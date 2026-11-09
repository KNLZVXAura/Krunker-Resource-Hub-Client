// ── Session stats ──
// The game page reports small deltas (kills, deaths, seconds played, matches, maps). This keeps the
// running session and a history of the last sessions in <userData>/KRH Client/session-stats.json.
// A session starts with the first report and ends when the game window is closed (back to the hub)
// or the client quits. Everything stays on this computer.

import { app } from 'electron';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { electronLog } from './logger';
import { bestBucket, byTimeOfDay, byWeekday } from '../shared/stats-hours';
import type { HourBucket } from '../shared/stats-hours';
import { byTag, cleanTag, knownTags } from '../shared/stats-tags';
import type { TagBucket } from '../shared/stats-tags';

/** Kills and deaths for one class or one map. */
export interface KD { k: number; d: number }

export interface SessionRecord {
  start: number;
  end: number;
  kills: number;
  deaths: number;
  seconds: number;
  matches: number;
  bestStreak: number;
  maps: Record<string, number>;
  /** Kills / deaths per class name (added in 1.2, empty in older sessions). */
  classes: Record<string, KD>;
  /** Kills / deaths per map name. */
  mapKd: Record<string, KD>;
  /** Label chosen for the session (ranked, scrim ...), '' when none. */
  tag: string;
}

export interface StatsDelta {
  kills?: number;
  deaths?: number;
  seconds?: number;
  matches?: number;
  bestStreak?: number;
  maps?: Record<string, number>;
  classes?: Record<string, KD>;
  mapKd?: Record<string, KD>;
}

const MAX_SESSIONS = 200;
const FLUSH_EVERY_MS = 3 * 60 * 1000;

let history: SessionRecord[] = [];
let current: SessionRecord | null = null;
/** The label new sessions get; it stays until the player changes it. */
let stickyTag = '';
let loaded = false;
let dirty = false;
let timer: ReturnType<typeof setInterval> | null = null;

function file(): string {
  const dir = join(app.getPath('userData'), 'KRH Client');
  try { mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
  return join(dir, 'session-stats.json');
}

function int(x: unknown, max: number): number {
  const n = typeof x === 'number' && isFinite(x) ? Math.floor(x) : 0;
  return Math.max(0, Math.min(max, n));
}

function load(): void {
  if (loaded) return;
  loaded = true;
  try {
    const j = JSON.parse(readFileSync(file(), 'utf-8')) as { sessions?: unknown; tag?: unknown };
    stickyTag = cleanTag(j.tag);
    if (Array.isArray(j.sessions)) {
      history = (j.sessions as Partial<SessionRecord>[])
        .filter((s) => s && typeof s.start === 'number')
        .map((s) => ({
          start: int(s.start, 4e12), end: int(s.end, 4e12), kills: int(s.kills, 1e7), deaths: int(s.deaths, 1e7),
          seconds: int(s.seconds, 1e9), matches: int(s.matches, 1e6), bestStreak: int(s.bestStreak, 1e5),
          maps: s.maps && typeof s.maps === 'object' ? cleanMaps(s.maps as Record<string, unknown>) : {},
          classes: cleanKd(s.classes), mapKd: cleanKd(s.mapKd), tag: cleanTag(s.tag),
        }))
        .slice(-MAX_SESSIONS);
    }
  } catch { /* first run or unreadable file: start empty */ }
}

function cleanMaps(m: Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(m).slice(0, 40)) {
    const name = String(k).slice(0, 40).trim();
    const n = int(v, 1e6);
    if (name && n > 0) out[name] = n;
  }
  return out;
}

function cleanKd(m: unknown): Record<string, KD> {
  const out: Record<string, KD> = {};
  if (!m || typeof m !== 'object') return out;
  for (const [k, v] of Object.entries(m as Record<string, unknown>).slice(0, 40)) {
    const name = String(k).slice(0, 40).trim();
    const kd = v as Partial<KD> | null;
    const kills = int(kd?.k, 1e6);
    const deaths = int(kd?.d, 1e6);
    if (name && (kills || deaths)) out[name] = { k: kills, d: deaths };
  }
  return out;
}

function mergeKd(into: Record<string, KD>, from: Record<string, KD>, cap: number): void {
  for (const [name, v] of Object.entries(from)) {
    if (!(name in into) && Object.keys(into).length >= 40) continue;
    const cur = into[name] ?? { k: 0, d: 0 };
    into[name] = { k: cur.k + Math.min(v.k, cap), d: cur.d + Math.min(v.d, cap) };
  }
}

function save(): void {
  try {
    const all = current && (current.kills || current.deaths || current.seconds) ? [...history, { ...current, end: Date.now() }] : history;
    writeFileSync(file(), JSON.stringify({ sessions: all.slice(-MAX_SESSIONS), tag: stickyTag }), 'utf-8');
    dirty = false;
  } catch (err) {
    electronLog.warn('[KRH-Stats] Could not save session stats:', (err as Error).message);
  }
}

export function addDelta(d: StatsDelta): void {
  load();
  if (!d || typeof d !== 'object') return;
  const now = Date.now();
  if (!current) current = { start: now, end: now, kills: 0, deaths: 0, seconds: 0, matches: 0, bestStreak: 0, maps: {}, classes: {}, mapKd: {}, tag: stickyTag };
  current.kills += int(d.kills, 500);
  current.deaths += int(d.deaths, 500);
  current.seconds += int(d.seconds, 3600);
  current.matches += int(d.matches, 20);
  current.bestStreak = Math.max(current.bestStreak, int(d.bestStreak, 1e5));
  if (d.maps && typeof d.maps === 'object') {
    for (const [name, n] of Object.entries(cleanMaps(d.maps as Record<string, unknown>))) {
      if (Object.keys(current.maps).length >= 40 && !(name in current.maps)) continue;
      current.maps[name] = (current.maps[name] || 0) + Math.min(n, 20);
    }
  }
  if (d.classes) mergeKd(current.classes, cleanKd(d.classes), 500);
  if (d.mapKd) mergeKd(current.mapKd, cleanKd(d.mapKd), 500);
  current.end = now;
  dirty = true;
  if (!timer) {
    timer = setInterval(() => { if (dirty) save(); }, FLUSH_EVERY_MS);
    timer.unref?.();
  }
}

export function topMap(r: SessionRecord): string {
  let best = '';
  let bestN = 0;
  for (const [k, v] of Object.entries(r.maps)) if (v > bestN) { best = k; bestN = v; }
  return best;
}

export function fmtDuration(sec: number): string {
  const m = Math.round(sec / 60);
  if (m < 1) return '<1 min';
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

export function kd(r: { kills: number; deaths: number }): string {
  return r.deaths > 0 ? (r.kills / r.deaths).toFixed(2) : r.kills > 0 ? r.kills.toFixed(2) : '0.00';
}

export function summaryText(r: SessionRecord): string {
  const parts = [`${r.kills} kills, ${r.deaths} deaths (K/D ${kd(r)})`, fmtDuration(r.seconds)];
  if (r.matches) parts.push(`${r.matches} ${r.matches === 1 ? 'match' : 'matches'}`);
  if (r.bestStreak > 1) parts.push(`best streak ${r.bestStreak}`);
  const m = topMap(r);
  if (m) parts.push(`most played: ${m}`);
  return parts.join(' · ');
}

/** Close the running session and store it. Returns it when it had any activity. */
export function endSession(): SessionRecord | null {
  load();
  const c = current;
  current = null;
  if (!c || (!c.kills && !c.deaths && c.seconds < 30)) { if (dirty) save(); return null; }
  c.end = Date.now();
  history.push(c);
  history = history.slice(-MAX_SESSIONS);
  save();
  return c;
}

export function flushStats(): void { if (dirty || current) save(); }

/** Sets the label for the running session and for the sessions that follow (empty = no label). */
export function setSessionTag(raw: unknown): string {
  load();
  stickyTag = cleanTag(raw);
  if (current) current.tag = stickyTag;
  save();
  return stickyTag;
}

export interface StatsView {
  current: SessionRecord | null;
  recent: SessionRecord[];
  total: { kills: number; deaths: number; seconds: number; matches: number; sessions: number; bestStreak: number };
  /** The last 7 calendar days (oldest first), sessions counted on the day they started. */
  days: Array<{ day: string; kills: number; deaths: number; seconds: number }>;
  /** All-time kills / deaths per class and per map, busiest first. */
  classes: Array<{ name: string; k: number; d: number }>;
  mapsKd: Array<{ name: string; k: number; d: number }>;
  /** K/D and kills per hour by part of the day and by weekday, from the session start time (see shared/stats-hours.ts). */
  timeOfDay: HourBucket[];
  weekdays: HourBucket[];
  /** Label of the best block / weekday when there is enough data to compare, else ''. */
  bestTime: string;
  bestDay: string;
  /** The label new sessions get, the labels to offer, and the totals per label (see shared/stats-tags.ts). */
  tag: string;
  tags: string[];
  byTag: TagBucket[];
}

function localDay(ms: number): string {
  const d = new Date(ms);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function topKd(all: SessionRecord[], pick: (s: SessionRecord) => Record<string, KD>): Array<{ name: string; k: number; d: number }> {
  const sum: Record<string, KD> = {};
  for (const s of all) for (const [n, v] of Object.entries(pick(s))) {
    const cur = sum[n] ?? { k: 0, d: 0 };
    sum[n] = { k: cur.k + v.k, d: cur.d + v.d };
  }
  return Object.entries(sum).map(([name, v]) => ({ name, k: v.k, d: v.d }))
    .sort((a, b) => (b.k + b.d) - (a.k + a.d)).slice(0, 6);
}

export function getStats(): StatsView {
  load();
  const all = current ? [...history, current] : history;
  const total = { kills: 0, deaths: 0, seconds: 0, matches: 0, sessions: all.length, bestStreak: 0 };
  for (const s of all) {
    total.kills += s.kills; total.deaths += s.deaths; total.seconds += s.seconds; total.matches += s.matches;
    total.bestStreak = Math.max(total.bestStreak, s.bestStreak);
  }
  const days: StatsView['days'] = [];
  const now = Date.now();
  for (let i = 6; i >= 0; i--) { const d = new Date(now); d.setDate(d.getDate() - i); days.push({ day: localDay(d.getTime()), kills: 0, deaths: 0, seconds: 0 }); } // calendar days: a clock change cannot skip or repeat a date
  for (const s of all) {
    const row = days.find((d) => d.day === localDay(s.start));
    if (row) { row.kills += s.kills; row.deaths += s.deaths; row.seconds += s.seconds; }
  }
  const timeOfDay = byTimeOfDay(all);
  const weekdays = byWeekday(all);
  return {
    current: current ? { ...current } : null, recent: history.slice(-10).reverse(), total,
    days, classes: topKd(all, (s) => s.classes), mapsKd: topKd(all, (s) => s.mapKd),
    timeOfDay, weekdays, bestTime: bestBucket(timeOfDay)?.label ?? '', bestDay: bestBucket(weekdays)?.label ?? '',
    tag: stickyTag, tags: knownTags(all), byTag: byTag(all),
  };
}

/** Every saved session plus the running one, oldest first (for the CSV export). */
export function allSessions(): SessionRecord[] {
  load();
  return current ? [...history, { ...current }] : [...history];
}

export function clearStats(): void {
  history = [];
  current = null;
  dirty = false;
  try { writeFileSync(file(), JSON.stringify({ sessions: [] }), 'utf-8'); } catch { /* ignore */ }
}
