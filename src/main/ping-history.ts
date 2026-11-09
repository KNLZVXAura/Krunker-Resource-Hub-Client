// ── Ping history (main process) ──
// Keeps the per-region, per-hour ping averages (see shared/ping-history.ts) in
// <userData>/KRH Client/ping-history.json. Samples come from the region ping round the client already makes;
// nothing extra is measured. Everything stays on this computer.

import { app } from 'electron';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { addSample, cleanHistory } from '../shared/ping-history';
import type { PingHistory } from '../shared/ping-history';
import { electronLog } from './logger';
import { notePingSample } from './trends';

let history: PingHistory = {};
let loaded = false;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function file(): string {
  const dir = join(app.getPath('userData'), 'KRH Client');
  try { mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
  return join(dir, 'ping-history.json');
}

function load(): void {
  if (loaded) return;
  loaded = true;
  try { history = cleanHistory(JSON.parse(readFileSync(file(), 'utf8'))); } catch { history = {}; }
}

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => { flushTimer = null; flushPingHistory(); }, 10_000);
}

export function flushPingHistory(): void {
  if (!loaded) return;
  try { writeFileSync(file(), JSON.stringify(history)); } catch (err) { electronLog.warn('[KRH] Could not save the ping history:', err); }
}

/** Adds one round of region pings (code -> ms). Regions sampled less than five minutes ago are skipped. */
export function recordRegionPings(pings: Record<string, number>): void {
  load();
  const now = Date.now();
  const hour = new Date(now).getHours();
  let changed = false;
  for (const [code, ms] of Object.entries(pings)) {
    if (addSample(history, code, ms, hour, now)) { changed = true; notePingSample(code, ms); }
  }
  if (changed) scheduleFlush();
}

export function getPingHistory(): PingHistory {
  load();
  return history;
}

export function resetPingHistory(): void {
  load();
  history = {};
  flushPingHistory();
}
