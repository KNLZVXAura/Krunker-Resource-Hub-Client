// ── Userscript health ──
// What the Userscripts page shows per script: did it run, did it fail, is it skipped, and what in its code is known to
// cause trouble. The game page reports the facts, the main process keeps the latest report, and the dashboard and the
// in-game settings read it. Pure functions only (no Electron, no DOM).

export type ScriptStatus = 'running' | 'off' | 'error' | 'skipped-twin' | 'other-page' | 'waiting';

export interface ScriptHealth {
  filename: string;
  name: string;
  version: string;
  builtin: boolean;
  status: ScriptStatus;
  /** Error message, or the reason a script was skipped. */
  detail: string;
  /** How long the script took to start, in milliseconds (0 when it has not run). */
  runMs: number;
  /** Findings from reading the code (see analyzeScript). */
  notes: string[];
  /** Milliseconds since 1970 when this was reported. */
  at: number;
}

/** Findings from the script's code. Each one is a short sentence for the page. Never executes the script.
 *  (Whether a script has an unload function is only known once it ran, so the game page adds that note itself.) */
export function analyzeScript(code: string): string[] {
  const notes: string[] = [];
  if (/\bWebSocket\s*=[^=]|defineProperty\s*\([^)]*WebSocket|extends\s+WebSocket\b|WebSocket\.prototype\.\w+\s*=[^=]/.test(code)) {
    notes.push('Wraps WebSocket. Two scripts that do this can break the game connection (Lost Connection, code 1005).');
  }
  if (/\beval\s*\(|\bnew\s+Function\s*\(/.test(code)) notes.push('Runs code built at run time (eval / new Function).');
  if (/document\.write\s*\(/.test(code)) notes.push('Uses document.write, which can break the page.');
  if (/\bsetInterval\s*\([^,]+,\s*([0-9]|1[0-5])\s*\)/.test(code)) notes.push('Runs something every few milliseconds, which can cost FPS.');
  if (/\blocalStorage\.clear\s*\(/.test(code)) notes.push('Clears localStorage, which also removes your Krunker settings.');
  if (/\bfetch\s*\(|\bXMLHttpRequest\b|\bnavigator\.sendBeacon\b/.test(code)) notes.push('Sends network requests.');
  return notes;
}

/** Scripts whose notes include a warning that should be shown in red / orange, not just listed. */
export function severity(h: Pick<ScriptHealth, 'status' | 'notes'>): 'ok' | 'warn' | 'bad' {
  if (h.status === 'error') return 'bad';
  if (h.status === 'skipped-twin') return 'warn';
  if (h.status === 'running' && h.notes.some((n) => n.startsWith('Wraps WebSocket') || n.startsWith('Clears localStorage'))) return 'warn';
  return 'ok';
}

export function statusText(h: Pick<ScriptHealth, 'status' | 'detail' | 'runMs'>): string {
  switch (h.status) {
    case 'running': return 'Running' + (h.runMs > 0 ? ' (started in ' + h.runMs + ' ms)' : '');
    case 'off': return 'Switched off';
    case 'error': return 'Failed: ' + (h.detail || 'unknown error');
    case 'skipped-twin': return 'Skipped: ' + (h.detail || 'the same script already runs');
    case 'other-page': return 'Not for this page (its @match does not fit)';
    case 'waiting': return 'Switched on, waiting for the page to load';
  }
}

/** Keeps what comes over IPC to a known shape and size. Returns null for anything that is not a report. */
export function cleanHealth(raw: unknown): ScriptHealth | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const statuses: ScriptStatus[] = ['running', 'off', 'error', 'skipped-twin', 'other-page', 'waiting'];
  const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '');
  if (typeof r.filename !== 'string' || !r.filename || r.filename.length > 200) return null;
  if (typeof r.status !== 'string' || !statuses.includes(r.status as ScriptStatus)) return null;
  const notes = Array.isArray(r.notes) ? r.notes.filter((n): n is string => typeof n === 'string').slice(0, 10).map((n) => n.slice(0, 200)) : [];
  const runMs = typeof r.runMs === 'number' && Number.isFinite(r.runMs) ? Math.max(0, Math.min(600000, Math.round(r.runMs))) : 0;
  return {
    filename: r.filename,
    name: str(r.name, 120) || r.filename,
    version: str(r.version, 40),
    builtin: r.builtin === true,
    status: r.status as ScriptStatus,
    detail: str(r.detail, 300),
    runMs,
    notes,
    at: typeof r.at === 'number' && Number.isFinite(r.at) ? r.at : Date.now(),
  };
}

/** Scripts that wrap WebSocket and are running (or switched on): more than one is a known cause of Lost Connection. */
export function websocketClash(list: readonly ScriptHealth[]): string[] {
  const wrappers = list.filter((h) => (h.status === 'running' || h.status === 'waiting') && h.notes.some((n) => n.startsWith('Wraps WebSocket')));
  return wrappers.length > 1 ? wrappers.map((h) => h.name) : [];
}

export const NO_UNLOAD_NOTE = 'Has no unload function: switching it off needs a page reload.';
