/*
 * Adapted from NM/NZ Client (https://github.com/nmallik1029/nm-nez-client), src/main/lite-update.ts.
 * NM/NZ Client is GPL-3.0-or-later, like KRH Client. See THIRD_PARTY_NOTICES.md.
 * Changes: app.asar only, KRH repository and runtime pin, downloads that stall are retried, and a
 * one-call helper (updateWithoutInstaller) for the launch update and the background updater.
 */

// The main-process half of updating without the installer: download, check, stage, and swap in on restart.
// See src/shared/lite-update.ts for why.
//
// Nothing touches the running install until applyLite(), which runs at the very end of quitting. Until then
// everything new sits beside what it replaces (app.asar.update), so a download that fails or is never used leaves
// the client exactly as it was, and the next launch tidies it away.

import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { app, net } from 'electron';
// Plain fs, which does not read inside .asar files. Anything done to an .asar file itself goes through this,
// or Electron treats the file as a folder.
import * as ofs from 'original-fs';
import { LITE_MANIFEST_NAME, liteVerdict, parseLiteManifest, releaseAssetUrl, type LiteAsset, type LiteManifest } from '../shared/lite-update';
import { sha512, swapAsar } from './lite-swap';
import { electronLog } from './logger';
import { runPreUpdate } from './pre-update';

/** Where releases are published. Matches `homepage` in package.json. */
const RELEASES = { owner: 'KNLZVXAura', repo: 'Krunker-Resource-Hub-Client' } as const;

/** A download only counts as stuck when NO data has arrived for this long (a slow but moving one is fine). */
const STALL_MS = 60_000;
const MAX_ATTEMPTS = 4;

declare const __KRH_RUNTIME__: string | undefined;

/**
 * The patched Electron build this app was made for, baked in by vite.main.config.ts from the stamp
 * scripts/download-electron.js writes. `unknown` in a build made without one, which always takes the installer.
 */
export function runtimePin(): string {
  return typeof __KRH_RUNTIME__ === 'string' && __KRH_RUNTIME__ !== '' ? __KRH_RUNTIME__ : 'unknown';
}

const resources = (): string => process.resourcesPath;
const liveAsar = (): string => join(resources(), 'app.asar');
const stagedAsar = (): string => `${liveAsar()}.update`;
const partialAsar = (): string => `${liveAsar()}.download`;
const previousAsar = (): string => `${liveAsar()}.old`;

export type Prepared = { readonly lite: true } | { readonly lite: false; readonly reason: string };

let staged: LiteAsset | null = null;

export function hasStagedLite(): boolean {
  return staged !== null;
}

/** Fetch with a stall timer: the signal fires when no response data has moved for STALL_MS. */
async function fetchWithStall(url: string, stall: { timer: ReturnType<typeof setTimeout> | null; ctl: AbortController }): Promise<Response> {
  const arm = (): void => {
    if (stall.timer) clearTimeout(stall.timer);
    stall.timer = setTimeout(() => stall.ctl.abort(new Error(`no data for ${STALL_MS / 1000} s`)), STALL_MS);
  };
  arm();
  const res = await net.fetch(url, { signal: stall.ctl.signal });
  arm();
  return res;
}

async function fetchManifest(version: string): Promise<LiteManifest | null> {
  const stall = { timer: null as ReturnType<typeof setTimeout> | null, ctl: new AbortController() };
  try {
    const res = await fetchWithStall(releaseAssetUrl(RELEASES, version, LITE_MANIFEST_NAME), stall);
    if (!res.ok) throw new Error(`no ${LITE_MANIFEST_NAME} on the release (HTTP ${res.status})`);
    const text = await res.text();
    if (text.length > 64 * 1024) return null; // a manifest is a few hundred bytes
    return parseLiteManifest(JSON.parse(text));
  } finally {
    if (stall.timer) clearTimeout(stall.timer);
  }
}

/**
 * One attempt at downloading one release asset to `dest`, checking it on the way in.
 * Hashed as it streams, and refused if it runs past its stated size, so a wrong file never gets written whole
 * before it is caught. A file that does not match is deleted, not left for anything to pick up.
 */
async function downloadOnce(version: string, asset: LiteAsset, dest: string, onBytes: (count: number) => void): Promise<number> {
  const stall = { timer: null as ReturnType<typeof setTimeout> | null, ctl: new AbortController() };
  const hash = createHash('sha512');
  let size = 0;
  let fd = -1;
  try {
    const res = await fetchWithStall(releaseAssetUrl(RELEASES, version, asset.name), stall);
    if (!res.ok || !res.body) throw new Error(`${asset.name}: HTTP ${res.status}`);
    fd = ofs.openSync(dest, 'w');
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      // Data arrived: the stall timer starts over.
      if (stall.timer) clearTimeout(stall.timer);
      stall.timer = setTimeout(() => stall.ctl.abort(new Error(`no data for ${STALL_MS / 1000} s`)), STALL_MS);
      size += value.length;
      if (size > asset.size) throw new Error(`${asset.name}: bigger than the release says`);
      ofs.writeSync(fd, value);
      hash.update(value);
      onBytes(value.length);
    }
  } catch (err) {
    if (fd >= 0) { try { ofs.closeSync(fd); } catch { /* ignore */ } }
    try { ofs.rmSync(dest, { force: true }); } catch { /* ignore */ }
    throw Object.assign(err instanceof Error ? err : new Error(String(err)), { bytesThisAttempt: size });
  } finally {
    if (stall.timer) clearTimeout(stall.timer);
  }
  ofs.closeSync(fd);

  if (size !== asset.size || hash.digest('base64') !== asset.sha512) {
    ofs.rmSync(dest, { force: true });
    throw Object.assign(new Error(`${asset.name}: does not match the release`), { bytesThisAttempt: size, final: true });
  }
  return size;
}

/** A cut-off connection is retried from the start (the file is a few MB). A file that does not match is not. */
async function download(version: string, asset: LiteAsset, dest: string, onBytes: (count: number) => void): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await downloadOnce(version, asset, dest, onBytes);
      return;
    } catch (err) {
      const e = err as Error & { bytesThisAttempt?: number; final?: boolean };
      onBytes(-(e.bytesThisAttempt ?? 0)); // this attempt's progress is thrown away
      if (e.final === true || attempt >= MAX_ATTEMPTS) throw e;
      electronLog.warn(`[KRH-Update] lite download interrupted (${e.message}), retrying (attempt ${attempt + 1})`);
      await new Promise((r) => setTimeout(r, Math.min(1000 * attempt, 5000)));
    }
  }
}

/**
 * Get an update ready to swap in, or say why it needs the installer.
 * Throws on anything unexpected; the caller falls back to the installer then too, so this can only ever make
 * updating work more often, never less.
 */
export async function prepareLite(version: string, onPercent: (percent: number) => void): Promise<Prepared> {
  staged = null;
  if (!app.isPackaged) return { lite: false, reason: 'not a packaged build' };
  const manifest = await fetchManifest(version);
  if (!manifest) return { lite: false, reason: `${LITE_MANIFEST_NAME} is not one this client understands` };

  const verdict = liteVerdict(manifest, { version, runtime: runtimePin() });
  if (!verdict.lite) return verdict;

  // A folder the user cannot write to (a per-machine install under Program Files, say) is a job for the
  // installer and its elevation prompt.
  try {
    ofs.writeFileSync(partialAsar(), '');
  } catch (err) {
    return { lite: false, reason: `cannot write to ${resources()}: ${(err as Error).message}` };
  }

  let done = 0;
  let shown = -1;
  const onBytes = (count: number): void => {
    done = Math.max(0, done + count);
    const percent = Math.min(100, Math.floor((done / manifest.asar.size) * 100));
    if (percent !== shown) onPercent((shown = percent));
  };

  try {
    await download(version, manifest.asar, partialAsar(), onBytes);
    ofs.rmSync(stagedAsar(), { force: true });
    ofs.renameSync(partialAsar(), stagedAsar());
  } catch (err) {
    try { ofs.rmSync(partialAsar(), { force: true }); } catch { /* ignore */ }
    throw err;
  }

  staged = manifest.asar;
  electronLog.log(`[KRH-Update] update ${version} staged without the installer (${(manifest.asar.size / 1048576).toFixed(1)} MB)`);
  return { lite: true };
}

/**
 * Prepare an update without the installer. Never throws: a false result means "use the installer",
 * and says why in the log.
 */
export async function updateWithoutInstaller(version: string, onPercent: (percent: number) => void): Promise<boolean> {
  try {
    const result = await prepareLite(version, onPercent);
    if (result.lite) return true;
    electronLog.log(`[KRH-Update] updating with the installer: ${result.reason}`);
  } catch (err) {
    electronLog.warn('[KRH-Update] lite update failed, falling back to the installer:', (err as Error).message);
  }
  return false;
}

/**
 * Swap the staged app.asar in. Called from `will-quit`, after the windows are gone, with `app.relaunch()` already
 * asked for when the client should come back by itself. Never throws: if the swap fails the old version stays.
 */
export function applyLite(): void {
  if (!staged) return;
  runPreUpdate();
  const asar = staged;
  staged = null;
  try {
    const how = swapAsar(ofs, { live: liveAsar(), staged: stagedAsar(), previous: previousAsar() }, asar.sha512);
    electronLog.log(`[KRH-Update] app.asar swapped in (${how})`);
  } catch (err) {
    electronLog.error('[KRH-Update] swapping the update in failed; the old version stays:', (err as Error).message);
  }
}

/** Swap the update in when the client closes, then start it again. The "Restart to update" path. */
export function applyLiteAndRelaunch(): void {
  if (!staged) return;
  // relaunch() only takes effect when the quit completes, so asking for it first is how the client comes back
  // on the new files. The swap itself happens at the very end of quitting, when nothing is left reading the app.
  app.once('will-quit', () => applyLite());
  app.relaunch();
  setTimeout(() => app.quit(), 120);
}

/**
 * Remove whatever an earlier update left behind: the previous app.asar and anything staged but never used.
 * Run at launch, when none of it can be open. Never throws; what cannot go now goes next launch.
 */
export function cleanupLite(): void {
  if (!app.isPackaged) return;
  for (const path of [previousAsar(), stagedAsar(), partialAsar()]) {
    try {
      ofs.rmSync(path, { recursive: true, force: true });
    } catch (err) {
      electronLog.warn(`[KRH-Update] could not remove ${path}: ${(err as Error).message}`);
    }
  }
}

export { sha512 };
