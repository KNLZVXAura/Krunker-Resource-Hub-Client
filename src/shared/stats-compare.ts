// ── Compare a session with your earlier ones ──
// Used in the summary notification: "K/D 1.80 (your average 1.40) · 85 kills/h (your average 70)". Pure functions only.

export interface Totals { kills: number; deaths: number; seconds: number }

/** Earlier sessions needed, and the play time they must add up to, before an average means anything. */
export const MIN_PRIOR_SESSIONS = 3;
export const MIN_PRIOR_SECONDS = 30 * 60;

export function kdRatio(kills: number, deaths: number): number {
  return deaths > 0 ? kills / deaths : kills;
}

export function killsPerHour(kills: number, seconds: number): number {
  return seconds >= 60 ? (kills / seconds) * 3600 : 0;
}

/** "K/D 1.80 (your average 1.40) · 85 kills/h (your average 70)", or '' when there is too little earlier data. */
export function compareText(session: Totals, prior: readonly Totals[]): string {
  if (prior.length < MIN_PRIOR_SESSIONS) return '';
  const sum = prior.reduce((a, p) => ({ kills: a.kills + p.kills, deaths: a.deaths + p.deaths, seconds: a.seconds + p.seconds }), { kills: 0, deaths: 0, seconds: 0 });
  if (sum.seconds < MIN_PRIOR_SECONDS) return '';
  const parts: string[] = [];
  if (session.kills || session.deaths) parts.push(`K/D ${kdRatio(session.kills, session.deaths).toFixed(2)} (your average ${kdRatio(sum.kills, sum.deaths).toFixed(2)})`);
  const kph = killsPerHour(session.kills, session.seconds);
  if (kph > 0) parts.push(`${Math.round(kph)} kills/h (your average ${Math.round(killsPerHour(sum.kills, sum.seconds))})`);
  return parts.join(' · ');
}

/** Minutes of play after which a break is suggested again, counting from `startedAt`; 0 means off. */
export function breakDue(playedSeconds: number, breakMinutes: number, nextAtSeconds: number): boolean {
  return breakMinutes > 0 && playedSeconds >= nextAtSeconds;
}
