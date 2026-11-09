// ── Replay clip list (main process) ──
// Remembers what each saved instant-replay clip shows (map, class, kill streak) in <userData>/KRH Client/clips.json and
// handles the gallery actions: list, rename and delete. File names are checked with shared/clips.ts and never leave the
// recordings folder. Stays on this computer.

import { app, shell } from 'electron';
import { promises as fsp, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { cleanClipList, cleanTitle, extensionOf, isAutoNamedClip, isClipFile, MAX_CLIPS } from '../shared/clips';
import type { ClipMeta } from '../shared/clips';
import { electronLog } from './logger';

let store: ClipMeta[] = [];
let loaded = false;

function file(): string {
  const dir = join(app.getPath('userData'), 'KRH Client');
  try { mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
  return join(dir, 'clips.json');
}

function load(): void {
  if (loaded) return;
  loaded = true;
  try { store = cleanClipList(JSON.parse(readFileSync(file(), 'utf8'))); } catch { store = []; }
}

function save(): void {
  try { writeFileSync(file(), JSON.stringify(store.slice(-MAX_CLIPS))); } catch (err) { electronLog.warn('[KRH] Could not save the clip list:', (err as Error).message); }
}

/** Called right after a clip was written. */
export function recordClip(meta: ClipMeta): void {
  load();
  store = store.filter((m) => m.file !== meta.file);
  store.push(meta);
  if (store.length > MAX_CLIPS) store = store.slice(-MAX_CLIPS);
  save();
}

/** The clips in the recordings folder, newest first: the ones with saved information plus the client-named files without it. */
export async function listClips(dir: string): Promise<ClipMeta[]> {
  load();
  let names: string[];
  try { names = await fsp.readdir(dir); } catch { return []; }
  const present = new Set(names.filter(isClipFile));
  const out: ClipMeta[] = [];
  const known = new Set<string>();
  for (const m of store) {
    if (!present.has(m.file)) continue;
    known.add(m.file);
    out.push(m);
  }
  for (const name of present) {
    if (known.has(name) || !isAutoNamedClip(name)) continue;
    try {
      const st = await fsp.stat(join(dir, name));
      out.push({ file: name, at: st.mtimeMs, map: '', cls: '', streak: 0, seconds: 0, size: st.size, title: '' });
    } catch { /* gone */ }
  }
  // Forget clips whose file is gone
  const kept = store.filter((m) => present.has(m.file));
  if (kept.length !== store.length) { store = kept; save(); }
  return out.sort((a, b) => b.at - a.at).slice(0, 100);
}

/** Full path of a clip that is in the list, or null. */
export async function clipPath(dir: string, name: unknown): Promise<string | null> {
  if (!isClipFile(name)) return null;
  const list = await listClips(dir);
  return list.some((c) => c.file === name) ? join(dir, name) : null;
}

export async function renameClip(dir: string, name: unknown, title: unknown): Promise<{ ok: boolean; file?: string; error?: string }> {
  const full = await clipPath(dir, name);
  const clean = cleanTitle(title);
  if (!full || typeof name !== 'string') return { ok: false, error: 'That clip is not in the list any more.' };
  if (!clean) return { ok: false, error: 'Type a name with letters or digits.' };
  const next = clean + extensionOf(name);
  if (next === name) return { ok: true, file: name };
  let existing: string[] = [];
  try { existing = await fsp.readdir(dir); } catch { /* handled by rename below */ }
  if (existing.some((f) => f.toLowerCase() === next.toLowerCase() && f !== name)) return { ok: false, error: 'A file with that name already exists.' };
  try { await fsp.rename(full, join(dir, next)); } catch (err) { return { ok: false, error: 'Could not rename: ' + (err as Error).message }; }
  load();
  const meta = store.find((m) => m.file === name);
  if (meta) { meta.file = next; meta.title = clean; }
  else store.push({ file: next, at: Date.now(), map: '', cls: '', streak: 0, seconds: 0, size: 0, title: clean });
  save();
  return { ok: true, file: next };
}

/** Moves the clip to the recycle bin (deleted for good only when that is not possible). */
export async function deleteClip(dir: string, name: unknown): Promise<boolean> {
  const full = await clipPath(dir, name);
  if (!full) return false;
  try { await shell.trashItem(full); } catch { try { await fsp.unlink(full); } catch { return false; } }
  load();
  store = store.filter((m) => m.file !== name);
  save();
  return true;
}
