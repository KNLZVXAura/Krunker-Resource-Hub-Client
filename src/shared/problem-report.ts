// ── Extra sections of the problem report ──
// The Diagnostics report (Dashboard > Diagnostics) already has the versions, the PC, the performance settings and the end
// of the log. These sections add how the userscripts are doing, the latest connection problems, the script search state and
// the backups, because that is what questions like "Lost Connection" need. Pure formatting: the main process gathers the data.

import { statusText } from './script-health';
import type { ScriptHealth } from './script-health';
import type { HuntState } from './script-hunt';

export interface ReportBackup { kind: string; version: string; at: number }

export interface ReportInput {
  health: readonly ScriptHealth[];
  gameRunning: boolean;
  hunt: HuntState | null;
  connectionLines: readonly string[];
  backups: readonly ReportBackup[];
  autoBackup: boolean;
  schedule: string;
  userscriptsOn: boolean;
}

const CONNECTION_WORDS = /lost connection|socket (closed|error)|close code|ws close|connection (failed|lost|closed)|ERR_[A-Z_]+|code 100[0-9]/i;

/** Lines of a log that are about the connection, newest last, at most `max`, each cut to 240 characters. */
export function connectionLines(log: string, max = 12): string[] {
  return log.split('\n').filter((l) => CONNECTION_WORDS.test(l)).slice(-max).map((l) => l.trim().slice(0, 240));
}

function stamp(ms: number): string {
  const d = new Date(ms);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function huntLine(h: HuntState | null): string {
  if (!h) return 'Script search: not running';
  if (h.phase === 'found') return `Script search: found ${h.culprit ?? '?'} (it was switched off)`;
  if (h.phase === 'not-scripts') return 'Script search: the problem happened with every script off';
  return `Script search: running, test ${h.step}, switched off now: ${h.off.join(', ') || 'none'}`;
}

export function formatReportExtras(r: ReportInput): string {
  const out: string[] = [];
  out.push(`===== Userscripts (the folder switch is ${r.userscriptsOn ? 'on' : 'off'}; the game is ${r.gameRunning ? 'running' : 'not running, this is the last game'}) =====`);
  if (!r.health.length) out.push('(no script reported yet)');
  for (const h of r.health) {
    const notes = h.notes.length ? ` [${h.notes.join(' | ')}]` : '';
    out.push(`- ${h.name}${h.version ? ' v' + h.version : ''}${h.builtin ? ' (built-in)' : ''}: ${statusText(h)}${notes}`);
  }
  out.push(huntLine(r.hunt));
  out.push('', '===== Connection events in the log (latest) =====');
  out.push(...(r.connectionLines.length ? r.connectionLines : ['(none)']));
  out.push('', '===== Backups =====');
  const newest = r.backups[0];
  out.push(`Before update: ${r.autoBackup ? 'on' : 'off'} | Schedule: ${r.schedule} | Saved: ${r.backups.length}${newest ? ` (newest ${stamp(newest.at)}, ${newest.kind}, v${newest.version})` : ''}`);
  return out.join('\n');
}
