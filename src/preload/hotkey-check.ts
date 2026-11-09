// Hotkey conflict check for the settings rows. The settings screen calls setHotkeyContext() once with the live key
// bindings and extras; the rows then ask whether a typed or captured key is already taken (see shared/hotkeys.ts).

import { collectHotkeys, conflictMessage, normalizeCombo, bindCombo } from '../shared/hotkeys';
import type { ExtrasKeys, HotkeyBind } from '../shared/hotkeys';

let binds: Record<string, HotkeyBind> = {};
let extras: ExtrasKeys = {};
/** Combinations typed in the settings since the screen was built (the extras object is a copy, so remember them here). */
const typed = new Map<string, string>();

export function setHotkeyContext(b: Record<string, HotkeyBind>, ex: ExtrasKeys): void {
  binds = b;
  extras = ex || {};
  typed.clear();
}

/** Remember the key a row was just set to, so later checks of other rows see it. */
export function noteHotkey(id: string, spec: string): void {
  typed.set(id, normalizeCombo(spec));
}

function entries(): ReturnType<typeof collectHotkeys> {
  return collectHotkeys(binds, extras).map((e) => (typed.has(e.id) ? { ...e, combo: typed.get(e.id) ?? '' } : e)).filter((e) => e.combo);
}

/** Warning for a typed combination such as "Ctrl+Alt+H", or null when it is free (or empty). */
export function checkCombo(selfId: string, spec: string): string | null {
  return conflictMessage(spec, selfId, entries());
}

/** Warning for a captured keybind object (F-keys, Ctrl+S and so on). */
export function checkBind(selfId: string, bind: HotkeyBind): string | null {
  return conflictMessage(bindCombo(bind), selfId, entries());
}
