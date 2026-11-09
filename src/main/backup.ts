// ── Full backup and restore ──
// One .json file that carries everything that makes this client "yours": the client settings (the same allow-listed
// categories the settings export uses, never saved accounts), your userscripts and their preferences, custom CSS, the
// built-in scripts' preferences and the session statistics. Handy for moving to another computer or as a safety net
// before a reset. The resource swapper folder is NOT included (it can be gigabytes); packs and swap files stay where
// they are.
//
// A backup is plain data. Restoring only ever writes files into the four known folders, with names that pass the
// checks below (no "..", no absolute paths, a short list of file types, size limits), and it asks first. A backup
// file that someone else made can contain userscripts: restore only backups you made yourself.

import { app, dialog, type BrowserWindow } from 'electron';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'fs';
import { dirname, join, resolve, sep } from 'path';
import { electronLog } from './logger';
import { diffSettings, previewText } from '../shared/backup-diff';
import { acceptScript } from './script-changes';
import type { FileItem, FileState } from '../shared/backup-diff';

export type BackupRoot = 'scripts' | 'css' | 'builtin' | 'data';

export interface BackupContext {
  /** Folders the backup reads from and restores into. */
  dirs: { scripts: string; css: string; builtin: string; data: string };
  /** The client settings to put in the file (allow-listed, no accounts). */
  readClient: () => Record<string, unknown>;
  /** Apply client settings from a file (re-filtered by the caller). Returns how many categories were applied. */
  writeClient: (client: Record<string, unknown>) => number;
  appVersion: string;
  parent: BrowserWindow | null;
}

export type BackupResult =
  | { ok: true; canceled?: false; path?: string; files: number; settings: number }
  | { ok: false; canceled?: boolean; error?: string };

interface BackupFile {
  app: 'KRH-Client';
  type: 'full-backup';
  formatVersion: 1;
  appVersion: string;
  createdAt: string;
  client: Record<string, unknown>;
  /** "<root>/<relative path>" to base64 content. */
  files: Record<string, string>;
}

const ROOTS: readonly BackupRoot[] = ['scripts', 'css', 'builtin', 'data'];
const EXTENSIONS = new Set(['.js', '.css', '.json', '.txt', '.md']);
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_BYTES = 30 * 1024 * 1024;
const MAX_FILES = 400;
const MAX_DEPTH = 3;
const SEGMENT = /^[A-Za-z0-9 _.()[\]+,&'-]{1,120}$/;

/** Data files (relative to dirs.data) that belong in a backup. */
const DATA_FILES = ['session-stats.json'];

function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i < 0 ? '' : name.slice(i).toLowerCase();
}

/** True for a relative path that is safe to write below a root: plain segments only, a known file type. */
export function isSafeRelative(rel: string): boolean {
  if (typeof rel !== 'string' || rel.length === 0 || rel.length > 300) return false;
  if (rel.includes('\\') || rel.startsWith('/') || rel.includes('\0')) return false;
  const parts = rel.split('/');
  if (parts.length > MAX_DEPTH) return false;
  for (const p of parts) {
    if (!SEGMENT.test(p) || p === '.' || p === '..' || p.startsWith('.')) return false;
  }
  return EXTENSIONS.has(extOf(parts[parts.length - 1]));
}

function rootDir(ctx: BackupContext, root: BackupRoot): string { return ctx.dirs[root]; }

function walk(base: string, rel: string, depth: number, out: Array<{ rel: string; full: string; size: number }>): void {
  if (depth > MAX_DEPTH || out.length > MAX_FILES) return;
  let entries;
  try { entries = readdirSync(join(base, rel), { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const childRel = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) { walk(base, childRel, depth + 1, out); continue; }
    if (!e.isFile() || !isSafeRelative(childRel)) continue;
    const full = join(base, childRel);
    let size: number;
    try { size = statSync(full).size; } catch { continue; }
    if (size > MAX_FILE_BYTES) continue;
    out.push({ rel: childRel, full, size });
  }
}

export function collectFiles(ctx: BackupContext): Record<string, string> {
  const files: Record<string, string> = {};
  let total = 0;
  let count = 0;
  const add = (key: string, full: string, size: number): void => {
    if (count >= MAX_FILES || total + size > MAX_TOTAL_BYTES) return;
    try { files[key] = readFileSync(full).toString('base64'); total += size; count++; } catch { /* unreadable: skip */ }
  };
  for (const root of ['scripts', 'css', 'builtin'] as const) {
    const list: Array<{ rel: string; full: string; size: number }> = [];
    walk(rootDir(ctx, root), '', 1, list);
    for (const f of list) add(`${root}/${f.rel}`, f.full, f.size);
  }
  for (const name of DATA_FILES) {
    const full = join(ctx.dirs.data, name);
    if (!existsSync(full)) continue;
    let size: number;
    try { size = statSync(full).size; } catch { continue; }
    if (size <= MAX_FILE_BYTES) add(`data/${name}`, full, size);
  }
  return files;
}

function buildPayload(ctx: BackupContext): BackupFile {
  return {
    app: 'KRH-Client', type: 'full-backup', formatVersion: 1, appVersion: ctx.appVersion,
    createdAt: new Date().toISOString(), client: ctx.readClient(), files: collectFiles(ctx),
  };
}

/** Backup files this module wrote (and may delete): <pre-update|scheduled>-<version>-<yyyymmdd>-<hhmmss>.json */
const AUTO_NAME = /^(pre-update|scheduled)-([0-9A-Za-z.-]+)-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.json$/;
export type AutoBackupKind = 'pre-update' | 'scheduled';

export interface AutoBackupInfo { file: string; kind: AutoBackupKind; version: string; at: number; size: number }

/** The automatic backups in `dir`, newest first. */
export function listAutoBackups(dir: string): AutoBackupInfo[] {
  const out: AutoBackupInfo[] = [];
  let names: string[];
  try { names = readdirSync(dir); } catch { return out; }
  for (const file of names) {
    const m = AUTO_NAME.exec(file);
    if (!m) continue;
    let size: number;
    try { size = statSync(join(dir, file)).size; } catch { continue; }
    const at = new Date(+m[3], +m[4] - 1, +m[5], +m[6], +m[7], +m[8]).getTime();
    out.push({ file, kind: m[1] as AutoBackupKind, version: m[2], at: Number.isFinite(at) ? at : 0, size });
  }
  return out.sort((a, b) => b.at - a.at);
}

/** Copies one automatic backup into the user's chosen folder and keeps the newest `keep` copies there. Never throws. */
export function copyAutoBackup(file: string, copyDir: string, keep = 6): boolean {
  try {
    if (!copyDir || !statSync(copyDir).isDirectory()) return false;
    const name = file.slice(Math.max(file.lastIndexOf('/'), file.lastIndexOf('\\')) + 1);
    if (!AUTO_NAME.test(name)) return false;
    copyFileSync(file, join(copyDir, name));
    const old = readdirSync(copyDir).filter((f) => AUTO_NAME.test(f)).sort((a, b) => a.slice(-20).localeCompare(b.slice(-20))).reverse().slice(Math.max(1, keep));
    for (const f of old) { try { unlinkSync(join(copyDir, f)); } catch { /* in use or gone: leave it */ } }
    return true;
  } catch (err) {
    electronLog.warn('[KRH-Backup] Could not copy the backup to the chosen folder:', (err as Error).message);
    return false;
  }
}

/** Full path of an automatic backup by file name, or null when the name is not one this module wrote or the file is gone. */
export function autoBackupPath(dir: string, file: unknown): string | null {
  if (typeof file !== 'string' || !AUTO_NAME.test(file)) return null;
  const full = join(dir, file);
  return existsSync(full) ? full : null;
}

/** Writes a backup into `dir` without asking and keeps only the newest `keep` of them. Used right before an update. */
export function writeAutoBackup(ctx: BackupContext, dir: string, keep = 3, kind: AutoBackupKind = 'pre-update'): string | null {
  try {
    mkdirSync(dir, { recursive: true });
    const payload = buildPayload(ctx);
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
    const name = `${kind}-${ctx.appVersion.replace(/[^0-9A-Za-z.-]/g, '')}-${stamp}.json`;
    const target = join(dir, name);
    writeFileSync(target, JSON.stringify(payload), 'utf-8');
    const old = readdirSync(dir).filter((f) => AUTO_NAME.exec(f)?.[1] === kind).sort((a, b) => a.slice(-20).localeCompare(b.slice(-20))).reverse().slice(Math.max(1, keep));
    for (const f of old) { try { unlinkSync(join(dir, f)); } catch { /* in use or gone: leave it */ } }
    electronLog.log(`[KRH-Backup] ${kind === 'scheduled' ? 'Scheduled backup' : 'Backup before update'} written (${Object.keys(payload.files).length} files): ${target}`);
    return target;
  } catch (err) {
    electronLog.warn('[KRH-Backup] Backup before update failed:', (err as Error).message);
    return null;
  }
}

export async function createBackup(ctx: BackupContext): Promise<BackupResult> {
  const stamp = new Date().toISOString().slice(0, 10);
  const opts = {
    title: 'Create backup',
    defaultPath: join(app.getPath('documents'), `krh-backup-${stamp}.json`),
    filters: [{ name: 'KRH backup', extensions: ['json'] }],
  };
  const pick = ctx.parent && !ctx.parent.isDestroyed() ? await dialog.showSaveDialog(ctx.parent, opts) : await dialog.showSaveDialog(opts);
  if (pick.canceled || !pick.filePath) return { ok: false, canceled: true };
  try {
    const payload = buildPayload(ctx);
    const files = payload.files;
    writeFileSync(pick.filePath, JSON.stringify(payload), 'utf-8');
    electronLog.log(`[KRH-Backup] Backup written (${Object.keys(files).length} files) to ${pick.filePath}`);
    return { ok: true, path: pick.filePath, files: Object.keys(files).length, settings: Object.keys(payload.client).length };
  } catch (err) {
    electronLog.error('[KRH-Backup] Backup failed:', err);
    return { ok: false, error: (err as Error).message };
  }
}

interface Planned { root: BackupRoot; rel: string; target: string; data: Buffer }

/** Checks a parsed backup and turns it into the list of files to write. Anything unsafe is dropped, not fixed. */
export function planRestore(ctx: BackupContext, parsed: unknown): { plan: Planned[]; skipped: number; client: Record<string, unknown> } | null {
  const b = parsed as Partial<BackupFile> | null;
  if (!b || typeof b !== 'object' || b.type !== 'full-backup' || b.formatVersion !== 1) return null;
  const client = b.client && typeof b.client === 'object' && !Array.isArray(b.client) ? (b.client as Record<string, unknown>) : {};
  const plan: Planned[] = [];
  let skipped = 0;
  let total = 0;
  const entries = b.files && typeof b.files === 'object' ? Object.entries(b.files as Record<string, unknown>) : [];
  for (const [key, value] of entries) {
    if (plan.length >= MAX_FILES) { skipped++; continue; }
    const slash = key.indexOf('/');
    const root = key.slice(0, slash) as BackupRoot;
    const rel = key.slice(slash + 1);
    if (slash < 1 || !ROOTS.includes(root) || !isSafeRelative(rel) || typeof value !== 'string') { skipped++; continue; }
    if (root === 'data' && (rel.includes('/') || !DATA_FILES.includes(rel))) { skipped++; continue; }
    const base = resolve(rootDir(ctx, root));
    const target = resolve(base, ...rel.split('/'));
    if (!target.startsWith(base + sep)) { skipped++; continue; }
    const data = Buffer.from(value, 'base64');
    if (data.length > MAX_FILE_BYTES || total + data.length > MAX_TOTAL_BYTES) { skipped++; continue; }
    total += data.length;
    plan.push({ root, rel, target, data });
  }
  return { plan, skipped, client };
}

export async function restoreBackup(ctx: BackupContext, knownFile?: string): Promise<BackupResult> {
  const opts = { title: 'Restore backup', properties: ['openFile' as const], filters: [{ name: 'KRH backup', extensions: ['json'] }] };
  const pick = knownFile
    ? { canceled: false, filePaths: [knownFile] }
    : ctx.parent && !ctx.parent.isDestroyed() ? await dialog.showOpenDialog(ctx.parent, opts) : await dialog.showOpenDialog(opts);
  if (pick.canceled || !pick.filePaths[0]) return { ok: false, canceled: true };
  let parsed: unknown;
  try {
    if (statSync(pick.filePaths[0]).size > MAX_TOTAL_BYTES * 2) return { ok: false, error: 'That file is too big to be a KRH backup.' };
    parsed = JSON.parse(readFileSync(pick.filePaths[0], 'utf-8'));
  } catch { return { ok: false, error: 'Could not read that file.' }; }
  const planned = planRestore(ctx, parsed);
  if (!planned) return { ok: false, error: 'That is not a KRH Client backup.' };
  // What would change, so the player decides with facts: settings groups and fields that differ, files new / different / identical
  let preview: string;
  try {
    const meta = parsed as Partial<BackupFile>;
    const files: FileItem[] = planned.plan.map((p) => {
      let state: FileState = 'new';
      if (existsSync(p.target)) {
        try { state = readFileSync(p.target).equals(p.data) ? 'same' : 'different'; } catch { state = 'different'; }
      }
      return { name: `${p.root}/${p.rel}`, state };
    });
    preview = previewText({
      backupVersion: typeof meta.appVersion === 'string' ? meta.appVersion.slice(0, 20) : '',
      backupAt: typeof meta.createdAt === 'string' ? meta.createdAt : '',
      currentVersion: ctx.appVersion,
      settings: diffSettings(ctx.readClient(), planned.client),
      files,
    });
  } catch (err) {
    electronLog.warn('[KRH-Backup] Could not build the restore preview:', (err as Error).message);
    preview = `This backup has ${Object.keys(planned.client).length} settings groups and ${planned.plan.length} files.`;
  }
  const detail =
    preview.slice(0, 2200) + '\n\n' +
    'Files with the same name are replaced; nothing else is deleted. The client restarts afterwards.\n\n' +
    'Userscripts run inside the game: only restore a backup you made yourself or fully trust.';
  const confirmOpts = { type: 'question' as const, title: 'KRH Client', message: 'Restore this backup?', detail, buttons: ['Restore', 'Cancel'], defaultId: 1, cancelId: 1, noLink: true };
  const { response } = ctx.parent && !ctx.parent.isDestroyed() ? await dialog.showMessageBox(ctx.parent, confirmOpts) : await dialog.showMessageBox(confirmOpts);
  if (response !== 0) return { ok: false, canceled: true };
  try {
    let written = 0;
    for (const p of planned.plan) {
      mkdirSync(dirname(p.target), { recursive: true });
      writeFileSync(p.target, p.data);
      // A restore was confirmed by the player: scripts it wrote are not "changed outside the client"
      if (p.root === 'scripts' && p.rel.endsWith('.js') && !p.rel.includes('/')) acceptScript(p.rel, p.data.toString('utf-8'));
      written++;
    }
    const settings = ctx.writeClient(planned.client);
    electronLog.log(`[KRH-Backup] Restored ${written} files and ${settings} settings groups (${planned.skipped} skipped)`);
    return { ok: true, files: written, settings };
  } catch (err) {
    electronLog.error('[KRH-Backup] Restore failed:', err);
    return { ok: false, error: (err as Error).message };
  }
}
