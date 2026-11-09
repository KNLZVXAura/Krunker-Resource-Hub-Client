// ── Hotkey registry and conflict finder ──
// Every key the client listens for is listed here (the rebindable ones are read from the settings, the fixed ones are
// written out), so a setting can warn when a key combination is already taken. Pure functions only: no Electron, no DOM.

export interface HotkeyBind { key: string; ctrl: boolean; shift: boolean; alt: boolean }
export interface HotkeyEntry { id: string; label: string; combo: string }

/** Canonical form of a combination: modifiers in the order ctrl, alt, shift, then the key, all lower case. '' when empty. */
export function normalizeCombo(spec: string): string {
  const raw = String(spec || '').trim();
  if (!raw) return '';
  const parts = raw.split('+').map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return '';
  let ctrl = false;
  let alt = false;
  let shift = false;
  for (const p of parts.slice(0, -1)) {
    const l = p.toLowerCase();
    if (l === 'ctrl' || l === 'control') ctrl = true;
    else if (l === 'alt') alt = true;
    else if (l === 'shift') shift = true;
  }
  const key = parts[parts.length - 1].toLowerCase();
  if (!key) return '';
  return comboString(key, ctrl, alt, shift);
}

export function comboString(key: string, ctrl: boolean, alt: boolean, shift: boolean): string {
  return [ctrl ? 'ctrl' : '', alt ? 'alt' : '', shift ? 'shift' : '', key.toLowerCase()].filter(Boolean).join('+');
}

export function bindCombo(bind: HotkeyBind | undefined): string {
  if (!bind || !bind.key) return '';
  return comboString(bind.key, !!bind.ctrl, !!bind.alt, !!bind.shift);
}

/** Readable form such as "Ctrl+Alt+H" for messages. */
export function prettyCombo(combo: string): string {
  return combo.split('+').map((p) => (p.length <= 1 ? p.toUpperCase() : p.charAt(0).toUpperCase() + p.slice(1))).join('+');
}

const KEYBIND_LABELS: Record<string, string> = {
  reload: 'Reload page',
  newMatch: 'New match',
  copyGameLink: 'Copy game link',
  joinFromClipboard: 'Join from clipboard',
  devTools: 'Developer tools',
  matchmaker: 'Matchmaker',
  matchmakerCancel: 'Cancel matchmaker',
  fullscreenToggle: 'Fullscreen',
  screenshot: 'Screenshot',
  screenshotArea: 'Area screenshot',
  record: 'Record',
  recordPause: 'Pause recording',
  hubToggle: 'KRH website',
  dashboard: 'Dashboard',
  openSocial: 'Krunker Social',
  openEditor: 'Krunker Editor',
};

/** Keys that are written into the client and cannot be changed in the settings. */
export const FIXED_HOTKEYS: readonly HotkeyEntry[] = [
  { id: 'fixed-css-theme', label: 'Remove / restore the custom CSS theme', combo: 'ctrl+shift+f1' },
  { id: 'fixed-alt-1', label: 'Quick login (1st account)', combo: 'ctrl+alt+1' },
  { id: 'fixed-alt-2', label: 'Quick login (2nd account)', combo: 'ctrl+alt+2' },
  { id: 'fixed-alt-3', label: 'Quick login (3rd account)', combo: 'ctrl+alt+3' },
  { id: 'fixed-twitch', label: 'Twitch chat overlay', combo: 'ctrl+alt+t' },
  { id: 'fixed-spotify-play', label: 'Spotify play / pause', combo: 'ctrl+alt+p' },
  { id: 'fixed-spotify-next', label: 'Spotify next track', combo: 'ctrl+alt+n' },
  { id: 'fixed-spotify-prev', label: 'Spotify previous track', combo: 'ctrl+alt+b' },
  { id: 'fixed-spotify-card', label: 'Spotify overlay', combo: 'ctrl+alt+s' },
  { id: 'fixed-tab-close', label: 'Close tab', combo: 'ctrl+w' },
  { id: 'fixed-tab-next', label: 'Next tab', combo: 'ctrl+tab' },
  { id: 'fixed-tab-prev', label: 'Previous tab', combo: 'ctrl+shift+tab' },
  { id: 'fixed-tab-reopen', label: 'Reopen closed tab', combo: 'ctrl+shift+t' },
];

export interface ExtrasKeys {
  perfHud?: { key?: string };
  netHud?: { key?: string };
  streamerKey?: string;
  instantReplay?: { key?: string };
  sessionStats?: { key?: string };
  layoutEditorKey?: string;
  quickPlayKey?: string;
  chatFilterKey?: string;
  chatLogsKey?: string;
}

/** Every combination the client uses right now: the rebindable keys from the settings plus the fixed ones. */
export function collectHotkeys(binds: Record<string, HotkeyBind> | undefined, ex: ExtrasKeys | undefined): HotkeyEntry[] {
  const out: HotkeyEntry[] = [];
  for (const [id, bind] of Object.entries(binds || {})) {
    const combo = bindCombo(bind);
    if (combo) out.push({ id: 'bind-' + id, label: KEYBIND_LABELS[id] || id, combo });
  }
  const add = (id: string, label: string, spec: string | undefined): void => {
    const combo = normalizeCombo(spec || '');
    if (combo) out.push({ id, label, combo });
  };
  add('extra-perfHud', 'Frame-time HUD', ex?.perfHud?.key);
  add('extra-netHud', 'Network HUD', ex?.netHud?.key);
  add('extra-streamer', 'Streamer mode', ex?.streamerKey);
  add('extra-replay', 'Instant replay', ex?.instantReplay?.key);
  add('extra-stats', 'Session stats', ex?.sessionStats?.key);
  add('extra-layout', 'Overlay layout editor', ex?.layoutEditorKey);
  add('extra-quickPlay', 'Quick Play', ex?.quickPlayKey);
  add('extra-chatFilter', 'Chat filter', ex?.chatFilterKey);
  add('extra-chatLogs', 'Chat logs', ex?.chatLogsKey);
  out.push(...FIXED_HOTKEYS);
  return out;
}

/** Entries that already use `combo`, leaving out the entry being edited (`selfId`). */
export function findHotkeyConflicts(combo: string, selfId: string, entries: readonly HotkeyEntry[]): HotkeyEntry[] {
  const c = normalizeCombo(combo);
  if (!c) return [];
  return entries.filter((e) => e.id !== selfId && e.combo === c);
}

/** One-line warning for a settings row, or null when the combination is free. */
export function conflictMessage(combo: string, selfId: string, entries: readonly HotkeyEntry[]): string | null {
  const hits = findHotkeyConflicts(combo, selfId, entries);
  if (!hits.length) return null;
  const names = hits.slice(0, 3).map((h) => h.label).join(', ');
  return prettyCombo(normalizeCombo(combo)) + ' is already used by: ' + names + '. Pick another key, or one of the two will not work.';
}
