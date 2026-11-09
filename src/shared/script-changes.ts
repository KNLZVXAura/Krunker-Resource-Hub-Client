// ── Userscript change detection ──
// Userscripts run inside the game, so a script that changes without you doing it (edited by another program, replaced,
// added to the folder) deserves a look. The client remembers each script's content; at game start it compares and reports
// what changed: how many lines were added and removed, a few of the added lines, and risky things that are NEW in the script
// (network requests, eval, WebSocket wrapping ...). Edits made through the client are accepted silently. Pure functions only.

import { analyzeScript } from './script-health';

export interface LineDiff { added: number; removed: number; addedSample: string[] }

export type ChangeKind = 'new' | 'changed' | 'removed';

export interface ChangeEntry {
  file: string;
  at: number;
  kind: ChangeKind;
  added: number;
  removed: number;
  /** A few of the added lines (each cut to 100 characters). */
  sample: string[];
  /** Risky things the new version has and the old one did not. */
  risks: string[];
}

export const MAX_LOG = 30;
const SAMPLE_LINES = 3;

function lines(text: string): string[] {
  return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

/** Counts of lines that are only in the new text and only in the old text (order is ignored), and a few of the added ones. */
export function lineDiff(oldText: string, newText: string): LineDiff {
  const count = new Map<string, number>();
  for (const l of lines(oldText)) count.set(l, (count.get(l) ?? 0) + 1);
  let added = 0;
  const addedSample: string[] = [];
  for (const l of lines(newText)) {
    const n = count.get(l) ?? 0;
    if (n > 0) { count.set(l, n - 1); continue; }
    added++;
    if (addedSample.length < SAMPLE_LINES) addedSample.push(l.slice(0, 100));
  }
  let removed = 0;
  for (const n of count.values()) removed += n;
  return { added, removed, addedSample };
}

/** Warnings the new text has and the old text did not (see analyzeScript). */
export function newRisks(oldText: string, newText: string): string[] {
  const before = new Set(analyzeScript(oldText));
  return analyzeScript(newText).filter((n) => !before.has(n));
}

export function changeEntry(file: string, kind: ChangeKind, oldText: string, newText: string, at: number): ChangeEntry {
  if (kind === 'removed') return { file, at, kind, added: 0, removed: lines(oldText).length, sample: [], risks: [] };
  if (kind === 'new') {
    const d = lineDiff('', newText);
    return { file, at, kind, added: d.added, removed: 0, sample: d.addedSample, risks: newRisks('', newText) };
  }
  const d = lineDiff(oldText, newText);
  return { file, at, kind, added: d.added, removed: d.removed, sample: d.addedSample, risks: newRisks(oldText, newText) };
}

/** One line for a notification or the list: "a.js changed (+3 / -1 lines)". */
export function changeLine(c: ChangeEntry): string {
  if (c.kind === 'new') return `${c.file} was added (${c.added} lines)`;
  if (c.kind === 'removed') return `${c.file} was removed`;
  return `${c.file} changed (+${c.added} / -${c.removed} lines)`;
}

/** Keeps a saved list to the known shape and size. */
export function cleanChangeLog(raw: unknown): ChangeEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: ChangeEntry[] = [];
  const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '');
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1e7, Math.floor(v))) : 0);
  for (const item of raw.slice(-MAX_LOG)) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    if (r.kind !== 'new' && r.kind !== 'changed' && r.kind !== 'removed') continue;
    const file = str(r.file, 120);
    if (!file) continue;
    out.push({
      file, at: typeof r.at === 'number' && Number.isFinite(r.at) ? r.at : 0, kind: r.kind, added: num(r.added), removed: num(r.removed),
      sample: Array.isArray(r.sample) ? r.sample.filter((x): x is string => typeof x === 'string').slice(0, SAMPLE_LINES).map((x) => x.slice(0, 100)) : [],
      risks: Array.isArray(r.risks) ? r.risks.filter((x): x is string => typeof x === 'string').slice(0, 6).map((x) => x.slice(0, 200)) : [],
    });
  }
  return out;
}
