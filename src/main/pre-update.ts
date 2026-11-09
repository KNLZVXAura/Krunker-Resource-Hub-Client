// ── Hook that runs just before an update is installed ──
// The place that starts an installer (or swaps in a lighter update) calls runPreUpdate(); the main process registers
// what should happen first (the automatic backup). A failing hook never blocks the update.

import { electronLog } from './logger';

let hook: (() => void) | null = null;
let ran = false;

export function setPreUpdateHook(fn: (() => void) | null): void {
  hook = fn;
  ran = false;
}

/** Runs the registered hook once per start of the client, however many update paths are taken. */
export function runPreUpdate(): void {
  if (!hook || ran) return;
  ran = true;
  try { hook(); } catch (err) { electronLog.warn('[KRH-Update] Backup before update failed:', (err as Error).message); }
}
