// ── FPS statistics (main process) ──
// Keeps the per-map and per-class FPS averages (see shared/fps-stats.ts) in <userData>/KRH Client/fps-stats.json.
// Everything stays on this computer.

import { app } from 'electron';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { addFpsSample, cleanFpsStats, emptyFpsStats } from '../shared/fps-stats';
import type { FpsStats } from '../shared/fps-stats';
import { electronLog } from './logger';
import { noteFpsSample } from './trends';

let stats: FpsStats = emptyFpsStats();
let loaded = false;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function file(): string {
  const dir = join(app.getPath('userData'), 'KRH Client');
  try { mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
  return join(dir, 'fps-stats.json');
}

function load(): void {
  if (loaded) return;
  loaded = true;
  try { stats = cleanFpsStats(JSON.parse(readFileSync(file(), 'utf8'))); } catch { stats = emptyFpsStats(); }
}

export function flushFpsStats(): void {
  if (!loaded) return;
  try { writeFileSync(file(), JSON.stringify(stats)); } catch (err) { electronLog.warn('[KRH] Could not save the FPS statistics:', err); }
}

export function recordFpsSample(map: unknown, cls: unknown, fps: unknown, low: unknown): void {
  load();
  if (!addFpsSample(stats, map, cls, fps, low)) return;
  if (typeof fps === 'number') noteFpsSample(map, fps);
  if (!flushTimer) flushTimer = setTimeout(() => { flushTimer = null; flushFpsStats(); }, 30_000);
}

export function getFpsStats(): FpsStats { load(); return stats; }

export function resetFpsStats(): void { load(); stats = emptyFpsStats(); flushFpsStats(); }
