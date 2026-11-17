// ── "Krunker updated" watch ──
// Krunker updates often and an update tends to break userscripts. The client fingerprints the game's own script files (their
// addresses plus the ETag / Last-Modified the server sends for them). When the fingerprint changes and scripts that worked before
// start failing, a banner says so and offers the way out: check for newer versions from the KRH website, or switch the failing ones
// off. Nothing is sent anywhere. A different fingerprint alone says nothing (a CDN can answer differently), so the banner needs both
// the change and new failures. Pure functions only.

export interface Resource { url: string; tag: string }

/** A small non-cryptographic hash (FNV-1a, 53 bit), enough to tell two lists apart. */
export function hashText(text: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + c, 0x85ebca6b) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

/** The address without query and hash: ?v=123 style cache busters would make every start look like an update. */
export function normaliseUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.origin + u.pathname;
  } catch { return ''; }
}

/** One fingerprint for a list of the game's script files. Empty when there are too few to say anything. */
export function fingerprint(items: readonly Resource[]): string {
  const seen = new Map<string, string>();
  for (const it of items) {
    const u = normaliseUrl(it.url);
    if (u) seen.set(u, it.tag.slice(0, 120));
  }
  if (seen.size < 1) return '';
  return hashText([...seen.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([u, t]) => `${u}|${t}`).join('\n'));
}

export interface WatchState {
  /** Fingerprint of the last start. */
  fp: string;
  /** When the fingerprint last changed (0 = never seen a change). */
  changedAt: number;
  /** The scripts that were failing before the change. */
  before: string[];
  /** The scripts failing in the newest finished start (becomes `before` when the game changes). */
  lastFailing: string[];
  /** The banner was dismissed for the change that happened at this time. */
  dismissedFor: number;
  /** The in-game toast was shown for the change that happened at this time. */
  toastedFor: number;
}

export const emptyState = (): WatchState => ({ fp: '', changedAt: 0, before: [], lastFailing: [], dismissedFor: 0, toastedFor: 0 });

/** A change older than this is not blamed for failures any more. */
export const BLAME_DAYS = 5;
export const BLAME_MS = BLAME_DAYS * 24 * 3600 * 1000;

/** What a new fingerprint means for the saved state (a first start only remembers it). */
export function noteFingerprint(state: WatchState, fp: string, now: number): WatchState {
  if (!fp) return state;
  if (!state.fp) return { ...state, fp };
  if (state.fp === fp) return state;
  return { ...state, fp, changedAt: now, before: state.lastFailing.slice(), dismissedFor: 0, toastedFor: 0 };
}

export const newFailures = (failingNow: readonly string[], before: readonly string[]): string[] => failingNow.filter((f) => !before.includes(f));

export interface Banner { changedAt: number; scripts: string[] }

/** The banner to show, or null: a recent game change, nothing dismissed, and scripts failing now that were not failing before it. */
export function banner(state: WatchState, failingNow: readonly string[], now: number): Banner | null {
  if (!state.changedAt || now - state.changedAt > BLAME_MS || state.dismissedFor === state.changedAt) return null;
  const scripts = newFailures(failingNow, state.before);
  return scripts.length ? { changedAt: state.changedAt, scripts } : null;
}

/** Keeps the list of failing scripts of a finished start; during the blame period only scripts that were not blamed yet change it. */
export function noteFailing(state: WatchState, failingNow: readonly string[], now: number): WatchState {
  if (state.changedAt && now - state.changedAt <= BLAME_MS) return state; // `before` stays what it was before the game changed
  return { ...state, lastFailing: failingNow.slice(0, 100) };
}
