// ── Community ping (optional) ──
// If you switch on "Share ping with KRH", the website gets the typical ping per region and hour of day from your Ping History, together
// with your time zone as a whole number of hours (not where you live). From many players in the same time zone the website can then
// say which region is usually best for people like you at this hour. Only these averages are sent: no IP address, no game, no names of
// servers. Pure functions only.

import { REGION_NAMES } from './ping-history';
import type { PingHistory } from './ping-history';

export interface PingRow { region: string; hour: number; ms: number; samples: number }
export interface PingShare { tz: number; rows: PingRow[] }

/** Samples an hour needs before it is sent (a single measurement says little). */
export const MIN_SAMPLES = 3;

/** Whole hours east of UTC, from the minutes `Date#getTimezoneOffset` gives (which are positive west of UTC). */
export function tzHours(offsetMinutes: number): number {
  const h = Math.round(-offsetMinutes / 60);
  return Math.max(-12, Math.min(14, h));
}

export function buildPingShare(history: PingHistory, offsetMinutes: number): PingShare {
  const rows: PingRow[] = [];
  for (const [region, rh] of Object.entries(history)) {
    if (!(region in REGION_NAMES)) continue;
    rh.hours.forEach((b, hour) => {
      if (b.n >= MIN_SAMPLES && b.sum > 0) rows.push({ region, hour, ms: Math.max(1, Math.min(2000, Math.round(b.sum / b.n))), samples: Math.min(5000, Math.round(b.n)) });
    });
  }
  return { tz: tzHours(offsetMinutes), rows: rows.slice(0, 240) };
}

/** A short summary for the preview in the settings. */
export function previewLines(p: PingShare): string[] {
  if (!p.rows.length) return [];
  const byRegion = new Map<string, PingRow[]>();
  for (const r of p.rows) byRegion.set(r.region, [...(byRegion.get(r.region) ?? []), r]);
  const lines = [`Time zone: UTC${p.tz >= 0 ? '+' : ''}${p.tz}`];
  for (const [code, rs] of byRegion) {
    const avg = Math.round(rs.reduce((a, r) => a + r.ms, 0) / rs.length);
    lines.push(`${REGION_NAMES[code]}: ${rs.length} hour${rs.length === 1 ? '' : 's'} of the day, about ${avg} ms`);
  }
  return lines;
}
