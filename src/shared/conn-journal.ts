// ── Connection journal ──
// Notes disconnects, ping spikes and stretches without answer while you play, with the time and the region, plus a per-day count
// for a small graph. It is meant as something you can show to your provider ("it happens every evening around nine").
// The pings come from the same ten-second samples as the play log. Pure functions only.

export type JKind = 'drop' | 'spike' | 'loss';

export interface JEvent {
  at: number;
  kind: JKind;
  region: string;
  /** drop: the close code. spike: the ping in ms. loss: how many answers in a row were missing. */
  value: number;
  /** spike: the usual ping at that moment (the median of the last samples). */
  base: number;
}

export interface JDay { drops: number; spikes: number; losses: number; minutes: number; pingSum: number; pingN: number }
export interface Journal { events: JEvent[]; days: Record<string, JDay> }

/** What is remembered between samples while the page is open (not saved). */
export interface Detector {
  /** The last pings that count as usual (spikes are left out). */
  recent: number[];
  /** Answers missing in a row. */
  misses: number;
  /** The region the usual ping belongs to: another region starts over. */
  region: string;
  /** Pings in a row that all looked like a spike: when they last, the high ping is the new usual ping. */
  highs: number[];
}

export const MAX_EVENTS = 300;
export const KEEP_DAYS = 35;
const MERGE_MS = 60_000;
const DROP_MERGE_MS = 20_000;
const SPIKE_MIN_MS = 150;
const SPIKE_FACTOR = 2.5;
const SPIKE_MIN_RISE = 80;
const MIN_BASELINE_SAMPLES = 6;
/** Samples in a row (ten seconds each) at a high ping before it is taken as the new usual ping and not a spike any more. */
const HIGH_RUN_SAMPLES = 6;

export const emptyJournal = (): Journal => ({ events: [], days: {} });
export const newDetector = (): Detector => ({ recent: [], misses: 0, region: '', highs: [] });

const p2 = (n: number): string => String(n).padStart(2, '0');
/** `ms` moved back by `n` calendar days (not 24 hours each, so a clock change cannot skip or repeat a date). */
export function daysBefore(ms: number, n: number): number {
  const d = new Date(ms);
  d.setDate(d.getDate() - n);
  return d.getTime();
}

export function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}

function dayOf(j: Journal, now: number): JDay {
  const k = dayKey(now);
  const d = j.days[k] ?? (j.days[k] = { drops: 0, spikes: 0, losses: 0, minutes: 0, pingSum: 0, pingN: 0 });
  const keys = Object.keys(j.days).sort();
  while (keys.length > KEEP_DAYS) delete j.days[keys.shift() as string];
  return d;
}

function median(values: readonly number[]): number {
  const s = values.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function push(j: Journal, e: JEvent, mergeMs: number): boolean {
  const last = j.events[j.events.length - 1];
  const region = e.region.slice(0, 5);
  if (last && last.kind === e.kind && last.region === region && e.at - last.at < mergeMs) {
    last.at = e.at;
    last.value = e.kind === 'drop' ? last.value : Math.max(last.value, e.value);
    return false; // merged into the previous event: not a new one for the day counts
  }
  j.events.push({ ...e, region });
  while (j.events.length > MAX_EVENTS) j.events.shift();
  return true;
}

/** A game connection that closed unexpectedly (a close code other than 1000 or 1001). */
export function noteDrop(j: Journal, code: number, region: string, now: number): void {
  if (!Number.isFinite(code) || code === 1000 || code === 1001) return;
  if (push(j, { at: now, kind: 'drop', region, value: Math.floor(code), base: 0 }, DROP_MERGE_MS)) dayOf(j, now).drops++;
}

/** One ping sample. `ms` <= 0 means the server did not answer. `dtSeconds` is the time since the last sample (for the minutes). */
export function noteSample(j: Journal, det: Detector, ms: number, region: string, now: number, dtSeconds: number): void {
  const day = dayOf(j, now);
  // Another region has another usual ping, and the first sample after the menu (no time since the last one) starts a new
  // stretch of play: answers missing before it do not count together with the ones after it
  if (det.region !== region) { det.recent = []; det.highs = []; det.misses = 0; det.region = region; }
  if (!(dtSeconds > 0)) { det.misses = 0; det.highs = []; }
  if (!(ms > 0 && ms < 5000)) {
    det.misses++;
    if (det.misses === 2 && push(j, { at: now, kind: 'loss', region, value: 2, base: 0 }, MERGE_MS)) day.losses++;
    else if (det.misses > 2) push(j, { at: now, kind: 'loss', region, value: det.misses, base: 0 }, MERGE_MS);
    return;
  }
  det.misses = 0;
  day.minutes += Math.max(0, Math.min(30, dtSeconds)) / 60;
  day.pingSum += ms; day.pingN += 1;
  if (det.recent.length >= MIN_BASELINE_SAMPLES) {
    const base = median(det.recent);
    if (ms >= SPIKE_MIN_MS && ms >= base * SPIKE_FACTOR && ms - base >= SPIKE_MIN_RISE) {
      if (push(j, { at: now, kind: 'spike', region, value: Math.round(ms), base: Math.round(base) }, MERGE_MS)) day.spikes++;
      det.highs.push(ms);
      if (det.highs.length < HIGH_RUN_SAMPLES) return; // a spike does not become part of the usual ping...
      det.recent = det.highs.slice(-MIN_BASELINE_SAMPLES); // ...unless it stays: then this is the usual ping now
      det.highs = [];
      return;
    }
  }
  det.highs = [];
  det.recent.push(ms);
  if (det.recent.length > 12) det.recent.shift();
}

export interface DayBar { day: string; drops: number; spikes: number; losses: number }

/** The last `n` days (oldest first, today last), with zeros for days without events. */
export function graphDays(j: Journal, now: number, n = 7): DayBar[] {
  const out: DayBar[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const k = dayKey(daysBefore(now, i));
    const d = j.days[k];
    out.push({ day: k, drops: d?.drops ?? 0, spikes: d?.spikes ?? 0, losses: d?.losses ?? 0 });
  }
  return out;
}

const stamp = (ms: number): string => { const d = new Date(ms); return `${dayKey(ms)} ${p2(d.getHours())}:${p2(d.getMinutes())}`; };

export function eventText(e: JEvent): string {
  const where = e.region ? ` (${e.region})` : '';
  if (e.kind === 'drop') return `disconnected, code ${e.value}${where}`;
  if (e.kind === 'spike') return `ping spike to ${e.value} ms, usually about ${e.base} ms${where}`;
  return `no answer from the server ${e.value} times in a row${where}`;
}

/** Plain text for a message to a provider or a game server admin. */
export function exportText(j: Journal, now: number, days = 14, maxEvents = 40): string {
  const from = daysBefore(now, days);
  const events = j.events.filter((e) => e.at >= from);
  let drops = 0, spikes = 0, losses = 0, minutes = 0, pingSum = 0, pingN = 0;
  for (const [k, d] of Object.entries(j.days)) {
    if (k < dayKey(from)) continue;
    drops += d.drops; spikes += d.spikes; losses += d.losses; minutes += d.minutes; pingSum += d.pingSum; pingN += d.pingN;
  }
  const lines = [
    `Connection journal of the last ${days} days, written by KRH Client while playing.`,
    pingN ? `Average ping: ${Math.round(pingSum / pingN)} ms over about ${Math.round(minutes)} minutes of measured play.` : 'No ping measured in this period.',
    `Disconnects: ${drops}. Ping spikes: ${spikes}. Stretches without an answer: ${losses}.`,
    '',
  ];
  if (!events.length) lines.push('No events in this period.');
  for (const e of events.slice().reverse().slice(0, maxEvents)) lines.push(`${stamp(e.at)}  ${eventText(e)}`);
  if (events.length > maxEvents) lines.push(`... and ${events.length - maxEvents} older events.`);
  return lines.join('\n');
}

/** Keeps what was read from disk to the known shape. */
export function cleanJournal(raw: unknown): Journal {
  const out = emptyJournal();
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown, hi: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(hi, v)) : 0);
  if (Array.isArray(r.events)) {
    for (const item of r.events.slice(-MAX_EVENTS)) {
      const e = item as Record<string, unknown> | null;
      if (!e || typeof e !== 'object' || (e.kind !== 'drop' && e.kind !== 'spike' && e.kind !== 'loss')) continue;
      out.events.push({ at: num(e.at, 1e14), kind: e.kind, region: typeof e.region === 'string' ? e.region.replace(/[^A-Za-z]/g, '').slice(0, 5).toUpperCase() : '', value: num(e.value, 1e6), base: num(e.base, 1e6) });
    }
  }
  if (r.days && typeof r.days === 'object') {
    for (const [k, v] of Object.entries(r.days as Record<string, unknown>)) {
      const d = v as Record<string, unknown> | null;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(k) || !d || typeof d !== 'object') continue;
      out.days[k] = { drops: num(d.drops, 1e5), spikes: num(d.spikes, 1e5), losses: num(d.losses, 1e5), minutes: num(d.minutes, 1e6), pingSum: num(d.pingSum, 1e12), pingN: num(d.pingN, 1e8) };
    }
    const keys = Object.keys(out.days).sort();
    while (keys.length > KEEP_DAYS) delete out.days[keys.shift() as string];
  }
  return out;
}
