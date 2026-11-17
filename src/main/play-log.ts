// ── Play log and connection journal (main process) ──
// Keeps the rounds, the K/D per ping range (shared/play-log.ts) and the connection journal (shared/conn-journal.ts) in
// <userData>/KRH Client/play-log.json, fed by the ten-second samples of the game page. Stays on this computer.

import { app } from 'electron';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { join } from 'path';
import { addFps, addSample, cleanPlayLog, emptyLog, finishRound, lagAnswer } from '../shared/play-log';
import type { PlayLog, Sample } from '../shared/play-log';
import { cleanJournal, diagnose, emptyJournal, eventText, exportText, graphDays, newDetector, noteDrop, noteSample, TRAIL_FPS, TRAIL_PING, trailText } from '../shared/conn-journal';
import type { Detector, Journal, Trail } from '../shared/conn-journal';
import { electronLog } from './logger';

let log: PlayLog = emptyLog();
let journal: Journal = emptyJournal();
let detector: Detector = newDetector();
let loaded = false;
let timer: ReturnType<typeof setTimeout> | null = null;

function file(): string {
  const dir = join(app.getPath('userData'), 'KRH Client');
  try { mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
  return join(dir, 'play-log.json');
}

function load(): void {
  if (loaded) return;
  loaded = true;
  try {
    const raw = JSON.parse(readFileSync(file(), 'utf8')) as { log?: unknown; journal?: unknown };
    log = cleanPlayLog(raw.log);
    journal = cleanJournal(raw.journal);
  } catch { log = emptyLog(); journal = emptyJournal(); }
}

/** Writes the file. The running round stays open (it is not part of the file), so a save every minute never cuts a round. */
function writeLog(): void {
  if (!loaded) return;
  const target = file();
  try {
    // Write next to the file and rename, so a crash in the middle never leaves a half-written play log
    writeFileSync(target + '.tmp', JSON.stringify({ log: { rounds: log.rounds, bins: log.bins, phases: log.phases }, journal }));
    renameSync(target + '.tmp', target);
  } catch (err) { electronLog.warn('[KRH] Could not save the play log:', (err as Error).message); }
}

/** Saves now and closes the running round (only for the end of the session: a round is kept when it lasted at least a minute). */
export function flushPlayLog(): void {
  if (!loaded) return;
  finishRound(log);
  writeLog();
}

function schedule(): void {
  if (timer) return;
  timer = setTimeout(() => { timer = null; writeLog(); }, 60_000);
}

/** One ten-second sample from the game page. `pingKnown` is false when the client does not know the game server yet. */
export function recordPlaySample(s: Sample, pingKnown: boolean, region: string): void {
  load();
  const now = Date.now();
  addSample(log, pingKnown ? s : { ...s, ms: -1 }, now);
  if (pingKnown) {
    // The trail is what the last minute looked like BEFORE this sample (a spike is the sample itself)
    noteSample(journal, detector, s.ms, region, now, s.dt, trailNow());
    if (!(s.dt > 0)) pingTrail = [];
    if (s.ms > 0 && s.ms < 5000) { pingTrail.push(s.ms); if (pingTrail.length > TRAIL_PING) pingTrail.shift(); }
  }
  schedule();
}

// The last minute: ping samples (ten seconds apart) and FPS windows (five seconds), kept only in memory
let pingTrail: number[] = [];
const fpsTrail: number[] = [];
const trailNow = (): Trail => ({ ping: pingTrail.slice(), fps: fpsTrail.slice() });

export function recordFpsForRound(fps: number): void {
  load();
  addFps(log, fps);
  fpsTrail.push(fps);
  if (fpsTrail.length > TRAIL_FPS) fpsTrail.shift();
}

export function recordDrop(code: number, region: string): void {
  load();
  noteDrop(journal, code, region, Date.now(), trailNow());
  schedule();
}

export function playLogView(): {
  rounds: Array<{ startAt: number; map: string; cls: string; seconds: number; kills: number; deaths: number; ping: number; fps: number }>;
  bins: PlayLog['bins'];
  lag: string;
} {
  load();
  const rounds = [...log.rounds, ...(log.current && log.current.seconds >= 60 ? [log.current] : [])].slice(-30).reverse();
  return {
    rounds: rounds.map((r) => ({ startAt: r.startAt, map: r.map, cls: r.cls, seconds: Math.round(r.seconds), kills: r.kills, deaths: r.deaths, ping: r.pingN ? Math.round(r.pingSum / r.pingN) : 0, fps: r.fpsN ? Math.round(r.fpsSum / r.fpsN) : 0 })),
    bins: log.bins,
    lag: lagAnswer(log.bins).text,
  };
}

/** Time, kills and deaths by how long the stretch of play had lasted (for the warm-up insight). */
export function phasesView(): PlayLog['phases'] {
  load();
  return log.phases;
}

export function journalView(): { graph: ReturnType<typeof graphDays>; events: Array<{ at: number; kind: string; text: string; trail: string; hint: string }>; report: string } {
  load();
  const now = Date.now();
  return {
    graph: graphDays(journal, now, 7),
    events: journal.events.slice(-15).reverse().map((e) => ({ at: e.at, kind: e.kind, text: eventText(e), trail: trailText(e.trail), hint: diagnose(e.trail) })),
    report: exportText(journal, now),
  };
}

export function resetPlayLog(): void { load(); log = emptyLog(); writeLog(); }
export function clearJournal(): void { load(); journal = emptyJournal(); detector = newDetector(); writeLog(); }
