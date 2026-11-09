// ── Backup preview ──
// Before a backup is restored, shows what would change: which settings groups differ from now (and which fields), and which
// files would be new, replaced with different content, or are identical. Only names are shown, never the contents of a script.
// Pure functions only: the main process reads the backup and the current files and hands the facts here.

import { changedFields, humanize } from './settings-history';

export interface SettingChange { key: string; fields: string[] }
export type FileState = 'new' | 'different' | 'same';
export interface FileItem { name: string; state: FileState }

/** Settings groups of the backup that differ from the current ones, with the names of the fields that differ. */
export function diffSettings(current: Record<string, unknown>, backup: Record<string, unknown>): { changed: SettingChange[]; same: number } {
  const changed: SettingChange[] = [];
  let same = 0;
  for (const key of Object.keys(backup)) {
    const fields = changedFields(current[key], backup[key]);
    if (fields.length) changed.push({ key, fields }); else same++;
  }
  return { changed, same };
}

export interface PreviewInput {
  backupVersion: string;
  backupAt: string;
  currentVersion: string;
  settings: { changed: SettingChange[]; same: number };
  files: FileItem[];
}

const MAX_NAMES = 6;

function names(list: readonly string[]): string {
  const shown = list.slice(0, MAX_NAMES).join(', ');
  return list.length > MAX_NAMES ? `${shown} and ${list.length - MAX_NAMES} more` : shown;
}

/** Numeric parts of "4.0.0" for comparing versions; unknown parts count as 0. */
function parts(v: string): number[] { return v.split('.').map((x) => parseInt(x, 10) || 0); }

export function isNewerVersion(a: string, b: string): boolean {
  const x = parts(a); const y = parts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return false;
}

export function previewText(p: PreviewInput): string {
  const lines: string[] = [];
  const when = p.backupAt ? new Date(p.backupAt) : null;
  const stamp = when && Number.isFinite(when.getTime()) ? ` made ${when.toLocaleDateString()} ${when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : '';
  lines.push(`Backup from ${p.backupVersion ? 'v' + p.backupVersion : 'an unknown version'}${stamp} (this client is v${p.currentVersion}).`);
  if (p.backupVersion && isNewerVersion(p.backupVersion, p.currentVersion)) lines.push('This backup is from a NEWER client: some settings in it may not exist in this version.');

  lines.push('', 'Settings that would change:');
  if (!p.settings.changed.length) lines.push('- none, the settings are the same as now');
  for (const c of p.settings.changed.slice(0, 10)) lines.push(`- ${humanize(c.key)}: ${names(c.fields.map(humanize))}`);
  if (p.settings.changed.length > 10) lines.push(`- and ${p.settings.changed.length - 10} more groups`);
  if (p.settings.same && p.settings.changed.length) lines.push(`(${p.settings.same} other group${p.settings.same === 1 ? ' is' : 's are'} the same)`);

  const added = p.files.filter((f) => f.state === 'new').map((f) => f.name);
  const replaced = p.files.filter((f) => f.state === 'different').map((f) => f.name);
  const same = p.files.filter((f) => f.state === 'same').length;
  lines.push('', 'Files:');
  lines.push(`- New: ${added.length}${added.length ? ' (' + names(added) + ')' : ''}`);
  lines.push(`- Replaced with different content: ${replaced.length}${replaced.length ? ' (' + names(replaced) + ')' : ''}`);
  lines.push(`- Identical, no change: ${same}`);
  return lines.join('\n');
}
