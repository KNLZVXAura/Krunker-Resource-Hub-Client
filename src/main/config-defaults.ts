// Canonical config types and default values.
//
// This module has NO electron-store dependency on purpose: the preload bundle is
// sandboxed and can't pull Node modules, but it can import this for the single
// source of truth on defaults. config.ts wraps DEFAULT_CONFIG in the actual Store.
import type { SettingPreset } from '../shared/presets';


// Sky dome textures are referenced by user-asset ID. This one is deliberately not a
// real asset: the preload writes it into the map config, and main redirects the
// resulting texture request to a local file, so it never reaches the network.
// Shared here because both processes need the same number.
export const SKY_SENTINEL_ID = 9900001;

// Payload of the 'resolve-social-music' IPC: a remote URL passes straight through,
// a local file comes back as raw bytes for the renderer to wrap in a Blob. Declared
// here because main and both preload consumers have to agree on it — ipcRenderer
// .invoke is typed `any`, so a mismatch is otherwise silent until runtime.
export type SocialMusicSource = { url: string } | { bytes: Uint8Array; mime: string } | null;

export interface Keybind {
  key: string;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
}

export interface SavedAccount {
  label: string;
  username: string;
  password: string;
  // Account avatar image URL, captured from Krunker's rendered header (.ph-avatar)
  // after logging into the account — the custom picture for premium accounts, or
  // Krunker's default avatar for non-premium ones. Public asset URL, never a credential.
  avatarUrl?: string;
}

export interface ExtrasConfig {
  /** Ranked badges next to names on the normal in-game leaderboard. */
  rankedBadges: boolean;
  /** Download icon on the cards of Krunker's Mods window. */
  modDownloader: boolean;
  /** /players /kills /unbox /server /all in the in-game chat + a key that cycles them. */
  chatFilters: boolean;
  chatFilterKey: string;
  /** Chat Logs window and the key that opens it. */
  chatLogs: boolean;
  chatLogsKey: string;
  /** Key that opens the Quick Play tile picker. */
  quickPlayKey: string;
  displayMode: 'windowed' | 'maximized' | 'fullscreen';
  /** What to do when a userscript file changes: nothing, show a notice, or reload the page. */
  userscriptReload: 'off' | 'notify' | 'reload';
  /** Keys of the menu elements to hide (see preload/menu-hider.ts). */
  hiddenMenu: string[];
  /** Up to two link buttons on the Discord presence. */
  rpcButtons: { enabled: boolean; label1: string; url1: string; label2: string; url2: string };
  /** Saved sets of Krunker settings (the game's own export text). */
  settingsProfiles: Array<{ name: string; data: string }>;
  /** Start a matchmaker search by itself when Krunker shows its update / disconnect screen. */
  autoRejoin: boolean;
  /** Custom crosshair drawn once on a canvas while aiming. */
  crosshair: {
    enabled: boolean;
    shape: 'cross' | 'plus' | 'circle' | 'hCircle' | 'square' | 'hSquare' | 'symbol' | 'image';
    symbol: string;
    /** Picture for the Image shape, stored as a data: URL so it cannot go dead like a link (see shared/crosshair-image.ts). */
    image: string;
    color: string;
    outline: string;
    size: number;
    thick: number;
    gap: number;
    dot: number;
    outWidth: number;
  };
  /** Opt-in motion blur while turning the camera (adapted from WOK Client, see THIRD_PARTY_NOTICES.md). */
  motionBlur: {
    enabled: boolean;
    /** 0-100: how strong the blur trail is. */
    strength: number;
    /** native = full resolution, balanced / performance = fewer pixels processed. */
    quality: 'native' | 'balanced' | 'performance';
  };
  /** Class icons above the play buttons for one-click class switching (idea from WOK Client). */
  quickClassPicker: boolean;
  /** Season 9 style main menu layout (adapted from Kute). */
  classicMenu: boolean;
  /** Do not load animated video skins (for more FPS; idea from Kute). */
  disableVideoSkins: boolean;
  /** Bring the client to the front / flash the taskbar when the ranked queue finds a match while tabbed out (idea from Kute). */
  rankedAlert: boolean;
  /** Keep the unsent text of a friend chat message when Krunker clears the box (adapted from Kute). */
  chatDraft: boolean;
  /** Remember Krunker's Match End Message separately for every account (adapted from Kute). */
  accountEndMessage: boolean;
  /** Escape out of a match without the ~2 s wait before you can click back in (adapted from NM/NZ Client). */
  escapeFastRelease: boolean;
  /** Match and life accuracy under the top-centre HUD (an estimate; adapted from NM/NZ Client). */
  /** Friend and clan name colours (one `Name #colour [bold]` per line). */
  nameColors: { friends: string; clans: string };
  /** Saved sensitivity / FOV snapshots (see shared/presets.ts). */
  settingPresets: SettingPreset[];
  liveAccuracy: { enabled: boolean; placement: 'top' | 'bottom' };
  /** Frame-time HUD (FPS and 1% / 0.1% lows), toggled with `key`. */
  /** Hide servers whose map name contains one of the words from Krunker's server browser (idea: j4k0xb's Serverlist Filter). */
  serverFilter: { enabled: boolean; words: string };
  /** EXPERIMENTAL: run the game's frame on its own timer between screen frames, drawing only once per screen frame. */
  gameLoop: { enabled: boolean; intervalMs: number };
  perfHud: { key: string; corner: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'; detail: 'fps' | 'full'; startOn: boolean };
  /** Extra Discord presence features. Each needs matching Art Assets in the Discord app (see DISCORD-ART.md). */
  rpcRich: {
    /** Small class icon on the presence (asset key class_<name>). */
    classIcon: boolean;
    /** Big map picture instead of the KRH logo (asset key map_<name>). */
    mapArt: boolean;
    /** Join button: friends can join your match straight from your Discord profile. */
    join: boolean;
  };
  /** ask = prompt at launch (default). background = keep playing, download quietly, then offer a restart. */
  updateMode: 'ask' | 'background';
  /** Background mode: install a downloaded update by itself when the client is closed. */
  updateInstallOnQuit: boolean;
  /** Streamer mode: hides Discord presence, saved account names and the Spotify card. */
  streamerMode: boolean;
  streamerKey: string;
  /** Instant replay: keeps the last seconds of the game in memory and saves them on a key. */
  instantReplay: {
    enabled: boolean;
    /** How many seconds are kept (10 - 120). */
    seconds: number;
    key: string;
    /** Also save a clip by itself at this kill streak (0 = off). */
    autoStreak: number;
  };
  /** Session stats: kills, deaths, play time and maps, kept on this computer. */
  sessionStats: {
    enabled: boolean;
    /** Show a summary notification when the game window is closed. */
    summary: boolean;
    key: string;
  };
  /** Installed resource packs that are switched on (in order) and saved sets of packs. */
  packs: { enabled: string[]; loadouts: Array<{ name: string; ids: string[] }> };
  /** Key that opens the drag-and-drop overlay layout editor. */
  layoutEditorKey: string;
}

export interface AppConfig {
  window: {
    width: number;
    height: number;
    x: number | undefined;
    y: number | undefined;
    maximized: boolean;
    fullscreen: boolean;
  };
  performance: {
    fpsUnlocked: boolean;
    higherMaxFps: boolean;
    frameCap: number;
    processPriority: string;
    /** CPU throttling multiplier while playing (1 = off, max 3). */
    cpuThrottle: number;
    /** CPU throttling multiplier while in menus (1 = off, max 3). */
    cpuThrottleMenu: number;
    /** Dual-GPU laptops: run on the dedicated GPU (default on). */
    highPerformanceGpu: boolean;
  };
  game: {
    lastServer: string;
    socialTabBehaviour: 'New Window' | 'Same Window';
    rememberTabs: boolean;
    joinAsSpectator: boolean;
    rawInput: boolean;
    selectableChat: boolean;
    betterChat: boolean;
    autoHideChat: boolean;
    chatHistorySize: number;
    showPing: boolean;
    suspectPing: boolean;
    hpEnemyCounter: boolean;
    hideBunnies: boolean;
    hideTurfBanners: boolean;
    screenshotSave: boolean;
    /** Recording quality preset: 'Low' | 'Medium' | 'High'. */
    recordQuality: string;
    /** Recording frame rate: 30 or 60. */
    recordFps: number;
    /** Recording audio: 'game' | 'system' (Windows only) | 'off'. */
    recordAudio: string;
    /** What to record: 'game' (only the game window) or 'screen' (the whole screen the game is on, so other windows show up too). */
    recordSource: string;
    /** Also record your microphone (voice) and mix it into the video's audio. */
    recordMic: boolean;
    headshotSound: 'off' | 'kill' | 'hit';
    tradeDingSound: string;
    tradeDingVolume: number;
    tradeDingSoundFile: string;
    tradeDingInterval: number;
  };
  keystrokes: {
    enabled: boolean;
    size: number;
    auxKey1: string;
    auxKey2: string;
    showAuxKeys: boolean;
    mouseEnabled: boolean;
  };
  // Named before it counted more than nukes; renaming would orphan saved settings
  nukeCounter: {
    enabled: boolean;
    stats: string[];
    goals: Record<string, number>;
    layout: 'stacked' | 'separate';
    session: boolean;
    background: boolean;
    scale: number;
    x: number;
    y: number;
    positions: Record<string, { x: number; y: number }>;
  };
  twitch: {
    enabled: boolean;
    channel: string;
    showBadges: boolean;
    showHeader: boolean;
    thirdPartyEmotes: boolean;
    fontSize: number;
    width: number;
    height: number;
    x: number;
    y: number;
    background: number;
    /** Sit next to the in-game chat (bottom aligned) instead of using x / y. */
    autoPlace: boolean;
    linkCommand: boolean;
    linkOnlyLive: boolean;
  };
  spotify: {
    enabled: boolean;
    clientId: string;
    showArt: boolean;
    showProgress: boolean;
    hideWhenIdle: boolean;
    scale: number;
    x: number;
    y: number;
    background: number;
    /** Media-session mode: skip live streams (no duration), e.g. a Twitch tab. */
    ignoreLive: boolean;
    /** Media-session mode: comma separated words; anything containing one is skipped. */
    ignoreWords: string;
  };
  // Encrypted Spotify login (main process only; not readable by the page, never exported)
  /** Extra features (chat tools, mod downloader, display mode, ...). */
  extras: ExtrasConfig;
  spotifyAuth: string;
  /** Match End Message per account name (main process only, edited through its own IPC, never exported). */
  endMessages: Record<string, string>;
  /** Encrypted Twitch chat token used only by the !link command. */
  twitchBotAuth: string;
  /** Version of the overlay default positions that were applied (see config.ts). */
  overlayLayout: number;
  /** Version of the one-time "Discord Presence+ art is on by default" migration (see config.ts). */
  rpcRichDefaults: number;
  swapper: {
    enabled: boolean;
    path: string;
  };
  matchmaker: {
    enabled: boolean;
    regions: string[];
    gamemodes: string[];
    maps: string[];
    minPlayers: number;
    maxPlayers: number;
    minRemainingTime: number;
    openServerBrowser: boolean;
    sortByPlayers: boolean;
    hideSearchOverlay: boolean;
    rankedMatchSound: string;
    /** 0-100, volume of the ranked match found sound. */
    rankedMatchVolume: number;
  };
  keybinds: {
    reload: Keybind;
    newMatch: Keybind;
    copyGameLink: Keybind;
    joinFromClipboard: Keybind;
    devTools: Keybind;
    matchmaker: Keybind;
    matchmakerCancel: Keybind;
    fullscreenToggle: Keybind;
    screenshot: Keybind;
    screenshotArea: Keybind;
    record: Keybind;
    recordPause: Keybind;
    hubToggle: Keybind;
    dashboard: Keybind;
    openSocial: Keybind;
    openEditor: Keybind;
  };
  userscripts: {
    enabled: boolean;
    path: string;
  };
  ui: {
    showExitButton: boolean;
    deathscreenAnimation: boolean;
    /** Dims or brightens the 3D game view only (20-150 %, 100 = off). */
    gameBrightness: number;
    hideMenuPopups: boolean;
    menuTimer: boolean;
    cleanMenu: boolean;
    /** Player search bar + top-1000 list on the ranked leaderboard page. */
    rankedLeaderboardSearch: boolean;
    watermark: boolean;
    directServerPing: boolean;
    classicSocial: boolean;
    cssTheme: string;
    socialCssTheme: string;
    skyOverride: boolean;
    skyZenith: string;
    skyHorizon: string;
    skyImage: string;
    socialMusic: string;
    socialMusicVolume: number;
    socialMusicOnSocial: boolean;
    socialMusicOnMarket: boolean;
    loadingTheme: string;
    backgroundUrl: string;
    showChangelog: boolean;
    lastSeenVersion: string;
    skippedUpdateVersion: string;
  };
  discord: {
    enabled: boolean;
    showMapMode: boolean;
    showClass: boolean;
    showTimer: boolean;
    showStatus: boolean;
  };
  translator: {
    enabled: boolean;
    targetLanguage: string;
    showLanguageTag: boolean;
    customSkipWords: string;
    textColor: string;
    textStyle: 'normal' | 'italic' | 'bold' | 'bold-italic';
  };
  advanced: {
    removeUselessFeatures: boolean;
    perfTweaks: boolean;
    angleBackend: string;
    verboseLogging: boolean;
    /** GPU-aware tuning: auto-detect NVIDIA / Intel / weak GPUs (auto), force a profile, or turn it off. */
    gpuProfile: 'auto' | 'standard' | 'low' | 'off';
    /** Render at 1x even when Windows display scaling is above 100% (fewer pixels, softer UI). */
    ignoreDisplayScaling: boolean;
    /** The one-time "weak GPU detected, apply the Low-End preset?" question has been shown. */
    lowEndPrompted: boolean;
  };
  accounts: SavedAccount[];
  tabWindow: {
    width: number;
    height: number;
    x: number | undefined;
    y: number | undefined;
    maximized: boolean;
  };
  savedTabs: string[];
}

export const DEFAULT_KEYBINDS: AppConfig['keybinds'] = {
  reload:            { key: 'F5',     ctrl: false, shift: false, alt: false },
  newMatch:          { key: 'F4',     ctrl: false, shift: false, alt: false },
  copyGameLink:      { key: 'l',      ctrl: true,  shift: false, alt: false },
  joinFromClipboard: { key: 'j',      ctrl: true,  shift: false, alt: false },
  devTools:          { key: 'F12',    ctrl: false, shift: false, alt: false },
  matchmaker:        { key: 'F6',     ctrl: false, shift: false, alt: false },
  matchmakerCancel:  { key: 'Escape', ctrl: false, shift: false, alt: false },
  fullscreenToggle:  { key: 'F11',    ctrl: false, shift: false, alt: false },
  screenshot:        { key: 'F9',     ctrl: false, shift: false, alt: false },
  screenshotArea:    { key: 'F9',     ctrl: false, shift: true,  alt: false },
  record:            { key: 'F8',     ctrl: false, shift: false, alt: false },
  recordPause:       { key: 'F7',     ctrl: false, shift: false, alt: false },
  hubToggle:         { key: 'h',      ctrl: true,  shift: false, alt: false },
  dashboard:         { key: 'd',      ctrl: true,  shift: true,  alt: false },
  openSocial:        { key: 's',      ctrl: true,  shift: false, alt: false },
  openEditor:        { key: 'e',      ctrl: true,  shift: false, alt: false },
};

export const DEFAULT_CONFIG: AppConfig = {
  window: {
    width: 1600,
    height: 900,
    x: undefined,
    y: undefined,
    maximized: false,
    fullscreen: false,
  },
  performance: {
    fpsUnlocked: true,
    higherMaxFps: false,
    frameCap: 0,
    processPriority: 'Normal',
    cpuThrottle: 1,
    cpuThrottleMenu: 1,
    highPerformanceGpu: true,
  },
  game: {
    lastServer: '',
    socialTabBehaviour: 'New Window',
    rememberTabs: false,
    joinAsSpectator: false,
    rawInput: true,
    selectableChat: false,
    betterChat: true,
    autoHideChat: false,
    chatHistorySize: 200,
    showPing: true,
    suspectPing: true,
    hpEnemyCounter: true,
    hideBunnies: false,
    hideTurfBanners: false,
    screenshotSave: false,
    recordQuality: 'Medium',
    recordFps: 60,
    recordAudio: 'game',
    recordSource: 'game',
    recordMic: false,
    headshotSound: 'off',
    tradeDingSound: 'off',
    tradeDingVolume: 40,
    tradeDingSoundFile: '',
    tradeDingInterval: 15,
  },
  keystrokes: {
    enabled: false,
    size: 2.5,
    auxKey1: 'r',
    auxKey2: 'n',
    showAuxKeys: true,
    mouseEnabled: false,
  },
  nukeCounter: {
    enabled: false,
    stats: ['nukes', 'kills', 'wins'],
    goals: {},
    layout: 'stacked',
    session: false,
    background: true,
    scale: 1,
    x: 95,
    y: 62,
    positions: {},
  },
  twitch: {
    enabled: false,
    channel: '',
    showBadges: true,
    showHeader: true,
    thirdPartyEmotes: true,
    fontSize: 16,
    width: 340,
    height: 260,
    x: 1,
    y: 40,
    background: 0.35,
    autoPlace: true,
    linkCommand: false,
    linkOnlyLive: true,
  },
  spotify: {
    enabled: false,
    clientId: '',
    showArt: true,
    showProgress: true,
    hideWhenIdle: true,
    scale: 1,
    x: 50,
    y: 1.5,
    background: 0.45,
    ignoreLive: true,
    ignoreWords: 'twitch',
  },
  extras: {
    rankedBadges: true,
    modDownloader: true,
    chatFilters: true,
    chatFilterKey: 'F3',
    chatLogs: true,
    chatLogsKey: 'F1',
    quickPlayKey: 'F2',
    displayMode: 'windowed',
    userscriptReload: 'notify',
    hiddenMenu: [],
    rpcButtons: { enabled: false, label1: '', url1: '', label2: '', url2: '' },
    settingsProfiles: [],
    autoRejoin: false,
    crosshair: { enabled: false, shape: 'cross', symbol: '★', image: '', color: '#00ff00', outline: '#000000', size: 10, thick: 2, gap: 5, dot: 0, outWidth: 1 },
    motionBlur: { enabled: false, strength: 50, quality: 'native' },
    quickClassPicker: false,
    classicMenu: false,
    disableVideoSkins: false,
    rankedAlert: true,
    chatDraft: true,
    accountEndMessage: false,
    escapeFastRelease: true,
    nameColors: { friends: '', clans: '' },
    settingPresets: [],
    liveAccuracy: { enabled: false, placement: 'top' },
    serverFilter: { enabled: false, words: 'infect, trade, trading, fun-parkour' },
    gameLoop: { enabled: false, intervalMs: 8 },
    perfHud: { key: 'F10', corner: 'top-left', detail: 'full', startOn: false },
    rpcRich: { classIcon: true, mapArt: true, join: false },
    updateMode: 'ask',
    updateInstallOnQuit: false,
    streamerMode: false,
    streamerKey: 'Ctrl+Alt+M',
    instantReplay: { enabled: false, seconds: 30, key: 'Ctrl+Alt+R', autoStreak: 0 },
    sessionStats: { enabled: true, summary: true, key: 'Ctrl+Alt+K' },
    packs: { enabled: [], loadouts: [] },
    layoutEditorKey: 'Ctrl+Alt+L',
  },
  spotifyAuth: '',
  endMessages: {},
  twitchBotAuth: '',
  overlayLayout: 0,
  rpcRichDefaults: 0,
  swapper: {
    enabled: false,
    path: '',
  },
  matchmaker: {
    enabled: true,
    regions: [],
    gamemodes: [],
    maps: [],
    minPlayers: 1,
    maxPlayers: 6,
    minRemainingTime: 120,
    openServerBrowser: true,
    sortByPlayers: false,
    hideSearchOverlay: false,
    rankedMatchSound: '',
    rankedMatchVolume: 100,
  },
  keybinds: DEFAULT_KEYBINDS,
  userscripts: {
    enabled: false,
    path: '',
  },
  ui: {
    showExitButton: true,
    deathscreenAnimation: true,
    gameBrightness: 100,
    hideMenuPopups: false,
    menuTimer: true,
    cleanMenu: false,
    rankedLeaderboardSearch: true,
    watermark: true,
    directServerPing: false,
    classicSocial: false,
    cssTheme: 'disabled',
    socialCssTheme: 'disabled',
    skyOverride: false,
    skyZenith: '#1E5AA8',
    skyHorizon: '#9FD0F0',
    skyImage: 'disabled',
    socialMusic: '',
    socialMusicVolume: 40,
    socialMusicOnSocial: true,
    socialMusicOnMarket: false,
    loadingTheme: 'disabled',
    backgroundUrl: '',
    showChangelog: true,
    lastSeenVersion: '',
    skippedUpdateVersion: '',
  },
  discord: {
    enabled: true,
    showMapMode: true,
    showClass: true,
    showTimer: true,
    showStatus: true,
  },
  translator: {
    enabled: false,
    targetLanguage: 'en',
    showLanguageTag: true,
    customSkipWords: '',
    textColor: '#88ff88',
    textStyle: 'italic',
  },
  advanced: {
    removeUselessFeatures: true,
    perfTweaks: false,
    angleBackend: 'default',
    verboseLogging: false,
    gpuProfile: 'auto',
    ignoreDisplayScaling: false,
    lowEndPrompted: false,
  },
  accounts: [],
  tabWindow: {
    width: 1280,
    height: 720,
    x: undefined,
    y: undefined,
    maximized: true,
  },
  savedTabs: [],
};
