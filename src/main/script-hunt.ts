// ── Script hunt (main process) ──
// Keeps the state of the "find the problem script" helper (see shared/script-hunt.ts) in
// <userData>/KRH Client/script-hunt.json, so it survives a restart of the client, and switches scripts on and off through
// the functions it is given (the userscript tracker and the built-in script switches).

import { app } from 'electron';
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import { answerHunt, cancelSwitches, cleanHuntState, startHunt, switchesFor } from '../shared/script-hunt';
import type { HuntState, Switches } from '../shared/script-hunt';
import { electronLog } from './logger';

export interface HuntBackend {
  /** File names of every script that is switched on now (folder scripts and built-in ones). */
  listEnabled(): Promise<string[]>;
  setEnabled(filename: string, enabled: boolean): Promise<void>;
  /** Scripts changed recently (listed first in the search), if the backend can tell. */
  recent?(): Promise<string[]>;
}

let state: HuntState | null = null;
let loaded = false;

function file(): string {
  const dir = join(app.getPath('userData'), 'KRH Client');
  try { mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
  return join(dir, 'script-hunt.json');
}

function load(): void {
  if (loaded) return;
  loaded = true;
  try { state = cleanHuntState(JSON.parse(readFileSync(file(), 'utf8'))); } catch { state = null; }
}

function save(): void {
  try {
    if (state) writeFileSync(file(), JSON.stringify(state));
    else unlinkSync(file());
  } catch (err) { if (state) electronLog.warn('[KRH] Could not save the script hunt state:', (err as Error).message); }
}

async function apply(sw: Switches, backend: HuntBackend): Promise<void> {
  for (const n of sw.off) await backend.setEnabled(n, false);
  for (const n of sw.on) await backend.setEnabled(n, true);
}

export function huntState(): HuntState | null { load(); return state; }

export async function startScriptHunt(backend: HuntBackend): Promise<{ ok: boolean; error?: string; state?: HuntState }> {
  load();
  if (state && state.phase === 'testing') return { ok: false, error: 'A hunt is already running.' };
  const s = startHunt(await backend.listEnabled(), backend.recent ? await backend.recent() : []);
  if (!s) return { ok: false, error: 'No script is switched on, so there is nothing to find.' };
  state = s;
  save();
  await apply(switchesFor(s), backend);
  electronLog.log(`[KRH-Hunt] Started with ${s.original.length} scripts; test 1: all off`);
  return { ok: true, state: s };
}

export async function answerScriptHunt(backend: HuntBackend, problemStillThere: boolean): Promise<{ ok: boolean; error?: string; state?: HuntState }> {
  load();
  if (!state || state.phase !== 'testing') return { ok: false, error: 'No hunt is running.' };
  state = answerHunt(state, problemStillThere);
  save();
  await apply(switchesFor(state), backend);
  electronLog.log(`[KRH-Hunt] ${state.phase}${state.culprit ? ': ' + state.culprit : ''} (test ${state.step})`);
  return { ok: true, state };
}

/** Cancel a running hunt (everything that was on goes back on) or dismiss a finished one (nothing more is changed). */
export async function endScriptHunt(backend: HuntBackend): Promise<void> {
  load();
  if (state && state.phase === 'testing') await apply(cancelSwitches(state), backend);
  state = null;
  save();
}
