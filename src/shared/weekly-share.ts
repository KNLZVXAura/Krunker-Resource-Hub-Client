// ── Weekly stats for the KRH leaderboard ──
// If the player switched on "Share weekly stats with KRH", the website asks the client (through the bridge, see
// main/site-bridge.ts) for ONE small summary per calendar week: this week and last week, local time, Monday to Sunday. The
// numbers are only totals: minutes, sessions, kills, deaths, days played (at least 10 minutes), days in a row and the most
// played map. Nothing else leaves this computer. Pure functions only.

import { previousWeekKey, weekKey } from './trends';

export interface ShareSession {
  start: number;
  kills: number;
  deaths: number;
  seconds: number;
  /** How much each map was played in this session (the same numbers the history uses for "most played"). */
  maps: Record<string, number>;
}

export interface ShareWeek {
  /** The Monday, "YYYY-MM-DD", local time. */
  weekStart: string;
  minutes: number;
  sessions: number;
  kills: number;
  deaths: number;
  /** Days of this week with at least ACTIVE_DAY_SECONDS of play. */
  activeDays: number;
  /** Days in a row with that much play: the best run inside the week, or the run going on now when that is longer. */
  streakDays: number;
  bestMap: string;
}

/** A day counts as played from this much play. */
export const ACTIVE_DAY_SECONDS = 10 * 60;
/** The database refuses weeks without any play, so these are not sent. */
export const MIN_SHARE_SECONDS = 60;

const p2 = (n: number): string => String(n).padStart(2, '0');

/** "YYYY-MM-DD" of a local day. */
export function dayOf(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}

function dayStart(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(key: string, n: number): string {
  const d = dayStart(key);
  d.setDate(d.getDate() + n);
  return dayOf(d.getTime());
}

/** Seconds of play per local day (a session counts on the day it started). */
export function secondsPerDay(sessions: readonly ShareSession[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const s of sessions) {
    if (!(s.seconds > 0)) continue;
    const k = dayOf(s.start);
    out.set(k, (out.get(k) ?? 0) + s.seconds);
  }
  return out;
}

/** Days in a row with enough play, ending on `endDay` (or on the day before when `endDay` itself had too little: today is not over yet). */
export function streakEndingAt(perDay: ReadonlyMap<string, number>, endDay: string, allowYesterday: boolean): number {
  let day = endDay;
  if (allowYesterday && (perDay.get(day) ?? 0) < ACTIVE_DAY_SECONDS) day = addDays(day, -1);
  let n = 0;
  while ((perDay.get(day) ?? 0) >= ACTIVE_DAY_SECONDS && n < 400) { n++; day = addDays(day, -1); }
  return n;
}

/** The longest run of days with enough play inside the 7 days of a week. */
export function longestRunIn(perDay: ReadonlyMap<string, number>, weekStart: string): number {
  let best = 0;
  let run = 0;
  for (let i = 0; i < 7; i++) {
    if ((perDay.get(addDays(weekStart, i)) ?? 0) >= ACTIVE_DAY_SECONDS) { run++; if (run > best) best = run; } else run = 0;
  }
  return best;
}

function bestPlayedMap(sessions: readonly ShareSession[]): string {
  const total: Record<string, number> = {};
  for (const s of sessions) for (const [name, v] of Object.entries(s.maps ?? {})) if (typeof v === 'number' && v > 0) total[name] = (total[name] ?? 0) + v;
  let best = '';
  let bestN = 0;
  for (const [name, v] of Object.entries(total)) if (v > bestN) { best = name; bestN = v; }
  return Array.from(best, (c) => (c.charCodeAt(0) < 32 ? ' ' : c)).join('').trim().slice(0, 40);
}

function weekOf(sessions: readonly ShareSession[], key: string, perDay: ReadonlyMap<string, number>, isCurrent: boolean, now: number): ShareWeek | null {
  const from = dayStart(key).getTime();
  const to = dayStart(addDays(key, 7)).getTime();
  const mine = sessions.filter((s) => s.start >= from && s.start < to);
  const seconds = mine.reduce((a, s) => a + Math.max(0, s.seconds), 0);
  if (seconds < MIN_SHARE_SECONDS) return null;
  let activeDays = 0;
  for (let i = 0; i < 7; i++) if ((perDay.get(addDays(key, i)) ?? 0) >= ACTIVE_DAY_SECONDS) activeDays++;
  const endDay = isCurrent ? dayOf(now) : addDays(key, 6);
  return {
    weekStart: key,
    minutes: Math.min(10080, Math.round(seconds / 60)),
    sessions: Math.min(1000, mine.length),
    kills: Math.min(20000, mine.reduce((a, s) => a + Math.max(0, s.kills), 0)),
    deaths: Math.min(20000, mine.reduce((a, s) => a + Math.max(0, s.deaths), 0)),
    activeDays,
    // The run that is going on now (it may reach back before this week) or the best run inside the week, whichever is longer
    streakDays: Math.min(400, Math.max(streakEndingAt(perDay, endDay, isCurrent), longestRunIn(perDay, key))),
    bestMap: bestPlayedMap(mine),
  };
}

/** The weeks to send: last week first, then this week (only those with play). */
export function buildShare(sessions: readonly ShareSession[], now: number): ShareWeek[] {
  const cur = weekKey(now);
  const prev = previousWeekKey(cur);
  const perDay = secondsPerDay(sessions);
  return [weekOf(sessions, prev, perDay, false, now), weekOf(sessions, cur, perDay, true, now)].filter((w): w is ShareWeek => w !== null);
}

/** One line for the preview in the settings. */
export function shareLine(w: ShareWeek): string {
  const kd = w.deaths > 0 ? w.kills / w.deaths : w.kills;
  return `Week of ${w.weekStart}: ${w.minutes} min in ${w.sessions} session${w.sessions === 1 ? '' : 's'}, ${w.kills} kills, ${w.deaths} deaths (K/D ${kd.toFixed(2)}), ${w.activeDays} day${w.activeDays === 1 ? '' : 's'} played, ${w.streakDays} in a row${w.bestMap ? `, most played map ${w.bestMap}` : ''}`;
}
