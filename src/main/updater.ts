import { get as httpsGet } from 'https';
import { createReadStream, createWriteStream, renameSync, unlinkSync, existsSync, statSync } from 'fs';
import { pipeline } from 'stream';
import { createHash } from 'crypto';
import { spawn } from 'child_process';
import { app, dialog } from 'electron';
import { electronLog } from './logger';
import { runPreUpdate } from './pre-update';

export interface UpdateInfo {
  version: string;
  /** Installer link. Empty when the release could only be read from the release page (no installer details). */
  downloadUrl: string;
  fileSize: number;
  /** SHA-256 of the installer. Empty when GitHub gave none: such an installer is never run (the lite update still is, it has its own SHA-512). */
  sha256: string;
  notes: string;
}

/** Lightweight "an update exists" result for builds that can't self-install (portable, AppImage). */
export interface UpdateNotice {
  version: string;
  /** Link to the release page, where the user can pick the download for their platform. */
  releaseUrl: string;
  notes: string;
}

export type ProgressCallback = (percent: number) => void;

interface GithubAsset {
  name: string;
  browser_download_url: string;
  size: number;
  digest: string;
}

interface GithubRelease {
  tag_name: string;
  html_url: string;
  body?: string;
  assets: GithubAsset[];
  prerelease?: boolean;
  draft?: boolean;
}

// Update checks read the latest GitHub release of the repository configured below (KNLZVXAura/Krunker-Resource-Hub-Client).
// Releases need a vX.Y.Z tag and a '...Setup.exe' asset for the Windows self-update.
const UPDATES_ENABLED = true;

const UPDATE_CONFIG = {
  checkUrl: 'https://api.github.com/repos/KNLZVXAura/Krunker-Resource-Hub-Client/releases/latest',
  releasesUrl: 'https://github.com/KNLZVXAura/Krunker-Resource-Hub-Client/releases/latest',
  allowedHosts: ['github.com', 'githubusercontent.com'],
};

export const RELEASES_URL = UPDATE_CONFIG.releasesUrl;

// Only Windows self-installs (the NSIS Setup.exe); other platforms use the notice path.
function updateAssetPattern(): RegExp {
  if (process.platform === 'win32') return /Setup\.exe$/i;
  return /$^/; // matches nothing
}

// The version flows into a filesystem path (installer name) and the dialog HTML, so
// reject anything with path separators, HTML metacharacters, or whitespace.
function isSafeVersion(v: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(v);
}

const CHECK_TIMEOUT_MS = 10000;
// A download may take as long as it needs; it only counts as stuck when NO data arrives for this long.
const DOWNLOAD_STALL_MS = 60000;
const DOWNLOAD_MAX_RETRIES = 20; // interrupted downloads continue where they stopped (Range), this caps the attempts

function isAllowedRedirect(url: string): boolean {
  try {
    const parsed = new URL(url);
    return UPDATE_CONFIG.allowedHosts.some(h => parsed.hostname === h || parsed.hostname.endsWith('.' + h));
  } catch {
    return false;
  }
}

function versionLessThan(a: string, b: string): boolean {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na < nb) return true;
    if (na > nb) return false;
  }
  return false;
}

/** Resolves the latest GitHub release, or null on any error/timeout/non-200 (never rejects). */
function fetchLatestRelease(currentVersion: string): Promise<GithubRelease | null> {
  return new Promise((resolve) => {
    const headers = { 'User-Agent': 'KrunkerKRHClient/' + currentVersion };

    function doGet(url: string, redirectCount: number): void {
      if (redirectCount > 5) {
        electronLog.error('[KRH-Update] Too many redirects during check');
        resolve(null);
        return;
      }

      const req = httpsGet(url, { headers }, (res) => {
        electronLog.log('[KRH-Update] Check response status:', res.statusCode);
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const redirectUrl = res.headers.location;
          electronLog.log('[KRH-Update] Redirected to:', redirectUrl);
          if (!isAllowedRedirect(redirectUrl)) {
            electronLog.error('[KRH-Update] Redirect to untrusted host blocked:', redirectUrl);
            resolve(null);
            return;
          }
          res.resume(); // drain so the socket can be reused
          doGet(redirectUrl, redirectCount + 1);
          return;
        }

        if (res.statusCode !== 200) {
          electronLog.error('[KRH-Update] Check returned status', res.statusCode);
          resolve(null);
          return;
        }

        let data = '';
        res.setEncoding('utf8'); // a multi-byte character cut in two by a chunk border would be damaged otherwise
        res.on('data', (chunk: string) => { data += chunk; });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data) as GithubRelease);
          } catch (err) {
            electronLog.error('[KRH-Update] Failed to parse release data:', err);
            resolve(null);
          }
        });
        res.on('error', (err) => {
          electronLog.error('[KRH-Update] Response error:', err);
          resolve(null);
        });
      });

      req.setTimeout(CHECK_TIMEOUT_MS, () => {
        electronLog.error('[KRH-Update] Check timed out after', CHECK_TIMEOUT_MS, 'ms');
        req.destroy();
        resolve(null);
      });

      req.on('error', (err) => {
        electronLog.error('[KRH-Update] Check error:', err);
        resolve(null);
      });
    }

    electronLog.log('[KRH-Update] Checking for updates at:', UPDATE_CONFIG.checkUrl);
    electronLog.log('[KRH-Update] Current version:', currentVersion);
    doGet(UPDATE_CONFIG.checkUrl, 0);
  });
}

/**
 * Same answer as the API, without the API: github.com/<repo>/releases/latest redirects to .../tag/vX.Y.Z.
 * The API allows only 60 requests an hour per IP address, and shared networks hit that limit all the time, which
 * looked exactly like "there is no update" (the check just returned null). The redirect has no such limit.
 */
function fetchLatestTag(currentVersion: string): Promise<string | null> {
  return new Promise((resolve) => {
    const req = httpsGet(UPDATE_CONFIG.releasesUrl, { headers: { 'User-Agent': 'KrunkerKRHClient/' + currentVersion } }, (res) => {
      res.resume();
      const loc = res.headers.location || '';
      const m = /\/releases\/tag\/v?([^/?#]+)$/i.exec(loc);
      if (m && res.statusCode && res.statusCode >= 300 && res.statusCode < 400) { resolve(decodeURIComponent(m[1])); return; }
      electronLog.warn('[KRH-Update] Release page gave no tag (status', res.statusCode, ')');
      resolve(null);
    });
    req.setTimeout(CHECK_TIMEOUT_MS, () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
  });
}

/** The latest release: from the API, or (API refused / rate limited) from the release page redirect. */
async function getLatestRelease(currentVersion: string): Promise<GithubRelease | null> {
  const api = await fetchLatestRelease(currentVersion);
  if (api) return api;
  const tag = await fetchLatestTag(currentVersion);
  if (!tag) return null;
  electronLog.warn('[KRH-Update] GitHub API unavailable; using the release page instead:', tag);
  return { tag_name: 'v' + tag, html_url: `https://github.com/KNLZVXAura/Krunker-Resource-Hub-Client/releases/tag/v${tag}`, assets: [] };
}

export async function checkForUpdate(currentVersion: string): Promise<UpdateInfo | null> {
  if (!UPDATES_ENABLED) return null;
  const release = await getLatestRelease(currentVersion);
  if (!release) return null;

  const remoteVersion = (release.tag_name || '').replace(/^v/i, '');
  if (remoteVersion && !isSafeVersion(remoteVersion)) {
    electronLog.error('[KRH-Update] Rejecting release with unsafe version token:', remoteVersion);
    return null;
  }
  electronLog.log('[KRH-Update] Latest release:', remoteVersion, '| Current:', currentVersion);
  if (!remoteVersion || !versionLessThan(currentVersion, remoteVersion)) {
    electronLog.log('[KRH-Update] Already up to date');
    return null;
  }

  // The lite update (app.asar only) needs neither the installer nor its digest, so a release whose installer
  // is missing or has no digest is still an update. Only the installer fallback needs them (see index.ts).
  const pattern = updateAssetPattern();
  const setupAsset = (release.assets || []).find((a) => pattern.test(a.name));
  let downloadUrl = '';
  let sha256 = '';
  let fileSize = 0;
  if (setupAsset && isAllowedRedirect(setupAsset.browser_download_url)) {
    downloadUrl = setupAsset.browser_download_url;
    fileSize = setupAsset.size;
    // GitHub returns the digest as "sha256:<hex>"
    sha256 = (setupAsset.digest || '').replace(/^sha256:/i, '');
  } else {
    electronLog.warn('[KRH-Update] No usable installer asset in release', remoteVersion, '(the lite update can still work)');
  }
  if (!sha256) electronLog.warn('[KRH-Update] No SHA-256 digest for the installer; it will not be run');

  electronLog.log('[KRH-Update] Update available:', remoteVersion, '| SHA-256:', sha256 ? sha256.substring(0, 16) + '...' : '(none)');
  return {
    version: remoteVersion,
    downloadUrl,
    fileSize,
    sha256,
    notes: release.body || '',
  };
}

/**
 * Newer-release check for builds that can't self-install (macOS, Linux, portable):
 * returns the version plus a link to the release page, without downloading anything.
 */
export async function checkForUpdateNotice(currentVersion: string): Promise<UpdateNotice | null> {
  if (!UPDATES_ENABLED) return null;
  const release = await getLatestRelease(currentVersion);
  if (!release) return null;

  const remoteVersion = (release.tag_name || '').replace(/^v/i, '');
  if (remoteVersion && !isSafeVersion(remoteVersion)) {
    electronLog.error('[KRH-Update] Rejecting release with unsafe version token:', remoteVersion);
    return null;
  }
  electronLog.log('[KRH-Update] Latest release:', remoteVersion, '| Current:', currentVersion);
  if (!remoteVersion || !versionLessThan(currentVersion, remoteVersion)) {
    electronLog.log('[KRH-Update] Already up to date');
    return null;
  }

  const releaseUrl = release.html_url || UPDATE_CONFIG.releasesUrl;
  if (!isAllowedRedirect(releaseUrl)) {
    electronLog.error('[KRH-Update] Notice URL points to untrusted host:', releaseUrl);
    return null;
  }

  electronLog.log('[KRH-Update] Update notice:', remoteVersion, '->', releaseUrl);
  return { version: remoteVersion, releaseUrl, notes: release.body || '' };
}

function verifyChecksum(filePath: string, expectedSha256: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => {
      const actual = hash.digest('hex');
      electronLog.log('[KRH-Update] SHA-256 expected:', expectedSha256);
      electronLog.log('[KRH-Update] SHA-256 actual:  ', actual);
      resolve(actual === expectedSha256);
    });
    stream.on('error', reject);
  });
}

export function downloadUpdate(url: string, destPath: string, onProgress: ProgressCallback, expectedSha256?: string): Promise<void> {
  if (!url || !isAllowedRedirect(url)) return Promise.reject(new Error('This release has no installer to download'));
  if (!expectedSha256) return Promise.reject(new Error('The installer has no SHA-256 digest, so it was not downloaded'));
  return new Promise((resolve, reject) => {
    const tmpPath = destPath + '.tmp';
    let retries = 0;
    let total = 0; // size of the whole file once the server told us

    const giveUp = (err: Error): void => {
      try { unlinkSync(tmpPath); } catch { /* ignore */ }
      reject(err);
    };

    // A stalled or dropped connection is not the end: wait a moment and continue from the bytes already on disk.
    const retry = (err: Error, madeProgress: boolean): void => {
      if (madeProgress) retries = 0;
      retries++;
      if (retries > DOWNLOAD_MAX_RETRIES) { giveUp(err); return; }
      electronLog.warn(`[KRH-Update] Download interrupted (${err.message}), continuing (attempt ${retries})`);
      setTimeout(() => doDownload(url), Math.min(1000 * retries, 8000));
    };

    function doDownload(downloadUrl: string, redirectCount = 0): void {
      if (redirectCount > 5) {
        giveUp(new Error('Too many redirects'));
        return;
      }
      let resumeFrom = 0;
      try { if (existsSync(tmpPath)) resumeFrom = statSync(tmpPath).size; } catch { resumeFrom = 0; }
      electronLog.log('[KRH-Update] Downloading from:', downloadUrl, resumeFrom > 0 ? `(continuing at ${resumeFrom} bytes)` : '');

      let settled = false; // one outcome per attempt, whichever event comes first
      let gotData = false;
      const once = (fn: () => void): void => { if (!settled) { settled = true; fn(); } };

      const req = httpsGet(downloadUrl, {
        headers: { 'User-Agent': 'KrunkerKRHClient', ...(resumeFrom > 0 ? { Range: `bytes=${resumeFrom}-` } : {}) },
      }, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const redirectUrl = res.headers.location;
          electronLog.log('[KRH-Update] Download redirected to:', redirectUrl);
          res.resume();
          req.setTimeout(0); // this request is done: its timer must not outlive it and cut the real download
          once(() => {
            if (!isAllowedRedirect(redirectUrl)) {
              electronLog.error('[KRH-Update] Download redirect to untrusted host blocked:', redirectUrl);
              giveUp(new Error('Download redirect to untrusted host: ' + redirectUrl));
              return;
            }
            doDownload(redirectUrl, redirectCount + 1);
          });
          return;
        }

        if (res.statusCode === 416) { // the saved part does not fit the file: start over
          res.resume();
          once(() => { try { unlinkSync(tmpPath); } catch { /* ignore */ } doDownload(url); });
          return;
        }

        const partial = res.statusCode === 206;
        if (res.statusCode !== 200 && !partial) {
          electronLog.error('[KRH-Update] Download returned status', res.statusCode, 'from:', downloadUrl);
          res.resume();
          const status = res.statusCode ?? 0;
          once(() => (status >= 500 ? retry(new Error('Download returned status ' + status), false) : giveUp(new Error('Download returned status ' + status))));
          return;
        }

        const length = parseInt(res.headers['content-length'] || '0', 10);
        const startAt = partial ? resumeFrom : 0;
        if (length > 0) total = startAt + length;
        let received = startAt;

        res.on('data', (chunk: Buffer) => {
          gotData = true;
          received += chunk.length;
          if (total > 0) onProgress(Math.min(100, Math.round(100 * received / total)));
        });

        const file = createWriteStream(tmpPath, { flags: partial ? 'a' : 'w' });
        pipeline(res, file, (err) => {
          if (err) { once(() => retry(err, gotData)); return; } // cut off half way: the part on disk is kept
          once(() => {
            void (async () => {
              try {
                if (expectedSha256) {
                  const valid = await verifyChecksum(tmpPath, expectedSha256);
                  if (!valid) {
                    electronLog.error('[KRH-Update] Checksum mismatch — file may be corrupted or tampered');
                    giveUp(new Error('SHA-256 checksum mismatch'));
                    return;
                  }
                  electronLog.log('[KRH-Update] Checksum verified');
                }
                if (existsSync(destPath)) unlinkSync(destPath);
                renameSync(tmpPath, destPath);
                resolve();
              } catch (e) {
                reject(e);
              }
            })();
          });
        });
      });

      // Socket idle timer of THIS request: it restarts whenever data arrives, so a slow but moving download is fine.
      req.setTimeout(DOWNLOAD_STALL_MS, () => {
        req.destroy(new Error(`no data for ${DOWNLOAD_STALL_MS / 1000} s`));
      });

      req.on('error', (err) => { once(() => retry(err, gotData)); });
    }

    doDownload(url);
  });
}

// ── Earlier versions (Settings > Extras > Earlier Versions) ──

export interface PastRelease { version: string; downloadUrl: string; fileSize: number; sha256: string; notes: string }

/** The release list of the repository (the API only: the "latest" redirect trick cannot list older ones). Never rejects. */
function fetchReleaseList(currentVersion: string): Promise<GithubRelease[] | null> {
  return new Promise((resolve) => {
    const url = UPDATE_CONFIG.checkUrl.replace(/\/latest$/, '') + '?per_page=15';
    const req = httpsGet(url, { headers: { 'User-Agent': 'KrunkerKRHClient/' + currentVersion, Accept: 'application/vnd.github+json' } }, (res) => {
      if (res.statusCode !== 200) { res.resume(); electronLog.warn('[KRH-Update] Release list returned status', res.statusCode); resolve(null); return; }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => { data += chunk; });
      res.on('end', () => { try { const j = JSON.parse(data) as unknown; resolve(Array.isArray(j) ? (j as GithubRelease[]) : null); } catch { resolve(null); } });
      res.on('error', () => resolve(null));
    });
    req.setTimeout(CHECK_TIMEOUT_MS, () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
  });
}

/**
 * Older releases that have a Windows installer with a SHA-256 digest (an installer without one is never offered, the same
 * rule as for updates), newest first, at most `max`. `ok: false` when GitHub did not answer (it allows 60 requests an hour).
 */
export async function listPastReleases(currentVersion: string, max = 5): Promise<{ ok: boolean; releases: PastRelease[] }> {
  const list = await fetchReleaseList(currentVersion);
  if (!list) return { ok: false, releases: [] };
  const pattern = updateAssetPattern();
  const out: PastRelease[] = [];
  for (const r of list) {
    if (r.draft || r.prerelease) continue;
    const version = (r.tag_name || '').replace(/^v/i, '');
    if (!version || !isSafeVersion(version) || !versionLessThan(version, currentVersion)) continue;
    const asset = (r.assets || []).find((a) => pattern.test(a.name));
    const sha256 = (asset?.digest || '').replace(/^sha256:/i, '');
    if (!asset || !sha256 || !isAllowedRedirect(asset.browser_download_url)) continue;
    out.push({ version, downloadUrl: asset.browser_download_url, fileSize: asset.size, sha256, notes: r.body || '' });
  }
  out.sort((a, b) => (versionLessThan(a.version, b.version) ? 1 : versionLessThan(b.version, a.version) ? -1 : 0));
  return { ok: true, releases: out.slice(0, max) };
}

export function installUpdate(installerPath: string): void {
  runPreUpdate();
  electronLog.log('[KRH-Update] Launching installer:', installerPath);
  const child = spawn(installerPath, [], {
    detached: true,
    stdio: 'ignore',
  });
  // Without a listener a failed start (antivirus, permissions, a missing file) is an uncaught exception in the main process
  child.on('error', (err) => {
    electronLog.error('[KRH-Update] Could not start the installer:', err);
    try { dialog.showErrorBox('KRH Client', `The installer could not be started (${err.message}).\n\nYou can run it by hand: ${installerPath}`); } catch { /* app is already closing */ }
  });
  child.unref();
  app.quit();
}



// ── Update diagnostics (Dashboard > What's new > Check for updates) ──

export interface UpdateDiagContext {
  /** 'ask' shows a dialog at launch, 'background' downloads quietly and offers a restart button later. */
  updateMode: string;
  /** A version the user chose to skip in the dialog (never offered again). */
  skippedVersion: string;
  /** 'installer' | 'portable' | 'appimage' | 'other' */
  install: string;
}

export interface UpdateDiagResult {
  latest: string | null;
  available: boolean;
  /** Plain-text report, one finding per line: what the dashboard shows and what "Copy report" copies. */
  report: string;
}

interface ApiProbe { status: number; remaining: string; resetMin: number; release: GithubRelease | null; error: string }

function probeApi(currentVersion: string): Promise<ApiProbe> {
  return new Promise((resolve) => {
    const out: ApiProbe = { status: 0, remaining: '', resetMin: 0, release: null, error: '' };
    const req = httpsGet(UPDATE_CONFIG.checkUrl, { headers: { 'User-Agent': 'KrunkerKRHClient/' + currentVersion, Accept: 'application/vnd.github+json' } }, (res) => {
      out.status = res.statusCode || 0;
      out.remaining = String(res.headers['x-ratelimit-remaining'] ?? '');
      const reset = Number(res.headers['x-ratelimit-reset'] ?? 0);
      if (reset > 0) out.resetMin = Math.max(0, Math.ceil((reset * 1000 - Date.now()) / 60000));
      let data = '';
      res.on('data', (c: Buffer) => { data += c.toString('utf8'); if (data.length > 2_000_000) req.destroy(); });
      res.on('end', () => {
        if (out.status === 200) { try { out.release = JSON.parse(data) as GithubRelease; } catch { out.error = 'the answer was not valid JSON'; } }
        resolve(out);
      });
    });
    req.setTimeout(CHECK_TIMEOUT_MS, () => { out.error = 'timed out after ' + CHECK_TIMEOUT_MS / 1000 + ' s'; req.destroy(); resolve(out); });
    req.on('error', (e) => { out.error = e.message; resolve(out); });
  });
}

/** Runs the same checks as the real update path and explains, line by line, why an update is (not) offered. */
export async function diagnoseUpdate(currentVersion: string, ctx: UpdateDiagContext): Promise<UpdateDiagResult> {
  const lines: string[] = [];
  lines.push(`Installed version: ${currentVersion} (${ctx.install})`);
  lines.push(`Update mode: ${ctx.updateMode === 'background' ? 'background (no dialog: a "Restart to update" button appears about 20 s after launch)' : 'ask (a dialog at launch)'}`);

  const [api, pageTag] = await Promise.all([probeApi(currentVersion), fetchLatestTag(currentVersion)]);

  if (api.release) lines.push(`GitHub API: OK${api.remaining ? ` (${api.remaining} requests left this hour)` : ''}`);
  else if (api.status === 403 || api.status === 429) lines.push(`GitHub API: refused (HTTP ${api.status}), the hourly limit for this IP address is used up${api.resetMin ? `; it resets in about ${api.resetMin} min` : ''}. The client falls back to the release page.`);
  else if (api.status) lines.push(`GitHub API: HTTP ${api.status}. The client falls back to the release page.`);
  else lines.push(`GitHub API: not reachable (${api.error || 'no answer'}). Check the internet connection, VPN or firewall.`);
  lines.push(pageTag ? `Release page: latest is v${pageTag}` : 'Release page: could not be read');

  const apiTag = api.release?.tag_name ? api.release.tag_name.replace(/^v/i, '') : '';
  const latest = apiTag || pageTag;
  if (!latest) {
    lines.push('Result: the latest version could not be read, so no update can be offered. Both GitHub sources failed.');
    return { latest: null, available: false, report: lines.join('\n') };
  }
  if (apiTag && pageTag && apiTag !== pageTag) lines.push(`Warning: the API says v${apiTag} but the release page says v${pageTag}. The newest release is probably not marked "Latest", or is a pre-release.`);
  if (!isSafeVersion(latest)) { lines.push(`Result: the version name "${latest}" is not valid for an update.`); return { latest, available: false, report: lines.join('\n') }; }

  const available = versionLessThan(currentVersion, latest);
  if (!available) {
    lines.push(versionLessThan(latest, currentVersion)
      ? `Result: you run v${currentVersion}, newer than the latest release (v${latest}). No update is offered.`
      : `Result: you are up to date (latest release v${latest}).`);
    return { latest, available: false, report: lines.join('\n') };
  }
  lines.push(`Result: v${latest} is available.`);

  if (ctx.skippedVersion && ctx.skippedVersion === latest) lines.push(`Note: you chose "skip" for v${latest} earlier, so the launch dialog does not show it again. Updating from this page still works.`);
  if (ctx.install === 'portable' || ctx.install === 'appimage') lines.push('Note: this build cannot install itself. It only shows a notice; download the new version from the releases page.');

  if (api.release) {
    const names = (api.release.assets || []).map((a) => a.name);
    const has = (re: RegExp) => names.some((n) => re.test(n));
    const setup = (api.release.assets || []).find((a) => /Setup\.exe$/i.test(a.name));
    lines.push(`Release files: lite.json ${has(/^lite\.json$/i) ? 'found' : 'MISSING'}, .asar ${has(/\.asar$/i) ? 'found' : 'MISSING'}, Windows installer ${setup ? 'found' : 'MISSING'}${setup ? (setup.digest ? ' (has a SHA-256 digest)' : ' (NO digest, it will not be run)') : ''}`);
    if (!has(/^lite\.json$/i) || !has(/\.asar$/i)) lines.push('Note: without lite.json and the .asar the small update cannot run, so the client needs the full installer.');
  } else lines.push('Release files: not checked (the API did not answer).');
  return { latest, available: true, report: lines.join('\n') };
}
