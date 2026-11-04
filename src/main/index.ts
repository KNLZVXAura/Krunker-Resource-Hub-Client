import { app, BrowserWindow, Menu, Notification, clipboard, dialog, ipcMain, net, powerSaveBlocker, safeStorage, screen, session, shell, webContents } from 'electron';
import { join, extname, basename, dirname, resolve as resolvePath } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync, watch as fsWatch, promises as fsp } from 'fs';
import { get as httpsGet } from 'https';
import { execFile } from 'child_process';
import * as os from 'os';
import { Socket } from 'net';
import { detectPlatform, applyPlatformFlags, getValidAngleBackends, devWindowIcon, clampFrameCap, ensureHighPerformanceGpu, getGpuProfileInfo, GPU_PROFILES } from './platform';
import type { ExtrasConfig } from './config-defaults';
import { config, Keybind, DEFAULT_KEYBINDS, SavedAccount, DEFAULT_CONFIG, SocialMusicSource } from './config';
import { initSwapperProtocol, registerSwapperFileProtocol, ResourceSwapper, filePathToSwapURL, EXTERNAL_SWAP_FILE, EXTERNAL_EXAMPLE } from './swapper';
import { listSkyImages, resolveSkyImage, SKIES_DIR, SKY_TEXTURE_RE, SKY_IMAGE_EXTS } from './sky-textures';
import { UserscriptManager } from './userscripts';
import { UserscriptGuard } from './userscript-guard';
import { runPerfDoctor } from './perf-doctor';
import { getKrunkerNews } from './news-feed';
import { UserCssManager } from './user-css';
import { openDashboard, closeDashboard, isDashboardVisible, isDashboardFocused, floatDashboard } from './dashboard';
import { GAME_PROBE_JS, clearLock, lockdownPage, readLock, scanLaunchFlags, scanProcesses, scanScripts, writeLock } from './integrity';
import { registerSiteBridge } from './site-bridge';
import { recordGameUrl, recordGameTitle, cacheLimitMb } from './dashboard-extras';
import exampleClassRoulette from '../../assets/example-userscripts/classRoulette.js?raw';
import exampleQuickSell from '../../assets/example-userscripts/quickSellByRarity.js?raw';
import exampleReconnector from '../../assets/example-userscripts/Krunker_Reconnector.js?raw';
import exampleDocs from '../../assets/example-userscripts/Quick_Krunker_Docs_Integration.js?raw';
import exampleKillStreak from '../../assets/example-userscripts/killstreak.js?raw';
import libMsgpack from '../../assets/userscript-libs/msgpack-lite-0.1.26.min.js?raw';
import { ALL_CLIENT_CSS, HIDE_ADS_CSS, CONSENT_DISMISS_JS } from './client-ui';
import { electronLog, rendererLog, getLogPath, closeLogStreams } from './logger';
import { checkForUpdate, downloadUpdate, installUpdate, checkForUpdateNotice, diagnoseUpdate, RELEASES_URL } from './updater';
import { installEscapeLock, handleEscapeInput, setEscapeFastRelease, releaseEscapeShortcut } from './escape-lock';
import { normalisePresets } from '../shared/presets';
import { cleanCrosshairImage } from '../shared/crosshair-image';
import { updateWithoutInstaller, applyLiteAndRelaunch, cleanupLite } from './lite-update';
import { createHubWindow, openSiteWindow, showWindow, setHubSuspended, authDeepLinkToHubUrl, HUB_URL } from './hub-window';
import { loadBlocklist, userListsDir } from './user-lists';
import { createSplash, splashStatus, splashPrompt, splashAlive, splashElapsed, getSplash, onSplashUserClosed, closeSplash } from './splash';
import { DiscordRPC } from './discord-rpc';
import { listThemes, getThemeCSS, listLoadingThemes, getLoadingScreenCSS, GAME_THEMES_DIR, SOCIAL_THEMES_DIR } from './css-themes';
import { TabManager } from './tab-manager';
import { openRankedQueue, loadQueueMaps, DEFAULT_RANKED_AUDIO_URL } from './ranked-queue';
import { loadOfficialMaps } from './official-maps';
import { takeScreenshot, takeAreaScreenshot, openScreenshotsFolder, revealLastScreenshot } from './screenshot';
import { toggleRecording, togglePauseRecording, stopRecording, openRecordingsFolder, startReplayBuffer, stopReplayBuffer, saveReplayClip, setReplaySeconds, replayActive } from './recorder';
import { installPackFromUrl, installPackFromFile, listPacks, deletePack, PACK_ID_RE } from './packs';
import { encodeShare, decodeShare } from './share-code';
import { addDelta, endSession, flushStats, getStats, clearStats, summaryText } from './session-stats';
import { beginLaunchGuard, isSafeMode, markCleanQuit, noteProcessCrash } from './safe-mode';
import { startBackgroundUpdates, wireHubBadge, installReadyUpdate, installOnQuitIfWanted, pokeBackgroundUpdates, getReadyUpdate } from './update-manager';
import { TwitchChat, normalizeChannel, fetchEmoteImage } from './twitch';
import { TwitchLinkBot, loadToken as loadTwitchBotToken, saveToken as saveTwitchBotToken, normalizeToken as normalizeTwitchBotToken } from './twitch-link';
import type { TwitchConfig } from './twitch';
import { Spotify, fetchSpotifyArt } from './spotify';
import type { SpotifyConfig, SpotifyAction } from './spotify';
import { blockOffsiteRedirects, isGameURL, isKrunkerHost, isKrunkerPage, safeOpenExternal } from './links';

// Letter of a Ctrl+Alt shortcut, from the physical key so it also works on AltGr layouts.
function spotKey(input: { code?: string; key: string }): string {
  const m = /^Key([A-Z])$/.exec(input.code || '');
  return m ? m[1].toLowerCase() : input.key.toLowerCase();
}

const AUDIO_MIME: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
};
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
const MAX_MUSIC_BYTES = 30 * 1024 * 1024;

/** The extension allowlist is load-bearing — this inlines file bytes into a renderer. */
async function readAudio(path: string, maxBytes: number): Promise<{ bytes: Buffer; mime: string } | null> {
  try {
    const mime = AUDIO_MIME[extname(path).toLowerCase()];
    if (!mime) throw new Error('unsupported audio type');
    const stat = await fsp.stat(path);
    if (!stat.isFile()) throw new Error('not a file');
    if (stat.size > maxBytes) {
      electronLog.warn(`[KRH] Audio file too large (${stat.size} bytes, max ${maxBytes}): ${path}`);
      return null;
    }
    return { bytes: await fsp.readFile(path), mime };
  } catch (err) {
    electronLog.warn(`[KRH] Audio file invalid (${path}):`, err);
    return null;
  }
}

async function resolveRankedAudioUrl(setting: string): Promise<string> {
  const s = (setting || '').trim();
  if (!s) return DEFAULT_RANKED_AUDIO_URL;
  if (/^https?:\/\//i.test(s)) return s;
  const a = await readAudio(s, MAX_AUDIO_BYTES);
  return a ? `data:${a.mime};base64,${a.bytes.toString('base64')}` : DEFAULT_RANKED_AUDIO_URL;
}

/** Like resolveRankedAudioUrl but with no built-in default — empty/unreadable → ''. */
async function resolveAudioUrl(setting: string): Promise<string> {
  const s = (setting || '').trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  const a = await readAudio(s, MAX_AUDIO_BYTES);
  return a ? `data:${a.mime};base64,${a.bytes.toString('base64')}` : '';
}

/** Local files come back as raw bytes for a Blob; base64 would add a third again. */
async function resolveSocialMusic(setting: string): Promise<SocialMusicSource> {
  const s = (setting || '').trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return { url: s };
  return await readAudio(s, MAX_MUSIC_BYTES);
}

// ── App version for API calls ──
// Must come from app.getVersion(): require('../../package.json') is inlined by Vite at build time, so it
// always reports package.json's 3-part semver (1.0.1) and ignores the 4-part release version that
// electron-builder injects via extraMetadata (electron-builder.yml). Reading the inlined copy made the
// client think it was still 1.0.1 after updating, so it kept offering the same update again.
const appVersion: string = app.getVersion();

// ── Region ping cache ──
const SERVER_MAP: Record<string, string> = {
  'us-ca-sv': 'SV', 'jb-hnd': 'TOK', 'de-fra': 'FRA',
  'as-mb': 'MBI', 'au-syd': 'SYD', 'sgp': 'SIN',
  'us-tx': 'DAL', 'me-bhn': 'BHN', 'brz': 'BRZ', 'us-nj': 'NY',
};
let pingCache: Record<string, number> = {};
let gamePingCache = { key: '', ms: -1, at: 0 };
let pingCacheTime = 0;

function osPing(host: string): Promise<number> {
  return new Promise((resolve) => {
    const isWin = process.platform === 'win32';
    // -W units differ by platform: seconds on Linux, milliseconds on macOS/BSD. Sending
    // Linux's '2' to BSD ping waits 2ms, so the reply arrives outside the wait window and
    // ping omits the per-packet 'time=' line the regex below needs — every region read -1.
    const wait = process.platform === 'darwin' ? '2000' : '2';
    const args = isWin ? ['-n', '1', '-w', '1500', host] : ['-c', '1', '-W', wait, host];
    execFile('ping', args, { timeout: 3000 }, (err, stdout) => {
      if (err) { resolve(-1); return; }
      const match = stdout.match(/time[=<]([\d.]+)\s*ms/i);
      if (match) resolve(Math.round(parseFloat(match[1])));
      else resolve(-1);
    });
  });
}

// ── Region pings for the matchmaker ──
// The matchmaker waits for these before it can sort lobbies, so they must never be the slow part of a search:
//  - an old answer is returned at once while a fresh one is measured in the background (regions move by a few ms,
//    not by the seconds a search used to lose),
//  - one ping per region, no retry (a region that blocks ICMP used to cost a second try every time, ~3 s),
//  - the whole round is capped, and a region that did not answer keeps its last known value.
let pingRefresh: Promise<Record<string, number>> | null = null;
const PING_ROUND_CAP_MS = 2500;

function refreshRegionPings(): Promise<Record<string, number>> {
  if (pingRefresh) return pingRefresh;
  pingRefresh = (async () => {
    try {
      const data = await new Promise<string>((resolve, reject) => {
        const req = httpsGet('https://matchmaker.krunker.io/ping-list?hostname=krunker.io', (res) => {
          let body = '';
          res.on('data', (chunk: string) => { body += chunk; });
          res.on('end', () => resolve(body));
          res.on('error', reject);
        });
        req.setTimeout(3000, () => req.destroy(new Error('ping-list timed out')));
        req.on('error', reject);
      });
      const serverIPs: Record<string, string> = JSON.parse(data);
      const results: Record<string, number> = {};
      const all = Promise.allSettled(Object.entries(serverIPs).map(async ([server, ip]) => {
        const latency = await osPing(ip.split(':')[0]);
        if (latency >= 0) results[SERVER_MAP[server] ?? server] = latency;
      }));
      await Promise.race([all, new Promise<void>((r) => setTimeout(r, PING_ROUND_CAP_MS))]);
      pingCache = { ...pingCache, ...results };
      pingCacheTime = Date.now();
      return pingCache;
    } catch (err) {
      electronLog.warn('[KRH] Ping regions error:', err);
      return pingCache;
    } finally {
      pingRefresh = null;
    }
  })();
  return pingRefresh;
}

// ── Direct server ping (TCP-connect timing — measures the same TCP path the game's WebSocket uses) ──
let _pingTimer: NodeJS.Timeout | null = null;
let _pingTarget: { host: string; port: number } | null = null;

function tcpPing(host: string, port: number): Promise<number> {
  return new Promise((resolve) => {
    const sock = new Socket();
    const start = process.hrtime.bigint();
    const done = (ms: number) => { sock.destroy(); resolve(ms); };
    sock.setTimeout(1800);
    sock.once('connect', () => done(Math.round(Number(process.hrtime.bigint() - start) / 1_000_000)));
    sock.once('error', () => done(-1));
    sock.once('timeout', () => done(-1));
    try { sock.connect(port, host); } catch { done(-1); }
  });
}

function setPingTarget(host: string, port: number, win: BrowserWindow): void {
  const wantPolling = !!config.get('ui')?.directServerPing;
  const sameTarget = _pingTarget?.host === host && _pingTarget?.port === port;
  // Timer state is part of the dedupe: the target survives an F5, so comparing
  // host/port alone would skip starting the timer after the setting is enabled.
  if (sameTarget && !!_pingTimer === wantPolling) return;
  if (_pingTimer) clearInterval(_pingTimer);
  _pingTimer = null;
  _pingTarget = { host, port };
  if (!wantPolling) return;
  const measure = async () => {
    if (!_pingTarget || win.isDestroyed()) return;
    const ms = await tcpPing(_pingTarget.host, _pingTarget.port);
    if (ms < 0 || win.isDestroyed() || win.webContents.isDestroyed()) return;
    // The render frame can be disposed mid-navigation (or by a renderer crash) while
    // the window itself survives; send() then throws "Render frame was disposed".
    try { win.webContents.send('server-ping', ms); } catch { /* frame gone */ }
  };
  measure();
  _pingTimer = setInterval(measure, 2000);
}

function stopServerPing(): void {
  if (_pingTimer) clearInterval(_pingTimer);
  _pingTimer = null;
  _pingTarget = null;
}


// ── Platform flags (must run before app.ready) ──
const platformInfo = detectPlatform();
const advancedConfig = { ...DEFAULT_CONFIG.advanced, ...config.get('advanced') };
const perfConfig = { ...DEFAULT_CONFIG.performance, ...config.get('performance') };

// Self-heal angleBackend if a previous version's value is no longer valid for this platform (e.g. user picked 'vulkan', 'd3d9', etc., and we removed it).
const validBackends = getValidAngleBackends(platformInfo);
if (advancedConfig.angleBackend && !validBackends.includes(advancedConfig.angleBackend)) {
  electronLog.warn(`[KRH] Invalid angleBackend '${advancedConfig.angleBackend}' for ${platformInfo.os}, resetting to 'default'`);
  advancedConfig.angleBackend = 'default';
  config.set('advanced', { ...config.get('advanced'), angleBackend: 'default' });
}

// The KRH Official theme was dropped before release; anyone who tried a test build goes back to no theme
if (config.get('ui')?.cssTheme === 'preset:krh-official') config.set('ui', { ...DEFAULT_CONFIG.ui, ...config.get('ui'), cssTheme: 'disabled' });

applyPlatformFlags(platformInfo, advancedConfig, perfConfig);
if (config.get('performance')?.highPerformanceGpu !== false) ensureHighPerformanceGpu();
{
  const g = getGpuProfileInfo();
  if (g) {
    const list = g.summary.gpus.map((x) => `${x.name} [${x.vendor}/${x.tier}${x.integrated ? '/iGPU' : ''}]`).join(' + ') || 'none detected';
    electronLog.log(`[KRH] GPU: ${list}${g.summary.hybrid ? ' (hybrid)' : ''} -> profile ${g.setting}/${g.effective}`);
  }
}

// Live frame-cap changes are safe only in sessions launched without
// CustomMaxPendingFrames (cap and deeper frame queue are mutually exclusive —
// depth ≥ 2 decouples the renderer from the paced draw loop) and with the FPS
// uncap active. Otherwise the new value persists and applies next restart.
const launchFrameCap = clampFrameCap(perfConfig.frameCap);
const capLiveAvailable = perfConfig.fpsUnlocked &&
  (launchFrameCap > 0 || !perfConfig.higherMaxFps);
if (launchFrameCap > 0) {
  electronLog.log(`[KRH] FPS cap ${launchFrameCap}, live changes ${capLiveAvailable ? 'enabled' : 'need a restart'}`);
}

// Never override the UA: Krunker falls back to a ~4x slower item-resolution path for any
// UA it can't identify as a browser, costing seconds per spawn with randomised cosmetics.

// ── App identity (must match electron-builder appId for taskbar pin persistence) ──
app.setAppUserModelId('com.krh.client');

// ── Resource swapper protocol (must register before app.ready) ──
initSwapperProtocol();

app.setAsDefaultProtocolClient('krh');

// krh://open is what the website's "Open KRH Client" button uses. It only brings the app to the
// front (no game launch, nothing forwarded to the game window). Starting the app cold with it
// simply opens the hub as usual.
const isOpenOnlyUrl = (url: string): boolean => /^krh:\/\/open\/?(?:[?#].*)?$/i.test(url);

// krh://auth?code=… is how the site sends a Google / Discord login that was done in the system browser
// (login / sign up / link account) back to the client. It is never forwarded to the game window: the hub
// window just opens the site's "finish login" page. A cold start with this link keeps it until the hub exists.
const isAuthUrl = (url: string): boolean => /^krh:\/\/auth(?:[/?#]|$)/i.test(url);
let pendingAuthUrl: string | null = process.argv.find((arg) => typeof arg === 'string' && isAuthUrl(arg)) ?? null;
let handleAuthUrlHook: ((url: string) => void) | null = null;
const handleAuthUrl = (url: string): void => {
  if (handleAuthUrlHook) handleAuthUrlHook(url);
  else pendingAuthUrl = url;
};

let pendingProtocolUrl: string | null = null;
let mainWindowForProtocol: BrowserWindow | null = null;
// Set once the windows exist (launchApp): open the game window / focus whichever KRH window is relevant.
let startGameHook: (() => void) | null = null;
let focusAppHook: (() => void) | null = null;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const krhUrl = argv.find((arg: string) => typeof arg === 'string' && arg.startsWith('krh://'));
    if (krhUrl && isAuthUrl(krhUrl)) {
      handleAuthUrl(krhUrl);
    } else if (!krhUrl || isOpenOnlyUrl(krhUrl)) {
      focusAppHook?.();
    } else {
      startGameHook?.();
      if (mainWindowForProtocol && !mainWindowForProtocol.isDestroyed()) {
        mainWindowForProtocol.show();
        if (mainWindowForProtocol.isMinimized()) mainWindowForProtocol.restore();
        mainWindowForProtocol.focus();
        mainWindowForProtocol.webContents.send('krh-protocol', krhUrl);
      } else {
        pendingProtocolUrl = krhUrl;
      }
    }
  });
}

app.on('open-url', (event, url) => {
  event.preventDefault();
  if (isAuthUrl(url)) {
    handleAuthUrl(url);
  } else if (isOpenOnlyUrl(url)) {
    focusAppHook?.();
  } else if (url.startsWith('krh://')) {
    startGameHook?.();
    if (mainWindowForProtocol && !mainWindowForProtocol.isDestroyed()) {
      mainWindowForProtocol.show();
      mainWindowForProtocol.focus();
      mainWindowForProtocol.webContents.send('krh-protocol', url);
    } else {
      pendingProtocolUrl = url;
    }
  }
});

// ── Ad-blocking URL patterns (matched in C++ layer, never hits JS for non-matches) ──
const BLOCKED_URL_PATTERNS = [
  '*://*.pollfish.com/*',
  '*://www.paypalobjects.com/*',
  '*://fran-cdn.frvr.com/*',
  '*://c.amazon-adsystem.com/*',
  '*://cdn.frvr.com/fran/*',
  '*://cookiepro.com/*',
  '*://*.cookiepro.com/*',
  '*://www.googletagmanager.com/*',
  '*://*.doubleclick.net/*',
  '*://storage.googleapis.com/pollfish_production/*',
  '*://coeus.frvr.com/*',
  '*://apis.google.com/js/platform.js',
  '*://imasdk.googleapis.com/*',
  // Added from Glorp's default blocklist (ads / analytics / dead third-party scripts)
  '*://*.googletagmanager.com/*',
  '*://*.googlesyndication.com/*',
  '*://www.google-analytics.com/*',
  '*://config.aps.amazon-adsystem.com/*',
  '*://securepubads.g.doubleclick.net/*',
  '*://fran-cdn.frvr.com/prebid*',
  '*://cdn.frvr.com/fran/prebid*',
  '*://cdn.ravenjs.com/*',
  '*://*.poll.fish/*',
  '*://unpkg.com/web3*',
  // Twitter widget scripts the game loads for its social embeds (from Krunker Civilian Client 1.3.2)
  '*://*.twitter.com/*',
  '*://platform.twitter.com/*',
  // From NM/NZ Client's list: more consent, ad-network and analytics hosts
  '*://*.onetrust.com/*',
  '*://*.adinplay.com/*',
  '*://*.playwire.com/*',
  '*://*.google-analytics.com/*',
];

// ── Bunny NPC blocklist (mirrors Glorp) ──
// Glorp nullifies these URIs via `request.SetUri(null)` — we emulate by redirecting
// to an empty data URL so Krunker's OBJLoader parses zero geometry (vs cancelling,
// which triggers fallback behavior in Krunker). 60585 is a whole-folder block (all
// file types for that asset id); 618xx are model.obj-only.
const BUNNY_URL_PATTERNS = [
  '*://user-assets.krunker.io/60585/*',
  '*://user-assets.krunker.io/61806/model.obj*',
  '*://user-assets.krunker.io/61814/model.obj*',
  '*://user-assets.krunker.io/61815/model.obj*',
  '*://user-assets.krunker.io/61818/model.obj*',
  '*://user-assets.krunker.io/61820/model.obj*',
  '*://user-assets.krunker.io/61821/model.obj*',
  '*://user-assets.krunker.io/61822/model.obj*',
  '*://user-assets.krunker.io/61823/model.obj*',
  '*://user-assets.krunker.io/61824/model.obj*',
];
const BUNNY_URL_RE = /user-assets\.krunker\.io\/(?:60585\/|(?:61806|61814|61815|61818|61820|61821|61822|61823|61824)\/model\.obj)/;
const EMPTY_RESPONSE_URL = 'data:,';
let hideBunnies = false;

// ── Turf Wars clan banner blocklist ──
// EnvRankBanner props (wall/pole banner variants) placed on official maps to
// show the owning clan. Blocking model.obj drops the whole prop, clan overlay
// included — same empty-redirect trick as the bunnies.
const TURF_BANNER_URL_PATTERNS = [
  '*://user-assets.krunker.io/64295/model.obj*',
  '*://user-assets.krunker.io/64300/model.obj*',
  '*://user-assets.krunker.io/64301/model.obj*',
  '*://user-assets.krunker.io/64303/model.obj*',
];
const TURF_BANNER_URL_RE = /user-assets\.krunker\.io\/(?:64295|64300|64301|64303)\/model\.obj/;
let hideTurfBanners = false;

// ── Video skin blocklist (idea from Kute, see THIRD_PARTY_NOTICES.md) ──
// Animated video skins (Glitch etc.) are .mp4 textures. With "Disable Video Skins" on, the request is
// cancelled so the game never downloads or decodes them. Tutorial videos live elsewhere and are not matched.
const VIDEO_SKIN_URL_RE = /^https?:\/\/(?:assets\.krunker\.io\/videos\/video_[^?#]*\.mp4|user-assets\.krunker\.io\/skins\/[^?#]*\.mp4)/;
let disableVideoSkins = false;

// ── Escape pointer lock fix ──
const ESCAPE_POINTERLOCK_FIX_JS = `
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape' && document.pointerLockElement) {
    document.exitPointerLock();
  }
}, true);`;

// ── Open issue count ──
const ISSUE_COUNT_URL = 'https://api.github.com/search/issues?q=repo:krunkerresourcehub/krh-client+is:issue+is:open&per_page=1';
const ISSUE_COUNT_TTL = 10 * 60 * 1000;
const ISSUE_COUNT_TIMEOUT_MS = 5000;
let issueCount: { value: Promise<number | null>; at: number } | null = null;

function fetchIssueCount(): Promise<number | null> {
  return new Promise((resolve) => {
    const req = httpsGet(ISSUE_COUNT_URL, { headers: { 'User-Agent': 'KRH' } }, (res) => {
      if (res.statusCode !== 200) {
        electronLog.warn('[KRH] Issue count returned status', res.statusCode);
        res.resume();
        resolve(null);
        return;
      }
      res.setEncoding('utf8');
      let body = '';
      res.on('data', (chunk: string) => { body += chunk; });
      res.on('end', () => {
        try {
          const total = JSON.parse(body).total_count;
          resolve(typeof total === 'number' ? total : null);
        } catch (err) {
          electronLog.warn('[KRH] Issue count parse failed:', err);
          resolve(null);
        }
      });
      res.on('error', () => resolve(null));
    });
    req.setTimeout(ISSUE_COUNT_TIMEOUT_MS, () => {
      req.destroy();
      resolve(null);
    });
    req.on('error', (err) => {
      electronLog.warn('[KRH] Issue count fetch failed:', err);
      resolve(null);
    });
  });
}

// The unauthenticated search limit is tight, so cache the promise itself: dedupes concurrent renders and holds a failure for the TTL.
function getIssueCount(): Promise<number | null> {
  if (!issueCount || Date.now() - issueCount.at >= ISSUE_COUNT_TTL) {
    issueCount = { value: fetchIssueCount(), at: Date.now() };
  }
  return issueCount.value;
}

// ── Keybind matching ──
function matchesKeybind(input: { key: string; control: boolean; shift: boolean; alt: boolean }, bind: Keybind | undefined): boolean {
  if (!bind) return false;
  const sameKey = input.key === bind.key
    || (input.key.length === 1 && bind.key.length === 1 && input.key.toLowerCase() === bind.key.toLowerCase());
  return sameKey
    && input.control === bind.ctrl
    && input.shift === bind.shift
    && input.alt === bind.alt;
}

// ── Cached keybinds (avoid re-reading electron-store on every keypress) ──
let cachedKeybinds: Record<string, Keybind> | null = null;

function getKeybinds(): Record<string, Keybind> {
  if (!cachedKeybinds) {
    cachedKeybinds = { ...DEFAULT_KEYBINDS, ...config.get('keybinds') };
  }
  return cachedKeybinds;
}

// ── Debounced window state persistence ──
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function saveWindowState(win: BrowserWindow): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (win.isDestroyed()) return;
    const bounds = win.getBounds();
    config.set('window', {
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
      maximized: win.isMaximized(),
      fullscreen: win.isFullScreen(),
    });
  }, 1000);
}

// Safe mode (see safe-mode.ts): decided once at start, read by the rest of the client.
let safeMode = false;

// A crashed renderer or GPU process counts towards the safe-mode prompt on the next start.
app.on('render-process-gone', (_e, _wc, details) => {
  if (['crashed', 'oom', 'launch-failed', 'integrity-failure'].includes(details.reason)) noteProcessCrash(`Renderer (${details.reason})`);
});
app.on('child-process-gone', (_e, details) => {
  if (details.type === 'GPU' && ['crashed', 'oom', 'launch-failed'].includes(details.reason)) noteProcessCrash(`GPU process (${details.reason})`);
});

app.whenReady().then(async () => {
  electronLog.log('[KRH] App ready');

  // DNS: every lookup of the client (game, hub, updates, mods) goes through DNS-over-HTTPS. This is fixed on
  // purpose and has no setting. Cloudflare is tried first; if it fails, Google DNS takes over. Each service is
  // listed by name and by IP address, so a lookup does not depend on the system DNS to find the DoH server.
  // 'secure' mode means there is never a fallback to the DNS of the system or the provider.
  try {
    app.configureHostResolver({
      enableBuiltInResolver: true,
      secureDnsMode: 'secure',
      secureDnsServers: [
        'https://cloudflare-dns.com/dns-query',
        'https://1.1.1.1/dns-query',
        'https://dns.google/dns-query',
        'https://8.8.8.8/dns-query',
      ],
    });
    electronLog.log('[KRH] DNS: DNS-over-HTTPS, Cloudflare first then Google (secure mode, no system DNS)');
  } catch (err) {
    // Never continue silently on another resolver: the DNS is meant to be Cloudflare/Google DoH or nothing.
    electronLog.error('[KRH] Could not enable secure DNS, quitting:', (err as Error).message);
    app.quit();
    return;
  }

  // macOS: opt out of App Nap / timer coalescing for the whole app lifetime.
  // Finder/LaunchServices-launched instances get app-role scheduling (App Nap
  // eligibility, coalesced timers, E-core steering for lower-QoS threads) that
  // degrades input/present pacing — the same build launched as a terminal child
  // consistently felt better (2026-07-08 investigation; probe-invisible, i.e.
  // below the page: present-to-glass level). prevent-app-suspension maps to
  // NSActivityUserInitiated. Held until process exit by design; no matching stop().
  if (process.platform === 'darwin') {
    powerSaveBlocker.start('prevent-app-suspension');
    electronLog.log('[KRH] App Nap / timer coalescing opt-out active (darwin)');
  }

  // ── Branded splash ──
  // Shows the KRH poster art through the update check and the initial game load, and
  // hosts the update prompts/progress so startup is one uniform window. Closing it
  // before the main window exists quits the app (window-all-closed).
  createSplash(appVersion);

  // Crash-loop guard: decides between normal and safe mode before any feature loads
  await beginLaunchGuard();
  safeMode = isSafeMode();
  if (!splashAlive()) return; // closed while the safe-mode dialog was open

  // ── Update check ──
  // Only Windows NSIS self-installs: the Setup.exe swaps the app while it's closed.
  // macOS, Linux (AppImage), and Windows-portable can't swap a running app, so they
  // show a notice linking the release page for a manual download. Dev builds skip.
  const isPortable = !!process.env.PORTABLE_EXECUTABLE_DIR;
  const isAppImage = !!process.env.APPIMAGE;
  const isDev = !app.isPackaged;
  const isNsisInstall = !isDev && process.platform === 'win32' && !isPortable && !isAppImage;
  // What an earlier lite update left behind (previous app.asar, files staged but never used).
  if (isNsisInstall) cleanupLite();

  if (isDev) {
    electronLog.log('[KRH] Skipping update check (dev mode)');
  } else if (isNsisInstall && (config.get('extras') as Partial<ExtrasConfig> | undefined)?.updateMode === 'background') {
    electronLog.log('[KRH] Update mode is background: no check at launch (see update-manager.ts)');
  } else if (isNsisInstall) {
    try {
      electronLog.log('[KRH] Checking for updates...');
      splashStatus('Checking for updates...', -1);
      const update = await checkForUpdate(appVersion);
      if (!splashAlive()) return; // user closed the splash — app is quitting
      const skippedVer = config.get('ui')?.skippedUpdateVersion || '';
      if (update && update.version === skippedVer) {
        electronLog.log(`[KRH] Update v${update.version} available but skipped by user preference`);
      } else if (update) {
        electronLog.log(`[KRH] Update available: v${update.version}`);

        const choice = await splashPrompt('install', update.version, appVersion, update.notes);
        if (choice === 'closed') return; // app is quitting
        if (choice === 'secondary' || choice === 'secondary-skip') {
          electronLog.log('[KRH] User skipped update');
          if (choice === 'secondary-skip') {
            config.set('ui', { ...DEFAULT_CONFIG.ui, ...config.get('ui'), skippedUpdateVersion: update.version });
          }
        } else {
          // Lite update first: only app.asar (a few MB) instead of the whole installer, and nothing new to run, so
          // Windows Smart App Control has nothing to block. Anything unexpected falls through to the installer below.
          splashStatus('Downloading update... 0%', 0);
          const lite = await updateWithoutInstaller(update.version, (pct) => {
            splashStatus(pct >= 100 ? 'Verifying download...' : `Downloading update... ${pct}%`, pct >= 100 ? -1 : pct);
          });
          if (!splashAlive()) return; // closed during the download: the app is quitting
          if (lite) {
            splashStatus('Installing update...', -1);
            applyLiteAndRelaunch();
            return; // the swap happens at the very end of quitting, then the client starts again
          }

          const tempDir = join(app.getPath('temp'), 'krh-update');
          if (!existsSync(tempDir)) mkdirSync(tempDir, { recursive: true });
          const installerPath = join(tempDir, `KRH-${update.version}-Setup.exe`);

          try {
            splashStatus('Downloading update... 0%', 0);
            await downloadUpdate(update.downloadUrl, installerPath, (pct) => {
              // At 100% the bytes are down but downloadUpdate is still hashing the file,
              // so show "Verifying" + an indeterminate sweep instead of a stuck 100%.
              // splashStatus no-ops once the splash is gone.
              splashStatus(pct >= 100 ? 'Verifying download...' : `Downloading update... ${pct}%`, pct >= 100 ? -1 : pct);
            }, update.sha256);

            // Closing the splash mid-download is the cancel path (it also quits
            // the app via window-all-closed, since no other window exists yet).
            if (!splashAlive()) return;
            splashStatus('Installing update...', -1);
            installUpdate(installerPath);
            return; // installUpdate spawns the installer and quits the app
          } catch (err) {
            electronLog.error('[KRH] Update download/install failed:', err);
            const splashWin = getSplash();
            if (!splashWin) return; // splash gone — app is quitting
            splashStatus('Update failed');
            // The user accepted this update — surface the failure instead of silently
            // launching the old version, which would just repeat the prompt next launch.
            const detail = (err as Error).message || String(err);
            const { response } = await dialog.showMessageBox(splashWin, {
              type: 'error',
              title: 'Update failed',
              message: `The update to v${update.version} could not be installed.`,
              detail: `${detail}\n\nYou can download it manually from the releases page — the current version keeps working in the meantime.`,
              buttons: ['Open Releases Page', 'Continue'],
              defaultId: 1,
              cancelId: 1,
            });
            if (response === 0) await shell.openExternal(RELEASES_URL).catch(() => { });
          }
        }
      } else {
        electronLog.log('[KRH] No updates available');
      }
    } catch (err) {
      electronLog.error('[KRH] Update check failed:', err);
    }
  } else {
    // macOS (DMG) / Linux (AppImage) / Windows portable: can't self-install — just
    // notify and link to the release page so the user can grab the right download.
    try {
      electronLog.log('[KRH] Checking for updates (notify-only)...');
      splashStatus('Checking for updates...', -1);
      const notice = await checkForUpdateNotice(appVersion);
      if (!splashAlive()) return; // user closed the splash — app is quitting
      const skippedVer = config.get('ui')?.skippedUpdateVersion || '';
      if (notice && notice.version === skippedVer) {
        electronLog.log(`[KRH] Update v${notice.version} available but skipped by user preference`);
      } else if (notice) {
        electronLog.log(`[KRH] Update available (notify-only): v${notice.version}`);
        const choice = await splashPrompt('notice', notice.version, appVersion, notice.notes);
        if (choice === 'closed') return; // app is quitting
        if (choice === 'secondary-skip') {
          config.set('ui', { ...DEFAULT_CONFIG.ui, ...config.get('ui'), skippedUpdateVersion: notice.version });
        }
        if (choice === 'primary') {
          // Open the release page and quit instead of launching the old version.
          electronLog.log('[KRH] User chose to download update; opening release page and quitting');
          await shell.openExternal(notice.releaseUrl).catch(() => { });
          app.quit();
          return;
        }
      } else {
        electronLog.log('[KRH] No updates available');
      }
    } catch (err) {
      electronLog.error('[KRH] Update notice check failed:', err);
    }
  }

  if (!splashAlive()) return; // user closed the splash — app is quitting
  splashStatus('Loading KRH Client...', -1);
  await launchApp();
});

async function launchApp(): Promise<void> {
  electronLog.log('[KRH] Starting initialization');

  // Invariant: the splash window is still open here and stays open until the main
  // window's first page load finishes. At least one window must exist at every point
  // of startup — window-all-closed quits the app.

  // ── Session: persistent partition ──
  const ses = session.fromPartition('persist:krunker');

  // ── Resource swapper ──
  const swapperConfig = config.get('swapper');
  const swapDir = swapperConfig.path || join(app.getPath('userData'), 'KRH Client', 'swapper');
  // Ensure swap subdirectories exist (themes/, backgrounds/, socialthemes/, skies/)
  for (const sub of [GAME_THEMES_DIR, 'backgrounds', SOCIAL_THEMES_DIR, SKIES_DIR]) {
    const dir = join(swapDir, sub);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  registerSwapperFileProtocol(ses, swapDir);

  // The swapper also runs for switched-on resource packs, even when the user's own swapper folder is off.
  const startupPacks = safeMode ? [] : (((config.get('extras') as Partial<ExtrasConfig> | undefined)?.packs?.enabled) || []);
  // Always on (like Krunker Civilian Client 1.3.2): any file in the swapper folder loads, changes apply without a restart
  const userSwapper = !safeMode;
  const swapper = userSwapper || startupPacks.length ? new ResourceSwapper(swapDir, { userFiles: userSwapper, packs: startupPacks }) : null;
  electronLog.log(`[KRH] Resource swapper: ${swapper ? 'enabled' : 'disabled'} (${swapDir}), packs: ${startupPacks.length}${safeMode ? ' [safe mode]' : ''}`);

  // ── Userscript manager ──
  const usConfig = config.get('userscripts') || { enabled: true, path: '' };
  const usDir = usConfig.path || join(app.getPath('userData'), 'KRH Client');
  const userscriptManager = usConfig.enabled && !safeMode ? new UserscriptManager(usDir) : null;
  // Switches off a userscript that crashes or hangs the game right after it was added or changed.
  const scriptGuard = userscriptManager ? new UserscriptGuard(join(app.getPath('userData'), 'KRH Client', 'userscript-health.json'), userscriptManager) : null;
  let healthyTimer: NodeJS.Timeout | null = null;
  // Any number of user .css files, each with its own on/off switch (Dashboard > Custom CSS)
  const userCss = new UserCssManager(join(app.getPath('userData'), 'KRH Client', 'user-css'));
  electronLog.log(`[KRH] Userscripts: ${userscriptManager ? 'enabled' : 'disabled'} (${usDir})`);

  // ── Ad blocking + resource swapper (single onBeforeRequest — Electron only allows one) ──
  // The broad *://*.krunker.io/* pattern lets the swapper intercept any krunker asset.
  // swapper.getRedirect() returns null before its async scan completes, so swapped
  // resources simply pass through until the scan finishes — no re-registration needed.
  const gameConf = config.get('game');
  hideBunnies = gameConf?.hideBunnies ?? false;
  hideTurfBanners = gameConf?.hideTurfBanners ?? false;
  disableVideoSkins = (config.get('extras') as Partial<ExtrasConfig> | undefined)?.disableVideoSkins === true;
  // *://* matches only http/https — wss needs an explicit pattern so the
  // webRequest handler fires on WebSocket upgrades for direct-ping detection.
  const userBlock = loadBlocklist(BLOCKED_URL_PATTERNS, (m) => electronLog.warn(m));
  if (userBlock.extra.length) electronLog.log(`[KRH] User blocklist: ${userBlock.extra.length} extra pattern(s)`);
  const requestFilterUrls = [
    ...userBlock.defaults,
    ...userBlock.extra,
    ...BUNNY_URL_PATTERNS,
    ...TURF_BANNER_URL_PATTERNS,
    '*://*.krunker.io/*',
    'wss://*.krunker.io/*',
  ];

  ses.webRequest.onBeforeRequest({ urls: requestFilterUrls }, (details, callback) => {
    // Direct ping: detect game-server WebSocket (lobby-* host) and start TCP timing.
    if (details.resourceType === 'webSocket' && details.url.includes('lobby-')) {
      try {
        const u = new URL(details.url);
        const port = u.port ? parseInt(u.port) : (u.protocol === 'wss:' ? 443 : 80);
        const wc = details.webContentsId != null ? webContents.fromId(details.webContentsId) : null;
        const w = wc ? BrowserWindow.fromWebContents(wc) : null;
        if (w) setPingTarget(u.hostname, port, w);
      } catch { /* invalid URL — ignore */ }
    }
    // User blocklist (user_blocklist.json) — also blocks krunker.io URLs, which the ad-block path below lets through
    if (userBlock.extraRe && userBlock.extraRe.test(details.url)) return callback({ cancel: true });
    // Video skins (.mp4 textures): cancel the request when the option is on
    if (disableVideoSkins && VIDEO_SKIN_URL_RE.test(details.url)) return callback({ cancel: true });
    // Bunny NPC block — redirect to empty body (matches Glorp's SetUri(null))
    if (hideBunnies && BUNNY_URL_RE.test(details.url)) {
      return callback({ redirectURL: EMPTY_RESPONSE_URL });
    }
    // Turf Wars clan banner block — same empty-body redirect
    if (hideTurfBanners && TURF_BANNER_URL_RE.test(details.url)) {
      return callback({ redirectURL: EMPTY_RESPONSE_URL });
    }
    // Sky dome texture — redirect the sentinel asset to the user's local image.
    // Config is read here rather than cached: this fires once per map load.
    if (SKY_TEXTURE_RE.test(details.url)) {
      const skyFile = resolveSkyImage(config.get('ui')?.skyImage || '', swapDir);
      if (skyFile) return callback({ redirectURL: filePathToSwapURL(skyFile) });
    }
    // Check swapper next — redirect matching assets to local files
    if (swapper) {
      const redirect = swapper.getRedirect(details.url);
      if (redirect) return callback({ redirectURL: redirect });
    }
    // Determine if this URL is a krunker.io request (matched by the broad swapper pattern)
    // vs an ad-block pattern. krunker.io requests that weren't swapped pass through normally.
    try {
      if (isKrunkerHost(new URL(details.url).hostname)) return callback({});
    } catch { /* invalid URL — fall through to cancel */ }
    // Matched an ad-block pattern — cancel it
    callback({ cancel: true });
  });

  if (swapper) {
    swapper.waitForReady().then(() => {
      electronLog.log(`[KRH] Swapper ready: ${swapper.patterns.length} pattern(s)`);
    });
  }

  // ── CORS fix for swapped resources ──
  if (swapper) {
    ses.webRequest.onHeadersReceived(({ responseHeaders }, callback) => {
      if (!responseHeaders) return callback({});
      for (const key in responseHeaders) {
        const lowercase = key.toLowerCase();
        if (lowercase === 'access-control-allow-credentials' && responseHeaders[key][0] === 'true') {
          return callback({ responseHeaders });
        }
        if (lowercase === 'access-control-allow-origin') {
          delete responseHeaders[key];
          break;
        }
      }
      return callback({
        responseHeaders: { ...responseHeaders, 'access-control-allow-origin': ['*'] },
      });
    });
  }

  // ── Restore saved window bounds ──
  const savedWindow = config.get('window');

  const win = new BrowserWindow({
    width: savedWindow.width,
    height: savedWindow.height,
    x: savedWindow.x,
    y: savedWindow.y,
    frame: true,
    show: false,
    backgroundColor: '#000000',
    icon: devWindowIcon(),
    webPreferences: {
      preload: join(__dirname, '..', 'preload', 'index.js'),
      session: ses,
      contextIsolation: false,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });

  // ── KRH Hub (first screen) + lazy game window ──
  // On launch the Krunker Resource Hub opens first. The game window (`win`, the KCC-based Krunker
  // client) stays hidden and unloaded until Play is pressed on the hub. Editor / Games / Viewer /
  // Docs / Guides open in their own window.
  let appQuitting = false;
  app.on('before-quit', () => { appQuitting = true; stopRecording(); stopReplayBuffer(); });

  // Restart that really restarts: the new process must not start while this one still holds the single-instance
  // lock (it would quit at once and nothing would come back), so the lock is released and this process exits now.
  const relaunchApp = (flush = true): void => {
    if (flush) flushPendingConfigWrites();
    app.releaseSingleInstanceLock();
    const portable = process.env.PORTABLE_EXECUTABLE_FILE;
    const appImage = process.env.APPIMAGE;
    if (portable) app.relaunch({ execPath: portable, args: process.argv.slice(1) });
    else if (appImage) app.relaunch({ execPath: appImage, args: process.argv.slice(1).filter((a) => a !== appImage) });
    else app.relaunch();
    app.exit(0);
  };
  let gameActive = false;
  let dashboardHintShown = false;
  // Never destroy the dashboard from inside one of its own event / IPC handlers: let that handler finish first.
  const closeDashLater = (): void => { setImmediate(() => closeDashboard()); };
  // Anti-hack lockdown (see integrity.ts). Starts locked when the last run ended locked, until the first check clears it.
  let lockedDown = readLock() !== null;
  let lockWin: BrowserWindow | null = null;
  let lockReason = readLock()?.reason ?? '';
  let showLockWindow: () => void = () => { /* set below */ };

  // ── Twitch chat (read-only overlay; connects only while the game window is open) ──
  // "!link": viewers type it in your chat and get the link of the game you are in (idea from the LaF Client).
  const LINK_USER_COOLDOWN_MS = 15_000;
  const linkCooldown = new Map<string, number>();
  let streamLive: boolean | null = null; // null = not known yet
  const twitchLink = new TwitchLinkBot((text) => { if (!win.isDestroyed()) win.webContents.send('twitch-link-notice', text); });
  const onLinkRequest = (login: string, text: string): void => {
    if (text.trim().toLowerCase() !== '!link') return;
    const conf = config.get('twitch');
    if (!gameActive || !conf?.enabled || !conf.linkCommand || !twitchLink.isReady) return;
    if (conf.linkOnlyLive !== false && streamLive === false) return;
    if (!/^[a-z0-9_]{1,25}$/i.test(login)) return;
    const url = win.isDestroyed() ? '' : win.webContents.getURL();
    // Only real match links: https://krunker.io/?game=REGION:id
    if (!isKrunkerPage(url) || !/[?&]game=[A-Za-z0-9:_-]+/.test(url)) return;
    const now = Date.now();
    const key = login.toLowerCase();
    if (now - (linkCooldown.get(key) ?? 0) < LINK_USER_COOLDOWN_MS) return;
    if (twitchLink.say(`@${login} ${url}`)) {
      linkCooldown.set(key, now);
      if (linkCooldown.size > 200) for (const [k, t] of linkCooldown) if (now - t > LINK_USER_COOLDOWN_MS) linkCooldown.delete(k);
    }
  };
  const twitchChat = new TwitchChat({
    onMessage: (m) => { if (!win.isDestroyed()) win.webContents.send('twitch-message', m); },
    onStatus: (st) => { if (!win.isDestroyed()) win.webContents.send('twitch-status', st); },
    onStream: (info) => { streamLive = info.live; if (!win.isDestroyed()) win.webContents.send('twitch-stream', info); },
    onChatLine: onLinkRequest,
  });
  const applyTwitch = (conf: Partial<TwitchConfig> | undefined): void => {
    const channel = normalizeChannel(conf?.channel);
    if (gameActive && conf?.enabled && channel) twitchChat.connect(channel, conf.thirdPartyEmotes !== false);
    else { twitchChat.disconnect(); streamLive = null; }
    // The sending side of !link: only connected while the command is on, the chat is on and a token is saved.
    const token = gameActive && conf?.enabled && channel && conf.linkCommand === true ? loadTwitchBotToken() : '';
    twitchLink.configure(token ? channel : '', token);
  };
  ipcMain.handle('twitch-link-status', () => ({ hasToken: !!loadTwitchBotToken() }));
  ipcMain.handle('twitch-link-save-token', (e, raw: unknown) => {
    if (e.sender !== win.webContents) return { ok: false, error: 'Open Settings inside the game window.' };
    const token = normalizeTwitchBotToken(raw);
    if (!token) return { ok: false, error: 'That does not look like a Twitch OAuth token.' };
    saveTwitchBotToken(token);
    applyTwitch(config.get('twitch'));
    return { ok: true };
  });
  ipcMain.on('twitch-link-clear-token', (e) => {
    if (e.sender !== win.webContents) return;
    saveTwitchBotToken('');
    applyTwitch(config.get('twitch'));
  });
  ipcMain.handle('twitch-emote', (_e, url: unknown) => (typeof url === 'string' ? fetchEmoteImage(url) : null));

  // ── Spotify now-playing (official Web API; polls only while the game window is open) ──
  const spotify = new Spotify({
    onState: (st) => { if (!win.isDestroyed()) win.webContents.send('spotify-state', st); },
    onNotice: (text) => { if (!win.isDestroyed()) win.webContents.send('spotify-notice', text); },
  });
  const applySpotify = (conf: Partial<SpotifyConfig> | undefined): void => {
    if (gameActive && conf?.enabled) spotify.startPolling();
    else spotify.stopPolling();
  };
  ipcMain.handle('spotify-art', (_e, url: unknown) => (typeof url === 'string' ? fetchSpotifyArt(url) : null));
  ipcMain.handle('spotify-get-state', () => spotify.getState());
  ipcMain.handle('spotify-status', () => ({ connected: spotify.connected }));
  ipcMain.handle('spotify-connect', async (e, clientId: unknown) => {
    if (e.sender !== win.webContents) return { ok: false, error: 'Open Settings inside the game window to connect Spotify.' };
    const r = await spotify.connect(typeof clientId === 'string' ? clientId : '');
    if (r.ok) applySpotify(config.get('spotify'));
    return r;
  });
  ipcMain.on('spotify-disconnect', (e) => {
    if (e.sender !== win.webContents) return;
    spotify.disconnect();
    applySpotify(config.get('spotify')); // keep showing what plays on this PC (no login needed)
  });
  ipcMain.on('spotify-control', (e, action: unknown) => {
    if (e.sender !== win.webContents || !gameActive) return;
    if (action === 'toggle' || action === 'next' || action === 'previous') void spotify.control(action as SpotifyAction);
  });
  // Instant replay: keeps the newest seconds of the game in memory (see recorder.ts). Runs only while the game is open.
  const applyReplay = (): void => {
    const ir = getExtras().instantReplay;
    if (gameActive && ir.enabled && !safeMode && !win.isDestroyed()) {
      setReplaySeconds(ir.seconds);
      if (!replayActive()) void startReplayBuffer(win, ir.seconds);
    } else if (replayActive()) {
      stopReplayBuffer();
    }
  };
  const showGameWindow = (): void => {
    if (win.isDestroyed()) return;
    if (!win.isVisible()) {
      if (savedWindow.fullscreen) win.setFullScreen(true);
      else if (savedWindow.maximized) win.maximize();
      win.show();
      applyDisplayMode(getExtras().displayMode, true);
    }
    showWindow(win);
  };
  const launchGame = (url: string = 'https://krunker.io'): void => {
    if (lockedDown) { showLockWindow(); return; }
    if (win.isDestroyed()) return;
    if (!gameActive) {
      gameActive = true;
      if (scriptGuard) {
        void scriptGuard.beginSession();
        if (healthyTimer) clearTimeout(healthyTimer);
        healthyTimer = setTimeout(() => { void scriptGuard.markHealthy(); }, 5 * 60_000);
      }
      win.webContents.setAudioMuted(false);
      void win.loadURL(url);
      applyTwitch(config.get('twitch'));
      applySpotify(config.get('spotify'));
      setTimeout(() => applyReplay(), 8000); // after the first page has loaded
      // One reminder per session that the dashboard is one key away (it is hidden while you play).
      if (!dashboardHintShown) {
        dashboardHintShown = true;
        setTimeout(() => {
          const k = getKeybinds().dashboard;
          const name = [k.ctrl ? 'Ctrl' : '', k.alt ? 'Alt' : '', k.shift ? 'Shift' : '', k.key.length === 1 ? k.key.toUpperCase() : k.key].filter(Boolean).join('+');
          if (!win.isDestroyed() && gameActive) win.webContents.send('krh-toast', `KRH Dashboard: press ${name} to open it over the game`);
        }, 9000);
      }
    } else if (url !== 'https://krunker.io') {
      void win.loadURL(url); // a specific game link (e.g. from the editor or a join link)
    }
    showGameWindow();
    // The KRH window is hidden as soon as the game starts (it is frozen while hidden, so it costs
    // nothing). Ctrl+H (rebindable) brings it back over the game without closing the game.
    if (!hub.isDestroyed()) {
      hub.setAlwaysOnTop(false);
      hub.hide();
    }
    // The dashboard is closed while you play (no extra window / process next to the game); the dashboard key and
    // the end of the game open it again.
    closeDashLater();
  };

  // Open / hide the KRH window while the game keeps running.
  const toggleHub = (): void => {
    if (lockedDown) { showLockWindow(); return; }
    if (hub.isDestroyed()) return;
    if (!gameActive) { showWindow(hub); return; }
    if (hub.isVisible() && hub.isFocused()) {
      hub.setAlwaysOnTop(false);
      hub.hide();
      if (!win.isDestroyed()) showWindow(win);
      return;
    }
    // Float above the (possibly fullscreen) game until the user goes back to it.
    hub.setAlwaysOnTop(true, 'floating');
    void setHubSuspended(hub, false);
    showWindow(hub);
  };

  const hubLinkHandlers = {
    onPlay: (url: string) => launchGame(url),
    onOpenWindow: (url: string) => { tabManager.openTab(url); },
    onExternal: (url: string) => safeOpenExternal(url),
    onOpenSiteWindow: (url: string) => openSiteWindow(url, hubLinkHandlers),
  };
  const hub = createHubWindow({
    version: appVersion,
    onPlay: (url) => launchGame(url),
    onOpenWindow: (url) => { tabManager.openTab(url); },
    onOpenSiteWindow: (url) => openSiteWindow(url, hubLinkHandlers),
    onExternal: (url) => safeOpenExternal(url),
    isGameVisible: () => !win.isDestroyed() && (win.isVisible() || win.isMinimized()),
    isQuitting: () => appQuitting,
    isHubToggleKey: (input) => matchesKeybind(input, getKeybinds().hubToggle),
    onHubToggle: toggleHub,
    isDashboardKey: (input) => matchesKeybind(input, getKeybinds().dashboard),
    onDashboardToggle: () => toggleDash(),
    onHidden: () => { if (!(gameActive && !win.isDestroyed() && win.isVisible())) openDash(); },
  });
  hub.on('blur', () => { if (!hub.isDestroyed()) hub.setAlwaysOnTop(false); });

  // A userscript that crashes or hangs the game right after it was added or changed is switched off and the game reloads.
  const handleGameFailure = async (reason: string): Promise<void> => {
    if (!scriptGuard || !gameActive || win.isDestroyed()) return;
    const names = await scriptGuard.failure(reason);
    if (names.length === 0) return;
    electronLog.warn(`[KRH] Userscript guard: ${reason}; turned off ${names.join(', ')}`);
    win.webContents.reload();
    setTimeout(() => {
      if (!win.isDestroyed()) win.webContents.send('krh-toast', `Turned off ${names.join(', ')}: ${reason}. Dashboard > Home has the details.`);
    }, 6000);
  };
  win.webContents.on('render-process-gone', (_e, details) => {
    if (details.reason !== 'clean-exit') void handleGameFailure(`the game crashed (${details.reason})`);
  });
  win.on('unresponsive', () => {
    if (scriptGuard && scriptGuard.sessionAgeSec() < 180) void handleGameFailure('the game stopped responding');
  });
  ipcMain.on('userscript-error', (_e, file: unknown) => {
    if (!scriptGuard || typeof file !== 'string' || file.length > 200) return;
    void scriptGuard.loadError(file).then((off) => {
      if (off && !win.isDestroyed()) win.webContents.send('krh-toast', `Turned off ${off}: it failed with an error on 3 launches in a row.`);
    });
  });

  // While you play the KRH website window is hidden and frozen. After a short while its page is unloaded too
  // (about:blank), so no website code, animation or memory stays alive next to the game. It loads again when the
  // window is shown (Ctrl+H) or when the game closes.
  let hubParkedUrl: string | null = null;
  let hubParkTimer: NodeJS.Timeout | null = null;
  const parkHub = (): void => {
    hubParkTimer = null;
    if (hub.isDestroyed() || !gameActive || hub.isVisible()) return;
    const u = hub.webContents.getURL();
    if (!/^https?:/.test(u)) return;
    hubParkedUrl = u;
    void setHubSuspended(hub, false).then(() => { if (!hub.isDestroyed()) void hub.loadURL('about:blank'); });
  };
  const unparkHub = (): void => {
    if (hubParkTimer) { clearTimeout(hubParkTimer); hubParkTimer = null; }
    if (!hubParkedUrl || hub.isDestroyed()) return;
    const u = hubParkedUrl;
    hubParkedUrl = null;
    void hub.loadURL(u);
  };
  hub.on('hide', () => {
    if (!gameActive) return;
    if (hubParkTimer) clearTimeout(hubParkTimer);
    hubParkTimer = setTimeout(parkHub, 15_000);
  });
  hub.on('show', unparkHub);
  hub.on('restore', unparkHub);
  // Inside the client the website's endless background loops stay off: with the FPS limit removed every window that
  // is animating renders as fast as it can.
  hub.webContents.on('dom-ready', () => {
    void hub.webContents.insertCSS('html::before,html::after,.brand-logo,.dot,.code,.logo-frame{animation:none !important}').catch(() => { /* page gone */ });
  });
  // Background updates (Settings > Extras > Updates): quiet download, then a "Restart to update" badge in the hub
  wireHubBadge(hub);
  startBackgroundUpdates({
    appVersion,
    settings: () => ({ mode: getExtras().updateMode, installOnQuit: getExtras().updateInstallOnQuit }),
    skippedVersion: () => config.get('ui')?.skippedUpdateVersion || '',
    hub: () => (hub.isDestroyed() ? null : hub),
    toastGame: (m) => { if (gameActive && !win.isDestroyed()) win.webContents.send('krh-toast', m); },
  }, app.isPackaged && process.platform === 'win32' && !process.env.PORTABLE_EXECUTABLE_DIR && !process.env.APPIMAGE);
  // Game window focused -> freeze the hub; hub focused -> it resumes itself (see hub-window.ts).
  win.on('focus', () => {
    if (gameActive && !hub.isDestroyed()) void setHubSuspended(hub, true);
    // Back in the game: the dashboard goes away again (a hidden window is not drawn, so it costs nothing).
    if (gameActive && isDashboardVisible()) closeDashLater();
  });
  startGameHook = () => launchGame();
  // Website login finished in the browser -> bring the hub forward and let the site finish it.
  handleAuthUrlHook = (url: string) => {
    const target = authDeepLinkToHubUrl(url);
    if (!target || hub.isDestroyed()) return;
    void hub.loadURL(target);
    showWindow(hub);
  };
  if (pendingAuthUrl) {
    const u = pendingAuthUrl;
    pendingAuthUrl = null;
    handleAuthUrlHook(u);
  }
  focusAppHook = () => {
    if (!win.isDestroyed() && (win.isVisible() || win.isMinimized())) showWindow(win);
    else openDash();
  };

  // Same path as Settings > General > Settings Profiles > Load: Krunker's own import validates the text.
  async function loadProfileIntoGame(name: string): Promise<boolean> {
    if (!gameActive || win.isDestroyed()) return false;
    const p = (config.get('extras')?.settingsProfiles ?? []).find((x) => x.name === name);
    if (!p) return false;
    const ok = await win.webContents.executeJavaScript(`new Promise((resolve) => {
      const w = window;
      if (typeof w.importSettingsPopup !== 'function' || typeof w.importSettings !== 'function') { resolve(false); return; }
      w.importSettingsPopup(1);
      setTimeout(() => {
        const box = document.getElementById('importTxt');
        if (!box) { resolve(false); return; }
        box.value = ${JSON.stringify(p.data)};
        w.importSettings(1);
        resolve(true);
      }, 150);
    })`).catch(() => false);
    return ok === true;
  }

  // ── KRH Dashboard window (Scripts, Custom CSS, Resource Swapper, Settings) ──
  const openDash = (): void => {
    if (lockedDown) { showLockWindow(); return; }
    openDashboard({
      version: appVersion,
      swapDir,
      prefsPath: join(app.getPath('userData'), 'KRH Client', 'dashboard.json'),
      userCss,
      userscripts: userscriptManager,
      onCssChanged: () => { applyUserCss(); },
      play: () => { if (gameActive && !win.isDestroyed()) showWindow(win); else launchGame(); },
      playUrl: (url) => launchGame(url),
      openHub: () => { if (!hub.isDestroyed()) { void setHubSuspended(hub, false); showWindow(hub); } },
      openWindow: (url) => { tabManager.openTab(url); },
      openGameSettings: () => {
        if (!gameActive || win.isDestroyed()) { launchGame(); return; }
        showWindow(win);
        // Krunker's settings window, on the last tab (the Client tab). Best effort: harmless if the page is not ready.
        win.webContents.executeJavaScript(`(() => { try { const w = window; w.showWindow(1); const sw = w.windows[0]; sw.changeTab(sw.tabs[sw.settingType].length - 1); } catch (e) {} })()`).catch(() => { /* page not ready */ });
      },
      restartClient: () => { relaunchApp(); },
      reloadGame: () => {
        if (!gameActive || win.isDestroyed()) return false;
        win.webContents.reload();
        return true;
      },
      quitWhenClosed: () => !(gameActive && !win.isDestroyed() && win.isVisible()) && !(!hub.isDestroyed() && hub.isVisible()),
      clearCache: async () => { await ses.clearCache(); },
      clearData: async () => {
        try { win.webContents.stop(); } catch { /* already gone */ }
        // Cookies, local/session storage, IndexedDB and cache of the Krunker session only; the client's own settings stay.
        await ses.clearStorageData();
        await ses.clearCache();
        if (!win.isDestroyed()) win.webContents.reload();
      },
      openExternal: (url) => safeOpenExternal(url),
      parent: () => (win.isDestroyed() ? null : win),
      gameVisible: () => gameActive && !win.isDestroyed() && win.isVisible(),
      isToggleKey: (input) => matchesKeybind(input, getKeybinds().dashboard),
      toggle: () => toggleDash(),
      extra: {
        dataPath: join(app.getPath('userData'), 'KRH Client', 'dashboard-data.json'),
        version: appVersion,
        buildSystemInfo: () => buildSystemInfo(),
        logTail: () => {
          try { return readFileSync(getLogPath(), 'utf-8').split('\n').slice(-60).join('\n'); } catch { return ''; }
        },
        copyText: (text) => clipboard.writeText(text),
        getPings: (force) => (force || Object.keys(pingCache).length === 0 ? refreshRegionPings() : Promise.resolve(pingCache)),
        getMatchmakerRegions: () => config.get('matchmaker')?.regions ?? [],
        setMatchmakerRegions: (regions) => config.set('matchmaker', { ...DEFAULT_CONFIG.matchmaker, ...config.get('matchmaker'), regions }),
        currentGameUrl: () => (gameActive && !win.isDestroyed() ? win.webContents.getURL() : null),
        launchGame: (url) => launchGame(url),
        profiles: () => (config.get('extras')?.settingsProfiles ?? []).map((p) => p.name),
        saveProfile: async (name) => {
          if (!gameActive || win.isDestroyed()) return false;
          const data = await win.webContents.executeJavaScript(`(() => { try { const r = window.exportSettings(1); return typeof r === 'string' ? r : ''; } catch (e) { return ''; } })()`).catch(() => '');
          if (typeof data !== 'string' || data === '') return false;
          const ex = { ...DEFAULT_CONFIG.extras, ...config.get('extras') };
          const list = ex.settingsProfiles.filter((p) => p.name !== name);
          if (list.length >= 30) return false;
          config.set('extras', { ...ex, settingsProfiles: [...list, { name, data }] });
          return true;
        },
        applyProfile: (name) => loadProfileIntoGame(name),
        deleteProfile: (name) => {
          const ex = { ...DEFAULT_CONFIG.extras, ...config.get('extras') };
          const next = ex.settingsProfiles.filter((p) => p.name !== name);
          if (next.length === ex.settingsProfiles.length) return false;
          config.set('extras', { ...ex, settingsProfiles: next });
          return true;
        },
        applyLowEndAndRestart: () => { applyLowEndPreset(); relaunchApp(); },
        perfDoctor: () => runPerfDoctor({
          performance: () => (config.get('performance') ?? {}) as { fpsUnlocked?: boolean; frameCap?: number; cpuThrottle?: number; cpuThrottleMenu?: number; processPriority?: string },
          advanced: () => (config.get('advanced') ?? {}) as { gpuProfile?: string; ignoreDisplayScaling?: boolean; perfTweaks?: boolean },
          instantReplayOn: () => (config.get('extras') as Partial<ExtrasConfig> | undefined)?.instantReplay?.enabled === true,
          gameActive: () => gameActive,
          gameWindow: () => (win.isDestroyed() ? null : win),
          version: appVersion,
        }),
        news: (force) => getKrunkerNews(join(app.getPath('userData'), 'KRH Client', 'news-feed-cache.json'), force),
        openHubRoute: (route) => {
          if (hub.isDestroyed()) return;
          hubParkedUrl = null;
          void setHubSuspended(hub, false);
          void hub.loadURL(HUB_URL + '#' + route);
          showWindow(hub);
        },
        scriptGuard: {
          list: () => (scriptGuard ? scriptGuard.list() : []),
          reenable: async (file) => (scriptGuard ? scriptGuard.reenable(file) : false),
          dismiss: (file) => { scriptGuard?.dismiss(file); },
        },
        checkUpdates: async () => ({ latest: (await checkForUpdate(appVersion))?.version ?? null }),
        diagnoseUpdates: async () => {
          const ui = config.get('ui');
          const install = process.env.PORTABLE_EXECUTABLE_DIR ? 'portable' : process.env.APPIMAGE ? 'appimage' : (process.platform === 'win32' && app.isPackaged ? 'installer' : 'other');
          const d = await diagnoseUpdate(appVersion, { updateMode: String(config.get('updateMode') || 'ask'), skippedVersion: ui?.skippedUpdateVersion || '', install });
          let logTail = '';
          try {
            const raw = readFileSync(getLogPath(), 'utf8').slice(-120000);
            logTail = raw.split('\n').filter((l) => l.includes('[KRH-Update]')).slice(-25).join('\n');
          } catch { /* no log yet */ }
          return { ...d, logTail };
        },
        fetchChangelog: (version) => fetchChangelog(version),
        keybinds: () => getKeybinds(),
        cacheSizeBytes: () => ses.getCacheSize(),
        clearCache: async () => { await ses.clearCache(); },
      },
    });
  };
  // Show / hide the dashboard over a running game (default Ctrl+Shift+D, rebindable). Over the game it floats above
  // the (fullscreen) game window like the KRH website window does; pressing the key again, closing it or clicking
  // back into the game puts it away and the game keeps running.
  const toggleDash = (): void => {
    if (lockedDown) { showLockWindow(); return; }
    const gameOnScreen = gameActive && !win.isDestroyed() && win.isVisible();
    if (!gameOnScreen) { openDash(); return; }
    if (isDashboardVisible() && isDashboardFocused()) {
      closeDashLater();
      showWindow(win);
      return;
    }
    openDash();
    floatDashboard(true);
  };
  ipcMain.on('open-dashboard', () => toggleDash());

  // The splash covers the hub's initial page load.
  let revealed = false;
  let revealFallback: ReturnType<typeof setTimeout> | null = null;
  const revealHub = (): void => {
    if (revealed) return;
    revealed = true;
    if (revealFallback) clearTimeout(revealFallback);
    // The dashboard is the first window. The hub keeps loading hidden, so its button opens it at once.
    openDash();
    closeSplash();
  };
  // A fast page load would reduce the splash to a flash — hold the reveal until
  // the splash has been on screen for a minimum time.
  const MIN_SPLASH_DISPLAY_MS = 2000;
  const revealAfterMinimum = (): void => {
    const wait = Math.max(0, MIN_SPLASH_DISPLAY_MS - splashElapsed());
    if (wait > 0) setTimeout(revealHub, wait);
    else revealHub();
  };
  // Reveal when the first load finishes, when it fails (offline page shows instead of
  // hanging on the splash), or after a hard cap.
  hub.webContents.once('did-finish-load', revealAfterMinimum);
  hub.webContents.on('did-fail-load', (_event, errorCode, _desc, _url, isMainFrame) => {
    // -3 = ERR_ABORTED (superseded navigation) — not a real failure
    if (isMainFrame && errorCode !== -3) revealAfterMinimum();
  });
  revealFallback = setTimeout(revealHub, 15000);
  // Nothing to wait for: the dashboard does not depend on the hub page, only on the splash having been seen.
  revealAfterMinimum();
  // If the user closes the splash early, show the hub immediately.
  onSplashUserClosed(revealHub);

  mainWindowForProtocol = win;
  if (pendingProtocolUrl) {
    const pendingUrl = pendingProtocolUrl;
    pendingProtocolUrl = null;
    win.webContents.once('did-finish-load', () => win.webContents.send('krh-protocol', pendingUrl));
    launchGame();
  }

  // ── No application menu (prevents Escape/Alt interception) ──
  Menu.setApplicationMenu(null);

  // ── Discord Rich Presence ──
  let discordRpc: DiscordRPC | null = null;
  {
    const discordConf = config.get('discord') || { enabled: false };
    if (discordConf.enabled) {
      discordRpc = new DiscordRPC();
      discordRpc.onJoin = (secret) => {
        if (!getExtras().rpcRich.join) return;
        electronLog.log('[KRH] Joining a friend\'s match from Discord');
        launchGame('https://krunker.io/?game=' + secret);
      };
      discordRpc.connect();
      electronLog.log('[KRH] Discord Rich Presence enabled');
    }
  }

  // ── Process Priority (Windows only) ──
  if (process.platform === 'win32') {
    const { PRIORITY_HIGH, PRIORITY_ABOVE_NORMAL, PRIORITY_BELOW_NORMAL, PRIORITY_LOW } = os.constants.priority;
    const PRIORITY_MAP: Record<string, number> = {
      'High': PRIORITY_HIGH,
      'Above Normal': PRIORITY_ABOVE_NORMAL,
      'Below Normal': PRIORITY_BELOW_NORMAL,
      'Low': PRIORITY_LOW,
    };
    const prioritySetting = config.get('performance')?.processPriority || 'Normal';
    const priorityVal = PRIORITY_MAP[prioritySetting];
    // "Normal" is what Windows already uses: nothing to set, and no timer that queries every process each second.
    if (priorityVal !== undefined && prioritySetting !== 'Normal') {
      try { os.setPriority(process.pid, priorityVal); } catch { /* ignore */ }
      // Apply to child processes now and then (new windows start with the default priority)
      setInterval(() => {
        for (const m of app.getAppMetrics()) {
          if (m.pid !== process.pid) {
            try { os.setPriority(m.pid, priorityVal); } catch { /* ignore */ }
          }
        }
      }, 5000);
      electronLog.log(`[KRH] Process priority set to ${prioritySetting}`);
    }
  }

  // ── Keybind capture lock (suppresses shortcuts while a modal dialog is open) ──
  // Refcounted so nested modals (e.g. the delete confirm opened over the alt
  // manager) don't unlock shortcuts when the inner one closes while the outer
  // is still open. Every opener sends true on open and false on close.
  let keybindCaptureCount = 0;
  let keybindCapturing = false;
  ipcMain.on('keybind-capture', (_e, capturing: boolean) => {
    keybindCaptureCount = Math.max(0, keybindCaptureCount + (capturing ? 1 : -1));
    keybindCapturing = keybindCaptureCount > 0;
  });

  // ── Configurable keybinds via before-input-event ──
  installEscapeLock(win, getExtras().escapeFastRelease !== false);
  win.webContents.on('before-input-event', (event, input) => {
    // Ahead of everything else: taking an Escape press means taking its keyUp and repeats too.
    if (handleEscapeInput(win.webContents, event, input)) return;
    if (input.type !== 'keyDown') return;
    if (keybindCapturing) return;

    const binds = getKeybinds();

    if (matchesKeybind(input, binds.hubToggle)) {
      toggleHub();
      event.preventDefault();
    } else if (matchesKeybind(input, binds.dashboard)) {
      toggleDash();
      event.preventDefault();
    } else if (matchesKeybind(input, binds.reload)) {
      win.reload();
      event.preventDefault();
    } else if (matchesKeybind(input, binds.newMatch)) {
      const mm = config.get('matchmaker');
      if (mm.enabled) {
        win.webContents.send('matchmaker-find', {
          ...mm,
          cancelKey: binds.matchmakerCancel,
        });
      } else {
        win.loadURL('https://krunker.io');
      }
      event.preventDefault();
    } else if (matchesKeybind(input, binds.joinFromClipboard)) {
      const text = clipboard.readText();
      if (isKrunkerPage(text)) win.loadURL(text);
      else electronLog.warn('[KRH] Join-from-clipboard: clipboard is not a krunker.io https URL');
      event.preventDefault();
    } else if (matchesKeybind(input, binds.copyGameLink)) {
      clipboard.writeText(win.webContents.getURL());
      event.preventDefault();
    } else if (matchesKeybind(input, binds.openSocial)) {
      tabManager.openOrFocusTab('https://krunker.io/social.html');
      event.preventDefault();
    } else if (matchesKeybind(input, binds.openEditor)) {
      tabManager.openOrFocusTab('https://krunker.io/editor.html');
      event.preventDefault();
    } else if (matchesKeybind(input, binds.devTools)) {
      win.webContents.toggleDevTools();
      event.preventDefault();
    } else if (matchesKeybind(input, binds.matchmaker)) {
      const mm = config.get('matchmaker');
      if (mm.enabled) {
        win.webContents.send('matchmaker-find', {
          ...mm,
          cancelKey: binds.matchmakerCancel,
        });
      } else {
        win.loadURL('https://krunker.io');
      }
      event.preventDefault();
    } else if (matchesKeybind(input, binds.fullscreenToggle)) {
      win.setFullScreen(!win.isFullScreen());
      event.preventDefault();
    } else if (matchesKeybind(input, binds.screenshot)) {
      void takeScreenshot(win);
      event.preventDefault();
    } else if (matchesKeybind(input, binds.screenshotArea)) {
      if (gameActive) void takeAreaScreenshot(win);
      event.preventDefault();
    } else if (matchesKeybind(input, binds.record)) {
      if (gameActive) toggleRecording(win);
      event.preventDefault();
    } else if (matchesKeybind(input, binds.recordPause)) {
      if (gameActive) togglePauseRecording();
      event.preventDefault();
    } else if (input.control && input.shift && !input.alt && input.key === 'F1') {
      // Temporarily remove / restore the custom CSS theme (toggle)
      win.webContents.executeJavaScript(`(() => {
        const s = document.getElementById('krh-user-theme');
        if (s) s.disabled = !s.disabled;
      })()`).catch(() => { /* page not ready */ });
      event.preventDefault();
    } else if (input.control && input.alt && !input.shift && ['1', '2', '3'].includes(input.key)) {
      // Quick alt login: Ctrl+Alt+1 / 2 / 3 -> first / second / third saved account
      if (gameActive) win.webContents.send('alt-quick-login', Number(input.key) - 1);
      event.preventDefault();
    } else if (input.control && input.alt && !input.shift && input.key.toLowerCase() === 't') {
      // Show / hide the Twitch chat overlay
      if (gameActive) win.webContents.send('twitch-toggle');
      event.preventDefault();
    } else if (input.control && input.alt && !input.shift && ['p', 'n', 'b', 's'].includes(spotKey(input))) {
      // Spotify: Ctrl+Alt+P play/pause, N next, B previous, S show/hide the card
      if (gameActive) {
        const k = spotKey(input);
        if (k === 's') win.webContents.send('spotify-toggle');
        else void spotify.control(k === 'p' ? 'toggle' : k === 'n' ? 'next' : 'previous');
      }
      event.preventDefault();
    } else if (input.key === 't' && input.control && !input.shift && !input.alt) {
      tabManager.openTab('https://krunker.io/social.html');
      event.preventDefault();
    } else if (input.key === 'T' && input.control && input.shift && !input.alt) {
      tabManager.reopenTab();
      event.preventDefault();
    }
  });

  // ── Window state persistence (debounced) ──
  win.on('resize', () => saveWindowState(win));
  win.on('move', () => saveWindowState(win));
  win.on('maximize', () => saveWindowState(win));
  win.on('unmaximize', () => saveWindowState(win));
  win.on('enter-full-screen', () => saveWindowState(win));
  win.on('leave-full-screen', () => saveWindowState(win));

  // ── Cached game config (invalidated on set-config writes to 'game') ──
  let cachedGameConf: typeof DEFAULT_CONFIG.game | null = null;
  function _getGameConf(): typeof DEFAULT_CONFIG.game {
    if (!cachedGameConf) cachedGameConf = { ...DEFAULT_CONFIG.game, ...config.get('game') };
    return cachedGameConf;
  }

  // ── Tab Manager ──
  const preloadPath = join(__dirname, '..', 'preload', 'index.js');
  // KRH Client always opens social/editor/etc. pages in their own window (the game window may be hidden).
  let tabMode: 'same' | 'new' = 'new';
  let sessionTabs: string[] = [];
  // Tracked separately from config because set-config defers the actual write
  let socialTheme = config.get('ui')?.socialCssTheme || 'disabled';
  const socialThemeCSS = () => getThemeCSS(socialTheme, swapDir, SOCIAL_THEMES_DIR);
  let tabManager = new TabManager(
    win, ses, preloadPath, tabMode,
    () => config.get('tabWindow'),
    (state) => config.set('tabWindow', state),
    () => sessionTabs,
    (urls) => { sessionTabs = urls; },
    () => config.get('game.rememberTabs') ?? false,
    socialThemeCSS,
  );
  // Open Social / Open Editor also work while a Krunker tab has focus
  const wireTabKeys = (): void => {
    tabManager.onExtraShortcut = (input) => {
      if (input.type !== 'keyDown' || keybindCapturing) return false;
      const binds = getKeybinds();
      if (matchesKeybind(input, binds.openSocial)) { tabManager.openOrFocusTab('https://krunker.io/social.html'); return true; }
      if (matchesKeybind(input, binds.openEditor)) { tabManager.openOrFocusTab('https://krunker.io/editor.html'); return true; }
      return false;
    };
  };
  tabManager.gameLauncher = (u) => launchGame(u);
  wireTabKeys();

  // Intercept in-page navigation (e.g. window.location = '/social.html')
  win.webContents.on('will-navigate', (event, url) => {
    if (isGameURL(url)) return;
    event.preventDefault();
    if (isKrunkerPage(url)) tabManager.openTab(url);
    else safeOpenExternal(url);
  });
  blockOffsiteRedirects(win.webContents);

  // Intercept target="_blank" / window.open links
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isGameURL(url)) win.loadURL(url);
    else if (isKrunkerPage(url)) setImmediate(() => tabManager.openTab(url));
    else setImmediate(() => safeOpenExternal(url));
    return { action: 'deny' };
  });

  // Right-click context menu on main window with "Open in New Tab"
  win.webContents.on('context-menu', (_e, params) => {
    if (!params.linkURL) return;
    const items: Electron.MenuItemConstructorOptions[] = [];
    if (isKrunkerPage(params.linkURL) && !isGameURL(params.linkURL)) {
      items.push({ label: 'Open in New Tab', click: () => tabManager.openTab(params.linkURL) });
    }
    items.push({ label: 'Copy Link', click: () => clipboard.writeText(params.linkURL) });
    if (!isKrunkerPage(params.linkURL)) {
      items.push({ label: 'Open in Browser', click: () => safeOpenExternal(params.linkURL) });
    }
    if (items.length) Menu.buildFromTemplate(items).popup();
  });

  // Remember the game you are in, for the dashboard's "Rejoin last game" button.
  win.webContents.on('did-navigate', (_e, url) => recordGameUrl(url));
  win.webContents.on('did-navigate-in-page', (_e, url) => recordGameUrl(url));
  win.webContents.on('page-title-updated', (_e, title) => recordGameTitle(win.webContents.getURL(), title));

  // Automatic cache limit (Dashboard > Dashboard): checked shortly after start and then every half hour while no
  // game is open; the cache is only ever deleted, never your login or settings.
  const autoClearCache = async (): Promise<void> => {
    const limit = cacheLimitMb();
    if (limit <= 0 || gameActive) return;
    try {
      if ((await ses.getCacheSize()) > limit * 1048576) {
        await ses.clearCache();
        electronLog.log(`[KRH] Cache was over ${limit} MB and has been cleared`);
      }
    } catch (err) { electronLog.warn('[KRH] Automatic cache check failed:', (err as Error).message); }
  };
  setTimeout(() => { void autoClearCache(); }, 20000);
  setInterval(() => { void autoClearCache(); }, 30 * 60 * 1000).unref();

  // The user CSS files (Dashboard > Custom CSS), as one <style> tag that is replaced whenever the list changes.
  const applyUserCss = (): void => {
    if (win.isDestroyed() || win.webContents.isLoading()) return;
    const css = safeMode ? '' : userCss.combined();
    win.webContents.executeJavaScript(`(() => {
      let s = document.getElementById('krh-user-css');
      if (!${JSON.stringify(css !== '')}) { if (s) s.remove(); return; }
      if (!s) { s = document.createElement('style'); s.id = 'krh-user-css'; document.head.appendChild(s); }
      s.textContent = ${JSON.stringify(css)};
    })()`).catch((err) => electronLog.warn('[KRH] User CSS inject failed:', err));
  };

  // Theme from swapper/themes/: a <style> tag (not insertCSS) so @import rules work; re-run when the choice or the file changes
  const applyGameTheme = (): void => {
    if (win.isDestroyed()) return;
    const themeId = safeMode ? 'disabled' : (config.get('ui')?.cssTheme || 'disabled');
    const themeCSS = getThemeCSS(themeId, swapDir);
    electronLog.log(`[KRH] CSS theme: id=${themeId}, css=${themeCSS ? themeCSS.length + ' chars' : 'none'}`);
    win.webContents.executeJavaScript(`(() => {
      const css = ${JSON.stringify(themeCSS)};
      let s = document.getElementById('krh-user-theme');
      if (!css) { if (s) s.remove(); return; }
      if (!s) {
        s = document.createElement('style');
        s.id = 'krh-user-theme';
        (document.head || document.documentElement).appendChild(s);
      }
      s.textContent = css;
    })()`).catch((err) => electronLog.warn('[KRH] Theme inject failed:', err));
  };

  if (swapper) {
    swapper.onFilesChange = (paths) => {
      if (win.isDestroyed()) return;
      const lower = paths.map((p) => p.toLowerCase());
      const css = paths.filter((_p, i) => lower[i].endsWith('.css'));
      if (css.length) win.webContents.send('swap-css-reload', css);
      if (lower.some((p) => p.startsWith(`/${GAME_THEMES_DIR}/`))) applyGameTheme();
      if (lower.some((p) => p.startsWith(`/${SOCIAL_THEMES_DIR}/`))) tabManager.refreshSocialTheme();
    };
  }

  let misplacedWarned = false;
  // Fallback for when the swap folder watcher couldn't start or has stopped
  win.webContents.on('did-start-navigation', (details) => {
    if (!swapper || swapper.watching || !details.isMainFrame || details.isSameDocument) return;
    swapper.rescan().catch((err) => electronLog.warn('[KRH] Swapper rescan failed:', err));
  });

  // ── Inject scripts after page loads ──
  win.webContents.on('did-finish-load', () => {
    electronLog.log(`[KRH] Page loaded: ${win.webContents.getURL()}`);
    if (swapper) {
      // The renderer memory cache serves F5 the stylesheet it already had, so the request never reaches the swapper
      const swappedCss = swapper.cssPaths();
      if (swappedCss.length) win.webContents.send('swap-css-reload', swappedCss);
      if (!misplacedWarned && swapper.misplaced().length) {
        misplacedWarned = true;
        win.webContents.send('krh-toast', 'Some swapper files are in the wrong folder and won\'t load. See Settings > Client > Swapper');
      }
    }

    const cssInjections = [
      win.webContents.insertCSS(HIDE_ADS_CSS),
      win.webContents.insertCSS(ALL_CLIENT_CSS),
    ];

    const uiConf = config.get('ui');
    applyGameTheme();

    applyUserCss();

    // Inject loading screen background
    const loadingCSS = getLoadingScreenCSS(safeMode ? 'disabled' : (uiConf?.loadingTheme || 'disabled'), uiConf?.backgroundUrl || '', swapDir);
    if (loadingCSS) cssInjections.push(win.webContents.insertCSS(loadingCSS));

    Promise.all(cssInjections).catch((err) => electronLog.warn('[KRH] CSS injection failed:', err));

    win.webContents.executeJavaScript(ESCAPE_POINTERLOCK_FIX_JS).catch((err) => electronLog.warn('[KRH] Pointerlock fix inject failed:', err));
    win.webContents.executeJavaScript(CONSENT_DISMISS_JS).catch((err) => electronLog.warn('[KRH] Consent dismiss inject failed:', err));
    // Notify preload to start hooking settings (matches Crankshaft's timing)
    win.webContents.send('main_did-finish-load');
    if (safeMode) setTimeout(() => { if (!win.isDestroyed()) win.webContents.send('krh-toast', 'Safe Mode: userscripts, swapper, themes and extras are off'); }, 2500);
    // A new match loads a new page, which ends the replay capture: start it again
    if (gameActive && getExtras().instantReplay.enabled) { stopReplayBuffer(); setTimeout(() => applyReplay(), 3000); }
  });

  // Window focus gates social-hub music — see social-music.ts. Guarded because
  // blur can arrive while the window is being torn down.
  const sendFocus = (focused: boolean): void => {
    if (!win.isDestroyed()) win.webContents.send('krh-window-focus', focused);
  };
  win.on('focus', () => sendFocus(true));
  win.on('blur', () => sendFocus(false));

  // ── IPC handlers ──
  // 'accounts' is intentionally excluded — it holds encrypted credential blobs.
  // The renderer must go through the dedicated alt-* handlers (alt-list returns
  // labels only), never the generic config getter, so page JS can't read it.
  const ALLOWED_CONFIG_KEYS = new Set<string>([
    'window', 'performance', 'game', 'swapper', 'matchmaker',
    'keybinds', 'userscripts', 'ui', 'discord', 'translator',
    'advanced', 'tabWindow', 'keystrokes', 'nukeCounter', 'twitch', 'spotify', 'extras',
  ]);

  // Settings categories included in export/import. Deliberately excludes:
  //   accounts          — encrypted alt-account credentials (never exported)
  //   window/tabWindow  — machine-specific window geometry
  //   savedTabs         — transient last-open tabs
  const EXPORT_CONFIG_KEYS = [
    'performance', 'game', 'keystrokes', 'nukeCounter', 'twitch', 'spotify', 'swapper', 'matchmaker',
    'keybinds', 'userscripts', 'ui', 'discord', 'translator', 'advanced', 'extras',
  ] as const;

  // Folder paths are hand-edited only: page scripts and imported files must not repoint where code loads from
  function keepFolderPath(key: string, value: unknown): unknown {
    if (key !== 'userscripts' && key !== 'swapper') return value;
    return { ...(value as object), path: config.get(key).path };
  }

  // ── Extras (chat tools, mod downloader, display mode, RPC buttons, userscript reload) ──
  function getExtras(): ExtrasConfig {
    return { ...DEFAULT_CONFIG.extras, ...(config.get('extras') as Partial<ExtrasConfig> | undefined) };
  }

  function sanitizeCrosshair(value: unknown): ExtrasConfig['crosshair'] {
    const d = DEFAULT_CONFIG.extras.crosshair;
    const v = (value && typeof value === 'object' ? value : {}) as Partial<ExtrasConfig['crosshair']>;
    const num = (x: unknown, def: number, lo: number, hi: number): number => (typeof x === 'number' && isFinite(x) ? Math.min(hi, Math.max(lo, x)) : def);
    const col = (x: unknown, def: string): string => (typeof x === 'string' && /^#[0-9a-fA-F]{6}$/.test(x) ? x : def);
    const shapes = ['cross', 'plus', 'circle', 'hCircle', 'square', 'hSquare', 'symbol', 'image'];
    return {
      enabled: typeof v.enabled === 'boolean' ? v.enabled : d.enabled,
      shape: shapes.includes(String(v.shape)) ? (v.shape as ExtrasConfig['crosshair']['shape']) : d.shape,
      symbol: typeof v.symbol === 'string' && v.symbol.length > 0 ? Array.from(v.symbol).slice(0, 4).join('') : d.symbol,
      image: cleanCrosshairImage(v.image),
      color: col(v.color, d.color),
      outline: col(v.outline, d.outline),
      size: num(v.size, d.size, 1, 80),
      thick: num(v.thick, d.thick, 1, 30),
      gap: num(v.gap, d.gap, -10, 80),
      dot: num(v.dot, d.dot, 0, 30),
      outWidth: num(v.outWidth, d.outWidth, 0, 8),
    };
  }

  function sanitizeExtras(value: unknown): ExtrasConfig {
    const v = (value && typeof value === 'object' ? value : {}) as Partial<ExtrasConfig>;
    const d = DEFAULT_CONFIG.extras;
    const str = (x: unknown, def: string, max = 200): string => (typeof x === 'string' ? x.slice(0, max) : def);
    const bool = (x: unknown, def: boolean): boolean => (typeof x === 'boolean' ? x : def);
    const rb = (v.rpcButtons && typeof v.rpcButtons === 'object' ? v.rpcButtons : d.rpcButtons) as ExtrasConfig['rpcButtons'];
    const mb = (v.motionBlur && typeof v.motionBlur === 'object' ? v.motionBlur : d.motionBlur) as Partial<ExtrasConfig['motionBlur']>;
    const obj = (x: unknown): Record<string, unknown> => (x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : {});
    const numIn = (x: unknown, def: number, lo: number, hi: number): number => (typeof x === 'number' && isFinite(x) ? Math.min(hi, Math.max(lo, Math.round(x))) : def);
    const rr = obj(v.rpcRich) as Partial<ExtrasConfig['rpcRich']>;
    const ir = obj(v.instantReplay) as Partial<ExtrasConfig['instantReplay']>;
    const ss = obj(v.sessionStats) as Partial<ExtrasConfig['sessionStats']>;
    const pk = obj(v.packs) as Partial<ExtrasConfig['packs']>;
    return {
      rankedBadges: bool(v.rankedBadges, d.rankedBadges),
      modDownloader: bool(v.modDownloader, d.modDownloader),
      chatFilters: bool(v.chatFilters, d.chatFilters),
      chatFilterKey: str(v.chatFilterKey, d.chatFilterKey, 20),
      chatLogs: bool(v.chatLogs, d.chatLogs),
      chatLogsKey: str(v.chatLogsKey, d.chatLogsKey, 20),
      quickPlayKey: str(v.quickPlayKey, d.quickPlayKey, 20),
      displayMode: v.displayMode === 'maximized' || v.displayMode === 'fullscreen' ? v.displayMode : 'windowed',
      userscriptReload: v.userscriptReload === 'off' || v.userscriptReload === 'reload' ? v.userscriptReload : 'notify',
      hiddenMenu: Array.isArray(v.hiddenMenu) ? v.hiddenMenu.filter((k) => typeof k === 'string').slice(0, 40) : [],
      rpcButtons: {
        enabled: bool(rb.enabled, false),
        label1: str(rb.label1, '', 32), url1: str(rb.url1, '', 512),
        label2: str(rb.label2, '', 32), url2: str(rb.url2, '', 512),
      },
      autoRejoin: bool(v.autoRejoin, d.autoRejoin),
      crosshair: sanitizeCrosshair(v.crosshair),
      motionBlur: {
        enabled: bool(mb.enabled, d.motionBlur.enabled),
        strength: typeof mb.strength === 'number' && isFinite(mb.strength) ? Math.min(100, Math.max(0, Math.round(mb.strength))) : d.motionBlur.strength,
        quality: mb.quality === 'balanced' || mb.quality === 'performance' ? mb.quality : 'native',
      },
      quickClassPicker: bool(v.quickClassPicker, d.quickClassPicker),
      classicMenu: bool(v.classicMenu, d.classicMenu),
      disableVideoSkins: bool(v.disableVideoSkins, d.disableVideoSkins),
      rankedAlert: bool(v.rankedAlert, d.rankedAlert),
      chatDraft: bool(v.chatDraft, d.chatDraft),
      accountEndMessage: bool(v.accountEndMessage, d.accountEndMessage),
      escapeFastRelease: bool(v.escapeFastRelease, d.escapeFastRelease),
      settingPresets: normalisePresets(v.settingPresets),
      nameColors: { friends: str(v.nameColors?.friends, '', 4000), clans: str(v.nameColors?.clans, '', 4000) },
      liveAccuracy: {
        enabled: bool(v.liveAccuracy?.enabled, d.liveAccuracy.enabled),
        placement: v.liveAccuracy?.placement === 'bottom' ? 'bottom' : 'top',
      },
      serverFilter: {
        enabled: bool(v.serverFilter?.enabled, d.serverFilter.enabled),
        words: str(v.serverFilter?.words, d.serverFilter.words, 600),
      },
      gameLoop: {
        enabled: bool(v.gameLoop?.enabled, d.gameLoop.enabled),
        intervalMs: numIn(v.gameLoop?.intervalMs, d.gameLoop.intervalMs, 4, 33),
      },
      perfHud: {
        key: str(v.perfHud?.key, d.perfHud.key, 20),
        corner: (['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const).find((c) => c === v.perfHud?.corner) ?? d.perfHud.corner,
        detail: v.perfHud?.detail === 'fps' ? 'fps' : 'full',
        startOn: bool(v.perfHud?.startOn, d.perfHud.startOn),
      },
      rpcRich: {
        classIcon: bool(rr.classIcon, d.rpcRich.classIcon),
        mapArt: bool(rr.mapArt, d.rpcRich.mapArt),
        join: bool(rr.join, d.rpcRich.join),
      },
      updateMode: v.updateMode === 'background' ? 'background' : 'ask',
      updateInstallOnQuit: bool(v.updateInstallOnQuit, d.updateInstallOnQuit),
      streamerMode: bool(v.streamerMode, d.streamerMode),
      streamerKey: str(v.streamerKey, d.streamerKey, 30),
      instantReplay: {
        enabled: bool(ir.enabled, d.instantReplay.enabled),
        seconds: numIn(ir.seconds, d.instantReplay.seconds, 10, 120),
        key: str(ir.key, d.instantReplay.key, 30),
        autoStreak: numIn(ir.autoStreak, d.instantReplay.autoStreak, 0, 100),
      },
      sessionStats: {
        enabled: bool(ss.enabled, d.sessionStats.enabled),
        summary: bool(ss.summary, d.sessionStats.summary),
        key: str(ss.key, d.sessionStats.key, 30),
      },
      packs: {
        enabled: Array.isArray(pk.enabled) ? pk.enabled.filter((x) => typeof x === 'string' && PACK_ID_RE.test(x)).slice(0, 200) : [],
        loadouts: Array.isArray(pk.loadouts)
          ? pk.loadouts
              .filter((l) => l && typeof l.name === 'string' && Array.isArray(l.ids))
              .slice(0, 30)
              .map((l) => ({ name: l.name.slice(0, 60), ids: l.ids.filter((x) => typeof x === 'string' && PACK_ID_RE.test(x)).slice(0, 200) }))
          : [],
      },
      layoutEditorKey: str(v.layoutEditorKey, d.layoutEditorKey, 30),
      settingsProfiles: Array.isArray(v.settingsProfiles)
        ? v.settingsProfiles
            .filter((p) => p && typeof p.name === 'string' && typeof p.data === 'string' && p.data.length < 2_000_000)
            .slice(0, 30)
            .map((p) => ({ name: p.name.slice(0, 60), data: p.data }))
        : [],
    };
  }

  // Display mode: windowed / maximized / fullscreen (F11 still toggles fullscreen on top of it)
  function applyDisplayMode(mode: ExtrasConfig['displayMode'], onlyIfNotWindowed = false): void {
    if (win.isDestroyed() || (onlyIfNotWindowed && mode === 'windowed')) return;
    if (mode === 'fullscreen') { win.setFullScreen(true); return; }
    if (win.isFullScreen()) win.setFullScreen(false);
    if (mode === 'maximized') { if (!win.isMaximized()) win.maximize(); }
    else if (win.isMaximized()) win.unmaximize();
  }

  // Discord presence buttons: https links only, label up to 32 characters, at most two
  function rpcButtons(): Array<{ label: string; url: string }> {
    const b = getExtras().rpcButtons;
    if (!b || !b.enabled) return [];
    const out: Array<{ label: string; url: string }> = [];
    for (const [label, url] of [[b.label1, b.url1], [b.label2, b.url2]]) {
      const l = String(label || '').trim().slice(0, 32);
      try {
        const u = new URL(String(url || '').trim());
        if (l.length >= 1 && u.protocol === 'https:' && u.href.length <= 512) out.push({ label: l, url: u.href });
      } catch { /* not a valid link: skipped */ }
    }
    return out;
  }

  // One-click mod download (the page asks, only krunker.io https links are fetched)
  const MODS_DIR = (): string => join(app.getPath('downloads'), 'KRH Client', 'Mods');
  const MOD_MAX_BYTES = 300 * 1024 * 1024;
  ipcMain.handle('download-mod', async (e, req: { url?: unknown; name?: unknown }) => {
    if (e.sender !== win.webContents) return { ok: false, error: 'Not allowed here.' };
    try {
      const url = new URL(String(req?.url ?? ''));
      if (url.protocol !== 'https:' || !isKrunkerHost(url.hostname)) return { ok: false, error: 'Only krunker.io https links can be downloaded.' };
      const res = await net.fetch(url.href, { redirect: 'follow' });
      if (!res.ok) return { ok: false, error: 'Download failed (HTTP ' + res.status + ').' };
      try { if (!isKrunkerHost(new URL(res.url).hostname)) return { ok: false, error: 'The link redirected away from krunker.io.' }; } catch { /* keep going */ }
      const declared = Number(res.headers.get('content-length') || 0);
      if (declared > MOD_MAX_BYTES) return { ok: false, error: 'That file is too large.' };
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > MOD_MAX_BYTES) return { ok: false, error: 'That file is too large.' };
      if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b) return { ok: false, error: 'That link is not a .zip file.' };
      const safe = Array.from(String(req?.name ?? 'mod')).filter((ch) => ch.charCodeAt(0) >= 32 && !'\\/:*?"<>|'.includes(ch)).join('').replace(/\s+/g, ' ').trim().slice(0, 80) || 'mod';
      const dir = MODS_DIR();
      mkdirSync(dir, { recursive: true });
      let target = join(dir, safe + '.zip');
      for (let n = 2; existsSync(target) && n < 1000; n++) target = join(dir, `${safe} (${n}).zip`);
      writeFileSync(target, buf);
      return { ok: true, path: target };
    } catch (err) {
      electronLog.warn('[KRH] Mod download failed:', (err as Error).message);
      return { ok: false, error: 'Could not download the mod.' };
    }
  });
  // Ranked match alert (idea from Kute): the game page reports that Krunker's ranked queue found a match.
  // If the client is not the window in front, bring it up (and flash the taskbar where the OS refuses to steal focus).
  let lastRankedAlert = 0;
  ipcMain.on('krh-ranked-found', (e) => {
    if (e.sender !== win.webContents || win.isDestroyed() || !getExtras().rankedAlert) return;
    const now = Date.now();
    if (now - lastRankedAlert < 5000) return;
    lastRankedAlert = now;
    if (win.isFocused()) return;
    showWindow(win);
    if (!win.isFocused()) {
      win.flashFrame(true);
      win.once('focus', () => { if (!win.isDestroyed()) win.flashFrame(false); });
    }
  });

  // Match End Message per account (adapted from Kute): stored by account name, edited only through these two handlers.
  const END_MESSAGE_ACCOUNT_RE = /^[\w.-]{1,40}$/;
  const END_MESSAGE_MAX_ACCOUNTS = 100;
  const endMessagesOf = (): Record<string, string> => {
    const raw = config.get('endMessages') as unknown;
    const out: Record<string, string> = {};
    if (raw && typeof raw === 'object') {
      for (const [k, val] of Object.entries(raw as Record<string, unknown>)) {
        if (k !== '__proto__' && END_MESSAGE_ACCOUNT_RE.test(k) && typeof val === 'string') out[k] = val.slice(0, 200);
      }
    }
    return out;
  };
  ipcMain.handle('end-message-get', (e) => (e.sender === win.webContents ? endMessagesOf() : {}));
  ipcMain.handle('end-message-set', (e, account: unknown, message: unknown) => {
    if (e.sender !== win.webContents) return false;
    if (typeof account !== 'string' || account === '__proto__' || !END_MESSAGE_ACCOUNT_RE.test(account)) return false;
    const text = typeof message === 'string' ? message.slice(0, 200) : '';
    const all = endMessagesOf();
    if (text) {
      if (!(account in all) && Object.keys(all).length >= END_MESSAGE_MAX_ACCOUNTS) return false;
      all[account] = text;
    } else {
      delete all[account];
    }
    config.set('endMessages', all);
    return true;
  });

  // Example userscripts (Class Roulette and Quick Sell by Rarity, both from Kute; Kill Streak by KRH): copied into the userscripts
  // folder on request, never over a file that is already there. New scripts start switched off.
  // @require libraries a userscript may ask for: only the ones shipped with the client (no download, nothing else is served).
  ipcMain.on('userscripts-require', (e, url: unknown) => {
    e.returnValue = url === 'https://cdnjs.cloudflare.com/ajax/libs/msgpack-lite/0.1.26/msgpack.min.js' ? libMsgpack : '';
  });
  ipcMain.handle('install-example-userscripts', () => {
    if (!userscriptManager) return { ok: false, error: 'Turn on Userscripts in the Userscripts settings and restart the client first.', added: [] as string[] };
    const added: string[] = [];
    const existing: string[] = [];
    try {
      for (const [name, code] of [['classRoulette.js', exampleClassRoulette], ['quickSellByRarity.js', exampleQuickSell], ['Krunker_Reconnector.js', exampleReconnector], ['Quick_Krunker_Docs_Integration.js', exampleDocs], ['killstreak.js', exampleKillStreak]] as const) {
        const target = join(userscriptManager.dir, name);
        if (existsSync(target)) { existing.push(name); continue; }
        writeFileSync(target, code, 'utf-8');
        added.push(name);
      }
    } catch (err) {
      electronLog.warn('[KRH] Could not install the example userscripts:', (err as Error).message);
      return { ok: false, error: 'Could not write to the userscripts folder.', added };
    }
    return { ok: true, error: '', added, existing };
  });

  // Userscript hot reload: when a script file changes, tell you (or reload the page) without restarting the client
  if (userscriptManager) {
    let reloadTimer: ReturnType<typeof setTimeout> | null = null;
    try {
      fsWatch(userscriptManager.dir, { persistent: false }, (_ev, filename) => {
        const name = filename ? String(filename) : '';
        if (!name.toLowerCase().endsWith('.js')) return;
        if (getExtras().userscriptReload === 'off') return;
        if (reloadTimer) clearTimeout(reloadTimer);
        reloadTimer = setTimeout(() => {
          reloadTimer = null;
          if (win.isDestroyed()) return;
          const mode = getExtras().userscriptReload; // read again: it may have been switched meanwhile
          if (mode === 'reload') win.webContents.reloadIgnoringCache();
          else if (mode === 'notify') win.webContents.send('krh-toast', `Userscript changed: ${name}. Reload the page to apply it.`);
        }, 700);
      });
    } catch (err) {
      electronLog.warn('[KRH] Could not watch the userscripts folder:', (err as Error).message);
    }
  }

  ipcMain.handle('reveal-mod-file', (e, p: unknown) => {
    if (e.sender !== win.webContents || typeof p !== 'string') return;
    const dir = MODS_DIR();
    if (resolvePath(p).startsWith(resolvePath(dir)) && existsSync(p)) shell.showItemInFolder(p);
  });

  ipcMain.handle('get-version', () => appVersion);
  ipcMain.handle('get-platform', () => platformInfo);
  ipcMain.handle('get-config', (_e, key: string) => {
    if (!ALLOWED_CONFIG_KEYS.has(key)) return undefined;
    return config.get(key as keyof typeof config.store);
  });
  ipcMain.handle('get-all-config', (_e, keys: string[]) => {
    const result: Record<string, unknown> = {};
    for (const key of keys) {
      if (ALLOWED_CONFIG_KEYS.has(key)) result[key] = config.get(key as keyof typeof config.store);
    }
    return result;
  });
  // Synchronous variant used by the settings render so the panel can rebuild in a
  // single tick (no async gap → no flash when Krunker clears #settHolder on tab switch).
  ipcMain.on('get-settings-data-sync', (e, keys: string[]) => {
    const cfg: Record<string, unknown> = {};
    for (const key of keys) {
      if (ALLOWED_CONFIG_KEYS.has(key)) cfg[key] = config.get(key as keyof typeof config.store);
    }
    e.returnValue = { config: cfg, platform: platformInfo, version: appVersion };
  });
  let configWriteTimer: ReturnType<typeof setTimeout> | null = null;
  const pendingConfigWrites = new Map<string, unknown>();

  function flushPendingConfigWrites(): void {
    if (configWriteTimer) {
      clearTimeout(configWriteTimer);
      configWriteTimer = null;
    }
    for (const [k, v] of pendingConfigWrites) {
      config.set(k as any, v);
    }
    pendingConfigWrites.clear();
  }

  app.on('before-quit', flushPendingConfigWrites);

  // ── CPU throttling (ported from Glorp) ──
  // Slows the game's JS (via the DevTools protocol) in-game and/or in menus. Off by default (1).
  // Useful when the GPU is the bottleneck and the game loop outruns what the GPU can present.
  let uiState: 'menu' | 'game' = 'menu';
  let appliedThrottle = 1;
  const clampThrottle = (n: unknown): number => {
    const v = Number(n);
    return Number.isFinite(v) ? Math.min(3, Math.max(1, v)) : 1;
  };
  const applyCpuThrottle = (perfOverride?: any, force = false): void => {
    if (win.isDestroyed() || !gameActive) return;
    const p = perfOverride || config.get('performance') || {};
    const rate = clampThrottle(uiState === 'game' ? p.cpuThrottle : p.cpuThrottleMenu);
    if (!force && rate === appliedThrottle) return;
    const dbg = win.webContents.debugger;
    // Don't hold the debugger when throttling is off, so F12 DevTools stays unaffected.
    if (rate === 1 && !dbg.isAttached()) { appliedThrottle = 1; return; }
    try { if (!dbg.isAttached()) dbg.attach('1.3'); } catch { return; } // DevTools may own it
    dbg.sendCommand('Emulation.setCPUThrottlingRate', { rate })
      .then(() => {
        appliedThrottle = rate;
        if (rate === 1) { try { dbg.detach(); } catch { /* already detached */ } }
      })
      .catch(() => { /* target gone */ });
  };
  win.webContents.on('did-finish-load', () => { appliedThrottle = 1; applyCpuThrottle(undefined, true); });
  ipcMain.on('krh-ui-state', (e, state: string) => {
    if (e.sender !== win.webContents) return;
    uiState = state === 'game' ? 'game' : 'menu';
    applyCpuThrottle();
  });
  ipcMain.handle('open-user-lists-folder', () => shell.openPath(userListsDir()));

  // ── GPU profile: info for the settings page, the Low-End preset, and a one-time suggestion ──
  ipcMain.handle('get-gpu-info', () => {
    const g = getGpuProfileInfo();
    if (!g) return null;
    return {
      setting: g.setting,
      effective: g.effective,
      hybrid: g.summary.hybrid,
      gpus: g.summary.gpus.map((x) => ({ name: x.name, vendor: x.vendor, tier: x.tier })),
    };
  });

  // One click that turns off the extras that cost GPU / CPU time and picks the weak-GPU flags.
  // Everything it changes can be switched back on in the normal settings.
  const applyLowEndPreset = (): void => {
    const ex = getExtras();
    const clean = sanitizeExtras({
      ...ex,
      disableVideoSkins: true,
      motionBlur: { ...ex.motionBlur, enabled: false },
      instantReplay: { ...ex.instantReplay, enabled: false },
    });
    clean.streamerMode = ex.streamerMode;
    clean.packs.enabled = ex.packs.enabled;
    config.set('extras', clean);
    disableVideoSkins = clean.disableVideoSkins;
    applyReplay();
    config.set('ui', { ...DEFAULT_CONFIG.ui, ...config.get('ui'), deathscreenAnimation: false });
    config.set('performance', { ...DEFAULT_CONFIG.performance, ...config.get('performance'), higherMaxFps: false });
    let hiDpi = false;
    try { hiDpi = screen.getPrimaryDisplay().scaleFactor > 1; } catch { /* keep false */ }
    const adv = { ...DEFAULT_CONFIG.advanced, ...config.get('advanced') };
    config.set('advanced', { ...adv, gpuProfile: 'low', ignoreDisplayScaling: adv.ignoreDisplayScaling || hiDpi, lowEndPrompted: true });
  };
  ipcMain.handle('apply-low-end-preset', () => {
    applyLowEndPreset();
    return { ok: true, needsRestart: true };
  });

  // First start on a machine whose GPU was recognised as weak: offer the preset once.
  const maybeSuggestLowEnd = async (): Promise<void> => {
    const adv = { ...DEFAULT_CONFIG.advanced, ...config.get('advanced') };
    const g = getGpuProfileInfo();
    if (adv.lowEndPrompted || !g || g.setting !== 'auto' || (g.effective !== 'low' && g.effective !== 'legacy')) return;
    if (hub.isDestroyed() || !hub.isVisible()) return;
    config.set('advanced', { ...adv, lowEndPrompted: true });
    const gpuName = g.summary.primary?.name || 'your graphics card';
    const { response } = await dialog.showMessageBox(hub, {
      type: 'question',
      title: 'KRH Client',
      message: `Low-end graphics detected: ${gpuName}`,
      detail: 'Apply the Low-End preset for more FPS? It turns off animated video skins, motion blur, instant replay and the death-screen animation, and uses lighter graphics settings. You can undo any of it in Settings > Performance.',
      buttons: ['Apply & restart', 'Not now'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    if (response === 0) {
      applyLowEndPreset();
      app.relaunch();
      app.exit(0);
    }
  };
  const scheduleLowEndSuggestion = (): void => { setTimeout(() => { void maybeSuggestLowEnd(); }, 6000); };
  if (hub.webContents.isLoading()) hub.webContents.once('did-finish-load', scheduleLowEndSuggestion);
  else scheduleLowEndSuggestion();

  ipcMain.handle('set-config', (_e, key: string, value: unknown) => {
    if (!ALLOWED_CONFIG_KEYS.has(key)) return;
    value = keepFolderPath(key, value);
    if (key === 'advanced') {
      // Validate the GPU options; lowEndPrompted is owned by main (a settings page with an older copy must not reset it).
      const v = (value ?? {}) as Record<string, unknown>;
      const prev = { ...DEFAULT_CONFIG.advanced, ...config.get('advanced') };
      value = {
        ...v,
        gpuProfile: (GPU_PROFILES as readonly unknown[]).includes(v.gpuProfile) ? v.gpuProfile : 'auto',
        ignoreDisplayScaling: v.ignoreDisplayScaling === true,
        lowEndPrompted: prev.lowEndPrompted || v.lowEndPrompted === true,
      };
    }
    if (key === 'extras') {
      const prev = getExtras();
      const clean = sanitizeExtras(value);
      // Streamer mode and the switched-on packs change through their own calls; a settings page holding
      // an older copy must not undo them.
      clean.streamerMode = prev.streamerMode;
      clean.packs.enabled = prev.packs.enabled;
      config.set('extras', clean);
      disableVideoSkins = clean.disableVideoSkins;
      setEscapeFastRelease(clean.escapeFastRelease);
      applyDisplayMode(clean.displayMode);
      if (clean.updateMode === 'background' && prev.updateMode !== 'background') pokeBackgroundUpdates();
      const irNow = clean.instantReplay, irWas = prev.instantReplay;
      if (irNow.enabled !== irWas.enabled || irNow.seconds !== irWas.seconds) applyReplay();
      if (!win.isDestroyed()) { win.webContents.send('streamer-key', clean.streamerKey); win.webContents.send('layout-editor-key', clean.layoutEditorKey); }
      return;
    }
    // Flush immediately for keys that have side effects
    if (key === 'keybinds') {
      config.set(key as any, value);
      cachedKeybinds = null;
      return;
    }
    let frameCapNeedsRestart = false;
    if (key === 'performance') {
      applyCpuThrottle(value);
      // setFrameCap only exists on the frameCap-patched Electron builds
      const capWin = win as BrowserWindow & { setFrameCap?: (fps: number) => void };
      const capped = clampFrameCap((value as any)?.frameCap);
      if (capLiveAvailable && typeof capWin.setFrameCap === 'function') {
        capWin.setFrameCap(capped);
      } else if (capped !== launchFrameCap && (value as any)?.fpsUnlocked) {
        frameCapNeedsRestart = true;
      }
    }
    // Invalidate caches immediately (not on flush) to prevent stale reads
    if (key === 'game') {
      cachedGameConf = null;
      const newGame = value as any;
      hideBunnies = newGame?.hideBunnies ?? false;
      hideTurfBanners = newGame?.hideTurfBanners ?? false;
      // Switch tab mode if socialTabBehaviour changed
      if (newGame?.socialTabBehaviour) {
        const newMode: 'same' | 'new' = 'new'; // KRH Client: always a separate window
        if (newMode !== tabMode) {
          tabManager.destroyAll();
          tabMode = newMode;
          tabManager = new TabManager(
            win, ses, preloadPath, tabMode,
            () => config.get('tabWindow'),
            (state) => config.set('tabWindow', state),
            () => sessionTabs,
            (urls) => { sessionTabs = urls; },
            () => config.get('game.rememberTabs') ?? false,
            socialThemeCSS,
          );
          tabManager.gameLauncher = (u) => launchGame(u);
          wireTabKeys();
        }
      }
    }
    if (key === 'twitch') applyTwitch(value as Partial<TwitchConfig>);
    if (key === 'spotify') applySpotify(value as Partial<SpotifyConfig>);
    if (key === 'ui') {
      // Game CSS theme applies as soon as it is picked
      if (((value as any)?.cssTheme || 'disabled') !== (config.get('ui')?.cssTheme || 'disabled')) setTimeout(applyGameTheme, 0);
      // Social CSS theme swaps live on open tabs
      const next = (value as any)?.socialCssTheme || 'disabled';
      if (next !== socialTheme) {
        socialTheme = next;
        tabManager.refreshSocialTheme();
      }
    }
    pendingConfigWrites.set(key, value);
    if (!configWriteTimer) {
      configWriteTimer = setTimeout(flushPendingConfigWrites, 300);
    }
    return frameCapNeedsRestart;
  });
  ipcMain.handle('window-minimize', () => win.minimize());
  ipcMain.handle('window-maximize', () => {
    if (win.isMaximized()) win.unmaximize(); else win.maximize();
  });
  ipcMain.handle('window-close', () => win.close());
  ipcMain.handle('window-is-maximized', () => win.isMaximized());
  ipcMain.handle('toggle-devtools', () => win.webContents.toggleDevTools());
  ipcMain.handle('open-external', (_e, url: string) => safeOpenExternal(url));
  ipcMain.handle('inject-game-click', () => {
    const [width, height] = win.getContentSize();
    const x = Math.round(width / 2);
    const y = Math.round(height / 2);
    win.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
    win.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
  });
  ipcMain.handle('get-swap-dir', () => swapDir);
  ipcMain.handle('open-swap-folder', () => shell.openPath(swapDir));
  ipcMain.handle('swap-misplaced', () => swapper ? swapper.misplaced() : []);
  ipcMain.handle('swap-fix-misplaced', () => swapper ? swapper.fixMisplaced() : { moved: 0, skipped: 0 });
  // External swapper: points Krunker resources at https links (externalResourceSwapper.json in the swap folder)
  ipcMain.handle('open-external-swap-file', () => {
    const file = join(swapDir, EXTERNAL_SWAP_FILE);
    try { if (!existsSync(file)) writeFileSync(file, JSON.stringify(EXTERNAL_EXAMPLE, null, 2), 'utf-8'); } catch { /* the folder opens anyway */ }
    shell.showItemInFolder(file);
  });
  // Support info for bug reports (idea from the LaF Client): version, OS, CPU, RAM and GPU in one paste.
  // Support info for bug reports (idea from the LaF Client): version, OS, CPU, RAM and GPU in one paste. The dashboard's
  // Diagnostics page adds the settings that matter for performance and the end of the log to the same text.
  const buildSystemInfo = async (): Promise<string> => {
    const os = await import('os');
    let gpu = 'unknown';
    try {
      const info: any = await app.getGPUInfo('basic');
      const devs: any[] = Array.isArray(info?.gpuDevice) ? info.gpuDevice : [];
      const names = devs.map((d) => String(d?.deviceString || d?.vendorString || '').trim()).filter(Boolean);
      if (names.length) gpu = names.join(' / ');
    } catch { /* keep unknown */ }
    const cpu = os.cpus()[0];
    const gb = (n: number): string => (n / 1073741824).toFixed(1) + ' GB';
    return [
      '===== KRH Client =====',
      `KRH Client v${app.getVersion()}`,
      `Electron ${process.versions.electron} / Chromium ${process.versions.chrome} / Node ${process.versions.node}`,
      `Build: ${!app.isPackaged ? 'development' : process.env.PORTABLE_EXECUTABLE_DIR ? 'Windows portable' : process.env.APPIMAGE ? 'Linux AppImage' : process.platform === 'win32' ? 'Windows installer' : process.platform}${safeMode ? ' (safe mode)' : ''}`,
      '===== System =====',
      `OS: ${os.type()} ${os.release()} ${os.arch()}`,
      `CPU: ${cpu ? cpu.model.trim() : 'unknown'} (${os.cpus().length} threads)`,
      `RAM: ${gb(os.totalmem() - os.freemem())} used / ${gb(os.totalmem())}`,
      `GPU: ${gpu}`,
      '===== Settings that matter for performance =====',
      `performance: ${JSON.stringify(config.get('performance'))}`,
      `advanced: ${JSON.stringify(config.get('advanced'))}`,
    ].join('\n');
  };
  ipcMain.handle('copy-system-info', async () => {
    clipboard.writeText(await buildSystemInfo());
    return true;
  });
  ipcMain.handle('open-log-folder', () => shell.openPath(join(app.getPath('userData'), 'logs')));
  ipcMain.handle('open-themes-folder', () => shell.openPath(join(swapDir, GAME_THEMES_DIR)));
  ipcMain.handle('open-social-themes-folder', () => shell.openPath(join(swapDir, SOCIAL_THEMES_DIR)));
  ipcMain.handle('open-backgrounds-folder', () => shell.openPath(join(swapDir, 'backgrounds')));
  ipcMain.handle('open-skies-folder', () => shell.openPath(join(swapDir, SKIES_DIR)));
  ipcMain.handle('open-screenshots-folder', () => openScreenshotsFolder());
  ipcMain.handle('reveal-screenshot', () => revealLastScreenshot());
  ipcMain.handle('open-recordings-folder', () => openRecordingsFolder());

  ipcMain.handle('game-server-ping', async () => {
    if (!_pingTarget) return -1;
    const key = `${_pingTarget.host}:${_pingTarget.port}`;
    if (key === gamePingCache.key && Date.now() - gamePingCache.at < 1000) return gamePingCache.ms;
    const ms = await tcpPing(_pingTarget.host, _pingTarget.port);
    gamePingCache = { key, ms, at: Date.now() };
    return ms;
  });

  // ── Ping regions IPC handler (TCP connect timing, cached 60s) ──
  ipcMain.handle('ping-regions', async () => {
    if (Object.keys(pingCache).length > 0) {
      // Answer at once; measure again in the background when the numbers are a minute old.
      if (Date.now() - pingCacheTime >= 60000) void refreshRegionPings();
      return pingCache;
    }
    return refreshRegionPings(); // nothing known yet: the first search waits for one capped round
  });
  // Measure once shortly after start-up, so even the first search of a session has numbers ready.
  setTimeout(() => { if (config.get('matchmaker')?.enabled) void refreshRegionPings(); }, 8000);

  ipcMain.handle('get-official-maps', () => loadOfficialMaps());

  // ── Ranked queue IPC handler ──
  ipcMain.on('open-ranked-queue', async (_e, token: string, region: string, allRegions: boolean) => {
    const mm = config.get('matchmaker');
    const [audioUrl, maps] = await Promise.all([resolveRankedAudioUrl(mm?.rankedMatchSound || ''), loadQueueMaps()]);
    const showHeader = config.get('ui')?.watermark ?? true;
    const vol = typeof mm?.rankedMatchVolume === 'number' ? Math.min(100, Math.max(0, mm.rankedMatchVolume)) / 100 : 1;
    openRankedQueue(token, region, allRegions, audioUrl, showHeader, maps, vol);
  });

  ipcMain.handle('pick-audio-file', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Select Audio File',
      properties: ['openFile'],
      filters: [
        { name: 'Audio', extensions: ['mp3', 'wav', 'ogg', 'oga', 'flac', 'm4a', 'aac'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    if (result.canceled || result.filePaths.length === 0) return '';
    return result.filePaths[0];
  });

  // Copies the pick in rather than storing its path: krh-swap only serves files under the swap dir.
  ipcMain.handle('pick-sky-image', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Select Sky Image',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: SKY_IMAGE_EXTS }],
    });
    if (result.canceled || result.filePaths.length === 0) return '';
    const src = result.filePaths[0];
    const ext = extname(src);
    // The dialog filter is advisory — the file name box opens anything typed into it
    if (!SKY_IMAGE_EXTS.includes(ext.slice(1).toLowerCase())) throw new Error(`Not a sky image: ${src}`);
    const destDir = join(swapDir, SKIES_DIR);
    if (dirname(resolvePath(src)) === resolvePath(destDir)) return `swap:${basename(src)}`;
    mkdirSync(destDir, { recursive: true });
    const stem = basename(src, ext);
    let name = `${stem}${ext}`;
    for (let n = 1; existsSync(join(destDir, name)); n++) name = `${stem} (${n})${ext}`;
    await fsp.copyFile(src, join(destDir, name));
    return `swap:${name}`;
  });

  ipcMain.handle('resolve-ranked-sound', (_e, setting: string) => resolveRankedAudioUrl(setting));

  ipcMain.handle('resolve-audio-file', (_e, setting: string) => resolveAudioUrl(setting));

  ipcMain.handle('resolve-social-music', (_e, setting: string) => resolveSocialMusic(setting));


  // ── Safe mode flag (the preload reads it once at startup) ──
  ipcMain.on('is-safe-mode', (e) => { e.returnValue = safeMode; });

  // ── Resource packs (Settings > Extras > Resource Packs) ──
  const packsDir = join(swapDir, '_packs');
  const packsView = () => ({ packs: listPacks(swapDir), enabled: getExtras().packs.enabled, dir: packsDir, swapperRunning: !!swapper, safeMode });
  const applyPackChange = async (): Promise<boolean> => {
    if (!swapper) return false;
    swapper.setEnabledPacks(getExtras().packs.enabled);
    await swapper.rescan();
    return true;
  };
  const saveEnabledPacks = (ids: string[]): void => {
    const ex = getExtras();
    config.set('extras', sanitizeExtras({ ...ex, packs: { ...ex.packs, enabled: ids } }));
  };
  ipcMain.handle('packs-list', () => packsView());
  ipcMain.handle('packs-install-url', async (_e, url: unknown) => {
    if (typeof url !== 'string' || url.length > 1000) return { ok: false, error: 'That is not a valid link' };
    return installPackFromUrl(swapDir, url.trim());
  });
  ipcMain.handle('packs-install-file', async () => {
    const parent = BrowserWindow.getFocusedWindow() || win;
    const r = await dialog.showOpenDialog(parent, { title: 'Install a resource pack', properties: ['openFile'], filters: [{ name: 'Zip files', extensions: ['zip'] }] });
    if (r.canceled || !r.filePaths[0]) return { ok: false, error: 'cancelled' };
    return installPackFromFile(swapDir, r.filePaths[0]);
  });
  ipcMain.handle('packs-set-enabled', async (_e, ids: unknown) => {
    const valid = new Set(listPacks(swapDir).map((p) => p.id));
    const list = Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string' && valid.has(x)).slice(0, 200) : [];
    saveEnabledPacks(list);
    const live = await applyPackChange();
    return { ok: true, needsRestart: !live && list.length > 0, enabled: list };
  });
  ipcMain.handle('packs-delete', async (_e, id: unknown) => {
    if (typeof id !== 'string' || !PACK_ID_RE.test(id)) return { ok: false };
    const done = await deletePack(swapDir, id);
    const ex = getExtras();
    const loadouts = ex.packs.loadouts.map((l) => ({ ...l, ids: l.ids.filter((x) => x !== id) }));
    config.set('extras', sanitizeExtras({ ...ex, packs: { enabled: ex.packs.enabled.filter((x) => x !== id), loadouts } }));
    await applyPackChange();
    return { ok: done };
  });
  ipcMain.handle('packs-open-folder', () => { mkdirSync(packsDir, { recursive: true }); return shell.openPath(packsDir); });

  // ── Share codes (profiles, crosshair, pack loadouts) ──
  ipcMain.handle('share-encode', (_e, kind: unknown, name: unknown, data: unknown) => {
    try { return { ok: true, code: encodeShare(kind as 'profile' | 'crosshair' | 'loadout', String(name || ''), data) }; }
    catch (err) { return { ok: false, error: (err as Error).message }; }
  });
  ipcMain.handle('share-decode', (_e, code: unknown) => {
    const r = decodeShare(String(code || ''));
    if (!r.ok) return r;
    if (r.kind === 'profile') {
      const d = r.data as { data?: unknown } | null;
      if (!d || typeof d.data !== 'string' || d.data.length < 2 || d.data.length > 1_900_000) return { ok: false, error: 'The profile in this code is not valid' };
      return { ok: true, kind: 'profile', name: r.name || 'Shared profile', data: d.data };
    }
    if (r.kind === 'crosshair') return { ok: true, kind: 'crosshair', name: r.name, data: sanitizeCrosshair(r.data) };
    const arr = (r.data as { packs?: unknown } | null)?.packs;
    if (!Array.isArray(arr)) return { ok: false, error: 'The loadout in this code is not valid' };
    const packs = arr.slice(0, 50)
      .map((x: { name?: unknown; source?: unknown }) => ({ name: String(x?.name || '').slice(0, 60), source: String(x?.source || '').slice(0, 500) }))
      .filter((x) => x.name);
    return { ok: true, kind: 'loadout', name: r.name || 'Shared loadout', packs };
  });

  // ── Anti-hack check and lockdown (integrity.ts) ──
  showLockWindow = (): void => {
    if (lockWin && !lockWin.isDestroyed()) { lockWin.show(); lockWin.focus(); return; }
    lockWin = new BrowserWindow({
      width: 540, height: 400, resizable: false, minimizable: false, maximizable: false, autoHideMenuBar: true,
      title: 'KRH Client - locked', backgroundColor: '#12060a',
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false },
    });
    lockWin.removeMenu();
    void lockWin.loadURL(lockdownPage(lockReason || 'Cheat software detected'));
    lockWin.webContents.on('will-navigate', (e, url) => {
      if (!url.startsWith('krh-lock://')) { if (!url.startsWith('data:')) e.preventDefault(); return; }
      e.preventDefault();
      if (url.startsWith('krh-lock://quit')) { app.quit(); return; }
      void runIntegrityCheck().then((reason) => {
        if (reason) { lockReason = reason; if (lockWin && !lockWin.isDestroyed()) void lockWin.loadURL(lockdownPage(reason)); return; }
        clearLock(); relaunchApp();
      });
    });
    lockWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    lockWin.on('closed', () => { lockWin = null; });
  };

  function enterLockdown(reason: string): void {
    lockReason = reason;
    if (!lockedDown) electronLog.warn('[KRH-Integrity] LOCKDOWN:', reason);
    lockedDown = true;
    writeLock(reason);
    gameActive = false;
    tabManager.locked = true;
    try { if (!win.isDestroyed()) { win.webContents.setAudioMuted(true); void win.loadURL('about:blank'); win.hide(); } } catch { /* window already gone */ }
    try { tabManager.destroyAll(); } catch { /* no tabs */ }
    closeDashboard();
    if (!hub.isDestroyed()) { hub.hide(); void hub.loadURL('about:blank'); }
    showLockWindow();
  }

  /** First reason found for a lockdown, or null when everything is clean. */
  async function runIntegrityCheck(withProcesses = true): Promise<string | null> {
    const flags = scanLaunchFlags();
    if (flags) return flags;
    if (withProcesses) {
      const proc = await scanProcesses();
      if (proc) return proc;
    }
    const scripts = scanScripts(userscriptManager?.dir ?? null);
    if (scripts) return scripts;
    if (gameActive && !win.isDestroyed()) {
      const probe = await win.webContents.executeJavaScript(GAME_PROBE_JS).catch(() => '');
      if (typeof probe === 'string' && probe) return `Cheat menu found in the game page (${probe})`;
    }
    return null;
  }

  let integrityRound = 0;
  const integrityCycle = async (): Promise<void> => {
    if (lockedDown) return;
    integrityRound++;
    const reason = await runIntegrityCheck(integrityRound % 3 === 0);
    if (reason) enterLockdown(reason);
  };
  // First check shortly after start (also decides whether a locked run stays locked). After that the cheap checks
  // run every 2 minutes and the process list (which starts a small system program) every 6 minutes, so nothing
  // here is felt while playing.
  setTimeout(() => {
    void runIntegrityCheck().then((reason) => {
      if (reason) { enterLockdown(reason); return; }
      if (lockedDown) { lockedDown = false; clearLock(); if (lockWin && !lockWin.isDestroyed()) lockWin.destroy(); openDash(); }
    });
  }, 2500);
  setInterval(() => { void integrityCycle(); }, 120_000).unref();
  if (lockedDown) showLockWindow();

  // ── Website -> client bridge (the "Use in KRH Client" buttons on the KRH website; see site-bridge.ts) ──
  registerSiteBridge({
    version: appVersion,
    hub: () => (hub.isDestroyed() ? null : hub),
    userCss,
    applyUserCss,
    installScript: async (title, code) => {
      // Works even when Userscripts are off: the file and its switch are written, and Userscripts are turned on
      // (they start at the next launch, because the engine loads when the client starts).
      const mgr = userscriptManager ?? new UserscriptManager(usDir);
      const stem = `KRH - ${title}`.slice(0, 100);
      let file = stem + '.js';
      for (let i = 2; existsSync(join(mgr.dir, file)); i++) file = `${stem} (${i}).js`;
      try {
        mkdirSync(mgr.dir, { recursive: true });
        writeFileSync(join(mgr.dir, file), code, 'utf-8');
        const tracker = await mgr.loadTracker(await mgr.scanScripts());
        tracker[file] = true;
        await mgr.saveTracker(tracker);
      } catch (err) { return { ok: false, error: (err as Error).message }; }
      if (!userscriptManager) {
        config.set('userscripts', { ...usConfig, enabled: true });
        return { ok: true, message: `"${title}" is added and switched on. Userscripts were off, so they are on now: restart KRH Client once (Restart Client button).` };
      }
      const live = gameActive && !win.isDestroyed();
      if (live) win.webContents.reload();
      return { ok: true, message: live ? `"${title}" is on and the game was reloaded.` : `"${title}" is on. It runs the next time the game loads.` };
    },
  });

  // ── Streamer mode ──
  const setStreamer = (on: boolean): void => {
    const ex = getExtras();
    config.set('extras', sanitizeExtras({ ...ex, streamerMode: on }));
    if (on) discordRpc?.clearActivity(); else discordRpc?.restoreActivity();
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('streamer-mode', on);
  };
  ipcMain.handle('streamer-set', (e, on: unknown) => {
    if (e.sender !== win.webContents) return getExtras().streamerMode;
    setStreamer(on === true);
    return getExtras().streamerMode;
  });

  // ── Session stats ──
  ipcMain.on('session-stats-delta', (e, d: unknown) => {
    if (e.sender !== win.webContents || !getExtras().sessionStats.enabled) return;
    addDelta(d as Parameters<typeof addDelta>[0]);
  });
  ipcMain.handle('session-stats-get', (e) => (e.sender === win.webContents ? getStats() : null));
  ipcMain.handle('session-stats-clear', (e) => { if (e.sender === win.webContents) clearStats(); });

  // ── Instant replay ──
  ipcMain.handle('replay-save', async (e) => {
    if (e.sender !== win.webContents || !gameActive || !getExtras().instantReplay.enabled) return false;
    await saveReplayClip();
    return true;
  });

  // ── Updates: state for the settings page ──
  ipcMain.handle('update-ready-info', () => { const r = getReadyUpdate(); return r ? { version: r.version } : null; });
  ipcMain.handle('update-install-now', () => installReadyUpdate());

  // ── Discord Rich Presence IPC handler ──
  ipcMain.on('discord-update', (_e, activity: any) => {
    const buttons = rpcButtons();
    if (activity && typeof activity === 'object') {
      if (buttons.length) activity.buttons = buttons; else delete activity.buttons;
      // Settings gate the extra presence features here too, so a page can never switch them on by itself
      const rich = getExtras().rpcRich;
      if (!rich.join) { delete activity.joinSecret; delete activity.partyId; delete activity.partySize; }
      if (!rich.classIcon) { delete activity.smallImageKey; delete activity.smallImageText; }
    }
    // Streamer mode keeps the presence hidden but remembers it for when the mode is switched off
    if (getExtras().streamerMode) { discordRpc?.holdActivity(activity); return; }
    discordRpc?.setActivity(activity);
  });

  // ── Verbose log IPC handler (preload forwards logs here) ──
  ipcMain.on('verbose-log', (_e, level: string, ...args: unknown[]) => {
    if (level === 'error') rendererLog.error(...args);
    else if (level === 'warn') rendererLog.warn(...args);
    else rendererLog.log(...args);
  });

  // ── CSS theme & loading background IPC handlers ──
  ipcMain.handle('list-themes', () => listThemes(swapDir));
  ipcMain.handle('list-social-themes', () => listThemes(swapDir, SOCIAL_THEMES_DIR));
  ipcMain.handle('get-theme-css', (_e, themeId: string) => getThemeCSS(themeId, swapDir));
  ipcMain.handle('list-loading-themes', () => listLoadingThemes(swapDir));
  ipcMain.handle('list-sky-images', () => listSkyImages(swapDir));
  // Sync: the preload reads this once at top level, before wrapping fetch. The image
  // resolves here so a selected-but-missing file falls back to the gradient.
  ipcMain.on('get-sky-config', (e) => {
    const uiConf = config.get('ui');
    e.returnValue = {
      enabled: uiConf?.skyOverride ?? DEFAULT_CONFIG.ui.skyOverride,
      zenith: uiConf?.skyZenith || DEFAULT_CONFIG.ui.skyZenith,
      horizon: uiConf?.skyHorizon || DEFAULT_CONFIG.ui.skyHorizon,
      useImage: resolveSkyImage(uiConf?.skyImage || '', swapDir) !== null,
    };
  });
  ipcMain.handle('get-loading-screen-css', (_e, loadingTheme: string, backgroundUrl: string) => {
    return getLoadingScreenCSS(loadingTheme, backgroundUrl, swapDir);
  });

  // ── Changelog IPC handler (fetch release notes from GitHub) ──
  const fetchChangelog = async (version: string): Promise<string> => {
    const tag = version.startsWith('v') ? version : `v${version}`;
    try {
      const data = await new Promise<string>((resolve, reject) => {
        httpsGet(`https://api.github.com/repos/krunkerresourcehub/krh-client/releases/tags/${tag}`, { headers: { 'User-Agent': 'KRH' } }, (res) => {
          let body = '';
          res.on('data', (chunk: string) => { body += chunk; });
          res.on('end', () => resolve(body));
          res.on('error', reject);
        }).on('error', reject);
      });
      const release = JSON.parse(data);
      return release.body || '';
    } catch (err) {
      electronLog.warn('[KRH] Changelog fetch failed for ' + tag + ':', err);
      return '';
    }
  };
  ipcMain.handle('changelog-fetch', (_e, version: string) => fetchChangelog(version));

  ipcMain.handle('github-issue-count', () => getIssueCount());

  // ── Userscript IPC handlers ──
  ipcMain.handle('userscripts-get-dir', () => userscriptManager ? userscriptManager.dir : '');
  ipcMain.handle('userscripts-open-folder', () => {
    if (userscriptManager) shell.openPath(userscriptManager.dir);
  });
  ipcMain.handle('userscripts-scan', async () => {
    if (!userscriptManager) return { scripts: [], tracker: {} };
    const scripts = await userscriptManager.scanScripts();
    const tracker = await userscriptManager.loadTracker(scripts);
    return { scripts, tracker };
  });
  ipcMain.handle('userscripts-set-tracker', (_e, tracker: Record<string, boolean>) => {
    if (userscriptManager) userscriptManager.saveTracker(tracker);
  });
  ipcMain.handle('userscripts-load-prefs', (_e, filename: string) => {
    if (!userscriptManager) return {};
    return userscriptManager.loadScriptPrefs(filename);
  });
  ipcMain.handle('userscripts-save-prefs', (_e, filename: string, prefs: Record<string, unknown>) => {
    if (userscriptManager) userscriptManager.saveScriptPrefs(filename, prefs);
  });

  // ── Action button IPC handlers ──
  ipcMain.handle('open-electron-log', () => {
    shell.openPath(getLogPath());
  });
  ipcMain.handle('open-client-folder', () => shell.openPath(app.getPath('userData')));
  ipcMain.handle('reset-swapper', async () => {
    try {
      const entries = await fsp.readdir(swapDir, { withFileTypes: true });
      for (const entry of entries) {
        await fsp.rm(join(swapDir, entry.name), { recursive: true, force: true });
      }
      electronLog.log('[KRH] Swapper reset (' + entries.length + ' entries cleared)');
      return true;
    } catch (err) {
      electronLog.error('[KRH] Reset swapper failed:', err);
      return false;
    }
  });
  ipcMain.handle('restart-client', () => {
    relaunchApp();
  });
  ipcMain.handle('reset-options', () => {
    config.clear();
    relaunchApp(false);
  });
  ipcMain.handle('delete-all-data', async () => {
    // Stop the page so Krunker can't re-persist anything mid-wipe.
    try { win.webContents.stop(); } catch { /* already gone */ }
    // Clear browsing data: the persistent Krunker partition holds the login token
    // and kro_setngss_* settings (localStorage), cookies, and cache. config.clear()
    // alone never touched these, which is why logins/settings used to survive.
    try {
      await ses.clearStorageData();
      await ses.clearCache();
      await session.defaultSession.clearStorageData();
      await session.defaultSession.clearCache();
    } catch (err) {
      electronLog.warn('[KRH] Clearing browsing data failed (non-fatal):', err);
    }
    config.clear();
    try {
      await fsp.rm(join(app.getPath('userData'), 'logs'), { recursive: true, force: true });
    } catch (err) {
      electronLog.warn('[KRH] Log deletion failed (non-fatal):', err);
    }
    // Userscripts and swapper files live under userData/KRH Client/
    // and are intentionally left untouched.
    relaunchApp();
  });

  // ── Settings export/import ──
  // Bundles client settings (allowlisted categories, never alt accounts) plus a
  // snapshot of Krunker's own settings (the s_* localStorage keys, passed in from
  // the renderer) into one JSON file. Import re-filters through the same allowlist.
  ipcMain.handle('export-settings', async (_e, krunkerSettings: Record<string, string> | undefined) => {
    flushPendingConfigWrites();

    const clientSettings: Record<string, unknown> = {};
    for (const key of EXPORT_CONFIG_KEYS) {
      clientSettings[key] = config.get(key as keyof typeof config.store);
    }
    // Shallow-copy the two categories we trim so we never mutate the live store.
    // Drop transient runtime fields that shouldn't travel between installs.
    clientSettings.game = { ...(clientSettings.game as Record<string, unknown>) };
    delete (clientSettings.game as Record<string, unknown>).lastServer;
    clientSettings.ui = { ...(clientSettings.ui as Record<string, unknown>) };
    delete (clientSettings.ui as Record<string, unknown>).lastSeenVersion;
    delete (clientSettings.ui as Record<string, unknown>).skippedUpdateVersion;

    const payload = {
      app: 'KRH-Client',
      type: 'settings-export',
      formatVersion: 1,
      appVersion,
      exportedAt: new Date().toISOString(),
      client: clientSettings,
      krunker: krunkerSettings && typeof krunkerSettings === 'object' ? krunkerSettings : {},
    };

    const result = await dialog.showSaveDialog(win, {
      title: 'Export Settings',
      defaultPath: join(app.getPath('documents'), 'krh-settings.json'),
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };

    try {
      await fsp.writeFile(result.filePath, JSON.stringify(payload, null, 2), 'utf-8');
      electronLog.log('[KRH] Settings exported to ' + result.filePath);
      return { success: true, path: result.filePath };
    } catch (err) {
      electronLog.error('[KRH] Settings export failed:', err);
      return { success: false, error: String(err) };
    }
  });

  ipcMain.handle('import-settings', async (_e, skipGroups: string[] = []) => {
    const result = await dialog.showOpenDialog(win, {
      title: 'Import Settings',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (result.canceled || result.filePaths.length === 0) return { canceled: true };

    let parsed: any;
    try {
      const raw = await fsp.readFile(result.filePaths[0], 'utf-8');
      parsed = JSON.parse(raw);
    } catch (err) {
      electronLog.error('[KRH] Settings import: read/parse failed:', err);
      return { success: false, error: 'Could not read or parse the file.' };
    }

    if (!parsed || parsed.type !== 'settings-export' || typeof parsed.client !== 'object') {
      return { success: false, error: 'Not a valid KRH Client settings file.' };
    }

    // Stale debounced set-config writes could otherwise fire after we apply and
    // clobber the import — flush them first so our config.set calls win.
    flushPendingConfigWrites();

    // Apply only allowlisted categories, merged over defaults so old/partial
    // exports keep their missing fields. 'accounts' can never be set here — it's
    // not in EXPORT_CONFIG_KEYS — so alt credentials are unaffected by import.
    // The renderer restarts the client after this, which is what makes every
    // imported setting (and derived state like tab mode / hideBunnies) take hold.
    const skipKeybinds = Array.isArray(skipGroups) && skipGroups.includes('keybinds');
    let applied = 0;
    for (const key of EXPORT_CONFIG_KEYS) {
      if (skipKeybinds && key === 'keybinds') continue;
      const incoming = parsed.client[key];
      if (incoming && typeof incoming === 'object' && !Array.isArray(incoming)) {
        config.set(key as any, keepFolderPath(key, { ...(DEFAULT_CONFIG as Record<string, any>)[key], ...incoming }));
        applied++;
      }
    }

    const krunker = parsed.krunker && typeof parsed.krunker === 'object' ? parsed.krunker : {};
    if (applied === 0 && Object.keys(krunker).length === 0) {
      return { success: false, error: 'No recognized settings found in the file.' };
    }
    electronLog.log('[KRH] Settings imported (' + applied + ' client categories, ' + Object.keys(krunker).length + ' Krunker keys) from ' + result.filePaths[0]);

    return { success: true, krunker };
  });

  // ── Alt manager IPC handlers (credentials encrypted via safeStorage) ──
  const canEncrypt = safeStorage.isEncryptionAvailable();
  if (!canEncrypt) electronLog.warn('[KRH] safeStorage encryption not available — account passwords will use base64 fallback');

  function encryptString(plaintext: string): string {
    if (canEncrypt) return safeStorage.encryptString(plaintext).toString('base64');
    return Buffer.from(plaintext).toString('base64');
  }

  function decryptString(encrypted: string): string {
    if (canEncrypt) return safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
    return Buffer.from(encrypted, 'base64').toString();
  }

  ipcMain.handle('alt-list', () => {
    const accounts = config.get('accounts') || [];
    // Labels + the public avatar URL only — never the encrypted credentials.
    return accounts.map((a: SavedAccount) => ({ label: a.label, avatarUrl: a.avatarUrl || null }));
  });

  // Link the currently logged-in Krunker account (username + the avatar URL Krunker
  // rendered, both read by the renderer) to a saved account by matching the decrypted
  // username here in main. Lets us show each account's avatar without exposing
  // usernames to the renderer or hitting Krunker's (captcha-walled) profile API.
  ipcMain.handle('alt-link-current', (_e, username: string, avatarUrl: string) => {
    if (!username || !avatarUrl) return false;
    // Only accept https Krunker asset URLs — never arbitrary or data: URLs.
    try {
      const u = new URL(avatarUrl);
      if (u.protocol !== 'https:' || !isKrunkerHost(u.hostname)) return false;
    } catch { return false; }
    const accounts = config.get('accounts') || [];
    const target = username.toLowerCase();
    let changed = false;
    for (const acc of accounts) {
      try {
        if (decryptString(acc.username).toLowerCase() === target && acc.avatarUrl !== avatarUrl) {
          acc.avatarUrl = avatarUrl;
          changed = true;
        }
      } catch { /* skip accounts that fail to decrypt */ }
    }
    if (changed) config.set('accounts', accounts);
    return changed;
  });

  ipcMain.handle('alt-save', (_e, data: { label: string; username: string; password: string }) => {
    try {
      const accounts = config.get('accounts') || [];
      const account: SavedAccount = {
        label: data.label,
        username: encryptString(data.username),
        password: encryptString(data.password),
      };
      accounts.push(account);
      config.set('accounts', accounts);
      electronLog.log('[KRH] Saved alt account "' + data.label + '"');
      return { success: true, index: accounts.length - 1 };
    } catch (err) {
      electronLog.error('[KRH] Failed to save alt account:', err);
      return { success: false };
    }
  });

  ipcMain.handle('alt-get-credentials', (_e, index: number) => {
    const accounts = config.get('accounts') || [];
    if (index < 0 || index >= accounts.length) return null;
    const acc = accounts[index];
    try {
      return {
        username: decryptString(acc.username),
        password: decryptString(acc.password),
      };
    } catch (err) {
      electronLog.error('[KRH] Failed to decrypt account credentials:', err);
      return null;
    }
  });

  ipcMain.handle('alt-remove', (_e, index: number) => {
    const accounts = config.get('accounts') || [];
    if (index < 0 || index >= accounts.length) return { success: false };
    accounts.splice(index, 1);
    config.set('accounts', accounts);
    return { success: true };
  });

  ipcMain.handle('alt-rename', (_e, index: number, newLabel: string) => {
    const accounts = config.get('accounts') || [];
    if (index < 0 || index >= accounts.length) return { success: false };
    accounts[index].label = newLabel;
    config.set('accounts', accounts);
    return { success: true };
  });

  // ── Stop page immediately on close to kill audio ──
  // Closing the game window returns to the dashboard (the game page is unloaded so audio/network stop).
  win.on('close', (event) => {
    stopRecording();
    stopReplayBuffer();
    const ended = endSession();
    if (ended && getExtras().sessionStats.summary && Notification.isSupported()) {
      new Notification({ title: 'KRH session summary', body: summaryText(ended), silent: true }).show();
    }
    win.webContents.setAudioMuted(true);
    win.webContents.stop();
    stopServerPing();
    twitchChat.disconnect();
    spotify.stopPolling();
    if (!appQuitting) {
      // Closing the game returns to the dashboard (the KRH website stays hidden until its button is pressed)
      event.preventDefault();
      gameActive = false;
      void win.loadURL('about:blank');
      win.hide();
      unparkHub();
      openDash();
    }
  });

  // ── Shutdown: disconnect Discord, then close log streams ──
  app.on('will-quit', () => {
    releaseEscapeShortcut();
    flushStats();
    installOnQuitIfWanted();
    markCleanQuit();
    discordRpc?.disconnect();
    spotify.shutdown();
    electronLog.log('[KRH] Shutting down');
    closeLogStreams();
  });

  electronLog.log('[KRH] Initialization complete — hub loading, game starts on Play');
}

app.on('window-all-closed', () => {
  app.quit();
});
