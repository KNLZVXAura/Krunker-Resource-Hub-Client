// ── Gameplay recording ──
// Records the game window (video + audio) to an MP4 (H.264) file in <Videos>/KRH Client
// (falls back to WebM if the H.264 encoder is unavailable).
// A hidden "recorder" window does the actual capture (MediaRecorder needs a renderer); this module
// answers its screen-capture request with the game window's frame, receives the encoded chunks over
// IPC and appends them to the output file as they arrive (so a crash still leaves a playable file).

import { app, BrowserWindow, desktopCapturer, ipcMain, screen, session, shell } from 'electron';
import { join } from 'path';
import { createWriteStream, mkdirSync, writeFileSync, WriteStream, promises as fsp } from 'fs';
import { config } from './config';
import { electronLog } from './logger';
import { recordClip } from './clips';
import { fileSuffix } from '../shared/clips';
import type { ClipContext } from '../shared/clips';

const BITRATES: Record<string, number> = { Low: 6_000_000, Medium: 12_000_000, High: 25_000_000 };

let target: BrowserWindow | null = null;
let recWin: BrowserWindow | null = null;
let out: WriteStream | null = null;
let filePath = '';   // temporary ".part" file while recording
let finalPath = '';  // final name; the extension is only known once the recorder reports its format
let startedAt = 0;
let bytes = 0;
let state: 'idle' | 'starting' | 'recording' | 'paused' | 'stopping' = 'idle';
let pausedAt = 0;
let pausedTotal = 0;
let audioMode = 'game';
let sourceMode = 'game';
let stopTimer: ReturnType<typeof setTimeout> | null = null;
let initialized = false;

export function recordingsDir(): string {
  try { return join(app.getPath('videos'), 'KRH Client'); }
  catch { return join(app.getPath('userData'), 'KRH Client', 'recordings'); }
}

function stamp(): string {
  const d = new Date();
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

function toast(msg: string): void {
  if (target && !target.isDestroyed()) target.webContents.send('krh-toast', msg);
}

function fmtSize(b: number): string {
  return b >= 1e9 ? (b / 1e9).toFixed(2) + ' GB' : (b / 1e6).toFixed(1) + ' MB';
}

export function isRecording(): boolean { return state === 'recording' || state === 'paused' || state === 'starting'; }

function init(): void {
  if (initialized) return;
  initialized = true;

  ipcMain.on('krh-rec-chunk', (e, buf: ArrayBuffer) => {
    if (!recWin || e.sender !== recWin.webContents || !out) return;
    const chunk = Buffer.from(buf);
    bytes += chunk.length;
    out.write(chunk);
  });
  ipcMain.on('krh-rec-started', (e, info: { width: number; height: number; hasAudio: boolean; mime?: string; mic?: boolean; micFailed?: boolean }) => {
    if (!recWin || e.sender !== recWin.webContents) return;
    state = 'recording';
    startedAt = Date.now();
    pausedAt = 0;
    pausedTotal = 0;
    finalPath = finalPath.replace(/\.\w+$/, info.mime && info.mime.startsWith('video/mp4') ? '.mp4' : '.webm');
    electronLog.log(`[KRH] Recording started: ${info.width}x${info.height}, audio=${info.hasAudio}, format=${info.mime || 'unknown'} -> ${finalPath}`);
    if (info.micFailed) electronLog.warn('[KRH] Microphone requested but unavailable (no device or access blocked in Windows privacy settings)');
    if (info.micFailed) toast('Recording started (microphone unavailable)');
    else toast(audioMode !== 'off' && !info.hasAudio ? 'Recording started (no audio available)' : 'Recording started');
  });
  ipcMain.on('krh-rec-pause-state', (e, paused: boolean) => {
    if (!recWin || e.sender !== recWin.webContents) return;
    if (paused && state === 'recording') {
      state = 'paused'; pausedAt = Date.now();
      toast('Recording paused');
    } else if (!paused && state === 'paused') {
      pausedTotal += Date.now() - pausedAt; pausedAt = 0; state = 'recording';
      toast('Recording resumed');
    }
  });
  ipcMain.on('krh-rec-error', (e, msg: string) => {
    if (!recWin || e.sender !== recWin.webContents) return;
    electronLog.error('[KRH] Recording error:', msg);
    toast('Recording failed');
    finalize(true);
  });
  ipcMain.on('krh-rec-stopped', (e) => {
    if (!recWin || e.sender !== recWin.webContents) return;
    finalize(false);
  });
}


// The capture page must be a secure context (getDisplayMedia is unavailable on data: URLs).
function ensureRecorderPage(): string {
  const pageFile = join(app.getPath('userData'), 'KRH Client', 'recorder.html');
  mkdirSync(join(app.getPath('userData'), 'KRH Client'), { recursive: true });
  writeFileSync(pageFile, '<!doctype html><meta charset="utf-8"><title>KRH Recorder</title>');
  return pageFile;
}

/** In-memory session for a hidden capture window: answers the screen-capture request with the game's own frame. */
function prepareSession(partition: string): Electron.Session {
  const ses = session.fromPartition(partition);
  ses.setDisplayMediaRequestHandler(async (_req, callback) => {
    if (!target || target.isDestroyed()) { callback({}); return; }
    try {
      const frame = target.webContents.mainFrame;
      // Video: the game window's own frame, or the whole screen the game is on (shows other windows too).
      let video: Electron.WebFrameMain | Electron.DesktopCapturerSource = frame;
      if (sourceMode === 'screen') {
        const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
        const disp = screen.getDisplayMatching(target.getBounds());
        const src = sources.find((s) => s.display_id === String(disp.id)) || sources[0];
        if (!src) { callback({}); return; }
        video = src;
      }
      if (audioMode === 'off') callback({ video });
      else if (audioMode === 'system' && process.platform === 'win32') callback({ video, audio: 'loopback' });
      else callback({ video, audio: frame });
    } catch (err) {
      electronLog.error('[KRH] Display media request failed:', err);
      callback({});
    }
  }, { useSystemPicker: false });
  // The capture window may use the microphone (only audio, only for this window).
  ses.setPermissionRequestHandler((_wc, permission, cb, details) => {
    const types = (details as { mediaTypes?: string[] }).mediaTypes ?? [];
    cb(permission === 'media' && types.every((t) => t === 'audio'));
  });
  ses.setPermissionCheckHandler((_wc, permission) => permission === 'media');
  return ses;
}

function finalize(failed: boolean): void {
  if (stopTimer) { clearTimeout(stopTimer); stopTimer = null; }
  const stream = out, win = recWin, path = filePath, dest = finalPath, size = bytes, began = startedAt;
  out = null; recWin = null; state = 'idle';
  if (win && !win.isDestroyed()) win.destroy();
  if (!stream) return;
  stream.end(() => {
    if (failed || size === 0) {
      void fsp.rm(path, { force: true }).catch(() => { /* ignore */ });
      return;
    }
    void fsp.rename(path, dest).catch((err) => electronLog.error('[KRH] Could not finalize recording file:', err)).then(() => {
      electronLog.log(`[KRH] Recording saved: ${dest}`);
    });
    const open = pausedAt ? Date.now() - pausedAt : 0;
    const secs = began ? Math.max(0, Math.round((Date.now() - began - pausedTotal - open) / 1000)) : 0;
    electronLog.log(`[KRH] Recording length ~${secs}s, ${fmtSize(size)}`);
    toast(`Recording saved (${fmtSize(size)})`);
  });
}

export async function startRecording(game: BrowserWindow): Promise<void> {
  if (state !== 'idle' || game.isDestroyed()) return;
  init();
  state = 'starting';
  target = game;

  const g = config.get('game');
  const fps = g.recordFps === 30 ? 30 : 60;
  const bps = BITRATES[g.recordQuality] ?? BITRATES.Medium;
  audioMode = g.recordAudio === 'system' || g.recordAudio === 'off' ? g.recordAudio : 'game';
  sourceMode = g.recordSource === 'screen' ? 'screen' : 'game';
  const mic = !!g.recordMic;

  try {
    const dir = recordingsDir();
    mkdirSync(dir, { recursive: true });
    finalPath = join(dir, `Krunker_${stamp()}.webm`); // extension corrected once the format is known
    filePath = finalPath.replace(/\.webm$/, '.part');
    out = createWriteStream(filePath);
    out.on('error', (err) => {
      electronLog.error('[KRH] Recording write error:', err);
      toast('Recording stopped: cannot write file');
      stopRecording();
    });
    bytes = 0;
    startedAt = 0;

    const pageFile = ensureRecorderPage();
    const ses = prepareSession('krh-recorder'); // in-memory

    recWin = new BrowserWindow({
      show: false,
      width: 320, height: 240,
      webPreferences: {
        session: ses,
        preload: join(__dirname, '..', 'preload', 'recorder.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
        autoplayPolicy: 'no-user-gesture-required',
      },
    });
    await recWin.loadFile(pageFile);
    // getDisplayMedia needs transient user activation; the keypress that got us here was in another window.
    await recWin.webContents.executeJavaScript('0', true);
    recWin.webContents.send('krh-rec-start', { fps, bps, audio: audioMode !== 'off', mic });
  } catch (err) {
    electronLog.error('[KRH] Could not start recording:', err);
    toast('Recording failed to start');
    finalize(true);
  }
}

export function stopRecording(): void {
  if (state === 'idle' || state === 'stopping') return;
  if (state === 'paused') { pausedTotal += Date.now() - pausedAt; pausedAt = 0; }
  state = 'stopping';
  if (recWin && !recWin.isDestroyed()) {
    recWin.webContents.send('krh-rec-stop');
    // Never hang: if the recorder doesn't answer, close the file with what we have.
    stopTimer = setTimeout(() => finalize(false), 6000);
  } else {
    finalize(false);
  }
}

export function toggleRecording(game: BrowserWindow): void {
  if (state === 'idle') void startRecording(game);
  else if (state === 'recording' || state === 'paused') stopRecording();
}

/** Pause a running recording, or resume a paused one. Does nothing when not recording. */
export function togglePauseRecording(): void {
  if (!recWin || recWin.isDestroyed()) return;
  if (state === 'recording') recWin.webContents.send('krh-rec-pause');
  else if (state === 'paused') recWin.webContents.send('krh-rec-resume');
}

export async function openRecordingsFolder(): Promise<string> {
  const dir = recordingsDir();
  await fsp.mkdir(dir, { recursive: true });
  return shell.openPath(dir);
}

// ── Instant replay ──
// A second hidden capture window records the game all the time into memory. Only the newest N seconds are kept.
// "Save clip" writes them to <Videos>/KRH Client as Krunker_replay_<time>.mp4 (or .webm). The encoder output is
// cut at fragment / cluster borders and glued to the stream header taken from the very first piece, so the
// clip needs no re-encoding. A clip can start with a short stretch of picture glitches until the encoder's next
// keyframe, because MediaRecorder cannot be told to cut on one.

let repWin: BrowserWindow | null = null;
let repState: 'idle' | 'starting' | 'running' = 'idle';
let repSeconds = 30;
let repFirst: Buffer | null = null;
let repRing: Array<{ t: number; buf: Buffer }> = [];
let repMime = '';
let repIpc = false;
let repSaving = false;

export function replayActive(): boolean { return repState !== 'idle'; }

function initReplayIpc(): void {
  if (repIpc) return;
  repIpc = true;
  ipcMain.on('krh-rbuf-chunk', (e, buf: ArrayBuffer) => {
    if (!repWin || e.sender !== repWin.webContents) return;
    const b = Buffer.from(buf);
    if (!repFirst) { repFirst = b; return; }
    const now = Date.now();
    repRing.push({ t: now, buf: b });
    const cutoff = now - (repSeconds + 3) * 1000;
    while (repRing.length > 1 && repRing[0].t < cutoff) repRing.shift();
  });
  ipcMain.on('krh-rbuf-started', (e, info: { mime?: string }) => {
    if (!repWin || e.sender !== repWin.webContents) return;
    repMime = info.mime || '';
    repState = 'running';
    electronLog.log(`[KRH] Instant replay buffer running (${repSeconds}s, ${repMime || 'unknown format'})`);
  });
  ipcMain.on('krh-rbuf-error', (e, msg: string) => {
    if (!repWin || e.sender !== repWin.webContents) return;
    electronLog.error('[KRH] Instant replay error:', msg);
    toast('Instant replay stopped (capture failed)');
    stopReplayBuffer();
  });
  ipcMain.on('krh-rbuf-stopped', (e) => {
    if (!repWin || e.sender !== repWin.webContents) return;
    stopReplayBuffer();
  });
}

export async function startReplayBuffer(game: BrowserWindow, seconds: number): Promise<void> {
  repSeconds = Math.max(10, Math.min(120, Math.round(seconds) || 30));
  if (repState !== 'idle' || game.isDestroyed()) return;
  initReplayIpc();
  repState = 'starting';
  target = game;
  repFirst = null;
  repRing = [];
  const g = config.get('game');
  const fps = g.recordFps === 30 ? 30 : 60;
  const bps = Math.min(BITRATES[g.recordQuality] ?? BITRATES.Medium, 12_000_000);
  audioMode = g.recordAudio === 'system' || g.recordAudio === 'off' ? g.recordAudio : 'game';
  sourceMode = g.recordSource === 'screen' ? 'screen' : 'game';
  try {
    const ses = prepareSession('krh-replay');
    repWin = new BrowserWindow({
      show: false, width: 320, height: 240,
      webPreferences: {
        session: ses,
        preload: join(__dirname, '..', 'preload', 'recorder.js'),
        contextIsolation: true, nodeIntegration: false, sandbox: true,
        backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required',
      },
    });
    await repWin.loadFile(ensureRecorderPage());
    await repWin.webContents.executeJavaScript('0', true);
    repWin.webContents.send('krh-rec-start', { fps, bps, audio: audioMode !== 'off', mic: false, prefix: 'krh-rbuf' });
  } catch (err) {
    electronLog.error('[KRH] Could not start instant replay:', err);
    stopReplayBuffer();
  }
}

export function setReplaySeconds(seconds: number): void {
  repSeconds = Math.max(10, Math.min(120, Math.round(seconds) || 30));
}

export function stopReplayBuffer(): void {
  const w = repWin;
  repWin = null;
  repState = 'idle';
  repFirst = null;
  repRing = [];
  if (w && !w.isDestroyed()) {
    try { w.webContents.send('krh-rec-stop'); } catch { /* ignore */ }
    setTimeout(() => { if (!w.isDestroyed()) w.destroy(); }, 1500);
  }
}

/** Position of the first occurrence of a byte pattern, or -1. */
function indexOfBytes(buf: Buffer, pattern: number[], from = 0): number {
  return buf.indexOf(Buffer.from(pattern), from);
}

/** Start of the first MP4 fragment (moof box) in the buffer, or -1. Walks the boxes; falls back to a search. */
function firstMoof(buf: Buffer): number {
  let p = 0;
  while (p + 8 <= buf.length) {
    const size = buf.readUInt32BE(p);
    const type = buf.toString('latin1', p + 4, p + 8);
    if (type === 'moof') return p;
    if (size < 8 || p + size > buf.length) break;
    p += size;
  }
  const i = buf.indexOf('moof', 4, 'latin1');
  return i >= 4 ? i - 4 : -1;
}

/** Pure part (exported for tests): build the clip bytes from the first piece and the kept pieces. */
export function buildClip(first: Buffer, pieces: Buffer[], mime: string): Buffer {
  const mp4 = mime.startsWith('video/mp4');
  let init = first;
  if (mp4) {
    const m = firstMoof(first);
    if (m > 0) init = first.subarray(0, m);
  } else {
    const c = indexOfBytes(first, [0x1f, 0x43, 0xb6, 0x75]);   // WebM Cluster id
    if (c > 0) init = first.subarray(0, c);
  }
  let body = Buffer.concat(pieces);
  if (mp4) {
    const m = firstMoof(body);
    if (m > 0) body = body.subarray(m);
  } else {
    const c = indexOfBytes(body, [0x1f, 0x43, 0xb6, 0x75]);
    if (c > 0) body = body.subarray(c);
  }
  return Buffer.concat([init, body]);
}

export async function saveReplayClip(ctx: ClipContext = { map: '', cls: '', streak: 0 }): Promise<void> {
  if (repState !== 'running' || !repFirst) { toast('Instant replay is not running'); return; }
  if (repSaving) return;
  const pieces = repRing.map((r) => r.buf);
  if (pieces.length === 0) { toast('Not enough recorded yet, try again in a moment'); return; }
  repSaving = true;
  try {
    const now = Date.now();
    const keep = repRing.filter((r) => r.t >= now - (repSeconds + 1) * 1000).map((r) => r.buf);
    const bytes = buildClip(repFirst, keep.length ? keep : pieces, repMime);
    const dir = recordingsDir();
    await fsp.mkdir(dir, { recursive: true });
    const ext = repMime.startsWith('video/mp4') ? '.mp4' : '.webm';
    const fileName = `Krunker_replay_${stamp()}${fileSuffix(ctx)}${ext}`;
    const path = join(dir, fileName);
    await fsp.writeFile(path, bytes);
    recordClip({ file: fileName, at: now, map: ctx.map, cls: ctx.cls, streak: ctx.streak, seconds: Math.min(repSeconds, keep.length || pieces.length), size: bytes.length, title: '' });
    electronLog.log(`[KRH] Instant replay clip saved: ${path} (${fmtSize(bytes.length)})`);
    toast(`Clip saved (last ${Math.min(repSeconds, keep.length || pieces.length)} s, ${fmtSize(bytes.length)})`);
  } catch (err) {
    electronLog.error('[KRH] Could not save the replay clip:', err);
    toast('Could not save the clip');
  } finally {
    repSaving = false;
  }
}
