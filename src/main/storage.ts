// ── Storage manager (main process) ──
// Measures the folders the client uses and cleans old files it made itself (see shared/storage.ts for the rules).
// Nothing outside these folders is touched, and nothing is deleted without the player confirming the count and the size.

import { promises as fsp } from 'fs';
import { join } from 'path';
import type { FileInfo } from '../shared/storage';

export interface DirSize { bytes: number; files: number; partial: boolean }

/** Size of a folder with everything below it. Stops counting after `maxFiles` files (then `partial` is true). */
export async function dirSize(dir: string, maxFiles = 30_000): Promise<DirSize> {
  const out: DirSize = { bytes: 0, files: 0, partial: false };
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop() as string;
    let entries: import('fs').Dirent[];
    try { entries = await fsp.readdir(d, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (out.files >= maxFiles) { out.partial = true; return out; }
      const full = join(d, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.isFile()) {
        try { out.bytes += (await fsp.stat(full)).size; out.files++; } catch { /* gone */ }
      }
    }
  }
  return out;
}

/** The files directly inside `dir` whose names match `pattern` (no subfolders). */
export async function listFiles(dir: string, pattern: RegExp): Promise<FileInfo[]> {
  let names: string[];
  try { names = await fsp.readdir(dir); } catch { return []; }
  const out: FileInfo[] = [];
  for (const name of names) {
    if (!pattern.test(name)) continue;
    try {
      const st = await fsp.stat(join(dir, name));
      if (st.isFile()) out.push({ name, mtime: st.mtimeMs, size: st.size });
    } catch { /* gone */ }
  }
  return out;
}

export async function removeFiles(dir: string, names: readonly string[]): Promise<number> {
  let n = 0;
  for (const name of names) {
    try { await fsp.unlink(join(dir, name)); n++; } catch { /* in use or gone */ }
  }
  return n;
}
