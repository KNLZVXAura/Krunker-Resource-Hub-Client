// ── Resource packs ──
// A pack is a zip of Krunker resources (textures, sounds, models ...) with the same layout as the
// swapper folder. Packs live in <swapper folder>/_packs/<id>/{pack.json, files/...}. They stay
// inside the swapper folder on purpose: the krh-swap:// protocol only serves files from there.
// The swapper maps the files of every switched-on pack (in order, later packs win) and the
// user's own swapper files still win over all packs. Nothing here runs or loads any code.

import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, statSync, writeFileSync, createWriteStream, promises as fsp } from 'fs';
import { join, resolve, sep, posix, basename } from 'path';
import { inflateRawSync } from 'zlib';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import { electronLog } from './logger';

export const PACKS_DIR = '_packs';
export const PACK_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

const MAX_ZIP_BYTES = 400 * 1024 * 1024;        // download / file size limit
const MAX_TOTAL_BYTES = 1500 * 1024 * 1024;     // uncompressed total
const MAX_ENTRY_BYTES = 250 * 1024 * 1024;      // one file
const MAX_ENTRIES = 20000;
const MAX_REDIRECTS = 5;

// Never extracted, whatever the zip says. Packs are resources, not programs.
const BLOCKED_EXT = new Set([
  '.exe', '.dll', '.bat', '.cmd', '.com', '.scr', '.msi', '.ps1', '.vbs', '.js', '.mjs', '.jar',
  '.lnk', '.sh', '.appimage', '.app', '.dmg', '.deb', '.rpm', '.hta', '.reg',
]);

// A single top folder with one of these names is a real asset folder; any other single top
// folder (like "MyPack/") is just how the zip was made and gets stripped.
const KNOWN_ASSET_ROOTS = new Set(['textures', 'sound', 'sounds', 'models', 'img', 'images', 'audio', 'sprites', 'weapons', 'maps', 'video', 'videos', 'fonts', 'css']);

// Where packs may be downloaded from (https only, checked again on every redirect).
const HOST_ALLOW = [
  /^krunker-resources-hub\.pages\.dev$/i,
  /(^|\.)krunker\.io$/i,
  /^github\.com$/i,
  /(^|\.)githubusercontent\.com$/i,
  /^cdn\.discordapp\.com$/i,
  /^media\.discordapp\.net$/i,
];

export interface PackMeta {
  id: string;
  name: string;
  source: string;      // https link it was installed from ('' for a local file)
  files: number;
  bytes: number;
  skipped: number;     // entries left out (programs, bad paths)
  installedAt: number;
}

export interface InstallResult {
  ok: boolean;
  error?: string;
  pack?: PackMeta;
}

export function packsRoot(swapDir: string): string { return join(swapDir, PACKS_DIR); }

function packDir(swapDir: string, id: string): string { return join(packsRoot(swapDir), id); }

export function hostAllowed(u: URL): boolean {
  return u.protocol === 'https:' && HOST_ALLOW.some((re) => re.test(u.hostname));
}

function slugify(name: string): string {
  const s = name.toLowerCase().replace(/\.zip$/i, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  return s || 'pack';
}

function cleanName(name: string): string {
  const n = name.replace(/\.zip$/i, '').replace(/[\p{Cc}<>:"/\\|?*]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
  return n || 'Pack';
}

function uniqueId(swapDir: string, base: string): string {
  let id = base;
  let i = 2;
  while (existsSync(packDir(swapDir, id))) id = `${base.slice(0, 60)}-${i++}`;
  return id;
}

// ── Zip reading (stored + deflate, no zip64, no encryption) ──
interface ZipEntry { name: string; method: number; csize: number; usize: number; offset: number; flags: number }

function readAt(fd: number, pos: number, len: number): Buffer {
  const buf = Buffer.alloc(len);
  let got = 0;
  while (got < len) {
    const n = readSync(fd, buf, got, len - got, pos + got);
    if (n <= 0) break;
    got += n;
  }
  return got === len ? buf : buf.subarray(0, got);
}

export function readZipEntries(fd: number, size: number): ZipEntry[] {
  if (size < 22) throw new Error('This is not a zip file');
  const tailLen = Math.min(size, 65557);
  const tail = readAt(fd, size - tailLen, tailLen);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('This is not a zip file');
  const total = tail.readUInt16LE(eocd + 10);
  const cdSize = tail.readUInt32LE(eocd + 12);
  const cdOffset = tail.readUInt32LE(eocd + 16);
  if (total === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) throw new Error('Zip64 archives are not supported (too big or too many files)');
  if (total > MAX_ENTRIES) throw new Error(`The zip has too many files (${total}, limit ${MAX_ENTRIES})`);
  if (cdOffset + cdSize > size) throw new Error('The zip is damaged');
  const cd = readAt(fd, cdOffset, cdSize);
  const entries: ZipEntry[] = [];
  let p = 0;
  while (p + 46 <= cd.length && entries.length < total) {
    if (cd.readUInt32LE(p) !== 0x02014b50) throw new Error('The zip is damaged');
    const flags = cd.readUInt16LE(p + 8);
    const method = cd.readUInt16LE(p + 10);
    const csize = cd.readUInt32LE(p + 20);
    const usize = cd.readUInt32LE(p + 24);
    const nlen = cd.readUInt16LE(p + 28);
    const elen = cd.readUInt16LE(p + 30);
    const clen = cd.readUInt16LE(p + 32);
    const offset = cd.readUInt32LE(p + 42);
    // bit 11 = UTF-8 names; otherwise the old DOS code page, which for plain file names is the same bytes
    const name = cd.toString('utf8', p + 46, p + 46 + nlen);
    entries.push({ name, method, csize, usize, offset, flags });
    p += 46 + nlen + elen + clen;
  }
  return entries;
}

function readEntryData(fd: number, e: ZipEntry): Buffer {
  const lh = readAt(fd, e.offset, 30);
  if (lh.length < 30 || lh.readUInt32LE(0) !== 0x04034b50) throw new Error('The zip is damaged');
  const dataStart = e.offset + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28);
  const raw = readAt(fd, dataStart, e.csize);
  if (raw.length !== e.csize) throw new Error('The zip is damaged');
  if (e.method === 0) return raw;
  if (e.method === 8) return inflateRawSync(raw, { maxOutputLength: MAX_ENTRY_BYTES });
  throw new Error('Unsupported compression in the zip');
}

/** Safe relative path inside the pack, or '' when the entry must be skipped. */
export function safeEntryPath(raw: string): string {
  const n = raw.replace(/\\/g, '/');
  if (!n || n.startsWith('/') || /^[a-zA-Z]:/.test(n) || n.includes('\0')) return '';
  const parts = n.split('/').filter((x) => x !== '' && x !== '.');
  if (parts.length === 0 || parts.some((x) => x === '..')) return '';
  return parts.join('/');
}

/** Pure planning step (tested on its own): which entries are extracted and where they go. */
export function planExtraction(names: string[]): { map: Map<string, string>; skipped: number } {
  const clean: Array<{ raw: string; path: string }> = [];
  let skipped = 0;
  for (const raw of names) {
    if (raw.endsWith('/') || raw.endsWith('\\')) continue;       // folder entry
    const path = safeEntryPath(raw);
    if (!path) { skipped++; continue; }                          // absolute, drive letter or ../ path
    if (/(^|\/)__MACOSX\//.test(path) || /(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini)$/i.test(path)) continue; // junk, not worth mentioning
    const dot = path.lastIndexOf('.');
    const ext = dot >= 0 ? path.slice(dot).toLowerCase() : '';
    if (BLOCKED_EXT.has(ext)) { skipped++; continue; }           // programs and scripts are never extracted
    clean.push({ raw, path });
  }
  // strip one wrapper folder
  let strip = '';
  if (clean.length > 0) {
    const firsts = new Set(clean.map((c) => c.path.split('/')[0]));
    const allNested = clean.every((c) => c.path.includes('/'));
    if (firsts.size === 1 && allNested) {
      const only = [...firsts][0];
      if (!KNOWN_ASSET_ROOTS.has(only.toLowerCase())) strip = only + '/';
    }
  }
  const map = new Map<string, string>();
  for (const c of clean) {
    const rel = strip ? c.path.slice(strip.length) : c.path;
    if (rel) map.set(c.raw, rel);
  }
  return { map, skipped };
}

async function extractZip(zipPath: string, destFiles: string): Promise<{ files: number; bytes: number; skipped: number }> {
  const fd = openSync(zipPath, 'r');
  try {
    const size = statSync(zipPath).size;
    const entries = readZipEntries(fd, size);
    const plan = planExtraction(entries.map((e) => e.name));
    let skipped = plan.skipped;
    let files = 0;
    let bytes = 0;
    const root = resolve(destFiles);
    mkdirSync(root, { recursive: true });
    for (const e of entries) {
      const rel = plan.map.get(e.name);
      if (!rel) continue;
      if (e.flags & 1) throw new Error('Encrypted zips are not supported');
      if (e.usize > MAX_ENTRY_BYTES) { skipped++; continue; }
      const target = resolve(root, ...rel.split('/'));
      if (target !== root && !target.startsWith(root + sep)) { skipped++; continue; }   // zip-slip guard
      const data = readEntryData(fd, e);
      bytes += data.length;
      if (bytes > MAX_TOTAL_BYTES) throw new Error('The pack is too big once unpacked');
      mkdirSync(join(target, '..'), { recursive: true });
      writeFileSync(target, data);
      files++;
    }
    if (files === 0) throw new Error('The zip has no usable files');
    return { files, bytes, skipped };
  } finally {
    closeSync(fd);
  }
}

// ── Install ──
async function installFromZip(swapDir: string, zipPath: string, name: string, source: string): Promise<InstallResult> {
  const id = uniqueId(swapDir, slugify(name));
  const dir = packDir(swapDir, id);
  try {
    mkdirSync(packsRoot(swapDir), { recursive: true });
    const stats = await extractZip(zipPath, join(dir, 'files'));
    const meta: PackMeta = { id, name: cleanName(name), source, files: stats.files, bytes: stats.bytes, skipped: stats.skipped, installedAt: Date.now() };
    writeFileSync(join(dir, 'pack.json'), JSON.stringify(meta, null, 2), 'utf-8');
    electronLog.log(`[KRH-Packs] Installed ${id}: ${meta.files} files, ${(meta.bytes / 1e6).toFixed(1)} MB, ${meta.skipped} skipped`);
    return { ok: true, pack: meta };
  } catch (err) {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => { /* ignore */ });
    electronLog.warn('[KRH-Packs] Install failed:', (err as Error).message);
    return { ok: false, error: (err as Error).message };
  }
}

export async function installPackFromFile(swapDir: string, filePath: string): Promise<InstallResult> {
  try {
    const st = statSync(filePath);
    if (!st.isFile() || st.size > MAX_ZIP_BYTES) return { ok: false, error: 'The file is missing or too big (limit 400 MB)' };
  } catch { return { ok: false, error: 'Could not read that file' }; }
  return installFromZip(swapDir, filePath, basename(filePath), '');
}

async function downloadToTemp(url: string): Promise<string> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let u: URL;
    try { u = new URL(current); } catch { throw new Error('That is not a valid link'); }
    if (!hostAllowed(u)) throw new Error('Packs can only be downloaded from the Krunker Resource Hub, krunker.io, GitHub or Discord links. Download the zip yourself and use "Install from file".');
    const res = await fetch(u.href, { redirect: 'manual', headers: { 'User-Agent': 'KRH-Client-Packs' } });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      current = new URL(res.headers.get('location') as string, u).href;
      continue;
    }
    if (!res.ok || !res.body) throw new Error('The download failed (HTTP ' + res.status + ')');
    const len = Number(res.headers.get('content-length') || 0);
    if (len > MAX_ZIP_BYTES) throw new Error('The file is too big (limit 400 MB)');
    const tmp = join(tmpdir(), 'krh-pack-' + randomBytes(6).toString('hex') + '.zip');
    const out = createWriteStream(tmp);
    let got = 0;
    try {
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        got += value.length;
        if (got > MAX_ZIP_BYTES) throw new Error('The file is too big (limit 400 MB)');
        if (!out.write(value)) await new Promise<void>((r) => out.once('drain', () => r()));
      }
      await new Promise<void>((r, j) => { out.end(() => r()); out.on('error', j); });
    } catch (err) {
      out.destroy();
      await fsp.rm(tmp, { force: true }).catch(() => { /* ignore */ });
      throw err;
    }
    return tmp;
  }
  throw new Error('Too many redirects');
}

export async function installPackFromUrl(swapDir: string, url: string): Promise<InstallResult> {
  let nameFromUrl: string;
  try {
    const u = new URL(url);
    nameFromUrl = decodeURIComponent(posix.basename(u.pathname)) || 'Pack';
  } catch { return { ok: false, error: 'That is not a valid link' }; }
  let tmp = '';
  try {
    tmp = await downloadToTemp(url);
    return await installFromZip(swapDir, tmp, nameFromUrl, new URL(url).href);
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  } finally {
    if (tmp) await fsp.rm(tmp, { force: true }).catch(() => { /* ignore */ });
  }
}

// ── List / delete ──
export function listPacks(swapDir: string): PackMeta[] {
  const root = packsRoot(swapDir);
  const out: PackMeta[] = [];
  let names: string[];
  try { names = readdirSync(root); } catch { return out; }
  for (const id of names) {
    if (!PACK_ID_RE.test(id)) continue;
    try {
      const meta = JSON.parse(readFileSync(join(root, id, 'pack.json'), 'utf-8')) as PackMeta;
      if (meta && typeof meta.name === 'string') out.push({ ...meta, id });
    } catch { /* not a pack folder */ }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export async function deletePack(swapDir: string, id: string): Promise<boolean> {
  if (!PACK_ID_RE.test(id)) return false;
  const dir = packDir(swapDir, id);
  if (!existsSync(dir)) return false;
  await fsp.rm(dir, { recursive: true, force: true });
  return true;
}
