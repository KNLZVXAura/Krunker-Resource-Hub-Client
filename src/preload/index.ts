import { ipcRenderer } from 'electron';
import { fetchGame, loadMatchmakerLists } from './matchmaker';
import type { MatchmakerConfig } from './matchmaker';
import { hookSettings } from './settings-render';
import { hookNativeImport } from './native-import';
import { initUserscripts, initBuiltins } from './userscripts';
import { initTranslator } from './translator';
import { clampBrightness, installCompositorAnimFix, setDeathAnimBlock, setGameBrightness, setMenuTimer, setWatermark, showToast } from './utils';
import { initChat } from './chat';
import { initHPCounter, initRankProgress } from './competitive';
import { initKeystrokes } from './keystrokes';
import type { KeystrokesConfig } from './keystrokes';
import { initStatCounter } from './stat-counter';
import { installInventoryScroll } from './inventory-scroll';
import { setTwitchChat } from './twitch-chat';
import type { TwitchChatConfig } from './twitch-chat';
import { setSpotifyOverlay } from './spotify-overlay';
import type { SpotifyOverlayConfig } from './spotify-overlay';
import { checkChangelog } from './changelog';
import { DEFAULT_CONFIG } from '../main/config-defaults';
import { savedConsole as _console, setVerbose } from './saved-console';
import { setServerFilter } from './serverlist-filter';
import { setGameLoop } from './game-loop';
import { initAltManagerButton } from './alt-manager';
import { startHidePopups, setClassicSocial, initModManagerButton, setCleanMenu, setSelectableChat, setQuickClassPicker, setClassicMenu } from './menu-tweaks';
import { initUiStateReporter } from './ui-state';
import { installRankedLeaderboardSearch, disableRankedLeaderboardSearch } from './ranked-leaderboard';
import { initSocialMusic } from './social-music';
import { initBanlog } from './banlog';
import { installGameSocketTap } from './game-socket';
import { installSkyHook } from './sky';
import { installSoundHook, setHeadshotSoundMode } from './headshot-sound';
import { initStreamerMode } from './streamer-mode';
import { initSessionTracker } from './session-tracker';
import { initLayoutEditor } from './layout-editor';
import { initReplayKey } from './replay-key';
import { initTradeDing } from './trade-ding';
import { initKrhProtocol } from './protocol';
import { initRankedBadges } from './ranked-badges';
import { initModDownloader } from './mod-downloader';
import { initChatTools } from './chat-tools';
import { initQuickPlay, initAutoRejoin } from './quickplay';
import { setCrosshair } from './crosshair';
import { setMotionBlur } from './motion-blur';
import { setChatDraft } from './chat-draft';
import { setRankedAlert } from './ranked-alert';
import { setAccountEndMessage } from './end-message';
import { installEscapeLockRelease } from './escape-lock';
import { setLiveAccuracy } from './live-accuracy';
import { setPerfHud } from './perf-hud';
import { initNameColors } from './name-colors';
import { setHiddenMenu } from './menu-hider';
import { initSuspectPing } from './kpd-call';


_console.log('[KRH] Preload script loaded');

// ── Game socket tap: wrap window.WebSocket before the game socket opens (read-only) ──
installGameSocketTap();

// ── Sky override: wrap window.fetch before the map config request goes out ──
installSkyHook();

// ── Fast Escape: report pointer-lock state to main so Escape can be taken there (game page only) ──
if (location.origin === 'https://krunker.io') installEscapeLockRelease();

// preventDefault on wheel events avoids Chromium 100+ pacing frame production to vsync during scroll gestures (FPS would tank from 1000+ to refresh rate). Skip when target is inside a real scrollable element so menus still scroll. krunker.io only: community.krunker.io scrolls the document.
if (location.origin === 'https://krunker.io') window.addEventListener('wheel', (e: WheelEvent) => {
    // Pointer lock = in-game weapon scroll: nothing is scrollable, and the
    // ancestor walk below forces style+layout (getComputedStyle/scrollHeight)
    // on every wheel tick mid-combat. Block the gesture without walking.
    if (document.pointerLockElement) {
        e.preventDefault();
        return;
    }
    let el = e.target as HTMLElement | null;
    while (el && el !== document.body && el !== document.documentElement) {
        const cs = getComputedStyle(el);
        const scrolls = (cs.overflowY === 'auto' || cs.overflowY === 'scroll' || cs.overflowX === 'auto' || cs.overflowX === 'scroll')
            && (el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth);
        if (scrolls) return;
        el = el.parentElement;
    }
    e.preventDefault();
}, { capture: true, passive: false });

// ── Tell Krunker this is a client (enables "Client" settings tab) ──
(window as any).OffCliV = true;

// ── IPC bridge exposed as window.krh ──
(window as any).krh = {
  platform: {
    getInfo: () => ipcRenderer.invoke('get-platform'),
  },
  config: {
    get: (key: string) => ipcRenderer.invoke('get-config', key),
    getAll: (keys: string[]) => ipcRenderer.invoke('get-all-config', keys),
    set: (key: string, value: unknown) => ipcRenderer.invoke('set-config', key, value),
  },
  window: {
    minimize: () => ipcRenderer.invoke('window-minimize'),
    maximize: () => ipcRenderer.invoke('window-maximize'),
    close: () => ipcRenderer.invoke('window-close'),
    isMaximized: () => ipcRenderer.invoke('window-is-maximized'),
  },
  dev: {
    toggleDevTools: () => ipcRenderer.invoke('toggle-devtools'),
  },
  swapper: {
    openFolder: () => ipcRenderer.invoke('open-swap-folder'),
    getPath: () => ipcRenderer.invoke('get-swap-dir'),
  },
  userscripts: {
    openFolder: () => ipcRenderer.invoke('userscripts-open-folder'),
    getPath: () => ipcRenderer.invoke('userscripts-get-dir'),
  },
};

initKrhProtocol();

// ── Direct Server Ping Display (TCP RTT from main, overrides #pingText + #menuPingText) ──
// Locks the textContent setter on first value arrival so Krunker's writes become
// no-ops; we write via innerText (different setter) so our value sticks. The
// lock is deferred so Krunker's value passes through if our IPC never fires.
function initDirectPingDisplay(): void {
    const locked = new WeakSet<HTMLElement>();
    ipcRenderer.on('server-ping', (_e, ms: number) => {
        const text = String(ms);
        for (const id of ['pingText', 'menuPingText']) {
            const el = document.getElementById(id);
            if (!el) continue;
            if (!locked.has(el)) {
                Object.defineProperty(el, 'textContent', { set: () => {}, configurable: true });
                locked.add(el);
            }
            el.innerText = text;
        }
    });
}

// ── Show Ping in Player List (numeric ms instead of icon) ──
// genList returns an HTML string — parse it, replace icon elements, return modified HTML.
function initShowPing(): void {
    const w = window as any;
    let attempts = 0;
    const poll = setInterval(() => {
        const origGenList = w.windows?.[22]?.genList;
        if (origGenList && !origGenList.__krhPingPatched) {
            clearInterval(poll);
            const patched = function (this: any) {
                const html = origGenList.call(this);
                const parser = new DOMParser();
                const doc = parser.parseFromString(html, 'text/html');
                for (const icon of doc.querySelectorAll('.pListPing.material-icons')) {
                    const ping = icon.getAttribute('title');
                    icon.classList.remove('pListPing', 'material-icons');
                    icon.removeAttribute('title');
                    // data-ping survives the class/title strip so the KPD call row can still read it.
                    icon.setAttribute('data-ping', ping ?? '');
                    icon.textContent = ping ? ping + ' ' : 'N/A ';
                }
                return doc.body.innerHTML;
            };
            (patched as any).__krhPingPatched = true;
            w.windows[22].genList = patched;
        } else if (++attempts > 75) {
            clearInterval(poll);
        }
    }, 200);
}

// ── Matchmaker IPC listener ──
ipcRenderer.on('matchmaker-find', (_e, mmConfig: MatchmakerConfig) => {
  fetchGame(mmConfig, _console).catch((err) => _console.error('[KRH] Matchmaker error:', err));
});

// ── Toast from main (e.g. screenshot confirmation) ──
// Safe mode (decided in the main process): overlays and the extra features are not started at all
const SAFE: boolean = ipcRenderer.sendSync('is-safe-mode') === true;

ipcRenderer.on('krh-toast', (_e, msg: string, action?: { label: string; id: string }) => {
  // Only one button exists so far: "Open folder" on a saved screenshot (the main process shows the file itself).
  if (action && action.id === 'reveal-screenshot') {
    showToast(msg, { label: String(action.label).slice(0, 24), onClick: () => { void ipcRenderer.invoke('reveal-screenshot'); } });
  } else showToast(msg);
});

// Re-link swapped krunker.io stylesheets under a fresh URL: the memory cache would otherwise keep the old copy.
// The swapper ignores the query string, so the new URL still resolves to the swap file.
ipcRenderer.on('swap-css-reload', (_e, paths: string[]) => {
  const wanted = new Set(paths.map((p) => p.toLowerCase()));
  for (const link of document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')) {
    if (!link.href || link.dataset.krhStale) continue;
    const url = new URL(link.href);
    if (!/(^|\.)krunker\.io$/.test(url.hostname) || !wanted.has(url.pathname.toLowerCase())) continue;
    url.searchParams.set('krhSwap', String(Date.now()));
    const fresh = link.cloneNode() as HTMLLinkElement;
    fresh.href = url.href;
    link.dataset.krhStale = '1';
    // Keep the old sheet until the new one applies, so there is no unstyled flash
    fresh.addEventListener('load', () => link.remove(), { once: true });
    fresh.addEventListener('error', () => { fresh.remove(); delete link.dataset.krhStale; }, { once: true });
    link.after(fresh);
  }
});

// Ranked leaderboard search: must wrap fetch before the social page requests the rankings, so it is
// installed right away (not after the config round-trip below) and switched off later if disabled.
if (window.location.pathname === '/social.html' || window.location.pathname === '/' || window.location.pathname === '') installRankedLeaderboardSearch();


// ── Wait for main process to signal page load, then poll for settings window ──
ipcRenderer.on('main_did-finish-load', () => {
  _console.log('[KRH] did-finish-load received, waiting to hook settings...');

  const isGamePage = window.location.pathname === '/' || window.location.pathname === '';

  // ── Batch all config reads into a single IPC call ──
  (window as any).closeClient = () => window.close();
  Promise.all([
    ipcRenderer.invoke('get-all-config', ['ui', 'userscripts', 'game', 'translator', 'keybinds', 'discord', 'advanced', 'performance']),
    ipcRenderer.invoke('get-platform'),
    ipcRenderer.invoke('get-version'),
  ]).then(([allConf, _platformInfo, currentVersion]: [any, any, string]) => {
    const uiConf = allConf.ui;
    const usConf = allConf.userscripts;
    const gameConf = allConf.game;
    const translatorConf = allConf.translator;
    const discordConf = allConf.discord;
    const advConf = allConf.advanced;

    // ── Verbose logging toggle ──
    setVerbose(advConf?.verboseLogging ?? false);

    // ── Exit button + UI toggles ──
    const showExit = uiConf ? (uiConf.showExitButton !== false) : true;
    const showExitBtn = () => {
      const btn = document.getElementById('clientExit');
      if (btn) {
        btn.style.display = showExit ? 'flex' : 'none';
        return true;
      }
      return false;
    };
    if (!showExitBtn()) {
      let exitAttempts = 0;
      const exitPoll = setInterval(() => {
        if (showExitBtn() || ++exitAttempts > 30) clearInterval(exitPoll);
      }, 500);
    }

    if (uiConf?.rankedLeaderboardSearch === false) disableRankedLeaderboardSearch();
    if (isGamePage) installCompositorAnimFix();
    if (uiConf?.deathscreenAnimation) setDeathAnimBlock(true);
    if (isGamePage) setGameBrightness(clampBrightness(uiConf?.gameBrightness));
    if (uiConf?.hideMenuPopups) startHidePopups();
    if (uiConf?.menuTimer ?? true) setMenuTimer(true);
    if (isGamePage && uiConf?.cleanMenu) setCleanMenu(true);
    if (isGamePage && gameConf?.selectableChat) setSelectableChat(true);
    if (isGamePage) initUiStateReporter();
    if (isGamePage && uiConf?.classicSocial) setClassicSocial(true);
    if (isGamePage) initModManagerButton();
    if (isGamePage) loadMatchmakerLists();
    if (isGamePage && !SAFE) installInventoryScroll();

    if (isGamePage) {
      initSocialMusic({
        source: uiConf?.socialMusic ?? '',
        volume: uiConf?.socialMusicVolume ?? 40,
        onSocial: uiConf?.socialMusicOnSocial ?? true,
        onMarket: uiConf?.socialMusicOnMarket ?? false,
      });
    }

    // ── Direct server ping (TCP RTT to the game server, replaces Krunker's display) ──
    if (isGamePage && uiConf?.directServerPing) {
      initDirectPingDisplay();
    }

    // ── Show ping in player list ──
    if (isGamePage && (gameConf?.showPing ?? true)) {
      initShowPing();
    }

    // ── Suspect ping on KPD calls ──
    if (isGamePage && (gameConf?.suspectPing ?? true)) {
      initSuspectPing();
    }

    // ── Raw input (Windows only — unadjustedMovement) ──
    if (isGamePage && process.platform === 'win32' && (gameConf?.rawInput ?? true)) {
      const origLock = HTMLCanvasElement.prototype.requestPointerLock;
      HTMLCanvasElement.prototype.requestPointerLock = function (opts?: any) {
        const promise = origLock.call(this, { ...opts, unadjustedMovement: true }) as any;
        if (promise && typeof promise.catch === 'function') {
          return promise.catch(() => origLock.call(this, opts));
        }
        return promise;
      };
    }

    // ── Better chat + Chat history ──
    if (isGamePage) {
      initChat({
        betterChat: gameConf?.betterChat ?? true,
        autoHideChat: gameConf?.autoHideChat ?? false,
        chatHistorySize: gameConf?.chatHistorySize ?? 200,
      }, _console);
    }

    // ── Competitive features ──
    if (isGamePage && (gameConf?.hpEnemyCounter ?? true)) {
      initHPCounter();
    }
    if (isGamePage) {
      initRankProgress();
    }

    // ── Headshot sound ──
    if (isGamePage) {
      setHeadshotSoundMode(gameConf?.headshotSound ?? 'off');
      installSoundHook();
    }

    // ── Trade request ding ──
    if (isGamePage) {
      initTradeDing({
        sound: gameConf?.tradeDingSound ?? 'off',
        volume: gameConf?.tradeDingVolume ?? 40,
        soundFile: gameConf?.tradeDingSoundFile ?? '',
        intervalSec: gameConf?.tradeDingInterval ?? 15,
      });
    }

    // ── Keystrokes + Mouse overlay ──
    if (isGamePage && !SAFE) {
      ipcRenderer.invoke('get-config', 'keystrokes').then((ksConf: KeystrokesConfig | undefined) => {
        if (ksConf && (ksConf.enabled || ksConf.mouseEnabled)) initKeystrokes(ksConf);
      }).catch((err) => _console.warn('[KRH] keystrokes config load failed:', err));
    }

    // ── Stat counter overlay (config key stays `nukeCounter`) ──
    if (isGamePage && !SAFE) {
      ipcRenderer.invoke('get-config', 'nukeCounter').then(initStatCounter)
        .catch((err) => _console.warn('[KRH] stat counter config load failed:', err));
    }

    // ── Twitch chat overlay ──
    if (isGamePage && !SAFE) {
      ipcRenderer.invoke('get-config', 'twitch').then((twConf: TwitchChatConfig | undefined) => {
        if (twConf && twConf.enabled) setTwitchChat({ ...DEFAULT_CONFIG.twitch, ...twConf });
      }).catch((err) => _console.warn('[KRH] twitch config load failed:', err));
    }

    // ── Spotify now-playing overlay ──
    if (isGamePage && !SAFE) {
      ipcRenderer.invoke('get-config', 'spotify').then((spConf: SpotifyOverlayConfig | undefined) => {
        if (spConf && spConf.enabled) setSpotifyOverlay({ ...DEFAULT_CONFIG.spotify, ...spConf });
      }).catch((err) => _console.warn('[KRH] spotify config load failed:', err));
    }

    // ── Extras: ranked badges, mod downloader, chat filters + logs, Quick Play, hidden menu elements ──
    if (isGamePage && !SAFE) {
      ipcRenderer.invoke('get-config', 'extras').then((exRaw: Partial<typeof DEFAULT_CONFIG.extras> | undefined) => {
        const ex = { ...DEFAULT_CONFIG.extras, ...exRaw };
        if (ex.rankedBadges) initRankedBadges();
        if (ex.modDownloader) initModDownloader();
        initChatTools({ filters: ex.chatFilters, filterKey: ex.chatFilterKey, logs: ex.chatLogs, logsKey: ex.chatLogsKey });
        initQuickPlay(ex.quickPlayKey);
        if (ex.autoRejoin) initAutoRejoin();
        if (ex.crosshair.enabled) setCrosshair(ex.crosshair);
        if (ex.hiddenMenu.length) setHiddenMenu(ex.hiddenMenu);
        if (ex.motionBlur.enabled) setMotionBlur(ex.motionBlur);
        if (ex.quickClassPicker) setQuickClassPicker(true);
        if (ex.classicMenu) setClassicMenu(true);
        setChatDraft(ex.chatDraft);
        setRankedAlert(ex.rankedAlert);
        if (ex.accountEndMessage) void setAccountEndMessage(true);
        if (ex.liveAccuracy?.enabled) setLiveAccuracy(true, ex.liveAccuracy.placement);
        if (ex.perfHud) setPerfHud(ex.perfHud);
        setServerFilter(ex.serverFilter?.enabled === true, ex.serverFilter?.words ?? '');
        if (ex.gameLoop?.enabled) setGameLoop(ex.gameLoop);
        if (ex.nameColors) initNameColors(ex.nameColors);
        // Version 1.1: streamer mode, session stats, instant replay key and the overlay layout editor
        initStreamerMode(ex.streamerMode, ex.streamerKey);
        initSessionTracker({
          enabled: ex.sessionStats?.enabled ?? true,
          key: ex.sessionStats?.key ?? 'Ctrl+Alt+K',
          autoStreak: ex.instantReplay?.enabled ? (ex.instantReplay.autoStreak || 0) : 0,
        });
        initLayoutEditor(ex.layoutEditorKey);
        if (ex.instantReplay?.enabled) initReplayKey(ex.instantReplay.key || 'Ctrl+Alt+R');
      }).catch((err) => _console.warn('[KRH] extras config load failed:', err));
    }

    // ── KRH watermark (in-game + menu) ──
    if (isGamePage) {
      setWatermark(uiConf?.watermark ?? true, currentVersion);
    }

    // ── Changelog popup ──
    if (isGamePage && (uiConf?.showChangelog ?? true)) {
      checkChangelog(currentVersion, uiConf?.lastSeenVersion || '');
    }

    // ── Battle Pass Claim All (game page only) ──
    // Poll for .bpBotH element — injects button when BP window is visible
    if (isGamePage) {
      const getClaimable = () => Array.from(document.querySelectorAll('.bpClaimB')).filter(
        (el: any) => el.offsetParent !== null && el.textContent?.trim() === 'Claim'
      );
      setInterval(() => {
        // The battle-pass window only exists in menus; skip the document-wide
        // selector + offsetParent (layout) read while pointer-locked in-game.
        if (document.pointerLockElement) return;
        const bar = document.querySelector('.bpBotH') as HTMLElement | null;
        if (!bar || bar.offsetParent === null) return;
        const existing = document.getElementById('claimAllBtn');
        if (existing) {
          // Update state on re-check (rewards may have become claimable)
          const claimable = getClaimable();
          if (claimable.length > 0) {
            existing.textContent = 'Claim All';
            existing.classList.remove('disabled');
          } else {
            existing.textContent = 'Nothing to Claim';
            existing.classList.add('disabled');
          }
          return;
        }
        const claimable = getClaimable();
        const btn = document.createElement('div');
        btn.className = 'bpBtn skip';
        btn.id = 'claimAllBtn';
        btn.style.cssText = 'margin-left: 8px; cursor: pointer; background: #4CAF50;';
        if (claimable.length > 0) {
          btn.textContent = 'Claim All';
        } else {
          btn.textContent = 'Nothing to Claim';
          btn.classList.add('disabled');
        }
        btn.addEventListener('click', async () => {
          if (btn.classList.contains('disabled')) return;
          (window as any).playSelect?.(0.1);
          const items = getClaimable();
          if (items.length === 0) return;
          btn.textContent = 'Claiming...';
          btn.classList.add('disabled');
          for (const item of items) {
            (item as HTMLElement).click();
            await new Promise(r => setTimeout(r, 200));
          }
          const remaining = getClaimable();
          btn.textContent = remaining.length > 0 ? 'Claim All' : 'Nothing to Claim';
          btn.classList.toggle('disabled', remaining.length === 0);
        });
        bar.appendChild(btn);
      }, 500);
    }

    // ── Initialize userscripts ──
    // Built-in scripts have their own switches and do not depend on the scripts folder setting
    void initBuiltins(_console).catch(err => _console.error('[KRH] Built-in scripts error:', err));
    const usEnabled = usConf ? usConf.enabled : true;
    if (usEnabled) {
      initUserscripts(_console).catch(err => _console.error('[KRH] Userscript init error:', err));
    }

    // ── Join as Spectator — auto-enable spectate on regular game join ──
    if (isGamePage && gameConf?.joinAsSpectator) {
      let attempts = 0;
      const poll = setInterval(() => {
        if (++attempts > 300) { clearInterval(poll); return; }
        const uiBase = document.getElementById('uiBase');
        if (!uiBase || uiBase.className === '') return;
        if (uiBase.className === 'onMenu') {
          const specBtn = document.querySelector('#spectButton input') as HTMLInputElement;
          if (specBtn && !specBtn.checked) {
            (window as any).setSpect(1);
          }
          clearInterval(poll);
        } else {
          clearInterval(poll);
        }
      }, 100);
    }

    // ── Initialize chat translator (game page only) ──
    if (isGamePage) {
      const mergedTl = { ...DEFAULT_CONFIG.translator, ...translatorConf };
      initTranslator(_console, mergedTl);
    }

    // ── Discord Rich Presence game state polling ──
    if (isGamePage && discordConf?.enabled) {
      const showMapMode = discordConf.showMapMode !== false;
      const showClass = discordConf.showClass !== false;
      const showTimer = discordConf.showTimer !== false;
      const showStatus = discordConf.showStatus !== false;

      const GENERIC_DETAILS = 'Playing Krunker';
      // Extra presence features (Settings > Extras > Discord Presence+). Off until the settings say otherwise.
      let rich = { classIcon: false, mapArt: false, join: false };
      ipcRenderer.invoke('get-config', 'extras').then((x: any) => { rich = { ...rich, ...(x?.rpcRich || {}) }; }).catch(() => { /* keep defaults */ });
      const slug = (t: string): string => t.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 28);
      let lastRich = '';
      let lastDetails = '';
      let lastState = '';
      let lastHadTimer = false;
      let firstSend = true;
      let gameStartTimestamp = Math.floor(Date.now() / 1000);

      function pollDiscordState(): void {
        let details = '';
        let state = '';
        let startTimestamp: number | undefined = undefined;
        let matchMap = '';
        let matchClass = '';
        let inMatchNow = false;

        const w = window as any;
        const spectating = w.spectating;

        let gameActivity: any = null;
        if (typeof w.getGameActivity === 'function') {
          try { gameActivity = w.getGameActivity(); } catch { /* game API unavailable */ }
        }

        if (spectating) {
          if (showStatus) details = 'Spectating';
          if (showMapMode && gameActivity?.map) {
            state = gameActivity.map;
          }
        } else {
          const uiBase = document.getElementById('uiBase');
          if (uiBase && uiBase.className === 'onMenu') {
            if (showStatus) details = 'In Menus';
          } else {
            if (showMapMode) {
              const mode = typeof gameActivity?.mode === 'string' ? gameActivity.mode.trim() : '';
              const map = typeof gameActivity?.map === 'string' ? gameActivity.map.trim() : '';
              if (mode && map) {
                details = mode + ' on ' + map;
              } else if (map || mode) {
                details = map || mode;
              } else {
                const mapInfo = document.getElementById('mapInfo')?.textContent?.trim();
                details = mapInfo || GENERIC_DETAILS;
              }
            }

            if (showClass) {
              if (gameActivity?.class?.name) {
                state = gameActivity.class.name;
              } else {
                const classElem = document.getElementById('menuClassName');
                if (classElem?.textContent) state = classElem.textContent;
              }
            }

            if (showTimer) startTimestamp = gameStartTimestamp;

            inMatchNow = true;
            matchMap = typeof gameActivity?.map === 'string' ? gameActivity.map.trim() : '';
            matchClass = typeof gameActivity?.class?.name === 'string' ? gameActivity.class.name.trim()
              : (document.getElementById('menuClassName')?.textContent?.trim() || '');
          }
        }

        // Art and Join (only inside a match). Asset keys: map_<name> and class_<name>, see DISCORD-ART.md.
        let largeImageKey = 'krh_logo';
        let largeImageText = 'Krunker Resource Hub Client';
        let smallImageKey: string | undefined;
        let smallImageText: string | undefined;
        let joinSecret: string | undefined;
        let partyId: string | undefined;
        let partySize: [number, number] | undefined;
        if (inMatchNow) {
          if (rich.mapArt && matchMap) { largeImageKey = 'map_' + slug(matchMap); largeImageText = matchMap; }
          if (rich.classIcon && matchClass) { smallImageKey = 'class_' + slug(matchClass); smallImageText = matchClass; }
          const gid = new URLSearchParams(location.search).get('game') || '';
          if (rich.join && /^[A-Za-z0-9:_-]{3,64}$/.test(gid)) {
            joinSecret = gid;
            partyId = 'krh-' + gid;
            const cur = Number(gameActivity?.players ?? gameActivity?.playerCount);
            const max = Number(gameActivity?.maxPlayers ?? gameActivity?.playerLimit);
            if (Number.isInteger(cur) && Number.isInteger(max) && cur >= 1 && max >= cur) partySize = [cur, max];
          }
        }
        const richKey = [largeImageKey, smallImageKey, joinSecret, partySize?.join('/')].join('|');

        if (firstSend || details !== lastDetails || state !== lastState || richKey !== lastRich) {
          // Restart the timer when a new match begins (coming from menus/spectating, or a different map/mode),
          // but not when the generic loading text is just being replaced by the real map/mode.
          if (startTimestamp && (!lastHadTimer || (lastDetails !== details && lastDetails !== GENERIC_DETAILS))) {
            gameStartTimestamp = Math.floor(Date.now() / 1000);
          }
          if (startTimestamp) startTimestamp = gameStartTimestamp;
          lastHadTimer = !!startTimestamp;
          lastDetails = details;
          lastState = state;
          lastRich = richKey;
          firstSend = false;
          ipcRenderer.send('discord-update', {
            details: details || undefined,
            state: state || undefined,
            startTimestamp,
            largeImageKey,
            largeImageText,
            smallImageKey,
            smallImageText,
            joinSecret,
            partyId,
            partySize,
          });
        }
      }

      pollDiscordState();
      setInterval(pollDiscordState, 5000);
      document.addEventListener('pointerlockchange', pollDiscordState);
    }
    // ── In-game Accounts quick-switch button ──
    if (isGamePage) initAltManagerButton();

    // ── Ban log enhancements (search + relative times in Krunker's native KPD popup) ──
    if (isGamePage) initBanlog();

  }).catch((err) => _console.error('[KRH] preload init failed:', err));

  const pollInterval = setInterval(() => {
    const w = window as any;
    if (
      Object.hasOwn(w, 'showWindow')
      && typeof w.showWindow === 'function'
      && Object.hasOwn(w, 'windows')
      && Array.isArray(w.windows)
      && w.windows.length >= 0
      && typeof w.windows[0] !== 'undefined'
      && typeof w.windows[0].changeTab === 'function'
    ) {
      clearInterval(pollInterval);
      _console.log('[KRH] Settings window found, hooking...');
      hookSettings();
      hookNativeImport();
    }
  }, 500);
});

// ── Lightweight tab page init (skips game-only features) ──
ipcRenderer.on('main_did-finish-load-tab', () => {
  _console.log('[KRH] Tab page loaded');
  // Editor and scripting pages: the built-in scripts that target them (Quick Krunker Docs Integration)
  void initBuiltins(_console, true).catch(err => _console.error('[KRH] Built-in scripts error:', err));
  (window as any).closeClient = () => window.close();
});
