// ── Ping history per region ──
// Every time the client measures the region pings (the same numbers the matchmaker uses) one sample per region is
// added to a bucket for the hour of the day. Over days this shows which region is usually fastest for you at what
// time. Old data fades: when an hour bucket holds many samples both its sum and its count are halved. Pure functions
// only (no Electron, no files), so the maths can be tested without a game.

export const REGION_NAMES: Record<string, string> = {
  SV: 'Silicon Valley', TOK: 'Tokyo', FRA: 'Frankfurt', MBI: 'Mumbai', SYD: 'Sydney',
  SIN: 'Singapore', DAL: 'Dallas', BHN: 'Bahrain', BRZ: 'Brazil', NY: 'New York',
};

export interface Bucket { sum: number; n: number }
export interface RegionHistory { hours: Bucket[]; lastAt: number }
export type PingHistory = Record<string, RegionHistory>;

/** Samples one hour bucket keeps before it halves (about two weeks of one sample every 5 minutes is far more). */
export const BUCKET_CAP = 60;
/** A region is sampled at most this often, so a burst of searches does not outweigh a quiet day. */
export const MIN_GAP_MS = 5 * 60 * 1000;

export function emptyRegion(): RegionHistory {
  return { hours: Array.from({ length: 24 }, () => ({ sum: 0, n: 0 })), lastAt: 0 };
}

/** Adds a sample. Returns true when it was kept (false: too soon after the last one, or not a usable number). */
export function addSample(history: PingHistory, code: string, ms: number, hour: number, now: number): boolean {
  if (!(code in REGION_NAMES) || !Number.isFinite(ms) || ms <= 0 || ms > 5000) return false;
  const h = Math.max(0, Math.min(23, Math.floor(hour)));
  const region = history[code] ?? (history[code] = emptyRegion());
  if (now - region.lastAt < MIN_GAP_MS) return false;
  const b = region.hours[h];
  b.sum += ms;
  b.n += 1;
  if (b.n > BUCKET_CAP) { b.sum /= 2; b.n = Math.round(b.n / 2); }
  region.lastAt = now;
  return true;
}

/** Keeps what was read from disk (or came over IPC) to the known shape. */
export function cleanHistory(raw: unknown): PingHistory {
  const out: PingHistory = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [code, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!(code in REGION_NAMES) || !value || typeof value !== 'object') continue;
    const v = value as Record<string, unknown>;
    const region = emptyRegion();
    if (Array.isArray(v.hours)) {
      for (let i = 0; i < 24; i++) {
        const b = v.hours[i] as Record<string, unknown> | undefined;
        const sum = b && typeof b.sum === 'number' && Number.isFinite(b.sum) ? Math.max(0, Math.min(1e7, b.sum)) : 0;
        const n = b && typeof b.n === 'number' && Number.isFinite(b.n) ? Math.max(0, Math.min(1000, Math.floor(b.n))) : 0;
        if (n > 0 && sum > 0) region.hours[i] = { sum, n };
      }
    }
    region.lastAt = typeof v.lastAt === 'number' && Number.isFinite(v.lastAt) ? v.lastAt : 0;
    if (region.hours.some((b) => b.n > 0)) out[code] = region;
  }
  return out;
}

export interface RegionSummary {
  code: string;
  name: string;
  samples: number;
  /** Average over every hour, weighted by the number of samples. */
  avg: number;
  /** Hours (0-23) with at least `minSamples` samples that averaged lowest and highest, or -1 when there are too few. */
  bestHour: number;
  worstHour: number;
}

/** One summary per region with data, fastest average first. */
export function summarise(history: PingHistory, minSamples = 3): RegionSummary[] {
  const rows: RegionSummary[] = [];
  for (const [code, region] of Object.entries(history)) {
    let sum = 0;
    let n = 0;
    let best = -1;
    let worst = -1;
    let bestAvg = Infinity;
    let worstAvg = -Infinity;
    region.hours.forEach((b, hour) => {
      sum += b.sum;
      n += b.n;
      if (b.n < minSamples) return;
      const avg = b.sum / b.n;
      if (avg < bestAvg) { bestAvg = avg; best = hour; }
      if (avg > worstAvg) { worstAvg = avg; worst = hour; }
    });
    if (n > 0) rows.push({ code, name: REGION_NAMES[code], samples: n, avg: sum / n, bestHour: best, worstHour: worst });
  }
  return rows.sort((a, b) => a.avg - b.avg);
}

/** Regions ranked by their average at one hour of the day (only those with enough samples in that hour). */
export function rankForHour(history: PingHistory, hour: number, minSamples = 3): { code: string; name: string; avg: number; n: number }[] {
  const h = Math.max(0, Math.min(23, Math.floor(hour)));
  const out: { code: string; name: string; avg: number; n: number }[] = [];
  for (const [code, region] of Object.entries(history)) {
    const b = region.hours[h];
    if (b && b.n >= minSamples) out.push({ code, name: REGION_NAMES[code], avg: b.sum / b.n, n: b.n });
  }
  return out.sort((a, b) => a.avg - b.avg);
}

export function hourLabel(hour: number): string {
  return String(hour).padStart(2, '0') + ':00';
}

export interface RegionSuggestion { code: string; name: string; avg: number; mine: number; hour: number }

/**
 * A region that is usually clearly faster than the current one around this hour, from the saved history.
 * Needs enough samples for the current region and the other one in this hour; "clearly faster" is at least 25 ms and at
 * least 40 % lower, the same rule the Network HUD uses for live numbers. Only a suggestion, nothing is switched.
 */
export function suggestForHour(history: PingHistory, hour: number, currentCode: string, minSamples = 3): RegionSuggestion | null {
  const h = Math.max(0, Math.min(23, Math.floor(hour)));
  const cur = history[currentCode]?.hours[h];
  if (!cur || cur.n < minSamples) return null;
  const mine = cur.sum / cur.n;
  const best = rankForHour(history, h, minSamples).find((r) => r.code !== currentCode);
  if (!best) return null;
  if (mine - best.avg >= 25 && best.avg <= mine * 0.6) return { code: best.code, name: best.name, avg: best.avg, mine, hour: h };
  return null;
}

export function suggestionText(s: RegionSuggestion): string {
  return `${s.name} is usually faster for you around ${hourLabel(s.hour)} (about ${Math.round(s.avg)} ms, here ${Math.round(s.mine)} ms)`;
}
