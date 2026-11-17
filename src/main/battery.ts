// ── Battery profile (main process) ──
// Applies the profile when the computer runs on battery and takes it back on the charger (see shared/battery.ts). What was
// changed is saved in <userData>/KRH Client/battery-profile.json, so a restart in between still puts it back.

import { app, powerMonitor } from 'electron';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { join } from 'path';
import { describe, planApply, planRestore } from '../shared/battery';
import type { BatteryInput, BatteryProfile } from '../shared/battery';
import type { Change } from '../shared/perf-coach';
import { electronLog } from './logger';

export interface BatteryDeps {
  profile: () => BatteryProfile;
  read: () => BatteryInput;
  write: (change: Change, value: unknown) => void;
  capLive: () => boolean;
  /** Tells the player what happened (a toast in the game). */
  say: (text: string) => void;
}

let deps: BatteryDeps | null = null;
let applied: Change[] = [];
let loaded = false;

function file(): string {
  const dir = join(app.getPath('userData'), 'KRH Client');
  try { mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
  return join(dir, 'battery-profile.json');
}

function load(): void {
  if (loaded) return;
  loaded = true;
  try {
    const r = JSON.parse(readFileSync(file(), 'utf8')) as { applied?: unknown };
    if (Array.isArray(r.applied)) {
      applied = r.applied.slice(0, 5).flatMap((x) => {
        const o = x as Record<string, unknown> | null;
        const ok = o && (o.cat === 'performance' || o.cat === 'extras') && typeof o.path === 'string' && /^[A-Za-z]+(\.[A-Za-z]+)*$/.test(o.path);
        const prim = (v: unknown): unknown => (typeof v === 'boolean' || typeof v === 'number' ? v : null);
        return ok ? [{ cat: o.cat as Change['cat'], path: o.path as string, from: prim(o.from), to: prim(o.to) }] : [];
      });
    }
  } catch { applied = []; }
}

function save(): void {
  try {
    const target = file();
    writeFileSync(target + '.tmp', JSON.stringify({ applied }));
    renameSync(target + '.tmp', target);
  } catch (err) { electronLog.warn('[KRH-Battery] Could not save:', (err as Error).message); }
}

/** The power source changed (or the client started): apply or take back. */
export function syncBattery(onBattery: boolean): void {
  load();
  if (!deps) return;
  const p = deps.profile();
  if (onBattery && applied.length === 0) {
    const plan = planApply(p, deps.read(), deps.capLive());
    if (!plan.length) return;
    for (const c of plan) deps.write(c, c.to);
    applied = plan;
    save();
    electronLog.log(`[KRH-Battery] On battery: ${describe(plan)} lowered`);
    deps.say(`On battery: ${describe(plan)} lowered. They come back when you plug in.`);
  } else if (!onBattery && applied.length > 0) {
    const plan = planRestore(applied, deps.read());
    for (const c of plan) deps.write(c, c.to);
    applied = [];
    save();
    if (plan.length) { electronLog.log(`[KRH-Battery] On the charger: ${describe(plan)} back`); deps.say(`Plugged in: ${describe(plan)} back to how you had it.`); }
  }
}

export function initBattery(d: BatteryDeps): void {
  deps = d;
  load();
  const now = (): void => { try { syncBattery(powerMonitor.isOnBatteryPower()); } catch { /* no power info on this system */ } };
  powerMonitor.on('on-battery', () => syncBattery(true));
  powerMonitor.on('on-ac', () => syncBattery(false));
  setTimeout(now, 5000).unref();
}
