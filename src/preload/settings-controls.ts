// ── Settings UI toolkit ──
// Reusable building blocks for the injected Client settings tab: the row shell,
// safety/apply-level tags, the "needs refresh/restart" notification, the row
// factories (toggle/select/number/keybind/checkbox-grid/button/text/info). All
// markup is self-contained under the `krh-` namespace — it deliberately avoids
// Krunker's own control classes so a Krunker restyle can't leak into our settings.
// Consumers (settings-sections.ts + settings-render.ts) import and call these.

import type { Keybind } from '../main/config';
import { escapeHtml } from './utils';
import { openKeybindDialog, keybindDisplayString } from './keybind-dialog';

// ── Safety / apply-level tags ──
// Replaces Crankshaft's per-row coloured warning square. A row carries at most one
// safety tag (caution/experimental/unstable) plus one apply-level tag (reload /
// restart). "Instant" settings get no tag — applying instantly is the expected
// default, so only the exceptions are marked. A thin coloured left edge mirrors
// the strongest tag.

export interface FlagOpts {
  safety?: number;
  instant?: boolean;
  refreshOnly?: boolean;
  restart?: boolean;
}

const SAFETY_TAGS: Record<number, { kind: string; label: string; title: string }> = {
  2: { kind: 'warn', label: 'caution', title: 'Not recommended' },
  3: { kind: 'exp', label: 'experimental', title: 'Experimental' },
  4: { kind: 'danger', label: 'unstable', title: 'Experimental and unstable — use at your own risk' },
};

function tag(kind: string, label: string, title: string): string {
  return '<span class="krh-tag krh-tag-' + kind + '" title="' + escapeHtml(title) + '">' + label + '</span>';
}

/** Resolve flag options into a row-class suffix (left-edge colour) and tag HTML. */
function rowFlags(o: FlagOpts): { rowClass: string; tags: string } {
  const tags: string[] = [];
  let border = '';

  const s = o.safety || 0;
  const st = SAFETY_TAGS[s >= 4 ? 4 : s];
  if (st) { tags.push(tag(st.kind, st.label, st.title)); border = 'krh-flag-' + st.kind; }

  if (o.restart) {
    tags.push(tag('restart', 'restart', 'Requires a full client restart'));
    if (!border) border = 'krh-flag-restart';
  } else if (o.refreshOnly) {
    tags.push(tag('reload', 'reload', 'Reload the page (F5) to apply'));
    if (!border) border = 'krh-flag-reload';
  }

  return { rowClass: border, tags: tags.join('') };
}

// ── Refresh / restart notification ──
const enum RefreshLevel { none, refresh, restart }
let refreshLevel: number = RefreshLevel.none;
let refreshPopupEl: HTMLElement | null = null;

export function onSettingChanged(level: 'refresh' | 'restart'): void {
  const newLevel = level === 'restart' ? RefreshLevel.restart : RefreshLevel.refresh;
  if (newLevel > refreshLevel) refreshLevel = newLevel;
  updateRefreshNotification();
}

function updateRefreshNotification(): void {
  if (refreshLevel === RefreshLevel.none) {
    if (refreshPopupEl) { refreshPopupEl.remove(); refreshPopupEl = null; }
    return;
  }
  if (refreshPopupEl) { try { refreshPopupEl.remove(); } catch { /* noop */ } }
  refreshPopupEl = document.createElement('div');
  refreshPopupEl.className = 'krh-holder-update refresh-popup';
  if (refreshLevel === RefreshLevel.restart) {
    refreshPopupEl.innerHTML = '<span class="restart-msg">Restart the client fully to apply your changes</span>';
  } else {
    refreshPopupEl.innerHTML = '<span class="reload-msg">Reload the page with <code>F5</code> or <code>CTRL + R</code> to apply your changes</span>';
  }
  document.body.appendChild(refreshPopupEl);
}

/** Reset the refresh/restart notification — called by renderSettings on each (re)render. */
export function resetRefreshNotification(): void {
  refreshLevel = RefreshLevel.none;
  if (refreshPopupEl) { refreshPopupEl.remove(); refreshPopupEl = null; }
}

// ── Row shell ──
// Every settings row shares this scaffold: a "main" column (title + tags + desc)
// and a "control" slot. `descHtml` is treated as trusted HTML — the typed
// factories escape their text before passing it; bespoke callers pass safe markup.

export function createRowShell(
  label: string,
  descHtml: string,
  opts?: FlagOpts & { block?: boolean },
): { row: HTMLElement; control: HTMLElement } {
  const f = rowFlags(opts || {});
  const row = document.createElement('div');
  row.className = 'krh-row' + (f.rowClass ? ' ' + f.rowClass : '') + (opts?.block ? ' krh-row-block' : '');
  row.innerHTML =
    '<div class="krh-row-main">' +
      '<div class="krh-row-title">' + escapeHtml(label) + f.tags + '</div>' +
      (descHtml ? '<div class="krh-row-desc">' + descHtml + '</div>' : '') +
    '</div>' +
    '<div class="krh-row-control"></div>';
  const control = row.querySelector('.krh-row-control') as HTMLElement;
  return { row, control };
}

/** Shows (or clears) a small warning line under a row's description. Used for hotkey conflicts. */
export function setRowWarning(row: HTMLElement, message: string | null): void {
  const main = row.querySelector('.krh-row-main');
  if (!main) return;
  let warn = main.querySelector('.krh-key-warn') as HTMLElement | null;
  if (!message) { warn?.remove(); return; }
  if (!warn) {
    warn = document.createElement('div');
    warn.className = 'krh-key-warn';
    main.appendChild(warn);
  }
  warn.textContent = message;
}

/** A non-interactive row (info text, credits) with no control slot. */
export function createInfoRow(descHtml: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'krh-row krh-row-info';
  row.innerHTML = '<div class="krh-row-main"><div class="krh-row-desc">' + descHtml + '</div></div>';
  return row;
}

// ── Group card ──
// Wraps related rows in a faint card with an optional overline label. Builders
// append rows to the returned element instead of the panel body. In search mode
// the card chrome is flattened away (display: contents) so results read as a
// plain list.
export function createGroup(body: HTMLElement, label?: string): HTMLElement {
  const group = document.createElement('div');
  group.className = 'krh-group';
  if (label) {
    const l = document.createElement('div');
    l.className = 'krh-group-label';
    l.textContent = label;
    group.appendChild(l);
  }
  body.appendChild(group);
  return group;
}

// ── Keybind rows ──
export function createKeybindRow(label: string, desc: string, currentBind: Keybind, onBind: (bind: Keybind) => void, safety?: number, instant?: boolean, validate?: (bind: Keybind) => string | null): HTMLElement {
  const { row, control } = createRowShell(label, escapeHtml(desc), { safety, instant });
  if (validate) setRowWarning(row, validate(currentBind));
  control.innerHTML = '<span class="krh-keyIcon">' + escapeHtml(keybindDisplayString(currentBind)) + '</span>';
  const keyEl = control.querySelector('.krh-keyIcon') as HTMLElement;
  keyEl.addEventListener('click', () => {
    openKeybindDialog(label).then((newBind) => {
      keyEl.textContent = keybindDisplayString(newBind);
      if (validate) setRowWarning(row, validate(newBind));
      onBind(newBind);
    });
  });
  return row;
}

// Single-key picker (no modifiers) — used for keystroke overlay aux keys
export function createSimpleKeyRow(opts: {
  label: string;
  desc: string;
  value: string;
  onChange: (value: string) => void;
  safety?: number;
  instant?: boolean;
  /** Returns a warning for a key (for example a hotkey conflict) or null. */
  validate?: (value: string) => string | null;
}): HTMLElement {
  const { row, control } = createRowShell(opts.label, escapeHtml(opts.desc), { safety: opts.safety, instant: opts.instant });
  if (opts.validate) setRowWarning(row, opts.validate(opts.value));
  control.innerHTML = '<span class="krh-keyIcon">' + escapeHtml((opts.value || '?').toUpperCase()) + '</span>';
  const keyEl = control.querySelector('.krh-keyIcon') as HTMLElement;
  keyEl.addEventListener('click', () => {
    openKeybindDialog(opts.label, { simple: true }).then((bind) => {
      keyEl.textContent = bind.key.toUpperCase();
      if (opts.validate) setRowWarning(row, opts.validate(bind.key));
      opts.onChange(bind.key);
    });
  });
  return row;
}

// ── Toggle ──
export function createToggleRow(opts: {
  label: string;
  desc: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  restart?: boolean;
  disabled?: boolean;
  safety?: number;
  instant?: boolean;
  refreshOnly?: boolean;
}): HTMLElement {
  const { row, control } = createRowShell(opts.label, escapeHtml(opts.desc), opts);
  control.innerHTML =
    '<label class="krh-toggle">' +
      '<input type="checkbox"' + (opts.checked ? ' checked' : '') + (opts.disabled ? ' disabled' : '') + '>' +
      '<span class="krh-toggle-track"></span>' +
    '</label>';
  if (!opts.disabled) {
    const cb = control.querySelector('input[type="checkbox"]') as HTMLInputElement;
    cb.addEventListener('change', () => {
      opts.onChange(cb.checked);
      if (opts.restart) onSettingChanged('restart');
      else if (opts.refreshOnly) onSettingChanged('refresh');
    });
  }
  return row;
}

// ── Select ──
export function createSelectRow(opts: {
  label: string;
  desc: string;
  options: Array<{ value: string; label: string }>;
  value: string;
  onChange: (value: string) => void;
  restart?: boolean;
  safety?: number;
  instant?: boolean;
  refreshOnly?: boolean;
}): HTMLElement {
  const { row, control } = createRowShell(opts.label, escapeHtml(opts.desc), opts);
  const select = createSelect(opts.options, opts.value);
  select.addEventListener('change', () => {
    opts.onChange(select.value);
    if (opts.restart) onSettingChanged('restart');
    else if (opts.refreshOnly) onSettingChanged('refresh');
  });
  control.appendChild(select);
  return row;
}

/** Build a bare `.krh-select` element (shared by createSelectRow and bespoke rows). */
export function createSelect(options: Array<{ value: string; label: string }>, value: string): HTMLSelectElement {
  const select = document.createElement('select');
  select.className = 'krh-select';
  for (const o of options) {
    const option = document.createElement('option');
    option.value = o.value;
    option.textContent = o.label;
    if (o.value === value) option.selected = true;
    select.appendChild(option);
  }
  return select;
}

// ── Number (range + value) ──
export function createNumberRow(opts: {
  label: string;
  desc: string;
  min: number;
  max: number;
  value: number;
  onChange: (value: number) => void;
  step?: number;
  safety?: number;
  restart?: boolean;
  instant?: boolean;
  refreshOnly?: boolean;
}): HTMLElement {
  const step = opts.step || 1;
  const parse = step < 1 ? parseFloat : parseInt;
  const { row, control } = createRowShell(opts.label, escapeHtml(opts.desc), opts);
  control.innerHTML =
    '<div class="krh-num">' +
      '<input type="range" class="krh-range" min="' + opts.min + '" max="' + opts.max + '" step="' + step + '" value="' + opts.value + '">' +
      '<input type="number" class="krh-num-val" min="' + opts.min + '" max="' + opts.max + '" step="' + step + '" value="' + opts.value + '">' +
    '</div>';
  const rangeInput = control.querySelector('input[type="range"]') as HTMLInputElement;
  const numInput = control.querySelector('input[type="number"]') as HTMLInputElement;
  rangeInput.addEventListener('input', () => {
    numInput.value = rangeInput.value;
  });
  rangeInput.addEventListener('change', () => {
    const v = Math.max(opts.min, Math.min(opts.max, parse(rangeInput.value) || 0));
    rangeInput.value = String(v);
    numInput.value = String(v);
    opts.onChange(v);
    if (opts.restart) onSettingChanged('restart');
    else if (opts.refreshOnly) onSettingChanged('refresh');
  });
  numInput.addEventListener('change', () => {
    const v = Math.max(opts.min, Math.min(opts.max, parse(numInput.value) || 0));
    numInput.value = String(v);
    rangeInput.value = String(v);
    opts.onChange(v);
    if (opts.restart) onSettingChanged('restart');
    else if (opts.refreshOnly) onSettingChanged('refresh');
  });
  return row;
}

// ── Text input ──
export function createTextRow(opts: {
  label: string;
  desc: string;
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
  safety?: number;
  instant?: boolean;
  refreshOnly?: boolean;
  restart?: boolean;
  /** Returns a warning for the typed value (for example a hotkey conflict) or null. Checked while typing. */
  validate?: (value: string) => string | null;
}): { row: HTMLElement; input: HTMLInputElement } {
  const { row, control } = createRowShell(opts.label, escapeHtml(opts.desc), opts);
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'krh-input';
  if (opts.placeholder) input.placeholder = opts.placeholder;
  input.value = opts.value || '';
  if (opts.validate) {
    const check = opts.validate;
    setRowWarning(row, check(input.value.trim()));
    input.addEventListener('input', () => setRowWarning(row, check(input.value.trim())));
  }
  input.addEventListener('change', () => {
    opts.onChange(input.value.trim());
    if (opts.restart) onSettingChanged('restart');
    else if (opts.refreshOnly) onSettingChanged('refresh');
  });
  control.appendChild(input);
  return { row, input };
}

// ── Color input ──
// Native color picker. `onInput` fires continuously while the picker is open
// (live preview); `onChange` fires once on commit — persist there. Passing
// `defaultValue` adds a reset button beside the swatch.
export function createColorRow(opts: {
  label: string;
  desc: string;
  value: string;
  defaultValue?: string;
  onChange: (value: string) => void;
  onInput?: (value: string) => void;
  safety?: number;
  instant?: boolean;
  refreshOnly?: boolean;
  restart?: boolean;
}): HTMLElement {
  const { row, control } = createRowShell(opts.label, escapeHtml(opts.desc), opts);
  const input = document.createElement('input');
  input.type = 'color';
  input.className = 'krh-color';
  input.value = opts.value;
  if (opts.onInput) input.addEventListener('input', () => opts.onInput!(input.value));
  input.addEventListener('change', () => {
    opts.onChange(input.value);
    if (opts.restart) onSettingChanged('restart');
    else if (opts.refreshOnly) onSettingChanged('refresh');
  });
  if (opts.defaultValue !== undefined) {
    const def = opts.defaultValue;
    control.appendChild(makeButton({
      icon: 'restart_alt',
      title: 'Reset to default',
      onClick: () => {
        if (input.value === def) return;
        input.value = def;
        input.dispatchEvent(new Event('change'));
      },
    }));
  }
  control.appendChild(input);
  return row;
}

// ── Button row ──
// A row whose control slot holds one or more action buttons. Returns the row plus
// the control element so callers can inject extra controls (e.g. a select).
export interface RowButton { label?: string; icon?: string; title?: string; onClick: () => void; }

export function createButtonRow(opts: {
  label: string;
  desc: string;
  buttons: RowButton[];
}): { row: HTMLElement; control: HTMLElement } {
  const { row, control } = createRowShell(opts.label, escapeHtml(opts.desc), {});
  for (const b of opts.buttons) control.appendChild(makeButton(b));
  return { row, control };
}

/** Build a single `.krh-btn` element. */
export function makeButton(b: RowButton): HTMLElement {
  const btn = document.createElement('div');
  btn.className = 'krh-btn';
  if (b.title) btn.title = b.title;
  btn.innerHTML = (b.icon ? '<span class="material-icons">' + b.icon + '</span>' : '') + (b.label ? escapeHtml(b.label) : '');
  btn.addEventListener('click', b.onClick);
  return btn;
}

// ── Checkbox grid (multi-select) ──
export function createCheckboxGrid(opts: {
  header: string;
  items: Array<{ value: string; label: string; icon?: string }>;
  selected: string[];
  onChange: (selected: string[]) => void;
}): HTMLElement {
  const hasIcons = opts.items.some(it => it.icon);
  const row = document.createElement('div');
  row.className = 'krh-row krh-row-block krh-multisel-row';
  row.innerHTML =
    '<div class="krh-multisel-head">' +
      '<span class="krh-row-title">' + escapeHtml(opts.header) + '</span>' +
      '<span class="krh-clear-btn">Clear</span>' +
    '</div>';

  const grid = document.createElement('div');
  grid.className = 'krh-multisel' + (hasIcons ? ' krh-multisel-has-icons' : '');
  for (const item of opts.items) {
    const label = document.createElement('label');
    label.className = 'krh-opt';
    // input first so `input:checked ~ .krh-opt-name/.krh-opt-check` can style the
    // label (the input is visually hidden, so DOM order doesn't affect layout).
    label.innerHTML =
      (item.icon ? '<img class="krh-opt-icon" alt="" src="' + item.icon + '">' : '') +
      '<input type="checkbox"' + (opts.selected.includes(item.value) ? ' checked' : '') + '>' +
      '<span class="krh-opt-name">' + escapeHtml(item.label) + '</span>' +
      '<span class="krh-opt-check"></span>';
    const iconImg = label.querySelector('.krh-opt-icon') as HTMLImageElement | null;
    if (iconImg) iconImg.onerror = () => { iconImg.style.visibility = 'hidden'; };
    const cb = label.querySelector('input') as HTMLInputElement;
    cb.addEventListener('change', () => {
      if (cb.checked) {
        if (!opts.selected.includes(item.value)) opts.selected.push(item.value);
      } else {
        const idx = opts.selected.indexOf(item.value);
        if (idx >= 0) opts.selected.splice(idx, 1);
      }
      opts.onChange(opts.selected);
    });
    grid.appendChild(label);
  }

  const clearBtn = row.querySelector('.krh-clear-btn') as HTMLElement;
  clearBtn.setAttribute('onmouseenter', 'playTick()');
  clearBtn.addEventListener('click', () => {
    const w = window as any;
    if (typeof w.playSelect === 'function') w.playSelect();
    for (const cb of grid.querySelectorAll('input[type="checkbox"]')) {
      (cb as HTMLInputElement).checked = false;
    }
    opts.selected.length = 0;
    opts.onChange(opts.selected);
  });

  row.appendChild(grid);
  return row;
}
