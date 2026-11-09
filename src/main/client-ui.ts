// ── Shared CSS theme variables (used by both main page and tab bar) ──
export const THEME_CSS = `
:root {
  /* ── Surfaces ── */
  --krh-surface-card: rgba(255,255,255,0.04);
  --krh-surface-input: rgba(255,255,255,0.08);
  --krh-surface-hover: rgba(255,255,255,0.1);
  --krh-surface-hover-strong: rgba(255,255,255,0.15);
  --krh-surface-dialog: #1a1a1a;
  --krh-surface-raised: #212121;

  /* ── Text ── */
  --krh-text-primary: rgba(255,255,255,0.9);
  --krh-text-secondary: rgba(255,255,255,0.7);
  --krh-text-muted: rgba(255,255,255,0.5);
  --krh-text-faint: rgba(255,255,255,0.35);
  --krh-text-dim: rgba(255,255,255,0.3);
  --krh-text-info: #888;

  /* ── Borders ── */
  --krh-border-subtle: rgba(255,255,255,0.06);
  --krh-border-default: rgba(255,255,255,0.1);
  --krh-border-medium: rgba(255,255,255,0.15);
  --krh-border-focus: rgba(255,255,255,0.35);

  /* ── Accents ── */
  --krh-accent: #2b82f6;
  --krh-accent-hover: #4f97ff;
  --krh-accent-soft: rgba(43,130,246,0.16);
  --krh-green: #4CAF50;
  --krh-green-hover: #66bb6a;
  --krh-red: #ef5350;
  --krh-red-hover: #e57373;
  --krh-blue: #42a5f5;
  --krh-blue-hover: #64b5f6;
  --krh-orange: #ff9800;
  --krh-orange-hover: #ffb74d;
  --krh-yellow: #ffc107;
  --krh-magenta: #fc03ec;

  /* ── Controls ── */
  --krh-toggle-off: rgba(255,255,255,0.12);

  /* ── Modal / dialog surfaces (shared across popups) ── */
  --krh-modal-bg: #1a1a1a;
  --krh-modal-border: 1px solid rgba(255,255,255,0.08);
  --krh-modal-radius: 14px;
  --krh-modal-shadow: 0 20px 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.02);
  --krh-overlay-bg: rgba(0,0,0,0.6);
  --krh-overlay-blur: 6px;

  /* ── Z-index layers ── */
  --krh-z-notification: 100000;
  --krh-z-overlay: 10000000;
  --krh-z-popup: 10000001;
}
`;

// ── Injected CSS for client settings in Krunker's settings panel ──
export const CLIENT_SETTINGS_CSS = `
${THEME_CSS}
/* -- Self-contained client settings design system (krh-* namespace) -- */
/* Deliberately avoids Krunker's own control classes so a Krunker restyle cannot
   leak into our settings. */

.krh-settings {
  /* Krunker's UI font so the menu reads as native (matches the matchmaker feed). */
  font-family: 'GameFont', sans-serif;
  color: var(--krh-text-secondary);
  font-size: 14px;
}

/* -- Header band -- */
.krh-header {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 14px 6px 16px;
  border-bottom: 1px solid var(--krh-border-default);
}
.krh-header-mark {
  width: 40px;
  height: 40px;
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
}
.krh-header-mark img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  -webkit-user-select: none;
  user-select: none;
}
.krh-header-name {
  font-size: 15px;
  font-weight: 500;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--krh-text-primary);
}
.krh-header-ver { font-size: 11px; color: var(--krh-text-muted); }
.krh-header-issues {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 11px;
  border: 1px solid var(--krh-border-default);
  border-radius: 999px;
  background: var(--krh-surface-card);
  color: var(--krh-text-secondary);
  font-size: 12.5px;
  cursor: pointer;
  user-select: none;
  transition: background 0.12s, border-color 0.12s, color 0.12s;
}
.krh-header-issues:hover {
  background: var(--krh-surface-hover);
  border-color: var(--krh-border-medium);
  color: var(--krh-text-primary);
}
.krh-issues-mark { width: 15px; height: 15px; flex: none; color: var(--krh-text-muted); }
.krh-header-issues:hover .krh-issues-mark { color: var(--krh-accent); }
.krh-issues-count {
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--krh-accent-soft);
  color: var(--krh-accent);
  font-size: 11px;
}
.krh-issues-count:empty { display: none; }

/* -- Shell: category rail + content pane -- */
.krh-shell { display: flex; align-items: flex-start; }
.krh-rail {
  flex: none;
  width: 170px;
  padding: 12px 8px;
  border-right: 1px solid var(--krh-border-default);
}
.krh-rail-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 9px;
  margin-bottom: 1px;
  border-radius: 7px;
  border-left: 2px solid transparent;
  cursor: pointer;
  user-select: none;
  color: var(--krh-text-secondary);
  transition: background 0.12s, color 0.12s;
}
.krh-rail-item .material-icons { font-size: 18px; color: var(--krh-text-muted); }
.krh-rail-label { font-size: 12.5px; }
.krh-rail-item:hover { background: var(--krh-surface-hover); }
.krh-rail-item.krh-active { background: var(--krh-accent-soft); border-left-color: var(--krh-accent); }
.krh-rail-item.krh-active .material-icons { color: var(--krh-accent); }
.krh-rail-item.krh-active .krh-rail-label { color: var(--krh-text-primary); }

.krh-pane { flex: 1; min-width: 0; padding: 4px 4px 8px 18px; }
.krh-cat-head {
  display: none;
  font-size: 13px;
  font-weight: 500;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--krh-text-muted);
  padding: 12px 0 4px;
  margin-top: 8px;
  border-bottom: 1px solid var(--krh-border-default);
}

/* search mode: hide the rail and stack every category with its heading */
.krh-settings.krh-searching .krh-rail { display: none; }
.krh-settings.krh-searching .krh-pane { padding-left: 4px; }
.krh-settings.krh-searching .krh-cat-head { display: block; }

/* -- Group cards -- */
.krh-group {
  background: rgba(255,255,255,0.024);
  border: 1px solid var(--krh-border-subtle);
  border-radius: 10px;
  padding: 2px 6px;
  margin-bottom: 10px;
}
.krh-group-label {
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--krh-text-dim);
  padding: 12px 11px 3px;
}
/* search mode: flatten the cards so results read as one plain list */
.krh-settings.krh-searching .krh-group { display: contents; }
.krh-settings.krh-searching .krh-group-label { display: none; }

/* -- Row -- */
.krh-row {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 6px 12px 11px;
  border-left: 2px solid transparent;
  border-bottom: 1px solid var(--krh-border-subtle);
  border-radius: 8px;
  transition: background 0.12s;
}
.krh-row:hover { background: rgba(255,255,255,0.035); }
.krh-row:last-child,
.krh-group > :last-child > .krh-row:last-child,
.krh-group > .krh-row:has(+ .krh-us-settings:empty:last-child) { border-bottom: none; }
.krh-row-main { flex: 1; min-width: 0; }
.krh-row-title {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  /* !important so Krunker's own settings text rules can't override the size. */
  font-size: 20px !important;
  font-weight: 700 !important;
  color: var(--krh-text-primary);
}
.krh-row-desc {
  font-size: 15px !important;
  letter-spacing: 0.5px;
  line-height: 1.6;
  /* dimmer than --krh-text-muted, matching the old crankshaft description shade */
  color: rgba(255, 255, 255, 0.4) !important;
  margin-top: 4px;
  max-width: 56ch;
  word-wrap: break-word;
}
.krh-row-desc a { color: var(--krh-blue); cursor: pointer; }
.krh-row-control {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
}
.krh-row-block { flex-direction: column; align-items: stretch; }
.krh-row-block .krh-row-control { margin-top: 6px; }
.krh-row-info { color: var(--krh-text-muted); }
.krh-row-hidden { display: none; }
.krh-row-dim { opacity: 0.55; }

/* flagged-row left edge (mirrors the strongest tag) */
.krh-row.krh-flag-reload  { border-left-color: var(--krh-blue); }
.krh-row.krh-flag-restart { border-left-color: var(--krh-orange); }
.krh-row.krh-flag-warn    { border-left-color: var(--krh-yellow); }
.krh-row.krh-flag-exp     { border-left-color: #ff8a3d; }
.krh-row.krh-flag-danger  { border-left-color: var(--krh-red); }

/* -- Tags -- */
.krh-tag {
  font-size: 9.5px;
  font-weight: 500;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  line-height: 1.5;
  padding: 1px 6px;
  border-radius: 4px;
  white-space: nowrap;
}
.krh-tag-reload  { background: rgba(66,165,245,0.16); color: var(--krh-blue); }
.krh-tag-restart { background: rgba(255,152,0,0.16);  color: var(--krh-orange); }
.krh-tag-warn    { background: rgba(255,193,7,0.16);  color: var(--krh-yellow); }
.krh-tag-exp     { background: rgba(255,138,61,0.16); color: #ff9a5a; }
.krh-tag-danger  { background: rgba(239,83,80,0.16);  color: var(--krh-red); }

/* -- Toggle -- */
.krh-toggle {
  position: relative;
  display: inline-block;
  width: 42px;
  height: 23px;
  flex: none;
}
.krh-toggle input { position: absolute; opacity: 0; width: 0; height: 0; }
.krh-toggle-track {
  position: absolute;
  inset: 0;
  border-radius: 23px;
  background: var(--krh-toggle-off);
  cursor: pointer;
  transition: background 0.15s;
}
.krh-toggle-track::before {
  content: "";
  position: absolute;
  top: 3px;
  left: 3px;
  width: 17px;
  height: 17px;
  border-radius: 50%;
  background: #fff;
  transition: left 0.15s;
}
.krh-toggle input:checked + .krh-toggle-track { background: var(--krh-accent); }
.krh-toggle input:checked + .krh-toggle-track::before { left: 22px; }
.krh-toggle input:disabled + .krh-toggle-track { opacity: 0.5; pointer-events: none; }

/* -- Krunker's own import popup -- */
/* Krunker's textarea resizes freely with no max-width, so it overruns the panel. */
#importTxt { max-width: 100%; resize: vertical; }
.krh-import-groups {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin: 16px 2px 4px;
}
.krh-import-group {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  cursor: pointer;
}
.krh-import-group span {
  /* !important so Krunker's popup text rules can't override the size. */
  font-size: 19px !important;
  letter-spacing: 0.5px;
  color: var(--krh-text-secondary) !important;
}
.krh-import-group:hover span { color: var(--krh-text-primary) !important; }

/* -- Select + text input -- */
.krh-select, .krh-input {
  background: var(--krh-surface-input);
  border: 1px solid var(--krh-border-default);
  border-radius: 6px;
  color: var(--krh-text-primary);
  font-family: inherit;
  font-size: 13px;
  padding: 7px 10px;
  outline: none;
  transition: border-color 0.15s, background 0.15s;
}
.krh-select { cursor: pointer; min-width: 150px; }
.krh-input { min-width: 240px; }
.krh-select:hover, .krh-input:hover { border-color: var(--krh-border-medium); }
.krh-select:focus, .krh-input:focus { border-color: var(--krh-border-focus); }
.krh-select option { background: var(--krh-surface-raised); color: var(--krh-text-primary); }
.krh-input::placeholder { color: var(--krh-text-faint); }
.krh-health { display: inline-block; min-width: 46px; text-align: center; padding: 3px 9px; border-radius: 999px; font-size: 12px; font-weight: 600; }
.krh-health-ok { background: rgba(80, 200, 120, 0.18); color: #6fe3a0; }
.krh-health-warn { background: rgba(255, 180, 84, 0.18); color: #ffb454; }
.krh-health-bad { background: rgba(255, 90, 90, 0.2); color: #ff7b7b; }
.krh-health-off { background: rgba(255, 255, 255, 0.08); color: var(--krh-text-faint); }
.krh-key-warn { margin-top: 4px; font-size: 12px; line-height: 1.35; color: #ffb454; }

/* -- Color input -- */
.krh-color {
  width: 46px;
  height: 30px;
  padding: 2px;
  background: var(--krh-surface-input);
  border: 1px solid var(--krh-border-default);
  border-radius: 6px;
  cursor: pointer;
  outline: none;
  transition: border-color 0.15s;
}
.krh-color:hover { border-color: var(--krh-border-medium); }
.krh-color::-webkit-color-swatch-wrapper { padding: 0; }
.krh-color::-webkit-color-swatch { border: none; border-radius: 4px; }

/* -- Number (range + value) -- */
.krh-num { display: flex; align-items: center; gap: 12px; }
.krh-range {
  -webkit-appearance: none;
  appearance: none;
  width: 120px;
  height: 4px;
  border-radius: 3px;
  background: var(--krh-surface-hover);
  outline: none;
  cursor: pointer;
}
.krh-range::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 15px;
  height: 15px;
  border-radius: 50%;
  background: var(--krh-blue);
  cursor: pointer;
}
.krh-num-val {
  width: 58px;
  text-align: center;
  background: var(--krh-surface-input);
  border: 1px solid var(--krh-border-default);
  border-radius: 6px;
  color: var(--krh-text-primary);
  font-family: inherit;
  font-size: 13px;
  padding: 6px 4px;
  outline: none;
}
.krh-num-val:focus { border-color: var(--krh-border-focus); }

/* -- Keybind chip -- */
.krh-keyIcon {
  display: inline-block;
  min-width: 36px;
  text-align: center;
  background: var(--krh-surface-input);
  border: 1px solid var(--krh-border-medium);
  border-radius: 6px;
  padding: 5px 12px;
  font-size: 12px;
  color: var(--krh-text-secondary);
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s;
}
.krh-keyIcon:hover { border-color: var(--krh-border-focus); color: var(--krh-text-primary); }

/* -- Button -- */
.krh-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: var(--krh-surface-input);
  border: 1px solid var(--krh-border-medium);
  border-radius: 6px;
  padding: 7px 12px;
  font-size: 12.5px;
  color: var(--krh-text-secondary);
  cursor: pointer;
  white-space: nowrap;
  user-select: none;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}
.krh-btn:hover { background: var(--krh-surface-hover); border-color: var(--krh-border-focus); color: var(--krh-text-primary); }
.krh-btn:active { transform: scale(0.97); }
.krh-btn .material-icons { font-size: 16px; }

/* -- Multi-select grid -- */
.krh-multisel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.krh-clear-btn {
  cursor: pointer;
  font-size: 11px;
  line-height: 1;
  padding: 5px 12px;
  border-radius: 5px;
  color: var(--krh-text-muted);
  background: var(--krh-surface-input);
  border: 1px solid var(--krh-border-medium);
  white-space: nowrap;
  user-select: none;
}
.krh-clear-btn:hover { color: #fff; border-color: var(--krh-border-focus); }
.krh-multisel {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 6px;
  width: 100%;
}
.krh-multisel-has-icons { grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); }
.krh-opt {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 8px 10px;
  background: var(--krh-surface-card);
  border: 1px solid var(--krh-border-default);
  border-radius: 7px;
  cursor: pointer;
  user-select: none;
  transition: background 0.15s, border-color 0.15s;
}
.krh-opt:hover { background: var(--krh-surface-hover); }
.krh-opt input { display: none; }
.krh-opt-icon {
  width: 40px;
  height: 40px;
  border-radius: 4px;
  object-fit: cover;
  flex: none;
}
.krh-opt-name {
  flex: 1;
  min-width: 0;
  font-size: 12.5px;
  color: var(--krh-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.krh-opt-check {
  flex: none;
  width: 16px;
  height: 16px;
  border-radius: 4px;
  border: 1px solid var(--krh-border-focus);
  position: relative;
}
.krh-opt input:checked ~ .krh-opt-name { color: var(--krh-text-primary); }
.krh-opt input:checked ~ .krh-opt-check { background: var(--krh-accent); border-color: var(--krh-accent); }
.krh-opt input:checked ~ .krh-opt-check::after {
  content: "";
  position: absolute;
  left: 5px;
  top: 1px;
  width: 4px;
  height: 9px;
  border: solid #fff;
  border-width: 0 2px 2px 0;
  transform: rotate(45deg);
}


/* ── Backup & Reset page ── */
.krh-manage-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 8px;
}
.krh-manage-btn {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 11px 13px;
  background: var(--krh-surface-card);
  border: 1px solid var(--krh-border-default);
  border-radius: 8px;
  font-size: 13px;
  color: var(--krh-text-primary);
  cursor: pointer;
  user-select: none;
  transition: background 0.15s, border-color 0.15s;
}
.krh-manage-btn:hover { background: var(--krh-surface-hover); border-color: var(--krh-border-focus); }
.krh-manage-btn:active { transform: scale(0.98); }
.krh-manage-btn .material-icons { font-size: 17px; color: var(--krh-text-muted); }
.krh-dzone-label { color: rgba(239,83,80,0.75); }
.krh-dzone {
  border: 1px solid rgba(239,83,80,0.3);
  background: rgba(239,83,80,0.05);
  border-radius: 10px;
}
.krh-drow {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 11px 13px;
  border-bottom: 1px solid rgba(239,83,80,0.12);
}
.krh-drow:last-child { border-bottom: none; }
.krh-drow-main { flex: 1; min-width: 0; }
.krh-drow-title { font-size: 16px; color: var(--krh-text-primary); }
.krh-drow-desc { font-size: 13px; line-height: 1.4; color: var(--krh-text-muted); margin-top: 2px; }
.krh-dbtn {
  flex: none;
  background: transparent;
  color: var(--krh-red);
  border: 1px solid rgba(239,83,80,0.45);
  border-radius: 6px;
  padding: 6px 16px;
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  transition: background 0.15s;
}
.krh-dbtn:hover { background: rgba(239,83,80,0.12); }

/* floating toasts css that is required */
.krh-holder-update {
	position: absolute;
	font-size: 1.125rem !important;
	color: rgba(255, 255, 255, 0.7);
	display: block !important;
	top: 20px;
	left: 20px;
	background-color: black;
	padding: 1rem;
	border-radius: 0.5rem;
	width: max-content;
	z-index: 10;
}

/* settings refresh popup */
.refresh-popup {
	height: min-content;
	left: 50%;
	transform: translateX(-50%);
	color: rgba(255,255,255,0.6)
}
.refresh-popup span {
	display: flex;
	align-items: center;
	column-gap: 0.5rem;
	color: rgba(255,255,255,0.6);
}
.refresh-popup,
.refresh-popup span,
.refresh-popup a {
	vertical-align: middle;
	font-size: .8rem;
	line-height: .8rem;
	z-index: 12;
}
.refresh-popup svg { fill: rgba(255,255,255,0.6); }
.refresh-popup code {
    color: white;
    font-size: 1.2rem;
    line-height: 1.2rem;
	font-family: ui-monospace, 'Cascadia Code', 'Source Code Pro', Menlo, Consolas, 'DejaVu Sans Mono', monospace;
    background-color: #232323;
    padding: 0.08rem 0.4rem;
    border-radius: 3px;
    border: 2px solid #333333
}
/* ── Keybind capture dialog ── */
.krh-keybind-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: var(--krh-z-overlay);
  background: var(--krh-overlay-bg);
  backdrop-filter: blur(var(--krh-overlay-blur));
  -webkit-backdrop-filter: blur(var(--krh-overlay-blur));
  display: flex;
  align-items: center;
  justify-content: center;
}
.krh-keybind-dialog {
  background: var(--krh-modal-bg);
  border: var(--krh-modal-border);
  border-radius: var(--krh-modal-radius);
  box-shadow: var(--krh-modal-shadow);
  padding: 24px 32px;
  min-width: 400px;
  position: relative;
}
.krh-keybind-dialog-title {
  color: var(--krh-text-primary);
  font-size: 18px;
  margin-bottom: 6px;
}
.krh-keybind-dialog-sub {
  color: var(--krh-text-muted);
  font-size: 13px;
  margin-bottom: 16px;
}
.krh-keybind-dialog-sub code {
  color: #64b5f6;
}
.krh-keybind-dialog-modifiers {
  display: flex;
  gap: 8px;
  font-size: 14px;
}
.krh-keybind-modifier {
  background: var(--krh-surface-raised);
  color: var(--krh-text-faint);
  flex: 1;
  text-align: center;
  padding: 10px 0;
  border-radius: 6px;
  transition: background 0.15s, color 0.15s;
}
.krh-keybind-modifier.active {
  background: #1976d2;
  color: #fff;
}
.krh-keybind-dialog-cancel {
  position: absolute;
  top: 12px;
  right: 16px;
  color: #64b5f6;
  cursor: pointer;
  font-size: 14px;
}
.krh-keybind-dialog-cancel:hover {
  text-decoration: underline;
}
/* ── Preserved: color input, userscript meta ── */
.krh-color-input {
  width: 36px;
  height: 28px;
  border: 1px solid var(--krh-border-default);
  border-radius: 4px;
  background: transparent;
  cursor: pointer;
  padding: 0;
  flex-shrink: 0;
}
.krh-color-input::-webkit-color-swatch-wrapper {
  padding: 2px;
}
.krh-color-input::-webkit-color-swatch {
  border: none;
  border-radius: 2px;
}
.krh-us-meta {
  color: var(--krh-text-dim);
  font-size: 11px;
  margin-top: 2px;
}
.krh-us-settings {
  padding: 4px 0 4px 20px;
}
#chatList, #chatList * {
  user-select: text !important;
  cursor: text;
}
#chatList.krh-chat-paused {
  border-left: 2px solid var(--krh-yellow);
}
/* Dynamic chat clamp so the message list never overlaps menu items injected
   by KRH (e.g. Classic Social). Only applies when chat.ts adds the
   .krh-chat-clamped class, so Krunker's own clamp wins when ours is unset. */
#chatList.krh-chat-clamped {
  max-height: var(--krh-chat-max) !important;
}

/* ═══════════════ KRH "Prism" settings (v1.0) ═══════════════
   Complete re-layout: category TILES in a grid on top (icon over label, nothing can be clipped),
   settings as separate rounded cards underneath, violet to magenta accent, pill switches with
   ON / OFF text. Overrides the base rules above on purpose. */
:root {
  --krh-accent: #8b5cf6;
  --krh-accent-hover: #b39bff;
  --krh-accent-soft: rgba(139,92,246,0.16);
  --krh-accent-grad: linear-gradient(135deg, #8b5cf6 0%, #d946ef 100%);
  --krh-blue: #8fb4ff;
  --krh-toggle-off: rgba(255,255,255,0.1);
}
.krh-settings { font-size: 14px; }

/* header: one rounded banner */
.krh-header {
  margin: 2px 0 12px;
  padding: 10px 14px;
  gap: 12px;
  border: 1px solid rgba(139,92,246,0.35);
  border-radius: 14px;
  background: linear-gradient(120deg, rgba(139,92,246,0.24), rgba(217,70,239,0.08) 60%, rgba(255,255,255,0.02));
}
.krh-header-mark { width: 38px; height: 38px; }
.krh-header-name { font-size: 16px; font-weight: 800; letter-spacing: 0.08em; }
.krh-header-ver { display: inline-block; margin-top: 2px; padding: 1px 9px; border-radius: 999px; background: rgba(139,92,246,0.3); color: #e4dcff; font-size: 11px; }
.krh-header-issues { border-radius: 999px; border: 1px solid rgba(139,92,246,0.45); background: rgba(139,92,246,0.14); }
.krh-header-issues:hover { background: var(--krh-accent); border-color: var(--krh-accent); color: #fff; }
.krh-header-issues:hover .krh-issues-mark { color: #fff; }

/* shell: tiles on top, content below (was: rail on the left) */
.krh-shell { flex-direction: column; align-items: stretch; }
.krh-rail {
  width: auto;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(104px, 1fr));
  gap: 6px;
  padding: 0 0 12px;
  border-right: none;
  border-bottom: 1px solid var(--krh-border-default);
}
.krh-rail-item {
  flex-direction: column;
  justify-content: center;
  text-align: center;
  gap: 3px;
  min-height: 62px;
  margin: 0;
  padding: 8px 4px;
  border-radius: 12px;
  border-left: none;
  background: rgba(255,255,255,0.045);
  box-shadow: inset 0 0 0 1px rgba(255,255,255,0.06);
  transition: transform 0.12s, background 0.12s, box-shadow 0.12s;
}
.krh-rail-item .material-icons { font-size: 22px; }
.krh-rail-label { font-size: 11.5px; line-height: 1.15; letter-spacing: 0.02em; white-space: normal; }
.krh-rail-item:hover { background: rgba(139,92,246,0.16); transform: translateY(-1px); }
.krh-rail-item.krh-active { background: var(--krh-accent-grad); border-left: none; box-shadow: 0 6px 18px rgba(139,92,246,0.4); }
.krh-rail-item.krh-active .material-icons, .krh-rail-item.krh-active .krh-rail-label { color: #fff; }

.krh-pane { padding: 14px 2px 8px; }

/* groups: no box, a divider heading; every row is its own card */
.krh-group { background: none; border: none; border-radius: 0; padding: 0; margin-bottom: 18px; }
.krh-group-label { display: flex; align-items: center; gap: 12px; padding: 4px 2px 10px; font-weight: 800; letter-spacing: 0.16em; color: var(--krh-accent-hover); }
.krh-group-label::after { content: ""; flex: 1; height: 1px; background: linear-gradient(90deg, rgba(139,92,246,0.55), transparent); }
.krh-row {
  margin-bottom: 7px;
  padding: 12px 14px;
  border-radius: 12px;
  border-left-width: 3px;
  border-bottom: none;
  background: rgba(255,255,255,0.045);
  box-shadow: inset 0 0 0 1px rgba(255,255,255,0.06);
}
.krh-row:hover { background: rgba(139,92,246,0.1); }
.krh-row-title { font-size: 18px !important; }
.krh-row-desc { font-size: 14px !important; color: rgba(255,255,255,0.45) !important; }

.krh-tag { border-radius: 999px; padding: 1px 8px; }

/* toggle: pill with ON / OFF text */
.krh-toggle { width: 60px; height: 28px; }
.krh-toggle-track { border-radius: 999px; box-shadow: inset 0 0 0 1px rgba(255,255,255,0.1); }
.krh-toggle-track::before { top: 3px; left: 3px; width: 22px; height: 22px; box-shadow: 0 2px 5px rgba(0,0,0,0.45); transition: left 0.18s; }
.krh-toggle-track::after { content: "OFF"; position: absolute; right: 9px; top: 0; line-height: 28px; font-size: 9px; font-weight: 800; letter-spacing: 0.08em; color: rgba(255,255,255,0.45); }
.krh-toggle input:checked + .krh-toggle-track { background: var(--krh-accent-grad); box-shadow: 0 0 12px rgba(139,92,246,0.5); }
.krh-toggle input:checked + .krh-toggle-track::before { left: 35px; }
.krh-toggle input:checked + .krh-toggle-track::after { content: "ON"; right: auto; left: 10px; color: #fff; }

/* controls */
.krh-select, .krh-input, .krh-num-val { border-radius: 10px; background: rgba(0,0,0,0.3); }
.krh-select:focus, .krh-input:focus, .krh-num-val:focus { border-color: var(--krh-accent); }
.krh-keyIcon { border-radius: 8px; border-color: rgba(139,92,246,0.5); background: rgba(139,92,246,0.16); color: #e4dcff; font-weight: 700; }
.krh-keyIcon:hover { background: var(--krh-accent); border-color: var(--krh-accent); color: #fff; }
.krh-btn, .krh-clear-btn { border-radius: 10px; border-color: rgba(139,92,246,0.5); background: rgba(139,92,246,0.14); color: #e4dcff; }
.krh-btn:hover, .krh-clear-btn:hover { background: var(--krh-accent-grad); border-color: transparent; color: #fff; }
.krh-color { border-radius: 10px; }
.krh-range { height: 6px; border-radius: 999px; background: rgba(139,92,246,0.25); }
.krh-range::-webkit-slider-thumb { width: 17px; height: 17px; background: var(--krh-accent-grad); box-shadow: 0 0 0 3px rgba(255,255,255,0.9); }

/* multi-select tiles */
.krh-opt { border-radius: 10px; }
.krh-opt:hover { background: rgba(139,92,246,0.14); }
.krh-opt:has(input:checked) { background: rgba(139,92,246,0.2); border-color: var(--krh-accent); }
.krh-opt-check { border-radius: 50%; border-color: rgba(255,255,255,0.4); }
.krh-opt input:checked ~ .krh-opt-check { background: var(--krh-accent); border-color: var(--krh-accent); }
`;


// ── Matchmaker popup CSS + settings extras (injected separately) ──
export const MATCHMAKER_SETTINGS_CSS = `
@keyframes matchmakerPopupSlideDown {
  0% { transform: translate(-50%, -500%); }
  100% { transform: translate(-50%, 0%); }
}
#matchmakerPopupContainer {
  position: absolute;
  top: 8em;
  left: 50%;
  z-index: var(--krh-z-popup);
  box-sizing: border-box;
  width: 24em;
  padding: 18px 22px;
  border-radius: var(--krh-modal-radius);
  overflow: hidden;
  pointer-events: all;
  background: rgba(18,18,22,0.5);
  backdrop-filter: blur(14px) saturate(120%);
  -webkit-backdrop-filter: blur(14px) saturate(120%);
  border: var(--krh-modal-border);
  box-shadow: var(--krh-modal-shadow);
  display: flex;
  flex-direction: column;
  animation: matchmakerPopupSlideDown 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}
#matchmakerSearchStatus {
  font-size: 1.4em;
  color: var(--krh-blue);
  margin-bottom: 0.6em;
  text-align: center;
}
#matchmakerSearchFeed {
  display: flex;
  flex-direction: column;
  gap: 0.15em;
  overflow: hidden;
  min-height: 5.6em;
  margin-bottom: 0.6em;
}
@keyframes mmFeedSlideIn {
  from { opacity: 0; transform: translateX(1em); }
  to { opacity: 1; transform: translateX(0); }
}
.mm-feed-entry {
  display: flex;
  gap: 0.8em;
  padding: 0.2em 0.5em;
  font-size: 0.95em;
  font-family: 'GameFont', monospace;
  border-radius: 0.2em;
  animation: mmFeedSlideIn 0.12s ease forwards;
}
.mm-feed-entry.mm-pass { background: rgba(76,175,80,0.1); }
.mm-feed-entry.mm-pass .mm-feed-region { color: var(--krh-blue); }
.mm-feed-entry.mm-pass .mm-feed-map { color: var(--krh-text-primary, rgba(255,255,255,0.9)); }
.mm-feed-entry.mm-pass .mm-feed-players { color: var(--krh-green); }
.mm-feed-entry.mm-fail { background: rgba(255,255,255,0.02); }
.mm-feed-entry.mm-fail .mm-feed-region { color: var(--krh-text-dim, rgba(255,255,255,0.3)); }
.mm-feed-entry.mm-fail .mm-feed-map { color: var(--krh-text-muted, rgba(255,255,255,0.5)); }
.mm-feed-entry.mm-fail .mm-feed-players { color: var(--krh-red); }
.mm-feed-entry:last-child::before {
  content: '\\25B8 ';
  color: var(--krh-yellow);
}
.mm-feed-region { min-width: 2.5em; font-weight: bold; }
.mm-feed-map { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mm-feed-players { min-width: 3em; text-align: right; font-weight: 600; }
.mm-feed-icon {
  width: 1.7em;
  height: 1.7em;
  flex: none;
  object-fit: cover;
  border-radius: 0.25em;
  align-self: center;
  background: rgba(255,255,255,0.06);
}
.mm-feed-entry.mm-fail .mm-feed-icon { opacity: 0.45; }
.mm-feed-icon-found {
  width: 2.4em;
  height: 2.4em;
  border-radius: 0.3em;
}
/* Found-lobby reveal: the scroll settles on the match, then it grows into focus */
#matchmakerSearchFeed.mm-feed-found {
  justify-content: center;
}
.mm-feed-entry.mm-feed-landed {
  box-shadow: inset 0 0 0 2px var(--krh-blue);
}
@keyframes mmFoundGrow {
  0%   { opacity: 0; transform: scale(0.55); }
  65%  { opacity: 1; transform: scale(1.05); }
  100% { opacity: 1; transform: scale(1); }
}
.mm-feed-entry.mm-found {
  font-size: 1.25em;
  justify-content: center;
  gap: 0.7em;
  transform-origin: center;
  animation: mmFoundGrow 0.34s cubic-bezier(0.2, 0.85, 0.3, 1.25) forwards;
}
/* No-match reveal: parallels the found state before falling back to the server browser */
.mm-feed-entry.mm-notfound {
  font-size: 1.2em;
  justify-content: center;
  color: var(--krh-text-muted, rgba(255,255,255,0.55));
  background: rgba(255,255,255,0.03);
  transform-origin: center;
  animation: mmFoundGrow 0.34s cubic-bezier(0.2, 0.85, 0.3, 1.25) forwards;
}
.mm-feed-entry.mm-notfound::before { content: none; }
#matchmakerSearchStatus.mm-status-fail { color: var(--krh-red); }
#matchmakerSearchCounter {
  font-size: 0.85em;
  color: var(--krh-yellow);
  text-align: center;
  margin-bottom: 0.5em;
}
#matchmakerSearchCancel {
  text-align: center;
  border: 0.2em solid var(--krh-red);
  color: white;
  border-radius: 0.3em;
  font-size: 1.1em;
  background: rgba(0,0,0,0.3);
  padding: 0.2em 1.2em;
  cursor: pointer;
  margin: 0 auto;
  width: fit-content;
  transition: all 0.08s;
}
#matchmakerSearchCancel:hover {
  border-color: white;
  transform: scale(0.95);
}
#matchmakerSearchCancel:active {
  transform: scale(0.85);
}
`;

export const TRANSLATOR_CSS = `
/* !important so Krunker's settings text rules can't override the preview copy */
.krh-translation {
  color: var(--krh-tl-color, #88ff88) !important;
  font-style: var(--krh-tl-font-style, italic) !important;
  font-weight: var(--krh-tl-font-weight, normal) !important;
  -webkit-text-stroke-width: var(--krh-tl-stroke, 0) !important;
  margin-left: 8px;
  margin-top: 2px;
  overflow-wrap: anywhere;
}

/* settings-panel preview box (mock chat lines; the .krh-translation inside
   tracks the same --krh-tl-* vars as real chat) */
.krh-tl-preview {
  flex: 1;
  background: rgba(0,0,0,0.4);
  border: 1px solid var(--krh-border-subtle);
  border-radius: 6px;
  padding: 8px 12px;
  font-size: 15px;
  line-height: 1.5;
  color: #fff;
}
`;

// ── Alt Manager CSS ──
export const ALT_MANAGER_CSS = `
/* ── Shared account row (settings panel + in-game popup) ── */
.krh-acc-item {
  display: flex; align-items: center; gap: 11px;
  padding: 10px 2px; border-top: 1px solid rgba(255,255,255,0.06);
}
.krh-acc-avatar {
  width: 34px; height: 34px; border-radius: 50%; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  background: rgba(66,165,245,0.15); border: 1px solid rgba(66,165,245,0.3);
  color: #6ea8fe; font-weight: 600; font-size: 14px; overflow: hidden;
}
img.krh-acc-avatar { object-fit: cover; }
.krh-acc-item-label {
  flex: 1; min-width: 0; color: #fff; font-size: 14px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.krh-acc-item-actions { display: flex; gap: 8px; flex-shrink: 0; }
.krh-acc-switch, .krh-acc-delete {
  font-size: 12px; font-weight: 600; padding: 7px 13px; border-radius: 7px;
  cursor: pointer; font-family: inherit; transition: all 120ms ease;
}
.krh-acc-switch { border: 1px solid #42a5f5; background: rgba(66,165,245,0.15); color: #fff; }
.krh-acc-switch:hover { background: rgba(66,165,245,0.28); border-color: #6ea8fe; }
.krh-acc-delete { border: 1px solid rgba(239,83,80,0.4); background: rgba(255,255,255,0.03); color: #ff7b73; }
.krh-acc-delete:hover { background: rgba(239,83,80,0.18); border-color: #ff7b73; }
.krh-acc-empty { color: rgba(255,255,255,0.4); font-size: 13px; text-align: center; padding: 18px 0; }
.krh-acc-add-toggle {
  padding: 6px 16px; border: none; border-radius: 6px; cursor: pointer;
  font-size: 12px; font-weight: 600; font-family: inherit;
  background: var(--krh-accent); color: #fff;
}
.krh-acc-add-toggle:hover { background: var(--krh-accent-hover); }

/* ── Add Account form (themed inputs) ── */
.krh-acc-form { display: flex; flex-direction: column; gap: 9px; margin: 10px 0 4px; }
.krh-acc-form input {
  width: 100%; box-sizing: border-box; padding: 10px 12px; border-radius: 8px;
  border: 1px solid rgba(255,255,255,0.12); background: rgba(255,255,255,0.04); color: #fff;
  font-size: 13px; font-family: inherit; outline: none; transition: border-color 120ms ease;
}
.krh-acc-form input:focus { border-color: #42a5f5; }
.krh-acc-form input::placeholder { color: rgba(255,255,255,0.3); }
.krh-acc-form-buttons { display: flex; justify-content: flex-end; gap: 10px; margin-top: 4px; }
.krh-acc-form-buttons button {
  font-size: 13px; font-weight: 600; padding: 9px 18px; border-radius: 8px;
  cursor: pointer; font-family: inherit; transition: all 120ms ease;
}
.krh-acc-save { border: 1px solid #42a5f5; background: rgba(66,165,245,0.15); color: #fff; }
.krh-acc-save:hover { background: rgba(66,165,245,0.28); border-color: #6ea8fe; }
.krh-acc-cancel { border: 1px solid rgba(255,255,255,0.12); background: rgba(255,255,255,0.04); color: rgba(255,255,255,0.85); }
.krh-acc-cancel:hover { background: rgba(255,255,255,0.09); border-color: rgba(255,255,255,0.2); }

/* Full-width "+ Add Account" button (in-game popup) */
.krh-acc-add-btn {
  width: 100%; font-size: 13px; font-weight: 600; padding: 11px; border-radius: 8px; cursor: pointer;
  border: 1px dashed rgba(66,165,245,0.5); background: rgba(66,165,245,0.08); color: #6ea8fe;
  font-family: inherit; transition: all 120ms ease;
}
.krh-acc-add-btn:hover { background: rgba(66,165,245,0.15); border-color: #6ea8fe; }

/* ── In-game Alt Manager modal (themed, matches changelog/confirm) ── */
.krh-alt-backdrop {
  position: fixed; inset: 0; z-index: 99990;
  background: var(--krh-overlay-bg);
  backdrop-filter: blur(var(--krh-overlay-blur)); -webkit-backdrop-filter: blur(var(--krh-overlay-blur));
  display: flex; align-items: center; justify-content: center;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  animation: krh-alt-fade 180ms ease-out;
}
.krh-alt-modal {
  position: relative; background: var(--krh-modal-bg); border: var(--krh-modal-border);
  border-radius: var(--krh-modal-radius); box-shadow: var(--krh-modal-shadow);
  width: min(440px, 92vw); max-height: 80vh; overflow: hidden;
  display: flex; flex-direction: column; animation: krh-alt-rise 220ms cubic-bezier(0.16,1,0.3,1);
}
.krh-alt-modal::before {
  content: ''; position: absolute; top: 0; left: 0; right: 0; height: 2px;
  background: linear-gradient(90deg, #42a5f5, #6ea8fe 50%, #42a5f5);
}
.krh-alt-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 18px 22px 14px; border-bottom: 1px solid rgba(255,255,255,0.06);
}
.krh-alt-header h2 { margin: 0; color: #fff; font-size: 19px; font-weight: 600; letter-spacing: -0.01em; }
.krh-alt-header-left { display: flex; align-items: center; gap: 8px; }
.krh-alt-back, .krh-alt-close {
  cursor: pointer; color: rgba(255,255,255,0.5); width: 28px; height: 28px; font-size: 18px;
  display: flex; align-items: center; justify-content: center; border-radius: 6px; transition: all 120ms ease;
}
.krh-alt-back:hover, .krh-alt-close:hover { color: #fff; background: rgba(255,255,255,0.08); }
.krh-alt-body { padding: 14px 22px 20px; overflow-y: auto; }
.krh-alt-body::-webkit-scrollbar { width: 8px; }
.krh-alt-body::-webkit-scrollbar-track { background: transparent; }
.krh-alt-body::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 4px; }
.krh-alt-body::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.18); }
@keyframes krh-alt-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes krh-alt-rise { from { opacity: 0; transform: translateY(12px) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
`;

// ── HP enemy counter CSS ──
export const HP_COUNTER_CSS = `
.krh-hp-counter .pointVal {
  color: #ff4444; font-size: 15px; font-weight: bold;
}
`;

// ── Battle Pass Claim All CSS ──
export const BP_CLAIM_ALL_CSS = `
#claimAllBtn.disabled { opacity: 0.4; pointer-events: none; }
`;

// ── Rank progress tracker CSS ──
export const RANK_TRACKER_CSS = `
#krh-elo-tracker { width: 100%; margin: 8px 0; }
.krh-elo-info-row { display: flex; align-items: center; gap: 8px; }
.krh-rank-container { display: flex; align-items: center; gap: 4px; white-space: nowrap; font-size: 12px; color: #ccc; }
.krh-elo-rank-img { width: 20px; height: 20px; }
.krh-elo-bar-bg { flex: 1; height: 14px; background: rgba(255,255,255,0.1); border-radius: 7px; position: relative; overflow: hidden; }
.krh-elo-bar-fill { height: 100%; background: linear-gradient(90deg, #388E3C, #4CAF50); border-radius: 7px; transition: width 0.3s; }
.krh-elo-bar-text { position: absolute; top: 0; left: 0; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; font-size: 10px; color: #fff; text-shadow: 0 1px 2px rgba(0,0,0,0.5); }
#krh-rank-list-btn { position: absolute; bottom: 8px; right: 8px; cursor: pointer; padding: 6px 14px; border-radius: 6px; font-size: 12px; background: rgba(76,175,80,0.3); color: #4CAF50; border: 1px solid rgba(76,175,80,0.4); z-index: 1; }
#krh-rank-list-btn:hover { background: rgba(76,175,80,0.5); color: #fff; }
#krh-rank-overlay { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: var(--krh-overlay-bg); backdrop-filter: blur(var(--krh-overlay-blur)); -webkit-backdrop-filter: blur(var(--krh-overlay-blur)); z-index: 9998; display: flex; justify-content: center; align-items: center; }
.krh-rank-popup { background: var(--krh-modal-bg); border: var(--krh-modal-border); border-radius: var(--krh-modal-radius); padding: 20px 24px; min-width: 340px; max-width: 500px; box-shadow: var(--krh-modal-shadow); }
.krh-rank-popup-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; padding-bottom: 12px; border-bottom: 1px solid rgba(255,255,255,0.06); }
.krh-rank-popup-header h2 { margin: 0; color: #fff; font-size: 16px; font-weight: 600; letter-spacing: -0.01em; }
.krh-rank-popup-close { cursor: pointer; color: rgba(255,255,255,0.5); font-size: 14px; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; border-radius: 6px; transition: all 120ms ease; }
.krh-rank-popup-close:hover { color: #fff; background: rgba(255,255,255,0.08); }
.krh-rank-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; max-height: 60vh; overflow-y: auto; }
.krh-rank-grid::-webkit-scrollbar { width: 8px; }
.krh-rank-grid::-webkit-scrollbar-track { background: transparent; }
.krh-rank-grid::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 4px; }
.krh-rank-grid::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.18); }
.krh-rank-grid-item { display: flex; align-items: center; gap: 8px; padding: 6px 10px; background: rgba(255,255,255,0.05); border-radius: 6px; }
.krh-rank-grid-item img { width: 28px; height: 28px; }
.krh-rank-name { font-size: 13px; font-weight: 600; }
.krh-rank-elo { font-size: 11px; color: #888; }

/* Ranked queue button in ranked menu footer */
#krh-ranked-queue-btn {
  background-color: #5ce05a;
  color: #fff;
  border: none;
  border-radius: 9px;
  padding: 12px 14px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background 0.2s ease;
}
#krh-ranked-queue-btn:hover { background-color: #4bc94a; }
`;

// ── KRH watermark CSS ──
// Font/shadow inherit from Krunker (topLeftOld class in-game, matchInfoHolder on menu).
export const WATERMARK_CSS = `
.krh-watermark, .krh-watermark-ver { color: #fff; }
.krh-watermark-ver { margin-left: 6px; }
#krh-watermark-menu {
  display: inline-block;
  margin-left: 12px;
  vertical-align: middle;
}
`;

// ── Ban log search CSS (search box injected into Krunker's native KPD popup) ──
export const BANLOG_SEARCH_CSS = `
#krhBanlogSearch {
  display: block;
  box-sizing: border-box;
  width: calc(100% - 24px);
  margin: 6px auto 10px;
  padding: 8px 12px;
  font-size: 15px;
  color: var(--krh-text-primary);
  background: var(--krh-surface-input);
  border: 1px solid var(--krh-border-default);
  border-radius: 8px;
  outline: none;
  pointer-events: all;
}
#krhBanlogSearch::placeholder { color: var(--krh-text-muted); }
#krhBanlogSearch:focus { border-color: var(--krh-accent); background: var(--krh-surface-hover); }
#kpdCalls tr.krh-banlog-hide { display: none !important; }
`;

// ── More Krunker popup CSS ──
// Hides the official-client download promo and shrinks the fixed-width popup to the remaining options grid.
export const MORE_KRUNKER_POPUP_CSS = `
.moreKrunkerClient { display: none !important; }
.moreKrunkerPopup { width: auto !important; }
`;

/** Pre-concatenated CSS for single-call injection */
export const ALL_CLIENT_CSS = `${CLIENT_SETTINGS_CSS}\n${MATCHMAKER_SETTINGS_CSS}\n${TRANSLATOR_CSS}\n${ALT_MANAGER_CSS}\n${HP_COUNTER_CSS}\n${BP_CLAIM_ALL_CSS}\n${RANK_TRACKER_CSS}\n${WATERMARK_CSS}\n${BANLOG_SEARCH_CSS}\n${MORE_KRUNKER_POPUP_CSS}`;

/** Hides leftover ad container divs after the network-level URL block cancels their payloads. */
export const HIDE_ADS_CSS = `
.endAHolder,
#aHider,
#adCon,
#rightABox,
#aContainer,
#topRightAdHolder,
div#aContainer,
#braveWarning,
#topRightAdHolder {
  display: none !important;
}`;

/** Auto-clicks the cookie/GDPR consent banner so it doesn't block the UI. Polling-only — never use a MutationObserver here, see CLAUDE.md WebGL-hang note. */
export const CONSENT_DISMISS_JS = `
(function dismissConsent() {
  let attempts = 0;
  const timer = setInterval(() => {
    attempts++;
    const btn = document.querySelector('.fc-cta-consent, [aria-label="Consent"], .css-47sehv');
    if (btn) { btn.click(); clearInterval(timer); }
    if (attempts > 30) clearInterval(timer);
  }, 500);
})();`;
