// ── Play log: rounds and K/D by ping ──
// While you are in a match the game page reports a small sample every ten seconds: map, class, ping and the kills and deaths
// since the last sample. Here the samples are
//   - added to "ping bins" (time, kills and deaths per ping range), which answers "do I play worse when my ping is high?", and
//   - grouped into "rounds": a new round starts when the map changes or after a break of three minutes.
// Krunker plays matches one after the other in the same lobby with no signal between them, so a round is a stretch on one map,
// not exactly one match. Pure functions only.

export interface Sample { map: string; cls: string; ms: number; kills: number; deaths: number; dt: number }

export interface Round {
  startAt: number;
  endAt: number;
  map: string;
  cls: string;
  seconds: number;
  kills: number;
  deaths: number;
  pingSum: number;
  pingN: number;
  fpsSum: number;
  fpsN: number;
}

export interface Bin { seconds: number; kills: number; deaths: number }

export interface PlayLog { rounds: Round[]; bins: Bin[]; current: Round | null }

/** Upper limits (ms) of the ping ranges: up to 40, 41-80, 81-120, 121-200, above 200. */
export const BIN_LIMITS: readonly number[] = [40, 80, 120, 200];
export const BIN_LABELS: readonly string[] = ['up to 40 ms', '41-80 ms', '81-120 ms', '121-200 ms', 'above 200 ms'];
export const MAX_ROUNDS = 50;
export const GAP_MS = 3 * 60 * 1000;
export const MIN_ROUND_SECONDS = 60;
/** Time in a range before its K/D is shown. */
export const MIN_BIN_SECONDS = 10 * 60;

export function emptyLog(): PlayLog {
  return { rounds: [], bins: BIN_LABELS.map(() => ({ seconds: 0, kills: 0, deaths: 0 })), current: null };
}

export function binIndex(ms: number): number {
  const i = BIN_LIMITS.findIndex((l) => ms <= l);
  return i < 0 ? BIN_LIMITS.length : i;
}

function newRound(s: Sample, now: number): Round {
  return { startAt: now, endAt: now, map: s.map, cls: s.cls, seconds: 0, kills: 0, deaths: 0, pingSum: 0, pingN: 0, fpsSum: 0, fpsN: 0 };
}

function closeRound(log: PlayLog): void {
  const r = log.current;
  log.current = null;
  if (!r || r.seconds < MIN_ROUND_SECONDS) return;
  log.rounds.push(r);
  while (log.rounds.length > MAX_ROUNDS) log.rounds.shift();
}

/** Adds one sample. Ping `ms` of 0 or below means no ping was measured (the kills and deaths still count in the round). */
export function addSample(log: PlayLog, s: Sample, now: number): void {
  const dt = Number.isFinite(s.dt) ? Math.max(0, Math.min(30, s.dt)) : 0;
  const kills = Number.isFinite(s.kills) ? Math.max(0, Math.min(50, Math.floor(s.kills))) : 0;
  const deaths = Number.isFinite(s.deaths) ? Math.max(0, Math.min(50, Math.floor(s.deaths))) : 0;
  const cur = log.current;
  if (cur && (now - cur.endAt > GAP_MS || (s.map && cur.map && s.map !== cur.map))) closeRound(log);
  if (!log.current) log.current = newRound(s, now);
  const r = log.current;
  if (!r.map && s.map) r.map = s.map;
  if (s.cls) r.cls = s.cls;
  r.endAt = now; r.seconds += dt; r.kills += kills; r.deaths += deaths;
  if (Number.isFinite(s.ms) && s.ms > 0 && s.ms < 5000) {
    r.pingSum += s.ms; r.pingN += 1;
    const b = log.bins[binIndex(s.ms)];
    b.seconds += dt; b.kills += kills; b.deaths += deaths;
  }
}

/** A frame-rate window measured during the running round. */
export function addFps(log: PlayLog, fps: number): void {
  const r = log.current;
  if (!r || !Number.isFinite(fps) || fps < 1 || fps > 1000) return;
  r.fpsSum += fps; r.fpsN += 1;
}

export function finishRound(log: PlayLog): void { closeRound(log); }

export interface LagAnswer { low: { seconds: number; kd: number } | null; high: { seconds: number; kd: number } | null; text: string }

/** Up to 80 ms against above 80 ms, each with at least MIN_BIN_SECONDS of play. */
export function lagAnswer(bins: readonly Bin[]): LagAnswer {
  const sum = (from: number, to: number): { seconds: number; kills: number; deaths: number } =>
    bins.slice(from, to).reduce((a, b) => ({ seconds: a.seconds + b.seconds, kills: a.kills + b.kills, deaths: a.deaths + b.deaths }), { seconds: 0, kills: 0, deaths: 0 });
  const lo = sum(0, 2);
  const hi = sum(2, bins.length);
  const kd = (x: { kills: number; deaths: number }): number => (x.deaths > 0 ? x.kills / x.deaths : x.kills);
  const low = lo.seconds >= MIN_BIN_SECONDS ? { seconds: lo.seconds, kd: kd(lo) } : null;
  const high = hi.seconds >= MIN_BIN_SECONDS ? { seconds: hi.seconds, kd: kd(hi) } : null;
  const min = (s: number): string => Math.round(s / 60) + ' min';
  let text: string;
  if (low && high) {
    const diff = low.kd - high.kd;
    text = `Up to 80 ms: K/D ${low.kd.toFixed(2)} (${min(low.seconds)}). Above 80 ms: K/D ${high.kd.toFixed(2)} (${min(high.seconds)}). ` +
      (Math.abs(diff) < 0.15 ? 'No clear difference.' : diff > 0 ? 'You do better with the lower ping.' : 'Your K/D is not worse with the higher ping.');
  } else {
    text = 'Not enough data yet: each side needs at least 10 minutes of play with a measured ping.';
  }
  return { low, high, text };
}

/** Keeps what was read from disk to the known shape. */
export function cleanPlayLog(raw: unknown): PlayLog {
  const out = emptyLog();
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown, hi: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(hi, v)) : 0);
  const str = (v: unknown): string => (typeof v === 'string' ? Array.from(v, (c) => (c.charCodeAt(0) < 32 ? ' ' : c)).join('').trim().slice(0, 40) : '');
  if (Array.isArray(r.bins)) {
    for (let i = 0; i < out.bins.length; i++) {
      const b = r.bins[i] as Record<string, unknown> | undefined;
      if (b && typeof b === 'object') out.bins[i] = { seconds: num(b.seconds, 1e9), kills: num(b.kills, 1e7), deaths: num(b.deaths, 1e7) };
    }
  }
  if (Array.isArray(r.rounds)) {
    for (const item of r.rounds.slice(-MAX_ROUNDS)) {
      if (!item || typeof item !== 'object') continue;
      const x = item as Record<string, unknown>;
      out.rounds.push({
        startAt: num(x.startAt, 1e14), endAt: num(x.endAt, 1e14), map: str(x.map), cls: str(x.cls), seconds: num(x.seconds, 86400),
        kills: num(x.kills, 1e5), deaths: num(x.deaths, 1e5), pingSum: num(x.pingSum, 1e9), pingN: num(x.pingN, 1e6), fpsSum: num(x.fpsSum, 1e9), fpsN: num(x.fpsN, 1e6),
      });
    }
  }
  return out;
}
