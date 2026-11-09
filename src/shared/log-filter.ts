// ── Log viewer filtering ──
// Picks lines of the client log by topic and search text for Dashboard > Logs. Log lines look like
//   [2026-11-08 21:14:03.123] [MAIN] WARN: message
// Pure functions only: the main process reads the file and hands the text here.

export interface LogFilter { id: string; label: string }

export const LOG_FILTERS: readonly LogFilter[] = [
  { id: 'all', label: 'Everything' },
  { id: 'problems', label: 'Errors and warnings' },
  { id: 'connection', label: 'Connection' },
  { id: 'scripts', label: 'Scripts' },
  { id: 'update', label: 'Updates and backups' },
];

const TOPIC: Record<string, RegExp> = {
  problems: /\b(WARN|ERROR): /,
  connection: /lost connection|socket|close code|connection (failed|lost|closed)|ERR_[A-Z_]+|\[KRH-Socket\]|ping|dns/i,
  scripts: /userscript|\[KRH-Hunt\]|\[KRH-Scripts\]|builtin|script/i,
  update: /\[KRH-Update\]|\[KRH-Backup\]|\[KRH-Safe\]|update|backup/i,
};

/** A log file name the client writes: electron-YYYY-MM-DD.log */
export function isLogFileName(name: unknown): name is string {
  return typeof name === 'string' && /^electron-\d{4}-\d{2}-\d{2}\.log$/.test(name);
}

export function filterId(raw: unknown): string {
  return typeof raw === 'string' && LOG_FILTERS.some((f) => f.id === raw) ? raw : 'all';
}

export interface FilteredLog { lines: string[]; total: number; matched: number }

/** The last `max` lines that fit the topic and contain `query` (not case-sensitive). */
export function filterLog(text: string, filter: string, query: string, max = 800): FilteredLog {
  const all = text.split('\n').filter((l) => l.length > 0);
  const re = TOPIC[filter];
  const q = query.trim().toLowerCase().slice(0, 80);
  const hits = all.filter((l) => (!re || re.test(l)) && (!q || l.toLowerCase().includes(q)));
  return { lines: hits.slice(-max), total: all.length, matched: hits.length };
}
