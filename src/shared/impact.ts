// ── Did that change help? ──
// After you change something that can affect how you play (crosshair, sensitivity or FOV presets, auto profile rules, key binds) this
// compares your K/D in the seven days before the change with the play since then (up to seven days, and not past the next change of
// that kind, so two changes are not mixed up). It also says how sure it can be: K/D moves around a lot by luck, so a small difference
// over a few matches is called "unclear" and not "better". Pure functions only.

export interface ImpactSession { start: number; kills: number; deaths: number }
export interface TrackedChange { at: number; /** Category the change was saved in ("extras", "keybinds"). */ key: string; fields: string[] }

export interface Side { kills: number; deaths: number; sessions: number; kd: number }
export interface Impact {
  at: number;
  label: string;
  before: Side;
  after: Side;
  verdict: 'better' | 'worse' | 'unclear' | 'few';
  text: string;
}

const DAY = 24 * 3600 * 1000;
export const WINDOW_DAYS = 7;
/** Kills + deaths and sessions each side needs before anything is said. */
export const MIN_EVENTS = 40;
export const MIN_SESSIONS = 3;
/** Two-sided z limits: above CLEAR the difference is very unlikely to be luck, above HINT it could be. */
export const Z_CLEAR = 1.96;
export const Z_HINT = 1.28;

/** Fields (inside "extras") and categories that can change how you play. */
const EXTRAS_FIELDS: Readonly<Record<string, string>> = {
  crosshair: 'Crosshair',
  settingPresets: 'Sensitivity / FOV presets',
  autoProfiles: 'Auto profile rules',
  liveAccuracy: 'Accuracy display',
};

/** The label for a change that can affect play, or '' when it cannot (HUD colours, a toggle for a window, ...). */
export function relevantLabel(c: Pick<TrackedChange, 'key' | 'fields'>): string {
  if (c.key === 'keybinds') return 'Key binds';
  if (c.key !== 'extras') return '';
  const hit = c.fields.map((f) => EXTRAS_FIELDS[f]).filter((x): x is string => !!x);
  return hit.length ? [...new Set(hit)].join(', ') : '';
}

const kdOf = (k: number, d: number): number => (d > 0 ? k / d : k);

function side(sessions: readonly ImpactSession[], from: number, to: number): Side {
  const part = sessions.filter((s) => s.start >= from && s.start < to);
  const kills = part.reduce((a, s) => a + Math.max(0, s.kills), 0);
  const deaths = part.reduce((a, s) => a + Math.max(0, s.deaths), 0);
  return { kills, deaths, sessions: part.length, kd: kdOf(kills, deaths) };
}

/** Share of kills among kills + deaths and its standard error, which is what the z value is built from. */
function share(s: Side): { p: number; n: number } { const n = s.kills + s.deaths; return { p: n ? s.kills / n : 0, n }; }

export function zValue(a: Side, b: Side): number {
  const x = share(a);
  const y = share(b);
  if (!x.n || !y.n) return 0;
  const se = Math.sqrt((x.p * (1 - x.p)) / x.n + (y.p * (1 - y.p)) / y.n);
  return se > 0 ? (y.p - x.p) / se : 0;
}

/** `nextAt` = when the next change of the same kind happened (the comparison stops there), 0 when there was none. */
export function impactOf(sessions: readonly ImpactSession[], change: TrackedChange, nextAt: number, now: number): Impact | null {
  const label = relevantLabel(change);
  if (!label) return null;
  const end = Math.min(change.at + WINDOW_DAYS * DAY, nextAt > change.at ? nextAt : Infinity, now);
  const before = side(sessions, change.at - WINDOW_DAYS * DAY, change.at);
  const after = side(sessions, change.at, end);
  const enough = (s: Side): boolean => s.kills + s.deaths >= MIN_EVENTS && s.sessions >= MIN_SESSIONS;
  if (!enough(before) || !enough(after)) {
    return { at: change.at, label, before, after, verdict: 'few', text: `Not enough play to tell yet: each side needs about ${MIN_EVENTS} kills + deaths in at least ${MIN_SESSIONS} sessions (before: ${before.kills + before.deaths} / ${before.sessions}, since: ${after.kills + after.deaths} / ${after.sessions}).` };
  }
  const z = zValue(before, after);
  const diff = after.kd - before.kd;
  const nums = `K/D ${before.kd.toFixed(2)} before, ${after.kd.toFixed(2)} since (${diff >= 0 ? '+' : ''}${diff.toFixed(2)})`;
  if (Math.abs(z) >= Z_CLEAR) {
    return { at: change.at, label, before, after, verdict: diff > 0 ? 'better' : 'worse', text: `${nums}. With this much play that is unlikely to be luck alone, but other things changed too (the maps you played, how rested you were).` };
  }
  if (Math.abs(z) >= Z_HINT) {
    return { at: change.at, label, before, after, verdict: 'unclear', text: `${nums}. It leans ${diff > 0 ? 'better' : 'worse'}, but this could still be luck: play some more before you decide.` };
  }
  return { at: change.at, label, before, after, verdict: 'unclear', text: `${nums}. No real difference that can be told from luck.` };
}

/** The newest changes that can affect play, each with its result (newest first). */
export function recentImpacts(sessions: readonly ImpactSession[], changes: readonly TrackedChange[], now: number, max = 5): Impact[] {
  const out: Impact[] = [];
  const sorted = changes.slice().sort((a, b) => a.at - b.at);
  for (let i = sorted.length - 1; i >= 0 && out.length < max; i--) {
    const c = sorted[i];
    const label = relevantLabel(c);
    if (!label) continue;
    const next = sorted.slice(i + 1).find((n) => relevantLabel(n) !== '')?.at ?? 0;
    const r = impactOf(sessions, c, next, now);
    if (r) out.push(r);
  }
  return out;
}
