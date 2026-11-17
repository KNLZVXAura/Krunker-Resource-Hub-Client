// ── Performance coach ──
// Looks at the FPS measured while you play (windows of five seconds: average and 1 % low, see shared/fps-stats.ts) and at the
// client settings that cost FPS, and suggests changes. A change is tried as an experiment: the windows measured just before it
// are the "before", the windows measured after it are the "after", and the result says in plain numbers whether it helped, so you
// keep it or put it back with one click. Only settings that take effect at once are suggested (no restart needed).
// Pure functions only.

export interface Win { at: number; fps: number; low: number; map: string }

export interface CoachInput {
  performance: { fpsUnlocked?: boolean; frameCap?: number; cpuThrottle?: number };
  extras: {
    motionBlur?: { enabled?: boolean; quality?: string };
    instantReplay?: { enabled?: boolean };
    disableVideoSkins?: boolean;
  };
  /** Refresh rate of the display, 0 when unknown. */
  hz: number;
}

export interface Change {
  cat: 'performance' | 'extras';
  /** Dot path inside the category, for example "cpuThrottle" or "motionBlur.enabled". */
  path: string;
  from: unknown;
  to: unknown;
}

export interface Suggestion {
  id: string;
  title: string;
  why: string;
  /** 'fix' = this is probably holding your FPS back, 'optional' = costs some FPS, only you know if you use it. */
  level: 'fix' | 'optional';
  changes: Change[];
}

export interface Summary { windows: number; avg: number; low: number }

/** Windows needed before FPS numbers mean anything (one minute of play). */
export const MIN_WINDOWS = 12;
/** How far back the "before" reaches, and how many windows it keeps at most. */
export const BEFORE_MS = 30 * 60 * 1000;
export const BEFORE_MAX = 120;
/** Windows after a change before the result is given (three minutes of play). */
export const AFTER_DONE = 36;
/** At least this many windows before the change, or the comparison says it cannot tell. */
export const BEFORE_MIN = 12;
/** Change that counts: average FPS this much (share) or 1 % low this much. */
export const GAIN_AVG = 0.05;
export const GAIN_LOW = 0.08;

export function summarise(w: readonly Win[]): Summary {
  if (!w.length) return { windows: 0, avg: 0, low: 0 };
  return { windows: w.length, avg: w.reduce((a, x) => a + x.fps, 0) / w.length, low: w.reduce((a, x) => a + x.low, 0) / w.length };
}

/** Is there an FPS problem to fix? Below the refresh rate (or 144 when it is unknown) and a weak 1 % low both count. */
export function hasProblem(s: Summary, hz: number): boolean {
  if (s.windows < MIN_WINDOWS) return false;
  const target = hz > 0 ? hz : 144;
  return s.avg < target * 0.85 || s.low < s.avg * 0.55;
}

export function suggest(input: CoachInput, recent: Summary): Suggestion[] {
  const out: Suggestion[] = [];
  const p = input.performance;
  const x = input.extras;
  const problem = hasProblem(recent, input.hz);
  const level = (costly: boolean): 'fix' | 'optional' => (problem && costly ? 'fix' : 'optional');

  if (p.fpsUnlocked === false) {
    out.push({ id: 'unlock', level: 'fix', title: 'Unlock the FPS limit', why: 'The FPS unlock is off, so the game is held to V-sync and the refresh rate of the display.',
      changes: [{ cat: 'performance', path: 'fpsUnlocked', from: false, to: true }] });
  }
  if (typeof p.cpuThrottle === 'number' && p.cpuThrottle > 1) {
    out.push({ id: 'throttle', level: 'fix', title: 'Switch the CPU throttle off', why: `The CPU throttle is ${p.cpuThrottle}x while you play: it deliberately slows the game down.`,
      changes: [{ cat: 'performance', path: 'cpuThrottle', from: p.cpuThrottle, to: 1 }] });
  }
  if (typeof p.frameCap === 'number' && p.frameCap > 0 && (input.hz <= 0 || p.frameCap < input.hz * 1.5) && (recent.windows < MIN_WINDOWS || recent.avg >= p.frameCap * 0.9)) {
    out.push({ id: 'cap', level: 'optional', title: 'Remove the frame cap', why: `A frame cap of ${p.frameCap} FPS is set${recent.windows >= MIN_WINDOWS ? ` and you are sitting at about ${Math.round(recent.avg)} FPS, so the cap is what limits you` : ''}.`,
      changes: [{ cat: 'performance', path: 'frameCap', from: p.frameCap, to: 0 }] });
  }
  if (x.motionBlur?.enabled === true) {
    out.push({ id: 'blur', level: level(true), title: 'Switch motion blur off', why: 'Motion blur redraws the picture while you turn, which costs FPS on weaker graphics cards.',
      changes: [{ cat: 'extras', path: 'motionBlur.enabled', from: true, to: false }] });
  }
  if (x.instantReplay?.enabled === true) {
    out.push({ id: 'replay', level: level(true), title: 'Switch instant replay off', why: 'Instant replay keeps recording the game while you play, which costs FPS and memory. Keep it if you use your clips.',
      changes: [{ cat: 'extras', path: 'instantReplay.enabled', from: true, to: false }] });
  }
  if (x.disableVideoSkins === false) {
    out.push({ id: 'skins', level: 'optional', title: 'Do not load animated video skins', why: 'Animated skins are small videos that are decoded while you play. They do not change how the game plays.',
      changes: [{ cat: 'extras', path: 'disableVideoSkins', from: false, to: true }] });
  }
  return out.sort((a, b) => Number(b.level === 'fix') - Number(a.level === 'fix'));
}

// ── A/B ──

export interface MapRow { map: string; before: number; after: number; windows: number }
export interface Result {
  verdict: 'better' | 'worse' | 'same' | 'unknown';
  before: Summary;
  after: Summary;
  /** Same map in both: only those maps are compared; empty when the maps differed and everything was compared. */
  maps: MapRow[];
  text: string;
}

const pct = (a: number, b: number): number => (a > 0 ? (b - a) / a : 0);
const sign = (v: number): string => (v >= 0 ? '+' : '') + Math.round(v * 100) + '%';

/** Compares the windows before and after a change. Maps that appear on both sides are compared with each other, so a lighter map does not look like a win. */
export function compare(before: readonly Win[], after: readonly Win[]): Result {
  const b = summarise(before);
  const a = summarise(after);
  if (before.length < BEFORE_MIN || after.length < MIN_WINDOWS) {
    return { verdict: 'unknown', before: b, after: a, maps: [], text: before.length < BEFORE_MIN ? 'Too little was measured before the change to compare (play at least a minute with FPS statistics on before trying one).' : 'Play a little longer to get a result.' };
  }
  const byMap = (w: readonly Win[]): Map<string, Win[]> => { const m = new Map<string, Win[]>(); for (const x of w) { if (x.map) m.set(x.map, [...(m.get(x.map) ?? []), x]); } return m; };
  const mb = byMap(before);
  const ma = byMap(after);
  const rows: MapRow[] = [];
  let sb: Win[] = [];
  let sa: Win[] = [];
  for (const [map, wb] of mb) {
    const wa = ma.get(map);
    if (!wa || wb.length < 6 || wa.length < 6) continue;
    rows.push({ map, before: summarise(wb).avg, after: summarise(wa).avg, windows: Math.min(wb.length, wa.length) });
    sb = sb.concat(wb); sa = sa.concat(wa);
  }
  const sameMaps = rows.length > 0 && sa.length >= MIN_WINDOWS;
  const cb = sameMaps ? summarise(sb) : b;
  const ca = sameMaps ? summarise(sa) : a;
  const dAvg = pct(cb.avg, ca.avg);
  const dLow = pct(cb.low, ca.low);
  let verdict: Result['verdict'] = 'same';
  if (dAvg >= GAIN_AVG || dLow >= GAIN_LOW) verdict = 'better';
  else if (dAvg <= -GAIN_AVG || dLow <= -GAIN_LOW) verdict = 'worse';
  const where = sameMaps ? ` on the same map${rows.length > 1 ? 's' : ''} (${rows.slice(0, 3).map((r) => r.map).join(', ')})` : ' (the maps differed, so treat this as a rough guide)';
  const nums = `FPS ${Math.round(cb.avg)} to ${Math.round(ca.avg)} (${sign(dAvg)}), 1% low ${Math.round(cb.low)} to ${Math.round(ca.low)} (${sign(dLow)})${where}.`;
  const tail = verdict === 'better' ? ' That helped: keep it.' : verdict === 'worse' ? ' It did not help: put it back.' : ' No clear difference: keep whichever you prefer.';
  return { verdict, before: b, after: a, maps: rows, text: nums + tail };
}

/** The windows to use as "before": the newest ones within the last 30 minutes. */
export function beforeWindows(all: readonly Win[], now: number): Win[] {
  return all.filter((w) => now - w.at <= BEFORE_MS).slice(-BEFORE_MAX);
}

/** Reads a value at a dot path ("motionBlur.enabled"). */
export function getAt(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const k of path.split('.')) {
    if (!cur || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

/** Sets a value at a dot path on a copy (the object itself is not changed). Only paths that already exist are set. */
export function setAt<T>(obj: T, path: string, value: unknown): T {
  const copy = JSON.parse(JSON.stringify(obj)) as T;
  const keys = path.split('.');
  let cur = copy as unknown as Record<string, unknown>;
  for (let i = 0; i < keys.length - 1; i++) {
    const next = cur[keys[i]];
    if (!next || typeof next !== 'object') return copy;
    cur = next as Record<string, unknown>;
  }
  const last = keys[keys.length - 1];
  if (last in cur) cur[last] = value;
  return copy;
}
