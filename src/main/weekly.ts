// ── Weekly summary state (main process) ──
// Remembers for which calendar week the summary was already handled (so it shows at most once a week, on the first start of
// the week) and the text of the last one, in <userData>/KRH Client/weekly.json. Stays on this computer.

import { app } from 'electron';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { WeeklySummary } from '../shared/weekly-summary';

interface State { sentWeek: string; lastWeekStart: string; lastText: string }

let state: State = { sentWeek: '', lastWeekStart: '', lastText: '' };
let loaded = false;

function file(): string {
  const dir = join(app.getPath('userData'), 'KRH Client');
  try { mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
  return join(dir, 'weekly.json');
}

function load(): void {
  if (loaded) return;
  loaded = true;
  try {
    const r = JSON.parse(readFileSync(file(), 'utf8')) as Partial<State>;
    const s = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '');
    state = { sentWeek: /^\d{4}-\d{2}-\d{2}$/.test(s(r.sentWeek, 10)) ? s(r.sentWeek, 10) : '', lastWeekStart: s(r.lastWeekStart, 10), lastText: s(r.lastText, 1500) };
  } catch { state = { sentWeek: '', lastWeekStart: '', lastText: '' }; }
}

export function weeklyState(): State { load(); return state; }

/** Marks the current week as handled; keeps the text when there was a summary. */
export function markWeekly(currentWeek: string, summary: WeeklySummary | null): void {
  load();
  state.sentWeek = currentWeek;
  if (summary) { state.lastWeekStart = summary.weekStart; state.lastText = summary.text; }
  try { writeFileSync(file(), JSON.stringify(state)); } catch { /* not worth failing for */ }
}
