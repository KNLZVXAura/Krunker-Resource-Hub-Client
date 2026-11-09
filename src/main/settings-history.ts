// ── Settings history (main process) ──
// Keeps the short list of earlier settings values (see shared/settings-history.ts) in
// <userData>/KRH Client/settings-history.json, so a change can be undone from Settings > Extras. Stays on this computer.

import { app } from 'electron';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { cleanHistoryList, recordChange, withoutUndone } from '../shared/settings-history';
import type { HistoryEntry } from '../shared/settings-history';
import { electronLog } from './logger';

let list: HistoryEntry[] = [];
let loaded = false;
let allowed: ReadonlySet<string> = new Set();
let timer: ReturnType<typeof setTimeout> | null = null;

function file(): string {
  const dir = join(app.getPath('userData'), 'KRH Client');
  try { mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
  return join(dir, 'settings-history.json');
}

function load(): void {
  if (loaded) return;
  loaded = true;
  try { list = cleanHistoryList(JSON.parse(readFileSync(file(), 'utf8')), allowed); } catch { list = []; }
}

export function initSettingsHistory(allowedKeys: ReadonlySet<string>): void {
  allowed = allowedKeys;
}

export function flushSettingsHistory(): void {
  if (!loaded) return;
  try { writeFileSync(file(), JSON.stringify(list)); } catch (err) { electronLog.warn('[KRH] Could not save the settings history:', err); }
}

function schedule(): void {
  if (timer) return;
  timer = setTimeout(() => { timer = null; flushSettingsHistory(); }, 5_000);
}

/** Notes that a settings category changed from `prev` to `next` (both plain data). */
export function noteSettingsChange(key: string, prev: unknown, next: unknown): void {
  if (!allowed.has(key)) return;
  load();
  try {
    const before = list;
    // Plain copies, so later changes to the live objects cannot alter what was kept
    const p = JSON.parse(JSON.stringify(prev ?? {}));
    const n = JSON.parse(JSON.stringify(next ?? {}));
    list = recordChange(list, key, p, n, Date.now(), () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
    if (list !== before) schedule();
  } catch { /* a value that cannot be copied is not worth keeping */ }
}

export function settingsHistory(): HistoryEntry[] { load(); return list; }

export function findSettingsChange(id: string): HistoryEntry | null { load(); return list.find((e) => e.id === id) ?? null; }

/**
 * The newest saved change, read straight from the file (works before the settings history was started, for the launch
 * guard). `allowedKeys` limits it to the categories the history may hold.
 */
export function peekLastChange(allowedKeys: ReadonlySet<string>): HistoryEntry | null {
  try {
    const all = cleanHistoryList(JSON.parse(readFileSync(file(), 'utf8')), allowedKeys);
    return all.length ? all[all.length - 1] : null;
  } catch { return null; }
}

/** Removes an entry (and the newer ones of the same category) from the saved file, for the launch guard. */
export function dropSavedChange(id: string, allowedKeys: ReadonlySet<string>): void {
  try {
    const all = cleanHistoryList(JSON.parse(readFileSync(file(), 'utf8')), allowedKeys);
    writeFileSync(file(), JSON.stringify(withoutUndone(all, id)));
  } catch { /* nothing saved */ }
}

/** Forget the entry and the newer changes of the same category (they were undone with it). */
export function forgetFrom(id: string): void {
  load();
  list = withoutUndone(list, id);
  flushSettingsHistory();
}

export function clearSettingsHistory(): void { load(); list = []; flushSettingsHistory(); }
