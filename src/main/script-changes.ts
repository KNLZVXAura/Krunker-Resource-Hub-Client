// ── Userscript change detection (main process) ──
// Keeps a copy of every userscript the client has seen (the text, up to 100 KB each, and a hash) in
// <userData>/KRH Client/script-snapshots.json and compares at game start (see shared/script-changes.ts). The first time it
// only learns the scripts that are there. Changes made through the client are accepted silently. Stays on this computer.

import { app } from 'electron';
import { createHash } from 'crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { changeEntry, cleanChangeLog, MAX_LOG } from '../shared/script-changes';
import type { ChangeEntry } from '../shared/script-changes';
import { electronLog } from './logger';

interface Snap { hash: string; text: string }
interface State { seeded: boolean; files: Record<string, Snap>; log: ChangeEntry[] }

const MAX_TEXT = 100 * 1024;       // longer scripts are compared by hash only (no line counts)
const MAX_TOTAL_TEXT = 1500 * 1024;
const MAX_FILES = 200;

let state: State = { seeded: false, files: {}, log: [] };
let loaded = false;

function path(): string {
  const dir = join(app.getPath('userData'), 'KRH Client');
  try { mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
  return join(dir, 'script-snapshots.json');
}

const hashOf = (text: string): string => createHash('sha256').update(text).digest('hex');

function load(): void {
  if (loaded) return;
  loaded = true;
  try {
    const raw = JSON.parse(readFileSync(path(), 'utf8')) as { seeded?: unknown; files?: unknown; log?: unknown };
    const files: Record<string, Snap> = {};
    if (raw.files && typeof raw.files === 'object') {
      for (const [name, v] of Object.entries(raw.files as Record<string, unknown>).slice(0, MAX_FILES)) {
        const s = v as { hash?: unknown; text?: unknown } | null;
        if (s && typeof s.hash === 'string' && /^[0-9a-f]{64}$/.test(s.hash)) files[name.slice(0, 120)] = { hash: s.hash, text: typeof s.text === 'string' ? s.text.slice(0, MAX_TEXT) : '' };
      }
    }
    state = { seeded: raw.seeded === true, files, log: cleanChangeLog(raw.log) };
  } catch { state = { seeded: false, files: {}, log: [] }; }
}

function save(): void {
  try { writeFileSync(path(), JSON.stringify(state)); } catch (err) { electronLog.warn('[KRH] Could not save the script snapshots:', (err as Error).message); }
}

function snapOf(content: string, textBudget: { left: number }): Snap {
  const keep = content.length <= MAX_TEXT && content.length <= textBudget.left;
  if (keep) textBudget.left -= content.length;
  return { hash: hashOf(content), text: keep ? content : '' };
}

/** Compares the scripts now in the folder with what was seen last time. Returns the new changes (empty the very first time). */
export function checkScripts(scripts: ReadonlyArray<{ filename: string; content: string }>): ChangeEntry[] {
  load();
  const now = Date.now();
  const budget = { left: MAX_TOTAL_TEXT };
  const next: Record<string, Snap> = {};
  const changes: ChangeEntry[] = [];
  for (const s of scripts.slice(0, MAX_FILES)) {
    const snap = snapOf(s.content, budget);
    const before = state.files[s.filename];
    next[s.filename] = snap;
    if (!state.seeded) continue;
    if (!before) changes.push(changeEntry(s.filename, 'new', '', s.content, now));
    else if (before.hash !== snap.hash) changes.push(changeEntry(s.filename, 'changed', before.text, s.content, now));
  }
  if (state.seeded) {
    for (const [name, before] of Object.entries(state.files)) {
      if (!(name in next)) changes.push(changeEntry(name, 'removed', before.text, '', now));
    }
  }
  state.files = next;
  state.seeded = true;
  if (changes.length) state.log = [...state.log, ...changes].slice(-MAX_LOG);
  save();
  if (changes.length) electronLog.log(`[KRH-Scripts] ${changes.length} userscript change(s) noticed: ${changes.map((c) => c.kind + ' ' + c.file).join(', ')}`);
  return changes;
}

/** A script was written through the client (editor, add, restore): remember it without reporting a change. */
export function acceptScript(filename: string, content: string): void {
  load();
  if (!state.seeded) return;
  state.files[filename] = { hash: hashOf(content), text: content.length <= MAX_TEXT ? content : '' };
  save();
}

/** A script was deleted through the client. */
export function forgetScript(filename: string): void {
  load();
  if (filename in state.files) { delete state.files[filename]; save(); }
}

export function changeLog(): ChangeEntry[] { load(); return state.log; }
export function clearChangeLog(): void { load(); state.log = []; save(); }
