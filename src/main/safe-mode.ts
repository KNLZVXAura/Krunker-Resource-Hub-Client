// ── Safe mode ──
// Detects a client that keeps crashing and offers to start without the things that usually cause it
// (userscripts, the resource swapper and packs, custom themes, overlays and the extra features).
//
// How it knows: a small file (not part of the settings, so a broken settings file cannot hide it)
// records "this launch is running". A normal quit clears it. If the next start still finds it set,
// the last run ended badly (crash, kill, power loss) and a counter goes up. A launch that stays up
// for 25 seconds without a renderer crash resets the counter. Two bad launches in a row, or the
// --safe-mode command line flag, bring up the dialog.

import { app, dialog } from 'electron';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { config } from './config';
import { electronLog } from './logger';

interface GuardState { pending: boolean; crashes: number }

/** An extra choice in the crash dialog that fixes the most likely cause instead of switching everything off. */
export interface Remedy { label: string; detail: string; apply: () => void }

const HEALTHY_AFTER_MS = 25_000;
const CRASH_LIMIT = 2;

let safe = false;
let sessionCrashed = false;
let healthyTimer: ReturnType<typeof setTimeout> | null = null;
let state: GuardState = { pending: false, crashes: 0 };

function guardFile(): string {
  const dir = join(app.getPath('userData'), 'KRH Client');
  try { mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
  return join(dir, 'launch-guard.json');
}

function readState(): GuardState {
  try {
    const j = JSON.parse(readFileSync(guardFile(), 'utf-8')) as Partial<GuardState>;
    return { pending: j.pending === true, crashes: Math.max(0, Math.min(50, Math.floor(Number(j.crashes) || 0))) };
  } catch {
    return { pending: false, crashes: 0 };
  }
}

function writeState(): void {
  try { writeFileSync(guardFile(), JSON.stringify(state), 'utf-8'); } catch { /* read-only profile: guard is best effort */ }
}

export function isSafeMode(): boolean { return safe; }

/** A renderer or GPU process died: counts towards safe mode and blocks the "healthy" reset. */
export function noteProcessCrash(what: string): void {
  sessionCrashed = true;
  state.crashes = Math.min(50, state.crashes + 1);
  writeState();
  electronLog.warn(`[KRH-Safe] ${what} crashed (bad launches in a row: ${state.crashes})`);
}

/** Normal quit: the run did not crash. */
export function markCleanQuit(): void {
  state.pending = false;
  writeState();
}

function startHealthTimer(): void {
  if (healthyTimer) clearTimeout(healthyTimer);
  healthyTimer = setTimeout(() => {
    healthyTimer = null;
    if (!sessionCrashed) {
      state.crashes = 0;
      writeState();
    }
  }, HEALTHY_AFTER_MS);
  healthyTimer.unref?.();
}

function backupAndResetSettings(): void {
  const path = (config as unknown as { path?: string }).path;
  try {
    if (path && existsSync(path)) {
      const bak = `${path}.backup-${new Date().toISOString().replace(/[:.]/g, '-')}`;
      copyFileSync(path, bak);
      electronLog.log('[KRH-Safe] Settings backed up to', bak);
    }
    // accounts hold the user's saved alts: keep them out of the reset
    const accounts = config.get('accounts');
    config.clear();
    if (accounts) config.set('accounts', accounts);
  } catch (err) {
    electronLog.error('[KRH-Safe] Settings reset failed:', err);
  }
}

/**
 * Call once at start, before any feature loads. Returns when the launch mode is decided;
 * afterwards isSafeMode() tells the rest of the client.
 */
export async function beginLaunchGuard(getRemedies: () => Remedy[] = () => []): Promise<void> {
  state = readState();
  const forced = process.argv.includes('--safe-mode');
  if (state.pending) state.crashes = Math.min(50, state.crashes + 1);   // last run never quit cleanly
  const loop = state.crashes >= CRASH_LIMIT;

  if (forced || loop) {
    const reason = forced
      ? 'KRH Client was started with --safe-mode.'
      : `KRH Client did not close properly the last ${state.crashes} times it was started.`;
    // Targeted fixes (undo the last settings change, switch off the newest script) sit between "Start Normally" and "Reset Settings"
    let remedies: Remedy[];
    try { remedies = getRemedies(); } catch { remedies = []; }
    const remedyText = remedies.length ? remedies.map((r) => `\n\n"${r.label}": ${r.detail} Then the client starts normally.`).join('') : '';
    const resetIndex = 2 + remedies.length;
    const { response } = await dialog.showMessageBox({
      type: 'warning',
      title: 'KRH Client',
      message: 'Start in Safe Mode?',
      detail:
        `${reason}\n\n` +
        'Safe Mode starts the client without userscripts, the resource swapper and packs, custom themes, ' +
        'overlays (Twitch, Spotify, keystrokes, nuke counter) and the extra features. Your settings are not changed.' +
        remedyText + '\n\n' +
        '"Reset Settings" saves a backup copy of your settings file first and then starts with default settings ' +
        '(your saved accounts are kept).',
      buttons: ['Safe Mode', 'Start Normally', ...remedies.map((r) => r.label), 'Reset Settings'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    let applied = '';
    if (response === 0) {
      safe = true;
    } else if (response === resetIndex) {
      backupAndResetSettings();
      state.crashes = 0;
    } else if (response >= 2 && response < resetIndex) {
      try { remedies[response - 2].apply(); applied = remedies[response - 2].label; } catch (err) { electronLog.error('[KRH-Safe] The chosen fix failed:', err); }
      state.crashes = 0;
    } else {
      state.crashes = 0;
    }
    electronLog.log(`[KRH-Safe] Launch mode: ${safe ? 'SAFE MODE' : response === resetIndex ? 'normal after reset' : applied ? 'normal after "' + applied + '"' : 'normal'}`);
  }

  state.pending = true;
  writeState();
  startHealthTimer();
}
