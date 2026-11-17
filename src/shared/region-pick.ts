// ── Best regions for you ──
// The dashboard measures your ping to every Krunker region. This picks the regions worth searching in: the fastest one and the
// ones close behind it. When the ping history knows the usual ping at this hour (shared/ping-history.ts) it counts for part of the
// score, so one lucky or unlucky measurement does not decide. Pure functions only.

import { REGION_NAMES } from './ping-history';
import type { PingHistory } from './ping-history';

export interface PickRow { code: string; name: string; now: number; usual: number | null; score: number }
export interface Pick { codes: string[]; rows: PickRow[]; text: string }

/** Regions within this many ms of the best score are worth searching in too. */
export const CLOSE_MS = 25;
/** The most regions suggested (more regions find games faster; far ones are not worth it). */
export const MAX_REGIONS = 3;
/** Samples an hour needs before the usual ping is trusted. */
export const MIN_HOUR_SAMPLES = 3;
/** Share of the score that comes from the usual ping at this hour. */
export const HISTORY_WEIGHT = 0.4;

export function pickBest(pings: Record<string, number>, history: PingHistory, hour: number): Pick {
  const h = Math.max(0, Math.min(23, Math.floor(hour)));
  const rows: PickRow[] = [];
  for (const [code, ms] of Object.entries(pings)) {
    if (!(code in REGION_NAMES) || !Number.isFinite(ms) || ms <= 0) continue;
    const b = history[code]?.hours[h];
    const usual = b && b.n >= MIN_HOUR_SAMPLES ? b.sum / b.n : null;
    rows.push({ code, name: REGION_NAMES[code], now: Math.round(ms), usual: usual === null ? null : Math.round(usual), score: usual === null ? ms : ms * (1 - HISTORY_WEIGHT) + usual * HISTORY_WEIGHT });
  }
  rows.sort((a, b) => a.score - b.score);
  if (!rows.length) return { codes: [], rows, text: 'No ping results yet.' };
  const top = rows[0].score;
  const codes = rows.filter((r) => r.score - top <= CLOSE_MS).slice(0, MAX_REGIONS).map((r) => r.code);
  const label = rows.filter((r) => codes.includes(r.code)).map((r) => `${r.name} (${r.now} ms)`).join(', ');
  const text = codes.length === 1
    ? `Best for you right now: ${label}. Only one region is close, so searching there keeps your ping lowest.`
    : `Best for you right now: ${label}. Searching in just these keeps your ping low and still finds games.`;
  return { codes, rows, text };
}
