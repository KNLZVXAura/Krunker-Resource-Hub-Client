// ── Weekly trends: is performance getting worse? ──
// FPS per map and ping per region are added up per calendar week (Monday to Sunday, local time). This week is compared with
// last week and only clear drops are reported, with enough measurements on both sides. It also keeps the date the client
// version last changed, so a drop can be put next to an update. Pure functions only.

export interface TrendBucket { sum: number; n: number }
export interface TrendWeek { fps: Record<string, TrendBucket>; ping: Record<string, TrendBucket> }
export interface Trends { weeks: Record<string, TrendWeek>; version: string; versionSince: number; /** Signature of the findings the player was last notified about. */ notified: string }

export const KEEP_WEEKS = 8;
export const MAX_NAMES = 200;
/** Measurements needed in each of the two weeks before a drop is reported. */
export const MIN_FPS_WINDOWS = 12;   // about one minute of play
export const MIN_PING_SAMPLES = 3;
/** A drop must be at least this much, in absolute terms and in percent. */
export const FPS_DROP_MIN = 10;
export const FPS_DROP_PCT = 15;
export const PING_RISE_MIN = 15;
export const PING_RISE_PCT = 25;

export function emptyTrends(): Trends { return { weeks: {}, version: '', versionSince: 0, notified: '' }; }

const p2 = (n: number): string => String(n).padStart(2, '0');

/** The Monday of the week of `ms` as "YYYY-MM-DD" (local time). */
export function weekKey(ms: number): string {
  const d = new Date(ms);
  const back = (d.getDay() + 6) % 7; // days since Monday
  const m = new Date(d.getFullYear(), d.getMonth(), d.getDate() - back);
  return `${m.getFullYear()}-${p2(m.getMonth() + 1)}-${p2(m.getDate())}`;
}

export function previousWeekKey(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return weekKey(new Date(y, m - 1, d - 7).getTime());
}

function nameOf(v: unknown): string {
  return typeof v === 'string' ? Array.from(v, (c) => (c.charCodeAt(0) < 32 ? ' ' : c)).join('').trim().slice(0, 40) : '';
}

function addTo(group: Record<string, TrendBucket>, name: string, value: number): void {
  if (!name) return;
  if (!(name in group) && Object.keys(group).length >= MAX_NAMES) return;
  const b = group[name] ?? (group[name] = { sum: 0, n: 0 });
  b.sum += value; b.n += 1;
}

function weekOf(t: Trends, key: string): TrendWeek {
  const w = t.weeks[key] ?? (t.weeks[key] = { fps: {}, ping: {} });
  const keys = Object.keys(t.weeks).sort();
  while (keys.length > KEEP_WEEKS) delete t.weeks[keys.shift() as string];
  return w;
}

export function addFps(t: Trends, map: unknown, fps: number, now: number): void {
  const name = nameOf(map);
  if (!name || !Number.isFinite(fps) || fps < 1 || fps > 1000) return;
  addTo(weekOf(t, weekKey(now)).fps, name, fps);
}

export function addPing(t: Trends, region: unknown, ms: number, now: number): void {
  const name = nameOf(region);
  if (!name || !Number.isFinite(ms) || ms <= 0 || ms > 5000) return;
  addTo(weekOf(t, weekKey(now)).ping, name, ms);
}

/** Remembers when the version changed (the first call with a new version sets the date). */
export function noteVersion(t: Trends, version: string, now: number): void {
  if (t.version !== version) { t.version = version; t.versionSince = now; }
}

export interface TrendFinding { kind: 'fps' | 'ping'; name: string; before: number; after: number; text: string }

export function compareWeeks(t: Trends, now: number): TrendFinding[] {
  const key = weekKey(now);
  const cur = t.weeks[key];
  const prev = t.weeks[previousWeekKey(key)];
  if (!cur || !prev) return [];
  const out: TrendFinding[] = [];
  for (const [name, a] of Object.entries(cur.fps)) {
    const b = prev.fps[name];
    if (!b || a.n < MIN_FPS_WINDOWS || b.n < MIN_FPS_WINDOWS) continue;
    const after = a.sum / a.n; const before = b.sum / b.n;
    if (before - after >= FPS_DROP_MIN && (before - after) / before * 100 >= FPS_DROP_PCT) {
      out.push({ kind: 'fps', name, before, after, text: `FPS on ${name} fell from ${Math.round(before)} to ${Math.round(after)}` });
    }
  }
  for (const [name, a] of Object.entries(cur.ping)) {
    const b = prev.ping[name];
    if (!b || a.n < MIN_PING_SAMPLES || b.n < MIN_PING_SAMPLES) continue;
    const after = a.sum / a.n; const before = b.sum / b.n;
    if (after - before >= PING_RISE_MIN && (after - before) / before * 100 >= PING_RISE_PCT) {
      out.push({ kind: 'ping', name, before, after, text: `Ping to ${name} rose from ${Math.round(before)} to ${Math.round(after)} ms` });
    }
  }
  return out.sort((x, y) => (y.before - y.after) / y.before - (x.before - x.after) / x.before || x.name.localeCompare(y.name));
}

/** Keeps what was read from disk to the known shape. */
export function cleanTrends(raw: unknown): Trends {
  const out = emptyTrends();
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;
  out.version = typeof r.version === 'string' ? r.version.slice(0, 20) : '';
  out.notified = typeof r.notified === 'string' ? r.notified.slice(0, 600) : '';
  out.versionSince = typeof r.versionSince === 'number' && Number.isFinite(r.versionSince) ? r.versionSince : 0;
  const weeks = r.weeks && typeof r.weeks === 'object' ? (r.weeks as Record<string, unknown>) : {};
  const clean = (g: unknown): Record<string, TrendBucket> => {
    const o: Record<string, TrendBucket> = {};
    if (!g || typeof g !== 'object') return o;
    for (const [k, v] of Object.entries(g as Record<string, unknown>)) {
      const name = nameOf(k);
      const b = v as Record<string, unknown> | null;
      if (!name || !b || typeof b !== 'object' || Object.keys(o).length >= MAX_NAMES) continue;
      const n = typeof b.n === 'number' && Number.isFinite(b.n) ? Math.max(0, Math.min(1e6, Math.floor(b.n))) : 0;
      const sum = typeof b.sum === 'number' && Number.isFinite(b.sum) ? Math.max(0, Math.min(1e9, b.sum)) : 0;
      if (n > 0) o[name] = { sum, n };
    }
    return o;
  };
  for (const key of Object.keys(weeks).filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k)).sort().slice(-KEEP_WEEKS)) {
    const w = weeks[key] as Record<string, unknown> | null;
    if (w && typeof w === 'object') out.weeks[key] = { fps: clean(w.fps), ping: clean(w.ping) };
  }
  return out;
}

/** A short signature of the findings, to notify only once for the same ones. */
export function signature(findings: readonly TrendFinding[], weekStart: string): string {
  return weekStart + '|' + findings.map((f) => f.kind + ':' + f.name).sort().join(',');
}
