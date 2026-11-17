// ── Warm-up and tired-out insight ──
// The play log adds up time, kills and deaths by how long the stretch of play had lasted (first 15 minutes, 15-45, 45-90, after 90;
// a break of 15 minutes ends a stretch). This compares those phases: do you start slower than you play later, and does your K/D fall
// when you have played a long time? Only said when there is enough data on both sides and the difference is clear. Pure functions only.

import { PHASE_LABELS } from './play-log';
import type { Bin } from './play-log';

export interface PhaseRow { label: string; minutes: number; kills: number; deaths: number; kd: number; enough: boolean }
export interface Insight { kind: 'warmup' | 'tired' | 'steady' | 'none'; text: string; rows: PhaseRow[] }

/** Time and kills + deaths a phase needs before it is compared. */
export const MIN_PHASE_SECONDS = 20 * 60;
export const MIN_PHASE_EVENTS = 30;
/** The K/D must differ by at least this much (absolute) and this share. */
export const MIN_DIFF = 0.15;
export const MIN_DIFF_SHARE = 0.15;

const kdOf = (k: number, d: number): number => (d > 0 ? k / d : k);

function rowsOf(phases: readonly Bin[]): PhaseRow[] {
  return PHASE_LABELS.map((label, i) => {
    const b = phases[i] ?? { seconds: 0, kills: 0, deaths: 0 };
    return { label, minutes: Math.round(b.seconds / 60), kills: b.kills, deaths: b.deaths, kd: kdOf(b.kills, b.deaths), enough: b.seconds >= MIN_PHASE_SECONDS && b.kills + b.deaths >= MIN_PHASE_EVENTS };
  });
}

function merge(rows: readonly PhaseRow[], from: number, to: number): { kd: number; ok: boolean; minutes: number } {
  const part = rows.slice(from, to);
  const kills = part.reduce((a, r) => a + r.kills, 0);
  const deaths = part.reduce((a, r) => a + r.deaths, 0);
  const minutes = part.reduce((a, r) => a + r.minutes, 0);
  return { kd: kdOf(kills, deaths), ok: minutes * 60 >= MIN_PHASE_SECONDS && kills + deaths >= MIN_PHASE_EVENTS, minutes };
}

const clearlyLower = (low: number, high: number): boolean => high - low >= MIN_DIFF && (high - low) / Math.max(high, 0.01) >= MIN_DIFF_SHARE;

export function warmupInsight(phases: readonly Bin[]): Insight {
  const rows = rowsOf(phases);
  const first = merge(rows, 0, 1);
  const middle = merge(rows, 1, 3);
  const mid = merge(rows, 1, 2);
  const late = merge(rows, 3, 4);
  const mins = (n: number): string => `${n} min`;

  if (first.ok && middle.ok && clearlyLower(first.kd, middle.kd)) {
    return { kind: 'warmup', rows, text: `You start slower: K/D ${first.kd.toFixed(2)} in the first 15 minutes of a session against ${middle.kd.toFixed(2)} after that (${mins(first.minutes)} and ${mins(middle.minutes)} measured). A short warm-up (an aim trainer or a casual lobby) before ranked or serious matches may help.` };
  }
  if (late.ok && mid.ok && clearlyLower(late.kd, mid.kd)) {
    return { kind: 'tired', rows, text: `Your K/D drops in long sessions: ${late.kd.toFixed(2)} after 90 minutes against ${mid.kd.toFixed(2)} between 15 and 45 minutes (${mins(late.minutes)} measured after 90). A break every hour or so (Client Settings > Extras > Session stats > break reminder) may keep you sharper.` };
  }
  if (first.ok && middle.ok) return { kind: 'steady', rows, text: `No clear pattern: K/D ${first.kd.toFixed(2)} at the start of a session and ${middle.kd.toFixed(2)} later. You are warm from the first match.` };
  return { kind: 'none', rows, text: 'Not enough data yet: the start of a session and the middle each need about 20 minutes and 30 kills + deaths.' };
}
