// ── Weekly summary ──
// Sums up last calendar week (Monday to Sunday, local time) from the saved sessions, compares it with the week before and adds
// clear performance drops. A session counts in the week it started. Nothing is made up: a week without play gives no summary.
// Pure functions only.

import { previousWeekKey, weekKey } from './trends';

export interface SummarySession {
  start: number;
  kills: number;
  deaths: number;
  seconds: number;
  matches: number;
  mapKd: Record<string, { k: number; d: number }>;
}

export interface WeekTotals {
  sessions: number;
  seconds: number;
  kills: number;
  deaths: number;
  matches: number;
  kd: number;
  maps: Record<string, { k: number; d: number }>;
}

/** Start of the week "YYYY-MM-DD" (a Monday) in local milliseconds. */
export function weekStartMs(key: string): number {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
}

export function totalsFor(sessions: readonly SummarySession[], key: string): WeekTotals {
  const from = weekStartMs(key);
  const to = weekStartMs(key.replace(/\d{4}-\d{2}-\d{2}/, () => {
    const d = new Date(from); d.setDate(d.getDate() + 7);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }));
  const t: WeekTotals = { sessions: 0, seconds: 0, kills: 0, deaths: 0, matches: 0, kd: 0, maps: {} };
  for (const s of sessions) {
    if (s.start < from || s.start >= to) continue;
    t.sessions++; t.seconds += s.seconds; t.kills += s.kills; t.deaths += s.deaths; t.matches += s.matches;
    for (const [name, v] of Object.entries(s.mapKd ?? {})) {
      const m = t.maps[name] ?? (t.maps[name] = { k: 0, d: 0 });
      m.k += v.k; m.d += v.d;
    }
  }
  t.kd = t.deaths > 0 ? t.kills / t.deaths : t.kills;
  return t;
}

/** Hours and minutes: "5 h 20 min", "45 min". */
export function durationText(seconds: number): string {
  const min = Math.round(seconds / 60);
  return min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`;
}

/** Fewer kills plus deaths than this on a map and it is not named "best": too little to say anything. */
export const MIN_MAP_EVENTS = 20;
/** A week with less play than this gets no summary. */
export const MIN_SECONDS = 10 * 60;

export function bestMap(maps: Record<string, { k: number; d: number }>): { name: string; kd: number; events: number } | null {
  let best: { name: string; kd: number; events: number } | null = null;
  for (const [name, v] of Object.entries(maps)) {
    const events = v.k + v.d;
    if (events < MIN_MAP_EVENTS) continue;
    const kd = v.d > 0 ? v.k / v.d : v.k;
    if (!best || kd > best.kd) best = { name, kd, events };
  }
  return best;
}

export interface WeeklySummary { weekStart: string; lines: string[]; text: string }

/** The summary of the week before `now`, or null when that week had too little play. */
export function buildWeekly(sessions: readonly SummarySession[], now: number, perfFindings: readonly string[]): WeeklySummary | null {
  const last = previousWeekKey(weekKey(now));
  const a = totalsFor(sessions, last);
  if (!a.sessions || a.seconds < MIN_SECONDS) return null;
  const b = totalsFor(sessions, previousWeekKey(last));
  const lines: string[] = [];
  let first = `Last week: ${durationText(a.seconds)} played in ${a.sessions} session${a.sessions === 1 ? '' : 's'}, K/D ${a.kd.toFixed(2)}`;
  if (b.sessions && b.seconds >= MIN_SECONDS) first += ` (the week before: ${b.kd.toFixed(2)}, ${durationText(b.seconds)})`;
  lines.push(first + '.');
  const map = bestMap(a.maps);
  if (map) lines.push(`Best map: ${map.name}, K/D ${map.kd.toFixed(2)}.`);
  for (const f of perfFindings.slice(0, 2)) lines.push(f + '.');
  return { weekStart: last, lines, text: lines.join('\n') };
}
