// ── Weekly trends (main process) ──
// Keeps the weekly FPS-per-map and ping-per-region sums (see shared/trends.ts) in <userData>/KRH Client/trends.json, fed by
// the FPS windows and the region ping rounds the client already measures. Stays on this computer.

import { app } from 'electron';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { addFps, addPing, cleanTrends, compareWeeks, emptyTrends, noteVersion, signature, weekKey } from '../shared/trends';
import type { Trends, TrendFinding } from '../shared/trends';
import { electronLog } from './logger';

let trends: Trends = emptyTrends();
let loaded = false;
let timer: ReturnType<typeof setTimeout> | null = null;

function file(): string {
  const dir = join(app.getPath('userData'), 'KRH Client');
  try { mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
  return join(dir, 'trends.json');
}

function load(): void {
  if (loaded) return;
  loaded = true;
  try { trends = cleanTrends(JSON.parse(readFileSync(file(), 'utf8'))); } catch { trends = emptyTrends(); }
}

export function flushTrends(): void {
  if (!loaded) return;
  try { writeFileSync(file(), JSON.stringify(trends)); } catch (err) { electronLog.warn('[KRH] Could not save the trends:', err); }
}

function schedule(): void {
  if (timer) return;
  timer = setTimeout(() => { timer = null; flushTrends(); }, 30_000);
}

/** Call once at start: remembers when the client version changed. */
export function initTrends(version: string): void {
  load();
  const before = trends.version;
  noteVersion(trends, version, Date.now());
  if (trends.version !== before) schedule();
}

export function noteFpsSample(map: unknown, fps: number): void { load(); addFps(trends, map, fps, Date.now()); schedule(); }
export function notePingSample(region: string, ms: number): void { load(); addPing(trends, region, ms, Date.now()); schedule(); }

export interface TrendsView {
  findings: TrendFinding[];
  weekStart: string;
  version: string;
  versionSince: number;
  /** True when this week and last week both have some data. */
  haveBothWeeks: boolean;
}

export function trendsView(now = Date.now()): TrendsView {
  load();
  const key = weekKey(now);
  const prev = Object.keys(trends.weeks).sort().filter((k) => k < key).pop();
  return { findings: compareWeeks(trends, now), weekStart: key, version: trends.version, versionSince: trends.versionSince, haveBothWeeks: !!trends.weeks[key] && !!prev };
}

/** Findings not yet announced to the player (and remembers that they are now). Empty when there is nothing new. */
export function takeNewFindings(now = Date.now()): TrendFinding[] {
  load();
  const findings = compareWeeks(trends, now);
  if (!findings.length) return [];
  const sig = signature(findings, weekKey(now));
  if (trends.notified === sig) return [];
  trends.notified = sig;
  flushTrends();
  return findings;
}
