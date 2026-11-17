// ── Performance coach (main process) ──
// Keeps the FPS windows of the last half hour (fed by main/fps-stats.ts), suggests settings that cost FPS (shared/perf-coach.ts)
// and runs one experiment at a time: apply a suggestion, measure the windows after it, compare with the ones before. The state
// is saved in <userData>/KRH Client/perf-coach.json so a restart does not lose a running test. Stays on this computer.

import { app } from 'electron';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { join } from 'path';
import { AFTER_DONE, BEFORE_MAX, MIN_WINDOWS, beforeWindows, compare, summarise, suggest } from '../shared/perf-coach';
import type { Change, CoachInput, Result, Suggestion, Summary, Win } from '../shared/perf-coach';
import { electronLog } from './logger';

export interface Experiment {
  id: string;
  suggestionId: string;
  title: string;
  startedAt: number;
  changes: Change[];
  before: Win[];
  after: Win[];
  result: Result | null;
}
export interface HistoryItem { at: number; title: string; verdict: string; text: string; kept: boolean }
interface State { experiment: Experiment | null; history: HistoryItem[] }

export interface CoachDeps {
  /** The settings that matter, as they are right now. */
  read: () => CoachInput;
  /** Writes one value into a settings category (through the same path as the settings pages, so it is also in the settings history). */
  write: (change: Change, value: unknown) => void;
}

const RING_MAX = 240;
let ring: Win[] = [];
let state: State = { experiment: null, history: [] };
let loaded = false;
let deps: CoachDeps | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

export function initPerfCoach(d: CoachDeps): void { deps = d; }

function file(): string {
  const dir = join(app.getPath('userData'), 'KRH Client');
  try { mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
  return join(dir, 'perf-coach.json');
}

const num = (v: unknown, hi: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(hi, v)) : 0);
const text = (v: unknown, max: number): string => (typeof v === 'string' ? Array.from(v, (c) => (c.charCodeAt(0) < 32 ? ' ' : c)).join('').trim().slice(0, max) : '');

function cleanWins(raw: unknown): Win[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(-BEFORE_MAX * 2).flatMap((x) => {
    if (!x || typeof x !== 'object') return [];
    const o = x as Record<string, unknown>;
    const fps = num(o.fps, 1000);
    return fps >= 1 ? [{ at: num(o.at, 1e14), fps, low: num(o.low, 1000), map: text(o.map, 40) }] : [];
  });
}

function cleanChanges(raw: unknown): Change[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 6).flatMap((x) => {
    if (!x || typeof x !== 'object') return [];
    const o = x as Record<string, unknown>;
    const cat = o.cat === 'performance' || o.cat === 'extras' ? o.cat : null;
    const path = text(o.path, 60);
    if (!cat || !/^[A-Za-z]+(\.[A-Za-z]+)*$/.test(path)) return [];
    const prim = (v: unknown): unknown => (typeof v === 'boolean' || typeof v === 'number' ? v : typeof v === 'string' ? v.slice(0, 40) : null);
    return [{ cat, path, from: prim(o.from), to: prim(o.to) }];
  });
}

function load(): void {
  if (loaded) return;
  loaded = true;
  try {
    const raw = JSON.parse(readFileSync(file(), 'utf8')) as { experiment?: unknown; history?: unknown };
    const e = raw.experiment as Record<string, unknown> | null | undefined;
    if (e && typeof e === 'object') {
      const changes = cleanChanges(e.changes);
      if (changes.length) {
        state.experiment = {
          id: text(e.id, 40), suggestionId: text(e.suggestionId, 30), title: text(e.title, 80), startedAt: num(e.startedAt, 1e14), changes,
          before: cleanWins(e.before), after: cleanWins(e.after), result: null,
        };
        if (state.experiment.after.length >= AFTER_DONE) state.experiment.result = compare(state.experiment.before, state.experiment.after);
      }
    }
    if (Array.isArray(raw.history)) {
      state.history = raw.history.slice(-10).flatMap((x) => {
        if (!x || typeof x !== 'object') return [];
        const o = x as Record<string, unknown>;
        return [{ at: num(o.at, 1e14), title: text(o.title, 80), verdict: text(o.verdict, 12), text: text(o.text, 400), kept: o.kept === true }];
      });
    }
  } catch { state = { experiment: null, history: [] }; }
}

function save(): void {
  saveTimer = null;
  try {
    const target = file();
    writeFileSync(target + '.tmp', JSON.stringify(state));
    renameSync(target + '.tmp', target);
  } catch (err) { electronLog.warn('[KRH] Could not save the performance coach:', (err as Error).message); }
}
function scheduleSave(): void { if (!saveTimer) saveTimer = setTimeout(save, 20_000); }
export function flushPerfCoach(): void { if (loaded) save(); }

/** One measured window (called for every window the game page reports). */
export function notePerfWindow(map: string, fps: number, low: number): void {
  load();
  const w: Win = { at: Date.now(), fps, low: Math.min(low, fps), map };
  ring.push(w);
  if (ring.length > RING_MAX) ring = ring.slice(-RING_MAX);
  const e = state.experiment;
  if (e && !e.result) {
    e.after.push(w);
    if (e.after.length > BEFORE_MAX * 2) e.after.shift();
    if (e.after.length >= AFTER_DONE) e.result = compare(e.before, e.after);
    scheduleSave();
  }
}

export interface CoachView {
  fpsOn: boolean;
  recent: Summary;
  enough: boolean;
  suggestions: Suggestion[];
  experiment: null | { title: string; windows: number; needed: number; result: null | { verdict: string; text: string }; changes: Change[] };
  history: HistoryItem[];
}

export function coachView(fpsStatsOn: boolean): CoachView {
  load();
  const input = deps?.read();
  const recent = summarise(beforeWindows(ring, Date.now()));
  const e = state.experiment;
  return {
    fpsOn: fpsStatsOn,
    recent,
    enough: recent.windows >= MIN_WINDOWS,
    suggestions: input && !e ? suggest(input, recent) : [],
    experiment: e ? { title: e.title, windows: e.after.length, needed: AFTER_DONE, result: e.result ? { verdict: e.result.verdict, text: e.result.text } : null, changes: e.changes } : null,
    history: state.history.slice().reverse(),
  };
}

function remember(item: HistoryItem): void {
  state.history.push(item);
  if (state.history.length > 10) state.history.shift();
}

/** Starts an experiment with a suggestion. Returns an error text or '' when it started. */
export function coachApply(suggestionId: unknown): string {
  load();
  if (!deps) return 'Not ready yet.';
  if (state.experiment) return 'Finish or undo the test that is running first.';
  const recent = summarise(beforeWindows(ring, Date.now()));
  const s = suggest(deps.read(), recent).find((x) => x.id === suggestionId);
  if (!s) return 'That suggestion is not available any more (the setting may have changed).';
  const now = Date.now();
  state.experiment = { id: `${now.toString(36)}`, suggestionId: s.id, title: s.title, startedAt: now, changes: s.changes, before: beforeWindows(ring, now), after: [], result: null };
  for (const c of s.changes) deps.write(c, c.to);
  save();
  return '';
}

/** Keeps the change of the running experiment. */
export function coachKeep(): boolean {
  load();
  const e = state.experiment;
  if (!e) return false;
  remember({ at: Date.now(), title: e.title, verdict: e.result?.verdict ?? 'unknown', text: e.result?.text ?? 'Kept before a result was ready.', kept: true });
  state.experiment = null;
  save();
  return true;
}

/** Puts the settings of the running experiment back. */
export function coachUndo(): boolean {
  load();
  const e = state.experiment;
  if (!e || !deps) return false;
  for (const c of e.changes) deps.write(c, c.from);
  remember({ at: Date.now(), title: e.title, verdict: e.result?.verdict ?? 'unknown', text: e.result?.text ?? 'Put back before a result was ready.', kept: false });
  state.experiment = null;
  save();
  return true;
}
