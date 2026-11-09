// ── Replay clips ──
// Names saved instant-replay clips after what happened (map, class, kill streak), keeps a small list with that information for
// the gallery in Settings > Extras, and checks the names used to rename a clip. The game page only tells the main process the
// map, class and streak; everything that becomes a file name is cleaned here. Pure functions only.

export interface ClipContext { map: string; cls: string; streak: number }

export interface ClipMeta {
  /** File name inside the recordings folder (no path). */
  file: string;
  /** Milliseconds since 1970 when the clip was saved. */
  at: number;
  map: string;
  cls: string;
  streak: number;
  seconds: number;
  size: number;
  /** A name the player chose (empty = show the automatic one). */
  title: string;
}

export const MAX_CLIPS = 500;
export const TITLE_MAX = 80;

/** Letters and digits kept, anything else becomes a single dash; cut to `max` characters. */
export function slug(text: string, max = 20): string {
  return text.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, max).replace(/-+$/g, '');
}

/** Keeps what the game page sends to a known shape (never trusted as a file name). */
export function cleanClipContext(raw: unknown): ClipContext {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const text = (v: unknown): string => (typeof v === 'string' ? Array.from(v, (c) => (c.charCodeAt(0) < 32 ? ' ' : c)).join('').trim().slice(0, 40) : '');
  const streak = typeof r.streak === 'number' && Number.isFinite(r.streak) ? Math.max(0, Math.min(999, Math.floor(r.streak))) : 0;
  return { map: text(r.map), cls: text(r.cls), streak };
}

/** Part of the file name that says what is in the clip: "_Sandstorm_Hunter_7streak" (empty when nothing is known). */
export function fileSuffix(c: ClipContext): string {
  const parts = [slug(c.map), slug(c.cls)].filter(Boolean);
  if (c.streak >= 2) parts.push(c.streak + 'streak');
  return parts.length ? '_' + parts.join('_') : '';
}

/** The title shown in the gallery when the player has not chosen one: "Sandstorm · Hunter · 7 kill streak". */
export function autoTitle(m: Pick<ClipMeta, 'map' | 'cls' | 'streak' | 'at'>): string {
  const parts = [m.map, m.cls].filter(Boolean);
  if (m.streak >= 2) parts.push(`${m.streak} kill streak`);
  return parts.length ? parts.join(' · ') : 'Clip';
}

const VIDEO = /\.(mp4|webm)$/i;

/** A clip file name that is safe to use inside the recordings folder. */
export function isClipFile(name: unknown): name is string {
  if (typeof name !== 'string' || name.length > 200 || !VIDEO.test(name) || name.startsWith('.') || name.includes('..')) return false;
  return !/[\\/:*?"<>|]/.test(name) && !Array.from(name).some((c) => c.charCodeAt(0) < 32);
}

/** Files that are clips even without saved information: the ones the client names itself. */
export function isAutoNamedClip(name: string): boolean {
  return isClipFile(name) && name.startsWith('Krunker_replay_');
}

/** A title the player typed, made safe as a file name, or null when nothing usable is left. */
export function cleanTitle(text: unknown): string | null {
  if (typeof text !== 'string') return null;
  const t = text.replace(/[^\p{L}\p{N} _().,&+-]+/gu, ' ').replace(/\s+/g, ' ').trim().replace(/^[.\s-]+/, '').slice(0, TITLE_MAX).trim();
  if (!t) return null;
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(t)) return null; // names Windows does not allow for files
  return t;
}

export function extensionOf(file: string): string {
  const m = VIDEO.exec(file);
  return m ? m[0].toLowerCase() : '';
}

/** Keeps a saved list to the known shape and size. */
export function cleanClipList(raw: unknown): ClipMeta[] {
  if (!Array.isArray(raw)) return [];
  const out: ClipMeta[] = [];
  for (const item of raw.slice(-MAX_CLIPS)) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    if (!isClipFile(r.file)) continue;
    const ctx = cleanClipContext({ map: r.map, cls: r.cls, streak: r.streak });
    const num = (v: unknown, hi: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(hi, v)) : 0);
    out.push({ file: r.file, at: num(r.at, 1e14), map: ctx.map, cls: ctx.cls, streak: ctx.streak, seconds: Math.round(num(r.seconds, 3600)), size: num(r.size, 1e12), title: cleanTitle(r.title) ?? '' });
  }
  return out;
}

export function sizeText(bytes: number): string {
  return bytes >= 1048576 ? (bytes / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(bytes / 1024)) + ' KB';
}
