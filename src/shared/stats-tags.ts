// ── Session labels ──
// A session can carry a short label ("ranked", "scrim", "casual" ...). The label stays until it is changed, so what you play
// next is counted under it. This module cleans labels and groups the saved sessions by label for the statistics panel.
// Pure functions only.

export const TAG_MAX = 20;
export const PRESET_TAGS: readonly string[] = ['ranked', 'scrim', 'casual', 'practice'];

/** A label the player typed (or that was read from disk), or '' when nothing usable is left. */
export function cleanTag(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.replace(/[^\p{L}\p{N} _+&.-]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, TAG_MAX).trim();
}

export interface TagSession { tag?: string; kills: number; deaths: number; seconds: number }

export interface TagBucket {
  /** The label, or '' for sessions without one. */
  tag: string;
  kills: number;
  deaths: number;
  seconds: number;
  sessions: number;
  kd: number;
  kph: number;
}

/** One bucket per label that has at least one session, most played first. Sessions without a label are one bucket with tag ''. */
export function byTag(sessions: readonly TagSession[]): TagBucket[] {
  const map = new Map<string, TagBucket>();
  for (const s of sessions) {
    const tag = cleanTag(s.tag).toLowerCase();
    const b = map.get(tag) ?? { tag, kills: 0, deaths: 0, seconds: 0, sessions: 0, kd: 0, kph: 0 };
    b.kills += s.kills; b.deaths += s.deaths; b.seconds += s.seconds; b.sessions += 1;
    map.set(tag, b);
  }
  return [...map.values()].map((b) => ({
    ...b,
    kd: b.deaths > 0 ? b.kills / b.deaths : b.kills,
    kph: b.seconds >= 60 ? (b.kills / b.seconds) * 3600 : 0,
  })).sort((a, b) => b.seconds - a.seconds || a.tag.localeCompare(b.tag));
}

/** Labels to offer in the picker: the presets plus every label already used, without duplicates (not case-sensitive). */
export function knownTags(sessions: readonly TagSession[], presets: readonly string[] = PRESET_TAGS): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of [...presets, ...sessions.map((s) => cleanTag(s.tag))]) {
    const k = t.toLowerCase();
    if (!t || seen.has(k)) continue;
    seen.add(k); out.push(t);
  }
  return out.slice(0, 20);
}
