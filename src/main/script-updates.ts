// ── Userscript updates from the KRH website (main process) ──
// Remembers where each website script came from (<userData>/KRH Client/script-origins.json), compares the website's copy now and
// then (shared/script-updates.ts decides), and updates, skips or undoes. One earlier version of every updated script is kept (up to
// 300 KB) so "Undo" works. Only the KRH website addresses the bridge already trusts are ever fetched. Nothing leaves this computer
// except those downloads.

import { app } from 'electron';
import { createHash } from 'crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { join } from 'path';
import { lineDiff, newRisks } from '../shared/script-changes';
import { activityLine, canAuto, judge, ROLLBACK_DROPS, suspect } from '../shared/script-updates';
import type { UpdateMode, Verdict } from '../shared/script-updates';
import { fetchSiteText } from './site-bridge';
import { electronLog } from './logger';

interface Origin {
  file: string; url: string; title: string;
  /** sha256 of the text the client installed or last updated to. */
  hash: string;
  installedAt: number; updatedAt: number; checkedAt: number;
  /** The version before the last update (empty = nothing to go back to). */
  prevText: string; prevHash: string;
  /** The website version the person chose to skip. */
  skipHash: string;
  /** Disconnects noticed since the last update. */
  drops: number;
}
interface Pending { file: string; remoteHash: string; verdict: Verdict; added: number; removed: number; risks: string[]; sample: string[] }
interface State { origins: Record<string, Origin>; pending: Record<string, Pending>; log: Array<{ at: number; text: string }>; lastCheckAt: number }

export interface ScriptIO {
  read: (file: string) => string | null;
  /** Writes the file (and tells the change detector the client did it); false when it failed. */
  write: (file: string, code: string) => boolean;
}

const MAX_ORIGINS = 100;
const MAX_PREV = 300 * 1024;
const MAX_TEXT = 2 * 1024 * 1024;
let state: State = { origins: {}, pending: {}, log: [], lastCheckAt: 0 };
let loaded = false;

const sha = (t: string): string => createHash('sha256').update(t).digest('hex');

function path(): string {
  const dir = join(app.getPath('userData'), 'KRH Client');
  try { mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
  return join(dir, 'script-origins.json');
}

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '');
const int = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
const isHash = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);

function load(): void {
  if (loaded) return;
  loaded = true;
  try {
    const raw = JSON.parse(readFileSync(path(), 'utf8')) as { origins?: unknown; log?: unknown; lastCheckAt?: unknown };
    const origins: Record<string, Origin> = {};
    if (raw.origins && typeof raw.origins === 'object') {
      for (const [file, v] of Object.entries(raw.origins as Record<string, unknown>).slice(0, MAX_ORIGINS)) {
        const o = v as Record<string, unknown> | null;
        if (!o || typeof o !== 'object' || !isHash(o.hash) || typeof o.url !== 'string') continue;
        origins[file.slice(0, 120)] = {
          file: file.slice(0, 120), url: str(o.url, 1500), title: str(o.title, 60) || file, hash: o.hash,
          installedAt: int(o.installedAt), updatedAt: int(o.updatedAt), checkedAt: int(o.checkedAt),
          prevText: str(o.prevText, MAX_PREV), prevHash: isHash(o.prevHash) ? o.prevHash : '', skipHash: isHash(o.skipHash) ? o.skipHash : '', drops: Math.min(50, int(o.drops)),
        };
      }
    }
    const log = Array.isArray(raw.log) ? (raw.log as unknown[]).slice(-20).flatMap((x) => {
      const o = x as { at?: unknown; text?: unknown } | null;
      return o && typeof o.text === 'string' ? [{ at: int(o.at), text: o.text.slice(0, 200) }] : [];
    }) : [];
    state = { origins, pending: {}, log, lastCheckAt: int(raw.lastCheckAt) };
  } catch { state = { origins: {}, pending: {}, log: [], lastCheckAt: 0 }; }
}

function save(): void {
  try {
    const target = path();
    writeFileSync(target + '.tmp', JSON.stringify({ origins: state.origins, log: state.log, lastCheckAt: state.lastCheckAt }));
    renameSync(target + '.tmp', target);
  } catch (err) { electronLog.warn('[KRH-ScriptUpdates] Could not save:', (err as Error).message); }
}

function note(text: string): void {
  state.log.push({ at: Date.now(), text });
  if (state.log.length > 20) state.log.shift();
}

/** A script was added from the website: remember where it came from and what was installed. */
export function noteScriptOrigin(file: string, url: string, title: string, code: string): void {
  load();
  state.origins[file] = { file, url: url.slice(0, 1500), title: title.slice(0, 60), hash: sha(code), installedAt: Date.now(), updatedAt: 0, checkedAt: Date.now(), prevText: '', prevHash: '', skipHash: '', drops: 0 };
  delete state.pending[file];
  const keys = Object.keys(state.origins);
  if (keys.length > MAX_ORIGINS) delete state.origins[keys[0]];
  save();
}

/** The script file was deleted or renamed through the client. */
export function forgetScriptOrigin(file: string): void {
  load();
  if (file in state.origins) { delete state.origins[file]; delete state.pending[file]; save(); }
}

export interface CheckSummary { checked: number; updates: number; applied: number; failed: number }

/** Compares the website's copy of every tracked script. In auto mode safe updates are applied at once. */
export async function checkScriptUpdates(mode: UpdateMode, io: ScriptIO): Promise<CheckSummary> {
  load();
  const sum: CheckSummary = { checked: 0, updates: 0, applied: 0, failed: 0 };
  if (mode === 'off') return sum;
  state.pending = {};
  for (const o of Object.values(state.origins)) {
    const local = io.read(o.file);
    if (local === null) { delete state.origins[o.file]; continue; }
    let remote: string;
    try { remote = await fetchSiteText(o.url, MAX_TEXT); } catch (err) { sum.failed++; electronLog.warn(`[KRH-ScriptUpdates] ${o.file}: ${(err as Error).message}`); continue; }
    sum.checked++;
    o.checkedAt = Date.now();
    const remoteHash = sha(remote);
    if (remoteHash === o.skipHash) continue;
    const verdict = judge(o.hash, sha(local), remoteHash);
    if (verdict === 'same' || verdict === 'gone') continue;
    const d = lineDiff(local, remote);
    const risks = newRisks(local, remote);
    if (canAuto(mode, verdict, risks)) {
      if (applyText(o, local, remote, remoteHash, io)) { sum.applied++; note(activityLine('updated', o.title, `+${d.added} / -${d.removed} lines`)); continue; }
      sum.failed++;
    }
    state.pending[o.file] = { file: o.file, remoteHash, verdict, added: d.added, removed: d.removed, risks, sample: d.addedSample };
    sum.updates++;
  }
  state.lastCheckAt = Date.now();
  save();
  if (sum.applied) electronLog.log(`[KRH-ScriptUpdates] ${sum.applied} script(s) updated automatically`);
  return sum;
}

function applyText(o: Origin, local: string, remote: string, remoteHash: string, io: ScriptIO): boolean {
  if (!io.write(o.file, remote)) return false;
  o.prevText = local.length <= MAX_PREV ? local : '';
  o.prevHash = o.prevText ? sha(local) : '';
  o.hash = remoteHash;
  o.updatedAt = Date.now();
  o.drops = 0;
  o.skipHash = '';
  delete state.pending[o.file];
  return true;
}

/** Applies one pending update (what the person pressed "Update" for). Returns an error text or ''. */
export async function applyScriptUpdate(file: unknown, io: ScriptIO): Promise<string> {
  load();
  const o = typeof file === 'string' ? state.origins[file] : undefined;
  if (!o) return 'That script is not tracked.';
  const local = io.read(o.file);
  if (local === null) { delete state.origins[o.file]; save(); return 'The script file is not there any more.'; }
  let remote: string;
  try { remote = await fetchSiteText(o.url, MAX_TEXT); } catch (err) { return (err as Error).message; }
  if (!applyText(o, local, remote, sha(remote), io)) return 'Could not write the script file.';
  note(activityLine('updated', o.title));
  save();
  return '';
}

/** "Not this one": the same website version is not offered again; the next one is. */
export function skipScriptUpdate(file: unknown): boolean {
  load();
  const o = typeof file === 'string' ? state.origins[file] : undefined;
  const p = typeof file === 'string' ? state.pending[file] : undefined;
  if (!o || !p) return false;
  o.skipHash = p.remoteHash;
  delete state.pending[o.file];
  note(activityLine('skipped', o.title));
  save();
  return true;
}

/** Goes back to the version before the last update. */
export function undoScriptUpdate(file: unknown, io: ScriptIO, why: 'undone' | 'rolled-back' = 'undone', extra = ''): string {
  load();
  const o = typeof file === 'string' ? state.origins[file] : undefined;
  if (!o) return 'That script is not tracked.';
  if (!o.prevText) return 'There is no earlier version to go back to.';
  if (!io.write(o.file, o.prevText)) return 'Could not write the script file.';
  // The version the person just left is not offered (or applied by auto mode) again until the website has a newer one
  const left = o.hash;
  o.hash = o.prevHash || sha(o.prevText);
  o.skipHash = left;
  o.prevText = ''; o.prevHash = '';
  o.updatedAt = 0; o.drops = 0;
  note(activityLine(why, o.title, extra));
  save();
  return '';
}

/**
 * The connection dropped (a real drop, not leaving a game). Scripts updated in the last half hour become suspects. In auto mode
 * the ones with enough drops are taken back by themselves. Returns the titles that were taken back, and whether any suspect remains.
 */
export function noteDropForScripts(mode: UpdateMode, io: ScriptIO): { rolledBack: string[]; suspects: number } {
  load();
  const now = Date.now();
  const rolledBack: string[] = [];
  let suspects = 0;
  for (const o of Object.values(state.origins)) {
    if (!o.prevText || !suspect(o.updatedAt, now)) continue;
    o.drops++;
    if (mode === 'auto' && o.drops >= ROLLBACK_DROPS) {
      const title = o.title;
      if (undoScriptUpdate(o.file, io, 'rolled-back', `${ROLLBACK_DROPS} times`) === '') rolledBack.push(title);
    } else suspects++;
  }
  if (rolledBack.length || suspects) save();
  return { rolledBack, suspects };
}

export interface ScriptUpdatesView {
  tracked: Array<{ file: string; title: string; updatedAt: number; checkedAt: number; canUndo: boolean; suspect: boolean }>;
  pending: Array<Pending & { title: string }>;
  log: Array<{ at: number; text: string }>;
  lastCheckAt: number;
}

export function scriptUpdatesView(): ScriptUpdatesView {
  load();
  const now = Date.now();
  return {
    tracked: Object.values(state.origins).map((o) => ({ file: o.file, title: o.title, updatedAt: o.updatedAt, checkedAt: o.checkedAt, canUndo: !!o.prevText, suspect: !!o.prevText && suspect(o.updatedAt, now) && o.drops > 0 })),
    pending: Object.values(state.pending).map((p) => ({ ...p, title: state.origins[p.file]?.title ?? p.file })),
    log: state.log.slice().reverse(),
    lastCheckAt: state.lastCheckAt,
  };
}
