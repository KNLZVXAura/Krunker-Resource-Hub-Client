// ── Ready to play ──
// One answer from several checks: the connection (a short Network Doctor run), the userscripts, Safe Mode, a running script
// search, clear performance drops since last week and the settings that limit FPS (the Performance Doctor). Pure functions only:
// the main process runs the checks and hands the results here.

import { websocketClash } from './script-health';
import type { ScriptHealth } from './script-health';

export type ReadyLevel = 'ok' | 'warn' | 'bad';

export interface ReadyItem { level: ReadyLevel; area: string; text: string }
export interface ReadyResult { level: ReadyLevel; headline: string; items: ReadyItem[] }

export interface ReadyInput {
  /** Result of the (short) network test, or null when it could not run. */
  network: { level: ReadyLevel; headline: string } | null;
  scripts: readonly ScriptHealth[];
  gameRunning: boolean;
  /** Phase of the script search, or null when none exists. */
  huntPhase: 'testing' | 'found' | 'not-scripts' | null;
  huntCulprit?: string;
  safeMode: boolean;
  /** Texts of clear drops since last week (FPS per map, ping per region). */
  trendFindings: readonly string[];
  /** Problems from the Performance Doctor (only the ones that matter: warnings and errors). */
  perf: ReadonlyArray<{ level: 'warn' | 'bad'; title: string; detail: string }>;
}

const rank: Record<ReadyLevel, number> = { bad: 0, warn: 1, ok: 2 };

export function buildReady(i: ReadyInput): ReadyResult {
  const items: ReadyItem[] = [];

  if (i.network) items.push({ level: i.network.level, area: 'Connection', text: i.network.headline });
  else items.push({ level: 'warn', area: 'Connection', text: 'The connection test could not run.' });

  if (i.safeMode) items.push({ level: 'warn', area: 'Safe Mode', text: 'This run is in Safe Mode: userscripts, the resource swapper and the extra features are off. Restart the client normally to get them back.' });

  if (i.huntPhase === 'testing') items.push({ level: 'bad', area: 'Scripts', text: 'A script search is still running, so scripts are switched off. Finish or cancel it in Settings > Userscripts first.' });
  else if (i.huntPhase === 'found') items.push({ level: 'warn', area: 'Scripts', text: `The script search found ${i.huntCulprit ?? 'a script'} and switched it off.` });

  const failed = i.scripts.filter((s) => s.status === 'error');
  const skipped = i.scripts.filter((s) => s.status === 'skipped-twin');
  for (const s of failed) items.push({ level: 'warn', area: 'Scripts', text: `${s.name} failed to start: ${s.detail || 'unknown error'}` });
  for (const s of skipped) items.push({ level: 'warn', area: 'Scripts', text: `${s.name} is skipped because the same script already runs.` });
  const clash = websocketClash(i.scripts);
  if (clash.length) items.push({ level: 'warn', area: 'Scripts', text: `${clash.join(', ')} all wrap WebSocket, which can break the game connection.` });
  if (!failed.length && !skipped.length && !clash.length && i.huntPhase !== 'testing') {
    const running = i.scripts.filter((s) => s.status === 'running').length;
    items.push({ level: 'ok', area: 'Scripts', text: i.scripts.length ? `${running} script${running === 1 ? '' : 's'} running without problems.` : i.gameRunning ? 'No script is switched on.' : 'Start the game to check how the scripts are doing.' });
  }

  for (const t of i.trendFindings) items.push({ level: 'warn', area: 'Performance', text: t + ' compared with last week.' });

  for (const p of i.perf) items.push({ level: p.level, area: 'Settings', text: `${p.title}: ${p.detail}` });
  if (!i.perf.length) items.push({ level: 'ok', area: 'Settings', text: 'No setting that limits FPS was found.' });

  items.sort((a, b) => rank[a.level] - rank[b.level]);
  const worst: ReadyLevel = items.some((x) => x.level === 'bad') ? 'bad' : items.some((x) => x.level === 'warn') ? 'warn' : 'ok';
  const headline = worst === 'bad' ? 'Something needs fixing before you play.' : worst === 'warn' ? 'Ready to play, but a few things are worth a look.' : 'Ready to play.';
  return { level: worst, headline, items };
}
