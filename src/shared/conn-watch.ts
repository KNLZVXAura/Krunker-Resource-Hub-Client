// ── Connection watch ──
// Notices when the game connection keeps dropping soon after it was opened ("Lost Connection" right after joining), which
// is what a broken userscript causes. A drop counts when the socket lived less than `maxLifetimeMs` and closed with code
// 1005 or 1006 while the page was not being left. After `minCount` such drops within `windowMs` the client may offer to look
// for a script that causes it. Pure functions only.

export interface CloseEvent { at: number; lifetimeMs: number; code: number }

export const MIN_COUNT = 3;
export const WINDOW_MS = 10 * 60 * 1000;
export const MAX_LIFETIME_MS = 45_000;
const BAD_CODES = new Set([1005, 1006]);

export function countsAsDrop(e: CloseEvent): boolean {
  return BAD_CODES.has(e.code) && e.lifetimeMs >= 0 && e.lifetimeMs < MAX_LIFETIME_MS;
}

/** Adds an event (only drops are kept) and forgets those older than the window. */
export function addDrop(list: readonly CloseEvent[], e: CloseEvent): CloseEvent[] {
  const kept = list.filter((x) => e.at - x.at < WINDOW_MS);
  return countsAsDrop(e) ? [...kept, e].slice(-20) : kept;
}

export function shouldOffer(list: readonly CloseEvent[], now: number): boolean {
  return list.filter((x) => now - x.at < WINDOW_MS).length >= MIN_COUNT;
}

/** Keeps what comes over IPC to a known shape, or null. */
export function cleanClose(raw: unknown, now: number): CloseEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.code !== 'number' || !Number.isFinite(r.code) || typeof r.lifetimeMs !== 'number' || !Number.isFinite(r.lifetimeMs)) return null;
  return { at: now, code: Math.floor(r.code), lifetimeMs: Math.max(0, Math.min(86_400_000, Math.floor(r.lifetimeMs))) };
}
