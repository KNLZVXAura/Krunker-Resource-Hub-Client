// ── Stats by time of day and weekday ──
// Groups the saved sessions by the part of the day and the day of the week they started in (local time), to show when you
// play best. A session is counted where it started, even if it ran past the end of that block. Pure functions only.

export interface HourSession { start: number; kills: number; deaths: number; seconds: number }

export interface HourBucket {
  label: string;
  kills: number;
  deaths: number;
  seconds: number;
  sessions: number;
  /** Kills divided by deaths (just the kills when there are no deaths). */
  kd: number;
  /** Kills per hour of play. */
  kph: number;
}

/** Enough data before a block is compared with the others. */
export const MIN_BUCKET_SESSIONS = 3;
export const MIN_BUCKET_SECONDS = 30 * 60;

const BLOCKS = [
  { label: 'Night (00-05)', from: 0, to: 5 },
  { label: 'Morning (06-11)', from: 6, to: 11 },
  { label: 'Afternoon (12-17)', from: 12, to: 17 },
  { label: 'Evening (18-23)', from: 18, to: 23 },
] as const;

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;

function make(label: string): HourBucket {
  return { label, kills: 0, deaths: 0, seconds: 0, sessions: 0, kd: 0, kph: 0 };
}

function finish(b: HourBucket): HourBucket {
  b.kd = b.deaths > 0 ? b.kills / b.deaths : b.kills;
  b.kph = b.seconds >= 60 ? (b.kills / b.seconds) * 3600 : 0;
  return b;
}

export function byTimeOfDay(sessions: readonly HourSession[]): HourBucket[] {
  const out = BLOCKS.map((b) => make(b.label));
  for (const s of sessions) {
    const h = new Date(s.start).getHours();
    const i = BLOCKS.findIndex((b) => h >= b.from && h <= b.to);
    if (i < 0) continue;
    const b = out[i];
    b.kills += s.kills; b.deaths += s.deaths; b.seconds += s.seconds; b.sessions += 1;
  }
  return out.map(finish);
}

export function byWeekday(sessions: readonly HourSession[]): HourBucket[] {
  const out = DAYS.map((d) => make(d));
  for (const s of sessions) {
    const js = new Date(s.start).getDay(); // 0 = Sunday
    const b = out[(js + 6) % 7];
    b.kills += s.kills; b.deaths += s.deaths; b.seconds += s.seconds; b.sessions += 1;
  }
  return out.map(finish);
}

/** The block with the best K/D among those with enough data, or null when fewer than two blocks qualify (nothing to compare). */
export function bestBucket(buckets: readonly HourBucket[]): HourBucket | null {
  const ok = buckets.filter((b) => b.sessions >= MIN_BUCKET_SESSIONS && b.seconds >= MIN_BUCKET_SECONDS);
  if (ok.length < 2) return null;
  return ok.reduce((a, b) => (b.kd > a.kd || (b.kd === a.kd && b.kph > a.kph) ? b : a));
}
