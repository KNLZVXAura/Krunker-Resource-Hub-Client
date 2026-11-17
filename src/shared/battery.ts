// ── Battery profile ──
// On a laptop that is running on its battery, the client can switch a few things that cost power and are not needed for playing to
// lower settings, and put them back when the charger is plugged in again. It only puts back what it changed itself, and only if you
// did not change that setting in between (your own change always wins). Only settings that take effect at once are touched.
// Pure functions only.

import { getAt } from './perf-coach';
import type { Change } from './perf-coach';

export interface BatteryProfile {
  enabled: boolean;
  /** FPS cap while on battery (0 = leave the cap alone). Only used when the cap can be changed while the game runs. */
  frameCap: number;
  /** Switch instant replay off while on battery. */
  pauseReplay: boolean;
  /** Switch motion blur off while on battery. */
  noMotionBlur: boolean;
}

export interface BatteryInput {
  performance: { frameCap?: number };
  extras: { instantReplay?: { enabled?: boolean }; motionBlur?: { enabled?: boolean } };
}

export const defaultProfile = (): BatteryProfile => ({ enabled: false, frameCap: 60, pauseReplay: true, noMotionBlur: true });

/** What to change when the computer starts running on battery. Nothing that is already low enough is touched. */
export function planApply(profile: BatteryProfile, input: BatteryInput, capLive: boolean): Change[] {
  if (!profile.enabled) return [];
  const out: Change[] = [];
  const cap = input.performance.frameCap ?? 0;
  if (capLive && profile.frameCap >= 20 && (cap === 0 || cap > profile.frameCap)) out.push({ cat: 'performance', path: 'frameCap', from: cap, to: profile.frameCap });
  if (profile.pauseReplay && input.extras.instantReplay?.enabled === true) out.push({ cat: 'extras', path: 'instantReplay.enabled', from: true, to: false });
  if (profile.noMotionBlur && input.extras.motionBlur?.enabled === true) out.push({ cat: 'extras', path: 'motionBlur.enabled', from: true, to: false });
  return out;
}

/** What to put back when the charger is plugged in: only settings that still have the value the profile gave them. */
export function planRestore(applied: readonly Change[], input: BatteryInput): Change[] {
  return applied.filter((c) => getAt(c.cat === 'performance' ? input.performance : input.extras, c.path) === c.to).map((c) => ({ ...c, from: c.to, to: c.from }));
}

export function describe(changes: readonly Change[]): string {
  const names: Record<string, string> = { frameCap: 'FPS cap', 'instantReplay.enabled': 'instant replay', 'motionBlur.enabled': 'motion blur' };
  return changes.map((c) => names[c.path] ?? c.path).join(', ');
}
