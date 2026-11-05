/*
 * Adapted from NM/NZ Client (https://github.com/nmallik1029/nm-nez-client), src/shared/lite-update.ts.
 * NM/NZ Client is GPL-3.0-or-later, like KRH Client. See THIRD_PARTY_NOTICES.md.
 * Changes: only app.asar is shipped (no "extra" archive, KRH has nothing beside it), 4-part versions,
 * and the release repository is KNLZVXAura/Krunker-Resource-Hub-Client.
 */

/**
 * Updating without the installer ("lite update").
 *
 * WHY. The installer is an unsigned exe, and Windows Smart App Control refuses to run one, so on those PCs the
 * installer never starts. It is also the big download (the whole Electron runtime), which is the part that
 * timed out on slow connections. But an update almost never needs it: everything that changes between two
 * releases lives in `resources/app.asar`. The patched Electron runtime only changes when it is re-pinned.
 *
 * So every release also publishes app.asar on its own, plus a small manifest, and the client fetches the file,
 * checks its SHA-512 and swaps it in on restart. It runs nothing new, so there is nothing for Windows to block.
 *
 * WHAT A RELEASE PUBLISHES, beside the installers (scripts/lite-release.mjs):
 *
 *   lite.json                  the manifest below
 *   KRH-Client-<v>.asar        resources/app.asar, exactly as shipped in the installer
 *
 * `runtime` is the pin of the patched Electron build the release was made with. The running app carries its own,
 * baked in at build time, and an app file is only ever swapped in for one built against the same runtime. The day
 * they differ is the day the installer is genuinely needed, and the client falls back to it.
 *
 * Pure, so every check a download has to pass can be tested without one.
 */

export const LITE_MANIFEST_NAME = 'lite.json';

/** One published file: its release asset name, and how to know it arrived whole. */
export interface LiteAsset {
  readonly name: string;
  readonly size: number;
  /** Base64 SHA-512 (the same form electron-updater's latest.yml uses). */
  readonly sha512: string;
}

export interface LiteManifest {
  readonly version: string;
  readonly runtime: string;
  readonly asar: LiteAsset;
}

const SHA512_BASE64 = /^[A-Za-z0-9+/]{86}==$/;
/** An asset name: one path segment, nothing to escape, nothing to traverse. */
const ASSET_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
/** KRH release versions have three or four numeric parts (1.3.0.0). */
const VERSION = /^\d+\.\d+\.\d+(?:\.\d+)?$/;
/** Real asar files are a few tens of MB. Anything near this is not an app. */
export const MAX_ASAR_BYTES = 400 * 1024 * 1024;

function isSize(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= MAX_ASAR_BYTES;
}

function asset(value: unknown): LiteAsset | null {
  if (typeof value !== 'object' || value === null) return null;
  const { name, size, sha512 } = value as Record<string, unknown>;
  if (typeof name !== 'string' || !ASSET_NAME.test(name) || !name.endsWith('.asar')) return null;
  if (!isSize(size) || typeof sha512 !== 'string' || !SHA512_BASE64.test(sha512)) return null;
  return { name, size, sha512 };
}

/**
 * The manifest, or null if any part of it is not what a release publishes.
 * All or nothing: a manifest with one bad entry is one this client does not understand, and the installer is
 * the safe way through that.
 */
export function parseLiteManifest(value: unknown): LiteManifest | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw['version'] !== 'string' || !VERSION.test(raw['version'])) return null;
  if (typeof raw['runtime'] !== 'string' || raw['runtime'] === '' || raw['runtime'].length > 300) return null;
  const app = asset(raw['asar']);
  if (!app) return null;
  return { version: raw['version'], runtime: raw['runtime'], asar: app };
}

export type LiteVerdict = { readonly lite: true } | { readonly lite: false; readonly reason: string };

/**
 * Can this client take the update without the installer?
 * Only for the version it was offered, and only on the runtime it is running. A runtime of `unknown` is a build
 * that could not read its own pin, and it gets the installer rather than a guess.
 */
export function liteVerdict(
  manifest: LiteManifest,
  expect: { readonly version: string; readonly runtime: string },
): LiteVerdict {
  if (manifest.version !== expect.version) {
    return { lite: false, reason: `manifest is for ${manifest.version}, not ${expect.version}` };
  }
  if (expect.runtime === 'unknown' || manifest.runtime !== expect.runtime) {
    return { lite: false, reason: 'this release changes the Electron runtime' };
  }
  return { lite: true };
}

/** Where a release asset is downloaded from. */
export function releaseAssetUrl(
  repo: { readonly owner: string; readonly repo: string },
  version: string,
  name: string,
): string {
  return `https://github.com/${repo.owner}/${repo.repo}/releases/download/v${version}/${name}`;
}
