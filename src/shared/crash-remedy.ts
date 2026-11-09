// ── Targeted fixes offered after repeated crashes ──
// When the client did not close properly several times in a row it offers Safe Mode. These two extra choices go after the
// most likely cause instead of switching everything off: the settings change made just before, and the userscript that was
// edited most recently. Pure functions only: the main process applies them.

import type { HistoryEntry } from './settings-history';

/** A settings change older than this is not blamed. */
export const UNDO_MAX_AGE_MS = 3 * 86_400_000;
/** A script file not edited within this time is not blamed. */
export const SCRIPT_RECENT_MS = 14 * 86_400_000;

/** Categories whose value includes a folder path: not restored at start-up (the path would have to be kept). */
export const NOT_UNDONE_AT_START: ReadonlySet<string> = new Set(['userscripts', 'swapper']);

export function undoCandidate(entry: HistoryEntry | null, now: number): HistoryEntry | null {
  if (!entry || NOT_UNDONE_AT_START.has(entry.key)) return null;
  if (!(entry.at <= now) || now - entry.at > UNDO_MAX_AGE_MS) return null;
  return entry;
}

export interface ScriptInfo { name: string; mtime: number; enabled: boolean }

/** The script that is switched on and was edited most recently (within SCRIPT_RECENT_MS), or null. */
export function newestEnabledScript(files: readonly ScriptInfo[], now: number): ScriptInfo | null {
  let best: ScriptInfo | null = null;
  for (const f of files) {
    if (!f.enabled || !(f.mtime <= now) || now - f.mtime > SCRIPT_RECENT_MS) continue;
    if (!best || f.mtime > best.mtime) best = f;
  }
  return best;
}
