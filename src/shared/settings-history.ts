// ── Settings history ──
// Every time a settings category is saved, the value it had before is kept (a short list, on this computer only) so a
// change can be undone later without restoring a whole backup. Changes to the same category within a few seconds are
// merged into one entry (dragging a slider is one change, not fifty). Pure functions only.

export interface HistoryEntry {
  id: string;
  at: number;
  /** Settings category (performance, game, extras ...). */
  key: string;
  /** The category as it was before this change (and before every change merged into this entry). */
  prev: unknown;
  /** Names of what changed, such as "netHud" or "fpsUnlocked", for the list. */
  fields: string[];
}

export const COALESCE_MS = 15_000;
export const MAX_ENTRIES = 40;
export const MAX_ENTRY_BYTES = 400_000;
export const MAX_TOTAL_BYTES = 4_000_000;

export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => k in (b as object) && sameValue((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

/** Names of the fields that differ between two values of a category (top level only). */
export function changedFields(prev: unknown, next: unknown): string[] {
  const a = (prev && typeof prev === 'object' ? prev : {}) as Record<string, unknown>;
  const b = (next && typeof next === 'object' ? next : {}) as Record<string, unknown>;
  const names = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...names].filter((k) => !sameValue(a[k], b[k])).sort();
}

/** "netHud" -> "Net hud" */
export function humanize(name: string): string {
  const spaced = name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim().toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function byteSize(v: unknown): number {
  try { return JSON.stringify(v)?.length ?? 0; } catch { return Infinity; }
}

/**
 * Adds a change to the list (newest last) and returns the new list. Nothing is added when nothing changed, when the old value
 * is too big to keep, or when merging brings the category back to how it was (then the entry is removed).
 */
export function recordChange(list: readonly HistoryEntry[], key: string, prev: unknown, next: unknown, now: number, newId: () => string): HistoryEntry[] {
  const out = list.slice();
  const last = out[out.length - 1];
  if (last && last.key === key && now - last.at < COALESCE_MS) {
    const fields = changedFields(last.prev, next);
    if (!fields.length) { out.pop(); return out; }
    out[out.length - 1] = { ...last, at: now, fields };
    return out;
  }
  const fields = changedFields(prev, next);
  if (!fields.length || byteSize(prev) > MAX_ENTRY_BYTES) return out;
  out.push({ id: newId(), at: now, key, prev, fields });
  while (out.length > MAX_ENTRIES) out.shift();
  let total = out.reduce((n, e) => n + byteSize(e.prev), 0);
  while (out.length > 1 && total > MAX_TOTAL_BYTES) { total -= byteSize(out[0].prev); out.shift(); }
  return out;
}

/** The list without the entry `id` and every newer entry of the same category (undoing one change also undoes the later ones). */
export function withoutUndone(list: readonly HistoryEntry[], id: string): HistoryEntry[] {
  const i = list.findIndex((e) => e.id === id);
  if (i < 0) return list.slice();
  const key = list[i].key;
  return list.filter((e, j) => !(e.key === key && j >= i));
}

/** Keeps what was read from disk to the known shape. */
export function cleanHistoryList(raw: unknown, allowedKeys: ReadonlySet<string>): HistoryEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: HistoryEntry[] = [];
  for (const item of raw.slice(-MAX_ENTRIES)) {
    if (!item || typeof item !== 'object') continue;
    const e = item as Record<string, unknown>;
    if (typeof e.id !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(e.id) || typeof e.key !== 'string' || !allowedKeys.has(e.key)) continue;
    if (typeof e.at !== 'number' || !Number.isFinite(e.at) || !e.prev || typeof e.prev !== 'object') continue;
    const fields = Array.isArray(e.fields) ? e.fields.filter((f): f is string => typeof f === 'string').slice(0, 30).map((f) => f.slice(0, 60)) : [];
    out.push({ id: e.id, at: e.at, key: e.key, prev: e.prev, fields });
  }
  return out;
}
