// ── KRH Dashboard window ──
// A launcher-style window (sidebar: Home, Scripts, Custom CSS, Resource Swapper, Settings) next to the game and the
// hub. It talks to the main process only
// through the `dash:*` channels registered here, and everything it receives from the page is validated again.

import { BrowserWindow, app, dialog, ipcMain, shell } from 'electron';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs';
import { basename, extname, join } from 'path';
import type { UserscriptManager } from './userscripts';
import { UserCssManager, safeCssName } from './user-css';
import { DASHBOARD_DATA_URL } from './dashboard-html';
import { FONT_IDS } from '../shared/look-options';
import { devWindowIcon } from './platform';
import { electronLog } from './logger';
import { showWindow } from './hub-window';
import { registerExtras, type ExtraDeps } from './dashboard-extras';
import { acceptScript, forgetScript } from './script-changes';

export interface DashboardDeps {
  version: string;
  swapDir: string;
  prefsPath: string;
  userCss: UserCssManager;
  userscripts: UserscriptManager | null;
  onCssChanged: () => void;
  play: () => void;
  /** Start (or switch) the game window on a specific krunker.io game link, e.g. the sandbox. */
  playUrl: (url: string) => void;
  openHub: () => void;
  /** Open a krunker.io page (social, editor, viewer) in its own window. */
  openWindow: (url: string) => void;
  openGameSettings: () => void;
  reloadGame: () => boolean;
  restartClient: () => void;
  /** True when closing the dashboard should end the app (no game and no hub window is showing). */
  quitWhenClosed: () => boolean;
  clearCache: () => Promise<void>;
  clearData: () => Promise<void>;
  openExternal: (url: string) => void;
  parent: () => BrowserWindow | null;
  /** True while the game window is on screen: the dashboard is then an overlay that only hides when closed. */
  gameVisible: () => boolean;
  /** The "show / hide the dashboard over the game" shortcut was pressed while the dashboard itself has focus. */
  isToggleKey: (input: { key: string; control: boolean; shift: boolean; alt: boolean }) => boolean;
  toggle: () => void;
  extra: ExtraDeps;
}

export const THEMES = ['aurora', 'sky', 'midnight', 'crimson', 'emerald', 'sunset', 'slate'] as const;
type ThemeId = typeof THEMES[number];
interface BgPrefs {
  mode: 'default' | 'file' | 'random' | 'url'; file: string; url: string;
  /** Darkening of a custom background picture, 0-90. */
  dim: number;
  theme: ThemeId; fx: boolean;
  /** How light the whole dashboard looks (glow, panels, text), 0-100. */
  bright: number;
  /** How solid the glass panels are, 0 (see-through) - 100 (solid). */
  glass: number;
  /** Motion in the dashboard (entrance, hover, glow drift). */
  anim: boolean;
  /** Font family id ('' = the default font), a custom installed font name, text color ('' = default) and size in %. */
  font: string; fontCustom: string; color: string; size: number;
}
const cleanLook = (r: Partial<BgPrefs>): Pick<BgPrefs, 'font' | 'fontCustom' | 'color' | 'size'> => ({
  font: FONT_IDS.includes(String(r.font ?? '')) ? String(r.font ?? '') : '',
  fontCustom: typeof r.fontCustom === 'string' ? r.fontCustom.replace(/[^A-Za-z0-9 _.-]/g, '').trim().slice(0, 40) : '',
  color: typeof r.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(r.color) ? r.color : '',
  size: clampInt(r.size, 80, 150, 100),
});
// 2.1.0: a lighter default look. Saved looks from 2.0.0.0 (no `ver`) get the new picture darkening once.
const DEFAULT_PREFS: BgPrefs = { mode: 'default', file: '', url: '', dim: 8, theme: 'aurora', fx: true, bright: 62, glass: 42, anim: true, font: '', fontCustom: '', color: '', size: 100 };
const clampInt = (v: unknown, lo: number, hi: number, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : d);
// Krunker's sandbox is the game itself (krunker.io/?sandbox), so it runs in the game window, not in a tab.
const SANDBOX_URL = 'https://krunker.io/?sandbox';
const PAGES: Record<string, string> = {
  social: 'https://krunker.io/social.html',
  editor: 'https://krunker.io/editor.html',
  viewer: 'https://krunker.io/viewer.html',
};
const MAX_SCRIPT_BYTES = 2 * 1024 * 1024;
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
const MAX_BG_BYTES = 15 * 1024 * 1024;
const LINKS = new Set([
  'https://github.com/KNLZVXAura/Krunker-Resource-Hub-Client/releases',
  'https://github.com/KNLZVXAura/Krunker-Resource-Hub-Client/issues',
  'https://github.com/KNLZVXAura/Krunker-Resource-Hub-Client',
]);

let win: BrowserWindow | null = null;
let registered = false;

function readPrefs(path: string): BgPrefs {
  try {
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as Partial<BgPrefs>;
    const mode = raw.mode === 'file' || raw.mode === 'random' || raw.mode === 'url' ? raw.mode : 'default';
    const migrated = (raw as { ver?: number }).ver === 2;
    const dim = migrated ? clampInt(raw.dim, 0, 90, DEFAULT_PREFS.dim) : DEFAULT_PREFS.dim;
    return {
      bright: clampInt(raw.bright, 0, 100, DEFAULT_PREFS.bright),
      glass: clampInt(raw.glass, 0, 100, DEFAULT_PREFS.glass),
      anim: raw.anim !== false,
      ...cleanLook(raw),
      mode,
      file: typeof raw.file === 'string' ? basename(raw.file) : '',
      url: typeof raw.url === 'string' && /^https:\/\//i.test(raw.url) && raw.url.length < 2000 ? raw.url : '',
      dim,
      theme: (THEMES as readonly unknown[]).includes(raw.theme) ? (raw.theme as ThemeId) : DEFAULT_PREFS.theme,
      fx: raw.fx !== false,
    };
  } catch { return { ...DEFAULT_PREFS }; }
}

function bgFiles(dir: string): string[] {
  try {
    return readdirSync(dir).filter((f) => IMAGE_EXT.has(extname(f).toLowerCase())).sort();
  } catch { return []; }
}

function imageDataUri(path: string): string {
  const ext = extname(path).toLowerCase();
  const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : ext === '.gif' ? 'image/gif' : 'image/jpeg';
  return `data:${mime};base64,${readFileSync(path).toString('base64')}`;
}

function safeScriptName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = basename(raw);
  return name === raw && !name.startsWith('.') && extname(name).toLowerCase() === '.js' && name.length <= 120 ? name : null;
}

export function openDashboard(deps: DashboardDeps): void {
  registerIpc(deps);
  if (win && !win.isDestroyed()) { showWindow(win); return; }
  win = new BrowserWindow({
    width: 1080,
    height: 720,
    minWidth: 820,
    minHeight: 560,
    show: false,
    backgroundColor: '#1a1a3a',
    title: 'KRH Dashboard',
    icon: devWindowIcon(),
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '..', 'preload', 'dashboard.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  // The page is ours: it never navigates and never opens windows of its own.
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.once('ready-to-show', () => { if (win && !win.isDestroyed()) showWindow(win); });
  // The dashboard is the first window: closing it with nothing else on screen ends the app (the hub is only hidden).
  win.on('close', () => { if (deps.quitWhenClosed()) app.quit(); });
  win.on('blur', () => floatDashboard(false));
  // The same shortcut that opens the dashboard over the game also puts it away again.
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && deps.gameVisible() && deps.isToggleKey(input)) { deps.toggle(); e.preventDefault(); }
  });
  win.on('closed', () => { win = null; });
  void win.loadURL(DASHBOARD_DATA_URL);
}

function registerIpc(deps: DashboardDeps): void {
  if (registered) return;
  registered = true;
  registerExtras(deps.extra);
  const backgroundsDir = join(deps.swapDir, 'backgrounds');
  const folder = (kind: unknown): string | null => {
    const dir = kind === 'scripts' ? deps.userscripts?.dir ?? null
      : kind === 'css' ? deps.userCss.dir
      : kind === 'swapper' ? deps.swapDir
      : kind === 'backgrounds' ? backgroundsDir
      : kind === 'logs' ? join(app.getPath('userData'), 'logs') : null;
    if (dir) { try { mkdirSync(dir, { recursive: true }); } catch { /* shown below if it fails */ } }
    return dir;
  };
  const pick = async (title: string, name: string, extensions: string[]): Promise<string | null> => {
    const parent = win && !win.isDestroyed() ? win : undefined;
    const opts = { title, properties: ['openFile' as const], filters: [{ name, extensions }] };
    const r = parent ? await dialog.showOpenDialog(parent, opts) : await dialog.showOpenDialog(opts);
    return r.canceled || !r.filePaths[0] ? null : r.filePaths[0];
  };

  ipcMain.handle('dash:info', () => ({
    version: deps.version, swapDir: deps.swapDir, prefs: readPrefs(deps.prefsPath),
    electron: process.versions.electron, chrome: process.versions.chrome, platform: process.platform + ' ' + process.arch,
  }));
  ipcMain.handle('dash:restart-client', () => { deps.restartClient(); return { ok: true }; });
  ipcMain.handle('dash:reload-game', () => ({ ok: deps.reloadGame() }));

  ipcMain.handle('dash:open', (_e, what: unknown) => {
    if (what === 'play') deps.play();
    else if (what === 'sandbox') deps.playUrl(SANDBOX_URL);
    else if (what === 'hub') deps.openHub();
    else if (what === 'game-settings') deps.openGameSettings();
    else if (typeof what === 'string' && PAGES[what]) deps.openWindow(PAGES[what]);
    else return { error: 'Unknown action' };
    return { ok: true };
  });
  ipcMain.handle('dash:link', (_e, url: unknown) => {
    if (typeof url === 'string' && LINKS.has(url)) deps.openExternal(url);
  });
  ipcMain.handle('dash:folder', async (_e, kind: unknown) => {
    const dir = folder(kind);
    if (dir) await shell.openPath(dir);
  });

  // ── Scripts ──
  ipcMain.handle('dash:scripts-list', async () => {
    const mgr = deps.userscripts;
    if (!mgr) return { disabled: true, files: [] };
    const scripts = await mgr.scanScripts();
    const tracker = await mgr.loadTracker(scripts);
    return { disabled: false, files: scripts.map((s) => ({ name: s.filename, enabled: tracker[s.filename] === true })).sort((a, b) => a.name.localeCompare(b.name)) };
  });
  ipcMain.handle('dash:scripts-toggle', async (_e, raw: unknown) => {
    const mgr = deps.userscripts;
    const name = safeScriptName(raw);
    if (!mgr || !name) return null;
    const scripts = await mgr.scanScripts();
    const tracker = await mgr.loadTracker(scripts);
    if (!(name in tracker)) return null;
    tracker[name] = !tracker[name];
    await mgr.saveTracker(tracker);
    return tracker[name];
  });
  ipcMain.handle('dash:scripts-delete', async (_e, raw: unknown) => {
    const mgr = deps.userscripts;
    const name = safeScriptName(raw);
    if (!mgr || !name) return false;
    try { rmSync(join(mgr.dir, name), { force: true }); } catch { return false; }
    forgetScript(name);
    await mgr.loadTracker(await mgr.scanScripts()); // prunes the deleted entry
    return true;
  });
  ipcMain.handle('dash:scripts-add', async () => {
    const mgr = deps.userscripts;
    if (!mgr) return { error: 'Turn on Userscripts in Settings > Client first.' };
    const src = await pick('Add userscript', 'JavaScript', ['js']);
    if (!src) return {};
    const wanted = safeScriptName(basename(src));
    if (!wanted) return { error: 'Pick a .js file.' };
    try {
      if (statSync(src).size > 2 * 1024 * 1024) return { error: 'That file is over 2 MB.' };
      let name = wanted;
      for (let i = 1; existsSync(join(mgr.dir, name)); i++) name = wanted.replace(/\.js$/i, `_${i}.js`);
      copyFileSync(src, join(mgr.dir, name));
      try { acceptScript(name, readFileSync(join(mgr.dir, name), 'utf-8')); } catch { /* reported as new at the next start */ }
      return { name };
    } catch (err) { return { error: (err as Error).message }; }
  });

  // The editor (like Tampermonkey's): read a script, save one (new or existing) and switch it on.
  ipcMain.handle('dash:script-read', async (_e, raw: unknown) => {
    const mgr = deps.userscripts;
    const name = safeScriptName(raw);
    if (!mgr || !name) return { error: 'Unknown script' };
    try { return { code: readFileSync(join(mgr.dir, name), 'utf-8') }; } catch { return { error: 'Could not read that script' }; }
  });
  ipcMain.handle('dash:script-save', async (_e, raw: unknown) => {
    const mgr = deps.userscripts;
    if (!mgr) return { error: 'Turn on Userscripts in Settings > Client > Userscripts and restart the client first.' };
    const r = (raw ?? {}) as { name?: unknown; code?: unknown; reload?: unknown };
    let wanted = typeof r.name === 'string' ? r.name.trim() : '';
    const code = typeof r.code === 'string' ? r.code : '';
    if (!code.trim()) return { error: 'The script is empty.' };
    if (Buffer.byteLength(code) > MAX_SCRIPT_BYTES) return { error: 'The script is over 2 MB.' };
    // No name typed: take @name from the userscript header, like Tampermonkey does
    if (!wanted) wanted = /^\s*\/\/\s*@name\s+(.+)$/m.exec(code)?.[1]?.trim() ?? 'script';
    // eslint-disable-next-line no-control-regex
    wanted = wanted.replace(/[\u0000-\u001f<>:"/\\|?*]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
    if (!/\.js$/i.test(wanted)) wanted += '.js';
    const name = safeScriptName(wanted);
    if (!name) return { error: 'Use a plain name for the script.' };
    try {
      writeFileSync(join(mgr.dir, name), code, 'utf-8');
      acceptScript(name, code);
      const tracker = await mgr.loadTracker(await mgr.scanScripts());
      tracker[name] = true;
      await mgr.saveTracker(tracker);
    } catch (err) { return { error: (err as Error).message }; }
    return { name, reloaded: r.reload === true ? deps.reloadGame() : false };
  });

  // ── Custom CSS files ──
  ipcMain.handle('dash:css-list', () => ({ files: deps.userCss.list() }));
  ipcMain.handle('dash:css-toggle', (_e, name: unknown) => { const r = deps.userCss.toggle(name); deps.onCssChanged(); return r; });
  ipcMain.handle('dash:css-delete', (_e, name: unknown) => { const r = deps.userCss.remove(name); deps.onCssChanged(); return r; });
  ipcMain.handle('dash:css-read', (_e, name: unknown) => {
    const text = deps.userCss.read(name);
    return text === null ? { error: 'Could not read that file' } : { css: text };
  });
  // Saved CSS goes live in the open game straight away (that is what makes the editor feel like Stylus).
  ipcMain.handle('dash:css-save', (_e, raw: unknown) => {
    const r = (raw ?? {}) as { name?: unknown; css?: unknown };
    let name = typeof r.name === 'string' ? r.name.trim() : '';
    if (name && !/\.css$/i.test(name)) name += '.css';
    const out = deps.userCss.save(name, r.css);
    if ('name' in out) deps.onCssChanged();
    return out;
  });
  ipcMain.handle('dash:css-add', async () => {
    const src = await pick('Add CSS file', 'CSS', ['css']);
    if (!src) return {};
    const r = deps.userCss.add(src);
    deps.onCssChanged();
    return r;
  });

  // ── Background ──
  ipcMain.handle('dash:bg-prefs', () => ({ prefs: readPrefs(deps.prefsPath), files: bgFiles(backgroundsDir) }));
  ipcMain.handle('dash:bg-save', (_e, raw: unknown) => {
    const r = (raw ?? {}) as Partial<BgPrefs>;
    const next: BgPrefs = {
      mode: r.mode === 'file' || r.mode === 'random' || r.mode === 'url' ? r.mode : 'default',
      file: typeof r.file === 'string' ? basename(r.file) : '',
      url: typeof r.url === 'string' && /^https:\/\//i.test(r.url) && r.url.length < 2000 ? r.url : '',
      dim: clampInt(r.dim, 0, 90, DEFAULT_PREFS.dim),
      theme: (THEMES as readonly unknown[]).includes(r.theme) ? (r.theme as ThemeId) : DEFAULT_PREFS.theme,
      fx: r.fx !== false,
      bright: clampInt(r.bright, 0, 100, DEFAULT_PREFS.bright),
      glass: clampInt(r.glass, 0, 100, DEFAULT_PREFS.glass),
      anim: r.anim !== false,
      ...cleanLook(r),
    };
    try { writeFileSync(deps.prefsPath, JSON.stringify({ ver: 2, ...next }, null, 2), 'utf-8'); }
    catch (err) { electronLog.warn('[KRH] Could not save the dashboard look:', (err as Error).message); }
    return true;
  });
  ipcMain.handle('dash:bg', () => {
    const prefs = readPrefs(deps.prefsPath);
    try {
      if (prefs.mode === 'url' && prefs.url) return { image: prefs.url };
      const files = bgFiles(backgroundsDir);
      const name = prefs.mode === 'random' ? files[Math.floor(Math.random() * files.length)]
        : prefs.mode === 'file' && files.includes(prefs.file) ? prefs.file : undefined;
      if (name) {
        const path = join(backgroundsDir, name);
        if (statSync(path).size <= MAX_BG_BYTES) return { image: imageDataUri(path) };
      }
    } catch (err) { electronLog.warn('[KRH] Dashboard background failed:', (err as Error).message); }
    return { image: '' };
  });
  ipcMain.handle('dash:bg-add', async () => {
    const src = await pick('Add background image', 'Images', ['png', 'jpg', 'jpeg', 'webp', 'gif']);
    if (!src) return {};
    try {
      if (!IMAGE_EXT.has(extname(src).toLowerCase())) return { error: 'Pick a PNG, JPEG, WebP or GIF image.' };
      if (statSync(src).size > MAX_BG_BYTES) return { error: 'That image is over 15 MB.' };
      mkdirSync(backgroundsDir, { recursive: true });
      let name = basename(src);
      const stem = name.slice(0, name.length - extname(name).length);
      for (let i = 1; existsSync(join(backgroundsDir, name)); i++) name = `${stem}_${i}${extname(src)}`;
      copyFileSync(src, join(backgroundsDir, name));
      return { name };
    } catch (err) { return { error: (err as Error).message }; }
  });

  // ── Clean-up tools ──
  ipcMain.handle('dash:clear-cache', async () => { await deps.clearCache(); return true; });
  ipcMain.handle('dash:clear-data', async () => {
    const parent = win && !win.isDestroyed() ? win : undefined;
    const opts = {
      type: 'warning' as const,
      buttons: ['Cancel', 'Clear Krunker data'],
      defaultId: 0,
      cancelId: 0,
      title: 'Clear Krunker data',
      message: 'Clear everything Krunker saved in this client?',
      detail: 'You will be signed out and Krunker\'s own settings (sensitivity, FOV, crosshair, keys) go back to default. KRH Client settings are kept.',
    };
    const r = parent ? await dialog.showMessageBox(parent, opts) : await dialog.showMessageBox(opts);
    if (r.response !== 1) return { cleared: false };
    await deps.clearData();
    return { cleared: true };
  });
}

// Re-exported so the main file can validate names the same way when it injects the CSS.
export { safeCssName };

/** Close the dashboard without the "quit when closed" rule (used by the lockdown). */
export function closeDashboard(): void {
  if (win && !win.isDestroyed()) win.destroy();
  win = null;
}

/** Hide the dashboard (used while a game is open, so it costs nothing). */
export function hideDashboard(): void {
  if (win && !win.isDestroyed()) win.hide();
}

/** True while the dashboard is on screen. */
export function isDashboardVisible(): boolean {
  return !!win && !win.isDestroyed() && win.isVisible() && !win.isMinimized();
}

/** True while the dashboard has the keyboard focus. */
export function isDashboardFocused(): boolean {
  return !!win && !win.isDestroyed() && win.isFocused();
}

/** Float the dashboard above a (fullscreen) game, or put it back to a normal window. */
export function floatDashboard(on: boolean): void {
  if (!win || win.isDestroyed()) return;
  try { win.setAlwaysOnTop(on, 'floating'); } catch { /* not supported on this platform */ }
}
