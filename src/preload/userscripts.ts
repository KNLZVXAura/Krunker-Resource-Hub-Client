import { ipcRenderer, webFrame } from 'electron';

// ── Types ──

export interface ScriptMetadata {
  name: string;
  author: string;
  version: string;
  desc: string;
  src: string;
  license: string;
  runAt: 'document-start' | 'document-end';
  priority: number;
  /** Tampermonkey-style page filters: the script only runs on pages that match one of `match`/`include` and none of `exclude`. */
  match: string[];
  exclude: string[];
  /** Libraries to load first (only the ones the client ships are available, see main/userscript-libs). */
  require: string[];
}

export interface UserscriptSetting {
  title: string;
  type: 'bool' | 'num' | 'sel' | 'color' | 'keybind';
  value: unknown;
  desc?: string;
  min?: number;
  max?: number;
  step?: number;
  opts?: (string | number)[];
  changed?: (value: unknown) => void;
}

export interface UserscriptInstance {
  filename: string;
  content: string;
  meta: ScriptMetadata;
  enabled: boolean;
  executed: boolean;
  unload: (() => void) | null;
  settings: Record<string, UserscriptSetting> | null;
}

// ── State ──

const instances: UserscriptInstance[] = [];
const cssHandles = new Map<string, string>(); // identifier -> webFrame CSS key

// ── Metadata parser ──

export function parseMetadata(code: string): ScriptMetadata {
  const meta: ScriptMetadata = {
    name: '',
    author: '',
    version: '',
    desc: '',
    src: '',
    license: '',
    runAt: 'document-end',
    priority: 0,
    match: [],
    exclude: [],
    require: [],
  };

  const startMatch = code.match(/\/\/\s*==UserScript==/);
  const endMatch = code.match(/\/\/\s*==\/UserScript==/);
  if (!startMatch || !endMatch) return meta;

  const block = code.substring(
    startMatch.index! + startMatch[0].length,
    endMatch.index!,
  );

  for (const line of block.split('\n')) {
    const m = line.match(/\/\/\s*@(\S+)\s+(.*)/);
    if (!m) continue;
    const [, tag, val] = m;
    const v = val.trim();
    switch (tag) {
      case 'name': meta.name = v; break;
      case 'author': meta.author = v; break;
      case 'version': meta.version = v; break;
      case 'desc':
      case 'description': meta.desc = v; break;
      case 'src': meta.src = v; break;
      case 'license': meta.license = v; break;
      case 'run-at':
        if (v === 'document-start') meta.runAt = 'document-start';
        else meta.runAt = 'document-end';
        break;
      case 'priority':
        meta.priority = parseInt(v, 10) || 0;
        break;
      case 'match':
      case 'include': if (v) meta.match.push(v); break;
      case 'exclude': if (v) meta.exclude.push(v); break;
      case 'require': if (v) meta.require.push(v); break;
    }
  }

  return meta;
}

// ── CSS injection via webFrame ──

function toggleCSS(css: string, identifier: string, value: boolean): void {
  const existing = cssHandles.get(identifier);
  if (value) {
    if (existing) return; // already inserted
    const key = webFrame.insertCSS(css);
    cssHandles.set(identifier, key);
  } else {
    if (!existing) return;
    webFrame.removeInsertedCSS(existing);
    cssHandles.delete(identifier);
  }
}

// ── Tampermonkey compatibility: @match / @exclude and @require ──

/** www.krunker.io and krunker.io are the same site for these filters. */
function plainUrl(u: string): string { return u.replace('://www.', '://'); }

function patternToRegex(pattern: string): RegExp {
  let p = plainUrl(pattern.trim());
  if (/^[a-z*]+:\/\/[^/]+$/i.test(p)) p += '/*'; // "https://docs.krunker.io" means the whole site root
  const src = p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp('^' + src + '$', 'i');
}

/** True when the script may run on this page. A script with no @match/@include runs everywhere, as before. */
export function matchesPage(meta: ScriptMetadata, url: string = window.location.href): boolean {
  const here = plainUrl(url);
  try {
    if (meta.exclude.some((p) => patternToRegex(p).test(here))) return false;
    return !meta.match.length || meta.match.some((p) => patternToRegex(p).test(here));
  } catch { return true; }
}

const loadedLibs = new Set<string>();

/** Run the libraries a script asked for with @require. Only libraries bundled with the client exist; others are skipped. */
function loadRequires(meta: ScriptMetadata, _console: { warn: (...args: unknown[]) => void }): void {
  for (const url of meta.require) {
    if (loadedLibs.has(url)) continue;
    const code = ipcRenderer.sendSync('userscripts-require', url) as string;
    if (!code) { _console.warn('[KRH] Userscript library is not available offline, skipped:', url); continue; }
    try { new Function(code).call(window); loadedLibs.add(url); } catch (err) { _console.warn('[KRH] Userscript library failed:', url, err); }
  }
}

// ── Script execution ──

function executeScript(
  instance: UserscriptInstance,
  _console: { log: (...args: unknown[]) => void; warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void },
): void {
  if (instance.executed) return;
  loadRequires(instance.meta, _console);

  const context: Record<string, unknown> = {
    _console,
    _css(css: string, identifier: string, value: boolean) {
      toggleCSS(css, instance.filename + ':' + identifier, value);
    },
    unload: null as (() => void) | null,
    settings: null as Record<string, UserscriptSetting> | null,
  };

  try {
    // Wrap script so DOMContentLoaded listeners fire immediately if the
    // document is already loaded (scripts run after did-finish-load IPC).
    const wrapped = `
      if (document.readyState !== 'loading') {
        const _origAdd = EventTarget.prototype.addEventListener;
        EventTarget.prototype.addEventListener = function(type, fn, opts) {
          if ((this === window || this === document) && (type === 'DOMContentLoaded' || (type === 'load' && document.readyState === 'complete'))) {
            Promise.resolve().then(() => fn.call(this, new Event(type)));
            return;
          }
          return _origAdd.call(this, type, fn, opts);
        };
        try { ${instance.content}\n } finally { EventTarget.prototype.addEventListener = _origAdd; }
      } else { ${instance.content}\n }`;
    // Names Tampermonkey scripts expect: unsafeWindow is the page window here, GM_setClipboard copies text.
    const gmSetClipboard = (text: unknown): void => { void navigator.clipboard.writeText(String(text)).catch(() => { /* needs focus */ }); };
    const fn = new Function('unsafeWindow', 'GM_setClipboard', wrapped);
    const result = fn.apply(context, [window, gmSetClipboard]);

    // Script returned `this` — capture settings and unload
    if (result === context) {
      instance.unload = (typeof context.unload === 'function') ? context.unload as () => void : null;
      instance.settings = context.settings as Record<string, UserscriptSetting> | null;
    } else {
      instance.unload = null;
      instance.settings = null;
    }

    instance.executed = true;
    _console.log('[KRH] Userscript executed:', instance.meta.name || instance.filename);
  } catch (err) {
    _console.error('[KRH] Userscript error in', instance.filename, ':', err);
    // The main process counts repeated failures (a script that throws on every start gets switched off).
    try { ipcRenderer.send('userscript-error', instance.filename, String(err instanceof Error ? err.message : err).slice(0, 200)); } catch { /* ignore */ }
  }
}

// ── Apply saved preferences ──

async function applyPreferences(instance: UserscriptInstance): Promise<void> {
  if (!instance.settings) return;
  const saved = await ipcRenderer.invoke('userscripts-load-prefs', instance.filename);
  for (const key of Object.keys(instance.settings)) {
    if (key in saved) {
      const setting = instance.settings[key];
      setting.value = saved[key];
      if (typeof setting.changed === 'function') {
        try { setting.changed(setting.value); } catch { /* ignore callback errors */ }
      }
    }
  }
}

// ── Public API ──

export function getInstances(): UserscriptInstance[] {
  return instances;
}

export async function initUserscripts(
  _console: { log: (...args: unknown[]) => void; warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void },
): Promise<void> {
  const { scripts, tracker } = await ipcRenderer.invoke('userscripts-scan');
  if (!scripts || scripts.length === 0) {
    _console.log('[KRH] No userscripts found');
    return;
  }

  // Build instances
  for (const script of scripts) {
    const meta = parseMetadata(script.content);
    instances.push({
      filename: script.filename,
      content: script.content,
      meta,
      enabled: tracker[script.filename] === true,
      executed: false,
      unload: null,
      settings: null,
    });
  }

  // Sort by priority descending
  instances.sort((a, b) => b.meta.priority - a.meta.priority);

  // Execute document-start scripts
  for (const inst of instances) {
    if (inst.enabled && inst.meta.runAt === 'document-start' && matchesPage(inst.meta)) {
      executeScript(inst, _console);
      await applyPreferences(inst);
    }
  }

  // Execute document-end scripts
  const runDocEnd = () => {
    for (const inst of instances) {
      if (inst.enabled && inst.meta.runAt === 'document-end' && !inst.executed && matchesPage(inst.meta)) {
        executeScript(inst, _console);
        applyPreferences(inst);
      }
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', runDocEnd, { once: true });
  } else {
    runDocEnd();
  }

  _console.log('[KRH] Userscripts initialized:', instances.length, 'scripts loaded');
}

export function setScriptEnabled(
  filename: string,
  enabled: boolean,
  _console: { log: (...args: unknown[]) => void; warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void },
): { needsReload: boolean } {
  const inst = instances.find(i => i.filename === filename);
  if (!inst) return { needsReload: false };

  inst.enabled = enabled;

  // Update tracker
  const tracker: Record<string, boolean> = {};
  for (const i of instances) tracker[i.filename] = i.enabled;
  ipcRenderer.invoke('userscripts-set-tracker', tracker);

  if (!enabled) {
    if (inst.unload && inst.executed) {
      try {
        inst.unload();
        _console.log('[KRH] Userscript unloaded:', inst.meta.name || inst.filename);
      } catch (err) {
        _console.error('[KRH] Userscript unload error:', err);
      }
      inst.executed = false;
      inst.unload = null;
      inst.settings = null;
      return { needsReload: false };
    }
    // No unload function — need page reload to fully disable
    return { needsReload: inst.executed };
  } else {
    // Enabling
    if (!inst.executed) {
      executeScript(inst, _console);
      applyPreferences(inst);
      return { needsReload: false };
    }
    return { needsReload: false };
  }
}
