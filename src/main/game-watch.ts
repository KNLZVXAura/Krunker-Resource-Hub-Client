// ── "Krunker updated" watch (main process) ──
// Collects the game's script files while the page loads (see shared/game-watch.ts for the idea), keeps the small state in
// <userData>/KRH Client/game-watch.json and answers the dashboard. Stays on this computer.

import { app } from 'electron';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { join } from 'path';
import { banner, emptyState, fingerprint, noteFailing, noteFingerprint } from '../shared/game-watch';
import type { Banner, Resource, WatchState } from '../shared/game-watch';
import { electronLog } from './logger';

let state: WatchState = emptyState();
let loaded = false;
let collecting: Resource[] | null = null;
let commitTimer: ReturnType<typeof setTimeout> | null = null;

function file(): string {
  const dir = join(app.getPath('userData'), 'KRH Client');
  try { mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
  return join(dir, 'game-watch.json');
}

const hex = (v: unknown): string => (typeof v === 'string' && /^[0-9a-f]{16}$/.test(v) ? v : '');
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
const names = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map((x) => x.slice(0, 120)).slice(0, 100) : []);

function load(): void {
  if (loaded) return;
  loaded = true;
  try {
    const r = JSON.parse(readFileSync(file(), 'utf8')) as Record<string, unknown>;
    state = { fp: hex(r.fp), changedAt: num(r.changedAt), before: names(r.before), lastFailing: names(r.lastFailing), dismissedFor: num(r.dismissedFor), toastedFor: num(r.toastedFor) };
  } catch { state = emptyState(); }
}

function save(): void {
  try {
    const target = file();
    writeFileSync(target + '.tmp', JSON.stringify(state));
    renameSync(target + '.tmp', target);
  } catch (err) { electronLog.warn('[KRH-GameWatch] Could not save:', (err as Error).message); }
}

/** The game page starts loading: collect its script files for a short while, then compare. */
export function beginGameLoad(): void {
  load();
  collecting = [];
  if (commitTimer) clearTimeout(commitTimer);
  commitTimer = setTimeout(() => {
    commitTimer = null;
    const items = collecting ?? [];
    collecting = null;
    const next = noteFingerprint(state, fingerprint(items), Date.now());
    if (next !== state) { if (next.changedAt !== state.changedAt) electronLog.log('[KRH-GameWatch] The game files changed since the last start'); state = next; save(); }
  }, 25_000);
  commitTimer.unref();
}

/** One finished request of the game (called for every request to krunker.io). */
export function noteGameResource(url: string, resourceType: string, headers: Record<string, string | string[]> | undefined): void {
  if (!collecting || resourceType !== 'script' || collecting.length > 200) return;
  let tag = '';
  if (headers) {
    for (const k of Object.keys(headers)) {
      const l = k.toLowerCase();
      if (l === 'etag' || (l === 'last-modified' && !tag)) { const v = headers[k]; tag = Array.isArray(v) ? v[0] ?? '' : v; }
    }
  }
  collecting.push({ url, tag });
}

export interface WatchView { banner: Banner | null; failing: string[] }

/** `failing` = the userscripts that failed in this start. Remembers them and answers with the banner (if any). */
export function watchView(failing: readonly string[]): WatchView {
  load();
  return { banner: banner(state, failing, Date.now()), failing: failing.slice() };
}

/** Called when the game ends / the client closes: these scripts failed in this start. */
export function rememberFailing(failing: readonly string[]): void {
  load();
  const next = noteFailing(state, failing, Date.now());
  if (next === state || (next.lastFailing.length === state.lastFailing.length && next.lastFailing.every((f, i) => f === state.lastFailing[i]))) return;
  state = next;
  save();
}

export function dismissBanner(): boolean {
  load();
  if (!state.changedAt) return false;
  state = { ...state, dismissedFor: state.changedAt };
  save();
  return true;
}

/** True once per game change when the in-game toast should be shown. */
export function shouldToast(failing: readonly string[]): boolean {
  load();
  const b = banner(state, failing, Date.now());
  if (!b || state.toastedFor === state.changedAt) return false;
  state = { ...state, toastedFor: state.changedAt };
  save();
  return true;
}
