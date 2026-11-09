// ── Targeted fixes for the launch guard (main process) ──
// Builds the extra choices of the "Start in Safe Mode?" dialog (see safe-mode.ts and shared/crash-remedy.ts): undo the last
// settings change, or switch off the userscript that was edited most recently. Only offered when there is a recent
// candidate, and only applied when the user picks it.

import { app } from 'electron';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';
import { config } from './config';
import { DEFAULT_CONFIG } from './config-defaults';
import type { ExtrasConfig } from './config-defaults';
import { dropSavedChange, peekLastChange } from './settings-history';
import { electronLog } from './logger';
import { humanize } from '../shared/settings-history';
import { newestEnabledScript, undoCandidate } from '../shared/crash-remedy';
import type { Remedy } from './safe-mode';

function ago(ms: number): string {
  const min = Math.max(1, Math.round(ms / 60_000));
  if (min < 90) return `${min} min ago`;
  const h = Math.round(min / 60);
  return h < 48 ? `${h} hours ago` : `${Math.round(h / 24)} days ago`;
}

function undoRemedy(allowed: ReadonlySet<string>, now: number): Remedy | null {
  const last = undoCandidate(peekLastChange(allowed), now);
  if (!last) return null;
  const what = last.fields.map(humanize).slice(0, 3).join(', ') || 'settings';
  return {
    label: `Undo Last Change (${humanize(last.key)})`,
    detail: `Undo the last settings change: "${humanize(last.key)}" (${what}), made ${ago(now - last.at)}.`,
    apply: () => {
      const prev = JSON.parse(JSON.stringify(last.prev)) as Record<string, unknown>;
      const merged: Record<string, unknown> = { ...((DEFAULT_CONFIG as unknown as Record<string, unknown>)[last.key] as object), ...prev };
      if (last.key === 'extras') {
        // These change through their own calls, not through settings: keep them as they are now
        const cur = { ...DEFAULT_CONFIG.extras, ...(config.get('extras') as Partial<ExtrasConfig> | undefined) };
        merged.streamerMode = cur.streamerMode;
        merged.packs = { ...(merged.packs as object | undefined), enabled: cur.packs.enabled };
        merged.backupCopyDir = cur.backupCopyDir;
        merged.offerScriptHunt = cur.offerScriptHunt;
      }
      config.set(last.key as never, merged as never);
      dropSavedChange(last.id, allowed);
      electronLog.log(`[KRH-Safe] Undid the last settings change (${last.key}: ${what})`);
    },
  };
}

function scriptRemedy(now: number): Remedy | null {
  const us = config.get('userscripts') as { enabled?: boolean; path?: string } | undefined;
  if (us?.enabled === false) return null;
  const dir = join(us?.path || join(app.getPath('userData'), 'KRH Client'), 'scripts');
  const trackerPath = join(dir, 'tracker.json');
  let tracker: Record<string, boolean>;
  try { tracker = JSON.parse(readFileSync(trackerPath, 'utf-8')) as Record<string, boolean>; } catch { return null; }
  if (!existsSync(dir)) return null;
  const files: Array<{ name: string; mtime: number; enabled: boolean }> = [];
  try {
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.js')) continue;
      try { files.push({ name, mtime: statSync(join(dir, name)).mtimeMs, enabled: tracker[name] === true }); } catch { /* gone */ }
    }
  } catch { return null; }
  const newest = newestEnabledScript(files, now);
  if (!newest) return null;
  return {
    label: 'Switch Off Newest Script',
    detail: `Switch off the userscript that was edited most recently: ${newest.name} (${ago(now - newest.mtime)}). You can switch it on again in Userscripts.`,
    apply: () => {
      tracker[newest.name] = false;
      writeFileSync(trackerPath, JSON.stringify(tracker, null, 2), 'utf-8');
      electronLog.log(`[KRH-Safe] Switched off the newest script: ${newest.name}`);
    },
  };
}

/** The extra choices for the crash dialog; empty when nothing recent can be blamed. Never throws. */
export function crashRemedies(allowedKeys: ReadonlySet<string>): Remedy[] {
  const now = Date.now();
  const out: Remedy[] = [];
  try { const r = undoRemedy(allowedKeys, now); if (r) out.push(r); } catch (err) { electronLog.warn('[KRH-Safe] Undo option unavailable:', (err as Error).message); }
  try { const r = scriptRemedy(now); if (r) out.push(r); } catch (err) { electronLog.warn('[KRH-Safe] Script option unavailable:', (err as Error).message); }
  return out;
}
