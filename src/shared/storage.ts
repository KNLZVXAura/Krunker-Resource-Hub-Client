// ── Storage manager ──
// Picks which old files may be cleaned and words the sizes. The rules are strict on purpose: only files the client made
// itself (logs, automatic backups, replay clips) are ever offered, only those older than the chosen number of days, and
// some of the newest are always kept. Pure functions only: the main process lists and deletes.

export interface FileInfo { name: string; mtime: number; size: number }

export const DAY_CHOICES: readonly number[] = [30, 90, 180];

/** Files older than `days` days, leaving the newest `keepNewest` files alone whatever their age. Oldest first. */
export function olderThan(files: readonly FileInfo[], days: number, now: number, keepNewest = 0): FileInfo[] {
  if (!Number.isFinite(days) || days < 1) return [];
  const newestFirst = files.slice().sort((a, b) => b.mtime - a.mtime);
  const eligible = newestFirst.slice(Math.max(0, keepNewest));
  const cutoff = now - days * 86_400_000;
  return eligible.filter((f) => f.mtime < cutoff).sort((a, b) => a.mtime - b.mtime);
}

export function totalSize(files: readonly FileInfo[]): number {
  return files.reduce((n, f) => n + f.size, 0);
}

export function sizeText(bytes: number): string {
  if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(1) + ' GB';
  if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + ' MB';
  if (bytes >= 1024) return Math.round(bytes / 1024) + ' KB';
  return bytes + ' B';
}

/** Days from the player (a button or a stored value) limited to the allowed choices; null when it is not one of them. */
export function cleanDays(raw: unknown): number | null {
  return typeof raw === 'number' && DAY_CHOICES.includes(raw) ? raw : null;
}

export interface StorageEntry {
  id: string;
  label: string;
  bytes: number;
  files: number;
  /** True when the number is a lower bound because the folder was too large to count completely. */
  partial: boolean;
  /** 'days' = can be cleaned by age, 'cache' = can be emptied, '' = only shown. */
  clean: 'days' | 'cache' | '';
  /** True when the folder can be opened from the page. */
  openable: boolean;
}

/** One-line description of a cleaning plan for the confirmation dialog. */
export function planText(label: string, count: number, bytes: number, days: number | null): string {
  if (!count) return `Nothing to clean in ${label}.`;
  return `${count} file${count === 1 ? '' : 's'} (${sizeText(bytes)}) in ${label}${days ? ' older than ' + days + ' days' : ''}.`;
}
