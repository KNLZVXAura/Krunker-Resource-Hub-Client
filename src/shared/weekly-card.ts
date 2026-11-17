// ── Weekly card ──
// The numbers of one week (this week so far or last week) laid out for a picture you can share: play time, K/D against the week
// before, most played map and a bar for every day. The drawing itself happens in the dashboard (a canvas); this only prepares the
// text. Nothing here is sent anywhere. Pure functions only.

import { previousWeekKey, weekKey } from './trends';
import { bestMap, durationText, totalsFor } from './weekly-summary';
import type { SummarySession } from './weekly-summary';
import { ACTIVE_DAY_SECONDS, addDays, dayOf, longestRunIn, secondsPerDay, streakEndingAt } from './weekly-share';
import type { ShareSession } from './weekly-share';

export type CardSession = SummarySession & ShareSession;

export interface CardDay { label: string; minutes: number; active: boolean }
export interface CardData {
  which: 'this' | 'last';
  title: string;
  range: string;
  time: string;
  sessions: number;
  kills: number;
  deaths: number;
  kd: string;
  /** "+0.21 vs the week before" or '' when there is nothing to compare with. */
  kdNote: string;
  mapName: string;
  mapKd: string;
  days: CardDay[];
  activeDays: number;
  streak: number;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MIN_CARD_SECONDS = 300;

function dayLabel(key: string): string {
  const [, m, d] = key.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}

export function buildCard(sessions: readonly CardSession[], now: number, which: 'this' | 'last'): CardData | null {
  const cur = weekKey(now);
  const key = which === 'this' ? cur : previousWeekKey(cur);
  const t = totalsFor(sessions, key);
  if (!t.sessions || t.seconds < MIN_CARD_SECONDS) return null;
  const before = totalsFor(sessions, previousWeekKey(key));
  const perDay = secondsPerDay(sessions);
  const days: CardDay[] = DAYS.map((label, i) => {
    const sec = perDay.get(addDays(key, i)) ?? 0;
    return { label, minutes: Math.round(sec / 60), active: sec >= ACTIVE_DAY_SECONDS };
  });
  const best = bestMap(t.maps);
  let note = '';
  if (before.sessions && before.seconds >= MIN_CARD_SECONDS) {
    const diff = t.kd - before.kd;
    note = Math.abs(diff) < 0.005 ? 'same as the week before' : `${diff > 0 ? '+' : '-'}${Math.abs(diff).toFixed(2)} vs the week before`;
  }
  const endDay = which === 'this' ? dayOf(now) : addDays(key, 6);
  return {
    which,
    title: which === 'this' ? 'My week in Krunker' : 'My last week in Krunker',
    range: `${dayLabel(key)} - ${dayLabel(addDays(key, 6))}`,
    time: durationText(t.seconds),
    sessions: t.sessions, kills: t.kills, deaths: t.deaths, kd: t.kd.toFixed(2), kdNote: note,
    mapName: best ? best.name : '', mapKd: best ? best.kd.toFixed(2) : '',
    days,
    activeDays: days.filter((d) => d.active).length,
    streak: Math.max(streakEndingAt(perDay, endDay, which === 'this'), longestRunIn(perDay, key)),
  };
}
