// ── Settings section builders ──
// Each build*Section() populates one category panel of the injected Client settings
// tab using the shared row factories. renderSettings (settings-render.ts) builds
// the SettingsBag and calls these.

import { ipcRenderer } from 'electron';
import type { Keybind } from '../main/config';
import { DEFAULT_CONFIG } from '../main/config-defaults';
import type { ExtrasConfig } from '../main/config-defaults';
import type { SocialMusicSource } from '../main/config-defaults';
import { BRIGHTNESS_MIN, BRIGHTNESS_MAX, clampBrightness, setDeathAnimBlock, setGameBrightness, setMenuTimer, setWatermark, showToast } from './utils';
import {
  createKeybindRow, createSimpleKeyRow, createToggleRow, createSelectRow,
  createNumberRow, createCheckboxGrid, createButtonRow, createTextRow,
  createInfoRow, createRowShell, createSelect, makeButton, onSettingChanged,
  createGroup, createColorRow,
} from './settings-controls';
import { setHiddenMenu, HIDE_ITEMS } from './menu-hider';
import { setCrosshair } from './crosshair';
import { buildV11Section } from './settings-v11';
import { setClassicSocial, startHidePopups, stopHidePopups, setCleanMenu, setSelectableChat, setQuickClassPicker, setClassicMenu } from './menu-tweaks';
import { setMotionBlur } from './motion-blur';
import { setLiveAccuracy } from './live-accuracy';
import { setPerfHud } from './perf-hud';
import { escapeHtml } from './utils';
import { CROSSHAIR_IMAGE_MAX_BYTES, cleanCrosshairImage } from '../shared/crosshair-image';
import { capturePreset, normalisePresets, planPreset, presetName, PRESET_LIMIT, PRESET_SCOPES, summarisePreset } from '../shared/presets';
import { gameSetting, setGameSettings, storedGameSettingIds } from './game-settings';
import { setChatDraft } from './chat-draft';
import { setRankedAlert } from './ranked-alert';
import { setAccountEndMessage } from './end-message';
import { updateSocialMusicConfig } from './social-music';
import { initHPCounter, destroyHPCounter } from './competitive';
import { initSuspectPing, destroySuspectPing } from './kpd-call';
import { setHeadshotSoundMode } from './headshot-sound';
import type { HeadshotSoundMode } from './headshot-sound';
import { setTradeDing } from './trade-ding';
import { updateKeystrokes } from './keystrokes';
import type { KeystrokesConfig } from './keystrokes';
import { STATS, statCounterConfig, updateStatCounter, openStatCounterEditor } from './stat-counter';
import { setTwitchChat } from './twitch-chat';
import type { TwitchChatConfig } from './twitch-chat';
import { setSpotifyOverlay } from './spotify-overlay';
import type { SpotifyOverlayConfig } from './spotify-overlay';
import { setBetterChat, setAutoHideChat, setChatHistorySize } from './chat';
import { updateTranslatorConfig } from './translator';
import { showChangelogNow } from './changelog';
import { setVerbose } from './saved-console';
import { setServerFilter } from './serverlist-filter';
import { setGameLoop } from './game-loop';
import { MATCHMAKER_REGIONS, MATCHMAKER_REGION_NAMES, MATCHMAKER_MAP_NAMES, mapIconUrl, matchmakerMapNames, matchmakerModeItems } from './matchmaker';

export interface SettingsBag {
  binds: Record<string, Keybind>;
  saveBinds: () => void;
  isWindows: boolean;
}

// Module-scoped so it can be stopped from outside the panel that created it.
let musicPreview: HTMLAudioElement | null = null;
let musicPreviewUrl = ''; // Blob URL while previewing a local file

export function stopMusicPreview(): void {
  if (musicPreview) musicPreview.pause();
  musicPreview = null;
  if (musicPreviewUrl) {
    URL.revokeObjectURL(musicPreviewUrl);
    musicPreviewUrl = '';
  }
}

export function buildGeneralSection(
  body: HTMLElement, gameConf: any, uiConfRaw: any, bag: SettingsBag,
): void {
  const game = gameConf;

  const tabsGroup = createGroup(body, 'Tabs & Social');

  tabsGroup.appendChild(createSelectRow({
    label: 'Social/Hub Tab Behaviour',
    desc: 'How social, market, and editor pages open when clicked',
    options: [{ value: 'New Window', label: 'Tabs (Separate Window)' }, { value: 'Same Window', label: 'Tabs (Overlay Game)' }],
    value: game.socialTabBehaviour, instant: true,
    onChange: (v) => { game.socialTabBehaviour = v; ipcRenderer.invoke('set-config', 'game', game); },
  }));

  tabsGroup.appendChild(createToggleRow({
    label: 'Remember Tabs',
    desc: 'Restore your open tabs when you reopen the social/hub window',
    checked: game.rememberTabs, instant: true,
    onChange: (v) => { game.rememberTabs = v; ipcRenderer.invoke('set-config', 'game', game); },
  }));

  const ui = uiConfRaw;

  function saveUI(): void {
    ipcRenderer.invoke('set-config', 'ui', ui);
  }

  tabsGroup.appendChild(createToggleRow({
    label: 'Classic Social',
    desc: 'Open the standalone social page in a tab instead of the in-game panel',
    checked: ui.classicSocial ?? false, instant: true,
    onChange: (v) => { ui.classicSocial = v; saveUI(); setClassicSocial(v); },
  }));

  const clientGroup = createGroup(body, 'Client');

  clientGroup.appendChild(createToggleRow({
    label: 'Show Exit Button',
    desc: 'Show the exit button in the game sidebar',
    checked: ui.showExitButton, instant: true,
    onChange: (v) => {
      ui.showExitButton = v; saveUI();
      const btn = document.getElementById('clientExit');
      if (btn) btn.style.display = v ? 'flex' : 'none';
    },
  }));

  clientGroup.appendChild(createToggleRow({
    label: 'Join as Spectator',
    desc: 'Automatically enable spectate mode when joining a game',
    checked: game.joinAsSpectator, instant: true,
    onChange: (v) => { game.joinAsSpectator = v; ipcRenderer.invoke('set-config', 'game', game); },
  }));

  clientGroup.appendChild(createToggleRow({
    label: 'Show Changelog',
    desc: 'Show release notes popup when the client updates',
    checked: ui.showChangelog ?? true, instant: true,
    onChange: (v) => { ui.showChangelog = v; saveUI(); },
  }));

  clientGroup.appendChild(createButtonRow({
    label: 'KRH Dashboard',
    desc: 'A separate window with your scripts, custom CSS files (each with its own on/off switch), the resource swapper folder, links to the KRH website and clean-up tools. Default key Ctrl+Shift+D.',
    buttons: [{ icon: 'dashboard', label: 'Open', onClick: () => { ipcRenderer.send('open-dashboard'); } }],
  }).row);

  clientGroup.appendChild(createButtonRow({
    label: 'Changelog',
    desc: 'View release notes for the current version',
    buttons: [{ icon: 'article', label: 'Show', onClick: () => {
      ipcRenderer.invoke('get-version').then((ver: string) => showChangelogNow(ver));
    } }],
  }).row);

  clientGroup.appendChild(createButtonRow({
    label: 'Support Info',
    desc: 'Copy your version, OS, CPU, RAM and GPU to paste into a bug report, or open the log folder',
    buttons: [
      { icon: 'content_copy', label: 'Copy System Info', onClick: () => {
        ipcRenderer.invoke('copy-system-info').then(() => showToast('System info copied')).catch(() => showToast('Could not copy system info'));
      } },
      { icon: 'folder_open', label: 'Open Logs', onClick: () => { void ipcRenderer.invoke('open-log-folder'); } },
    ],
  }).row);

  const hotkeysGroup = createGroup(body, 'Hotkeys');

  hotkeysGroup.appendChild(createKeybindRow('Toggle Fullscreen', 'Fullscreen the game window (default F11)', bag.binds.fullscreenToggle, (b) => {
    bag.binds.fullscreenToggle = b;
    bag.saveBinds();
  }, undefined, true));

  hotkeysGroup.appendChild(createKeybindRow('Screenshot Area', 'Select just the part you want to capture, like the Snipping Tool: the game freezes, drag a box, release to copy it (default Shift+F9). Esc or right-click cancels', bag.binds.screenshotArea, (b) => {
    bag.binds.screenshotArea = b;
    bag.saveBinds();
  }, undefined, true));

  hotkeysGroup.appendChild(createKeybindRow('Screenshot', 'Copy the whole game view to your clipboard (default F9)', bag.binds.screenshot, (b) => {
    bag.binds.screenshot = b;
    bag.saveBinds();
  }, undefined, true));

  hotkeysGroup.appendChild(createKeybindRow('Record Gameplay', 'Start / stop recording the game window to a video file (default F8)', bag.binds.record, (b) => {
    bag.binds.record = b;
    bag.saveBinds();
  }, undefined, true));

  hotkeysGroup.appendChild(createKeybindRow('Pause / Resume Recording', 'Pause the recording you are making, press again to continue in the same file (default F7)', bag.binds.recordPause, (b) => {
    bag.binds.recordPause = b;
    bag.saveBinds();
  }, undefined, true));

  hotkeysGroup.appendChild(createKeybindRow('Show / Hide KRH Dashboard', 'Show the dashboard over the game, press again to hide it (default Ctrl+Shift+D)', bag.binds.dashboard, (b) => {
    bag.binds.dashboard = b;
    bag.saveBinds();
  }, undefined, true));

  hotkeysGroup.appendChild(createKeybindRow('Open / Hide KRH Hub', 'Bring the KRH window up over the game without closing the game, press again to hide it (default Ctrl+H)', bag.binds.hubToggle, (b) => {
    bag.binds.hubToggle = b;
    bag.saveBinds();
  }, undefined, true));

  hotkeysGroup.appendChild(createKeybindRow('Open Krunker Social', 'Open krunker.io/social.html in a tab, or bring it forward if it is already open (default Ctrl+S)', bag.binds.openSocial, (b) => {
    bag.binds.openSocial = b;
    bag.saveBinds();
  }, undefined, true));

  hotkeysGroup.appendChild(createKeybindRow('Open Krunker Editor', 'Open krunker.io/editor.html in a tab, or bring it forward if it is already open (default Ctrl+E)', bag.binds.openEditor, (b) => {
    bag.binds.openEditor = b;
    bag.saveBinds();
  }, undefined, true));

  const shotsGroup = createGroup(body, 'Screenshots');

  shotsGroup.appendChild(createToggleRow({
    label: 'Save Screenshots to Folder',
    desc: 'Also save a PNG copy to the screenshots folder (always copies to clipboard)',
    checked: game.screenshotSave ?? false, instant: true,
    onChange: (v) => { game.screenshotSave = v; ipcRenderer.invoke('set-config', 'game', game); },
  }));

  shotsGroup.appendChild(createButtonRow({
    label: 'Screenshots Folder',
    desc: 'Where saved screenshots are written',
    buttons: [{ icon: 'folder', label: 'Screenshots', title: 'Open Folder', onClick: () => ipcRenderer.invoke('open-screenshots-folder') }],
  }).row);

  const recGroup = createGroup(body, 'Recording');

  recGroup.appendChild(createSelectRow({
    label: 'Recording Source',
    desc: 'Game Window records only the game. Entire Screen records the whole screen the game is on, so the hub, Editor, Docs and other windows (and notifications) appear in the video too',
    options: [
      { value: 'game', label: 'Game Window' },
      { value: 'screen', label: 'Entire Screen' },
    ],
    value: game.recordSource ?? 'game',
    onChange: (v) => { game.recordSource = v === 'screen' ? 'screen' : 'game'; ipcRenderer.invoke('set-config', 'game', game); },
  }));

  recGroup.appendChild(createSelectRow({
    label: 'Recording Quality',
    desc: 'Video bitrate. Low ~6 Mbps, Medium ~12 Mbps, High ~25 Mbps (bigger files). Applies to the next recording',
    options: [
      { value: 'Low', label: 'Low' },
      { value: 'Medium', label: 'Medium' },
      { value: 'High', label: 'High' },
    ],
    value: game.recordQuality ?? 'Medium',
    onChange: (v) => { game.recordQuality = v; ipcRenderer.invoke('set-config', 'game', game); },
  }));

  recGroup.appendChild(createSelectRow({
    label: 'Recording Frame Rate',
    desc: '60 FPS looks smoother but makes larger files and needs more from your PC while recording',
    options: [
      { value: '60', label: '60 FPS' },
      { value: '30', label: '30 FPS' },
    ],
    value: String(game.recordFps ?? 60),
    onChange: (v) => { game.recordFps = Number(v) === 30 ? 30 : 60; ipcRenderer.invoke('set-config', 'game', game); },
  }));

  recGroup.appendChild(createSelectRow({
    label: 'Recording Audio',
    desc: 'Game Audio records only the game. System Audio (Windows only) records everything you hear, including Discord and music',
    options: [
      { value: 'game', label: 'Game Audio' },
      { value: 'system', label: 'System Audio' },
      { value: 'off', label: 'No Audio' },
    ],
    value: game.recordAudio ?? 'game',
    onChange: (v) => { game.recordAudio = v; ipcRenderer.invoke('set-config', 'game', game); },
  }));

  recGroup.appendChild(createToggleRow({
    label: 'Record Microphone (Voice)',
    desc: 'Adds your own voice from the microphone to the video. Voices of friends in Discord are recorded by choosing System Audio above (Windows)',
    checked: game.recordMic ?? false, instant: true,
    onChange: (v) => { game.recordMic = v; ipcRenderer.invoke('set-config', 'game', game); },
  }));

  recGroup.appendChild(createButtonRow({
    label: 'Recordings Folder',
    desc: 'Videos are saved as .mp4 (H.264) in your Videos folder under KRH Client',
    buttons: [{ icon: 'folder', label: 'Recordings', title: 'Open Folder', onClick: () => ipcRenderer.invoke('open-recordings-folder') }],
  }).row);
}

export function buildGameSection(
  body: HTMLElement, gameConf: any, uiConfRaw: any, bag: SettingsBag,
): void {
  const game = gameConf;
  const ui = uiConfRaw;

  function saveGame(): void {
    ipcRenderer.invoke('set-config', 'game', game);
  }
  function saveUI(): void {
    ipcRenderer.invoke('set-config', 'ui', ui);
  }

  const inputGroup = createGroup(body, 'Input & HUD');

  if (bag.isWindows) {
    inputGroup.appendChild(createToggleRow({
      label: 'Raw Input',
      desc: 'Bypass OS mouse acceleration for direct 1:1 sensor input (Windows only)',
      checked: game.rawInput ?? true, refreshOnly: true,
      onChange: (v) => { game.rawInput = v; saveGame(); },
    }));
  }

  inputGroup.appendChild(createToggleRow({
    label: 'Show Ping in Player List',
    desc: 'Replace the ping icon with numeric millisecond values in the player list',
    checked: game.showPing ?? true, refreshOnly: true,
    onChange: (v) => { game.showPing = v; saveGame(); },
  }));

  inputGroup.appendChild(createToggleRow({
    label: 'Suspect Ping on KPD Calls',
    desc: 'Show the suspect ping alongside your own while spectating on a KPD call',
    checked: game.suspectPing ?? true, instant: true,
    onChange: (v) => {
      game.suspectPing = v; saveGame();
      if (v) initSuspectPing(); else destroySuspectPing();
    },
  }));

  inputGroup.appendChild(createToggleRow({
    label: 'Direct Server Ping',
    desc: 'Replace Krunker\'s ping with a TCP round-trip measurement to the game server',
    checked: ui.directServerPing ?? false, refreshOnly: true,
    onChange: (v) => { ui.directServerPing = v; saveUI(); },
  }));

  inputGroup.appendChild(createToggleRow({
    label: 'Hardpoint Enemy Counter',
    desc: 'Show enemy capture points in Hardpoint mode',
    checked: game.hpEnemyCounter ?? true, refreshOnly: true,
    onChange: (v) => {
      game.hpEnemyCounter = v; saveGame();
      if (v) initHPCounter(); else destroyHPCounter();
    },
  }));

  inputGroup.appendChild(createSelectRow({
    label: 'Headshot Sound',
    desc: 'Play the headshot hit sound on every kill, or on every hit. Also applies to a resource-swapped custom headshot sound.',
    options: [
      { value: 'off', label: 'Off' },
      { value: 'kill', label: 'On Every Kill' },
      { value: 'hit', label: 'On Every Hit' },
    ],
    value: game.headshotSound ?? 'off', instant: true,
    onChange: (v) => { game.headshotSound = v as HeadshotSoundMode; saveGame(); setHeadshotSoundMode(v as HeadshotSoundMode); },
  }));

  const tdSettings = () => ({
    sound: game.tradeDingSound ?? 'off',
    volume: game.tradeDingVolume ?? 40,
    soundFile: game.tradeDingSoundFile ?? '',
    intervalSec: game.tradeDingInterval ?? 15,
  });

  // Custom sound file row — built first so the sound select can show/hide it.
  const tdFile = createTextRow({
    label: 'Custom Trade Sound',
    desc: 'A direct audio link ending in .mp3/.ogg/.wav, or browse for a local file.',
    value: game.tradeDingSoundFile || '',
    placeholder: 'https://example.com/ding.mp3  or  C:\\path\\to\\ding.mp3',
    onChange: (v) => { game.tradeDingSoundFile = v; saveGame(); setTradeDing(tdSettings()); },
  });
  const tdFileControl = tdFile.row.querySelector('.krh-row-control') as HTMLElement;
  tdFileControl.appendChild(makeButton({ icon: 'folder_open', title: 'Browse for Audio File', onClick: async () => {
    const path: string = await ipcRenderer.invoke('pick-audio-file');
    if (path) { tdFile.input.value = path; game.tradeDingSoundFile = path; saveGame(); setTradeDing(tdSettings()); }
  } }));
  let tdPreview: HTMLAudioElement | null = null;
  const tdResetPlay = (failed?: boolean): void => {
    tdPreview = null;
    tdPlayBtn.innerHTML = '<span class="material-icons">play_arrow</span>';
    if (failed) showToast('Couldn\'t load that sound. Use a direct audio file link (.mp3/.ogg/.wav) or pick a local file.');
  };
  const tdPlayBtn = makeButton({ icon: 'play_arrow', title: 'Preview Sound', onClick: async () => {
    if (tdPreview) { tdPreview.pause(); tdResetPlay(); return; }
    const url: string = await ipcRenderer.invoke('resolve-audio-file', tdFile.input.value.trim());
    if (!url) { tdResetPlay(true); return; }
    tdPreview = new Audio(url);
    tdPreview.volume = Math.min(1, Math.max(0, (game.tradeDingVolume ?? 40) / 100));
    tdPlayBtn.innerHTML = '<span class="material-icons">stop</span>';
    tdPreview.onended = () => tdResetPlay();
    tdPreview.onerror = () => tdResetPlay(true);
    tdPreview.play().catch(() => tdResetPlay(true));
  } });
  tdFileControl.appendChild(tdPlayBtn);

  // Only reveal the custom file row when the sound is set to Custom File.
  const syncTdRows = (): void => {
    tdFile.row.classList.toggle('krh-row-hidden', (game.tradeDingSound ?? 'off') !== 'custom');
  };

  const tradeGroup = createGroup(body, 'Trade Requests');

  tradeGroup.appendChild(createSelectRow({
    label: 'Trade Request Sound',
    desc: 'Play a sound when another player sends you a trade request. Checks your pending trades on the interval below.',
    options: [
      { value: 'off', label: 'Off' },
      { value: 'chime', label: 'Chime' },
      { value: 'tick_0', label: 'Krunker Tick' },
      { value: 'headshot_0', label: 'Headshot Ding' },
      { value: 'custom', label: 'Custom File…' },
    ],
    value: game.tradeDingSound ?? 'off', instant: true,
    onChange: (v) => { game.tradeDingSound = v; saveGame(); syncTdRows(); setTradeDing(tdSettings()); },
  }));
  tradeGroup.appendChild(tdFile.row);

  tradeGroup.appendChild(createNumberRow({
    label: 'Trade Request Volume',
    desc: 'Loudness of the trade request sound',
    min: 0, max: 100, value: game.tradeDingVolume ?? 40, instant: true,
    onChange: (v) => { game.tradeDingVolume = v; saveGame(); setTradeDing(tdSettings()); },
  }));

  tradeGroup.appendChild(createNumberRow({
    label: 'Trade Check Interval',
    desc: 'How often to check for new trade requests, in seconds',
    min: 5, max: 60, value: game.tradeDingInterval ?? 15, instant: true,
    onChange: (v) => { game.tradeDingInterval = v; saveGame(); setTradeDing(tdSettings()); },
  }));

  syncTdRows();

  const worldGroup = createGroup(body, 'World');

  worldGroup.appendChild(createToggleRow({
    label: 'Hide Bunny NPCs',
    desc: 'Block the bunny NPC models that spawn in public matches',
    checked: game.hideBunnies ?? false, refreshOnly: true,
    onChange: (v) => { game.hideBunnies = v; saveGame(); },
  }));

  worldGroup.appendChild(createToggleRow({
    label: 'Hide Turf War Banners',
    desc: 'Block the clan banner decorations placed on official maps by Turf Wars',
    checked: game.hideTurfBanners ?? false, refreshOnly: true,
    onChange: (v) => { game.hideTurfBanners = v; saveGame(); },
  }));

  worldGroup.appendChild(createToggleRow({
    label: 'Block Death Screen Animation',
    desc: 'Disable the slide-in animation on the death screen',
    checked: ui.deathscreenAnimation, instant: true,
    onChange: (v) => { ui.deathscreenAnimation = v; saveUI(); setDeathAnimBlock(v); },
  }));

  worldGroup.appendChild(createNumberRow({
    label: 'Game Brightness',
    desc: 'Dim or brighten the 3D game view (20% to 150%). The HUD, nametags and menus are unaffected',
    min: BRIGHTNESS_MIN, max: BRIGHTNESS_MAX, step: 5, value: clampBrightness(ui.gameBrightness), instant: true,
    onChange: (v) => { ui.gameBrightness = v; saveUI(); setGameBrightness(v); },
  }));

  const menuGroup = createGroup(body, 'Menu');

  menuGroup.appendChild(createToggleRow({
    label: 'Hide Menu Popups',
    desc: 'Hide promotional notifications, offers, and streams on the main menu',
    checked: ui.hideMenuPopups, instant: true,
    onChange: (v) => {
      ui.hideMenuPopups = v; saveUI();
      if (v) startHidePopups(); else stopHidePopups();
    },
  }));

  menuGroup.appendChild(createToggleRow({
    label: 'Menu Timer',
    desc: 'Show the game/spectate timer on the menu screen. Drag it to move it; double-click to reset',
    checked: ui.menuTimer ?? true, instant: true,
    onChange: (v) => { ui.menuTimer = v; saveUI(); setMenuTimer(v); },
  }));

  menuGroup.appendChild(createToggleRow({
    label: 'Ranked Leaderboard Search',
    desc: 'Adds a player search box to the ranked leaderboard and loads the top 1000 players instead of 50. Reopen the leaderboard page after changing',
    checked: ui.rankedLeaderboardSearch ?? true, instant: true,
    onChange: (v) => { ui.rankedLeaderboardSearch = v; saveUI(); },
  }));

  menuGroup.appendChild(createToggleRow({
    label: 'Cleaner Menu',
    desc: 'Removes extra clutter from the main menu: social button, sign-up banner, class preview, terms line, map info and other elements',
    checked: ui.cleanMenu ?? false, instant: true,
    onChange: (v) => { ui.cleanMenu = v; saveUI(); setCleanMenu(v); },
  }));

  menuGroup.appendChild(createToggleRow({
    label: 'KRH Watermark',
    desc: 'Show the KRH version watermark in-game and on the menu, and the brand header in this menu and the ranked queue',
    checked: ui.watermark ?? true, instant: true,
    onChange: (v) => {
      ui.watermark = v; saveUI(); setWatermark(v);
      const brandHeader = document.querySelector('.krh-settings .krh-header') as HTMLElement | null;
      if (brandHeader) brandHeader.style.display = v ? '' : 'none';
    },
  }));

  if (ui.deathscreenAnimation) setDeathAnimBlock(true);
  if (ui.menuTimer ?? true) setMenuTimer(true);
  if (ui.cleanMenu) setCleanMenu(true);
  if (ui.hideMenuPopups) startHidePopups();
}

export function buildKeystrokesRows(body: HTMLElement): void {
  const ks: KeystrokesConfig = { ...DEFAULT_CONFIG.keystrokes };
  let loaded = false;

  function save(): void {
    if (!loaded) return;
    ipcRenderer.invoke('set-config', 'keystrokes', ks);
    updateKeystrokes(ks);
  }

  const overlayGroup = createGroup(body, 'Overlay');

  const enableRow = createToggleRow({
    label: 'Keystrokes Overlay',
    desc: 'Show on-screen WASD/Shift/Space + 2 aux keys (great for streaming)',
    checked: false, instant: true,
    onChange: (v) => { ks.enabled = v; save(); },
  });
  overlayGroup.appendChild(enableRow);

  const mouseRow = createToggleRow({
    label: 'Mouse Overlay',
    desc: 'Show on-screen mouse buttons (L/M/R) and scroll wheel direction',
    checked: false, instant: true,
    onChange: (v) => { ks.mouseEnabled = v; save(); },
  });
  overlayGroup.appendChild(mouseRow);

  const sizeRow = createNumberRow({
    label: 'Overlay Size',
    desc: 'Visual scale of the keystroke and mouse indicators (rem)',
    min: 1, max: 6, step: 0.1, value: 2.5, instant: true,
    onChange: (v) => { ks.size = v; save(); },
  });
  overlayGroup.appendChild(sizeRow);

  const auxGroup = createGroup(body, 'Aux Keys');

  const showAuxRow = createToggleRow({
    label: 'Show Aux Keys',
    desc: 'Display the two configurable aux key indicators in the keyboard overlay',
    checked: true, instant: true,
    onChange: (v) => { ks.showAuxKeys = v; save(); },
  });
  auxGroup.appendChild(showAuxRow);

  const aux1Row = createSimpleKeyRow({
    label: 'Aux Key 1',
    desc: 'First configurable key (default R, e.g. weapon switch). Click to rebind.',
    value: 'r', instant: true,
    onChange: (v) => { ks.auxKey1 = v; save(); },
  });
  auxGroup.appendChild(aux1Row);

  const aux2Row = createSimpleKeyRow({
    label: 'Aux Key 2',
    desc: 'Second configurable key (default N, e.g. knife). Click to rebind.',
    value: 'n', instant: true,
    onChange: (v) => { ks.auxKey2 = v; save(); },
  });
  auxGroup.appendChild(aux2Row);

  const KEYSTROKES_CREDIT_URL = 'https://gist.github.com/KraXen72/2ea1332440b0c66b83ca9b73afc38269';
  const creditRow = createInfoRow(
    'Keyboard overlay adapted from <a class="krh-credit-link">KraXen72\'s Keystrokes userscript</a> for the Crankshaft Krunker client.',
  );
  const creditLink = creditRow.querySelector('.krh-credit-link') as HTMLElement;
  creditLink.addEventListener('click', (e) => {
    e.preventDefault();
    ipcRenderer.invoke('open-external', KEYSTROKES_CREDIT_URL);
  });
  body.appendChild(creditRow);

  ipcRenderer.invoke('get-config', 'keystrokes').then((conf: KeystrokesConfig | undefined) => {
    Object.assign(ks, DEFAULT_CONFIG.keystrokes, conf || {});
    const enableCb = enableRow.querySelector('input[type="checkbox"]') as HTMLInputElement;
    if (enableCb) enableCb.checked = !!ks.enabled;
    const mouseCb = mouseRow.querySelector('input[type="checkbox"]') as HTMLInputElement;
    if (mouseCb) mouseCb.checked = !!ks.mouseEnabled;
    const sizeRange = sizeRow.querySelector('input[type="range"]') as HTMLInputElement;
    const sizeNum = sizeRow.querySelector('input[type="number"]') as HTMLInputElement;
    if (sizeRange) sizeRange.value = String(ks.size);
    if (sizeNum) sizeNum.value = String(ks.size);
    const showAuxCb = showAuxRow.querySelector('input[type="checkbox"]') as HTMLInputElement;
    if (showAuxCb) showAuxCb.checked = !!ks.showAuxKeys;
    const aux1KeyEl = aux1Row.querySelector('.krh-keyIcon') as HTMLElement;
    if (aux1KeyEl) aux1KeyEl.textContent = (ks.auxKey1 || 'R').toUpperCase();
    const aux2KeyEl = aux2Row.querySelector('.krh-keyIcon') as HTMLElement;
    if (aux2KeyEl) aux2KeyEl.textContent = (ks.auxKey2 || 'N').toUpperCase();
    loaded = true;
  }).catch(() => { loaded = true; });
}

// Merged Performance category: frame rate, system (priority + graphics backend),
// the consolidated Chromium flag toggles, and debugging. Covers both the
// `performance` and `advanced` config sections.
export function buildPerformanceSection(
  body: HTMLElement, perfConf: any, advConf: any, isWindows: boolean,
): void {
  const perf = { ...DEFAULT_CONFIG.performance, ...perfConf };
  const adv = { ...DEFAULT_CONFIG.advanced, ...advConf };

  function savePerf(): void {
    ipcRenderer.invoke('set-config', 'performance', perf);
  }

  function saveAdv(): void {
    ipcRenderer.invoke('set-config', 'advanced', adv);
  }

  const fpsGroup = createGroup(body, 'Frame Rate');

  // Mode is derived from the two stored keys: vsync = !fpsUnlocked,
  // custom = fpsUnlocked + frameCap > 0, unlimited = fpsUnlocked + frameCap 0.
  const frameMode = (): 'vsync' | 'custom' | 'unlimited' => !perf.fpsUnlocked ? 'vsync' : (perf.frameCap > 0 ? 'custom' : 'unlimited');
  let lastCustomCap = Math.min(1000, Math.max(30, Math.round(Number(perf.frameCap)) || 240));
  // Re-clamp hand-edited configs so the slider shows what will be stored
  if (frameMode() === 'custom') perf.frameCap = lastCustomCap;

  const applyPerf = (crossedVsync: boolean): void => {
    ipcRenderer.invoke('set-config', 'performance', perf).then((needsRestart) => {
      if (needsRestart || crossedVsync) onSettingChanged('restart');
    });
  };

  const capRow = createNumberRow({
    label: 'FPS Cap',
    desc: 'Exact frame rate to hold. Applies live in most sessions (may need a restart)',
    min: 30, max: 1000, step: 1, value: lastCustomCap, instant: true,
    onChange: (v) => {
      perf.frameCap = v;
      lastCustomCap = v;
      applyPerf(false);
    },
  });

  const higherMaxRow = createToggleRow({
    label: 'Higher Max FPS',
    desc: 'Lets powerful machines reach higher framerates. Only active while FPS Limit is Unlimited. May cause input lag or stutter on low-end hardware. Recommended to keep disabled (requires restart)',
    checked: perf.higherMaxFps, restart: true, safety: 4,
    onChange: (v) => { perf.higherMaxFps = v; savePerf(); },
  });

  const higherMaxCheckbox = higherMaxRow.querySelector('input[type="checkbox"]') as HTMLInputElement;
  const syncFrameRows = (): void => {
    const mode = frameMode();
    capRow.classList.toggle('krh-row-hidden', mode !== 'custom');
    higherMaxRow.classList.toggle('krh-row-dim', mode !== 'unlimited');
    higherMaxCheckbox.disabled = mode !== 'unlimited';
  };

  fpsGroup.appendChild(createSelectRow({
    label: 'FPS Limit',
    desc: 'Vsync syncs to the monitor refresh rate; switching it on or off requires a restart. Custom Cap holds an exact frame rate',
    options: [
      { value: 'unlimited', label: 'Unlimited' },
      { value: 'custom', label: 'Custom Cap' },
      { value: 'vsync', label: 'Vsync' },
    ],
    value: frameMode(),
    onChange: (mode) => {
      const wasVsync = !perf.fpsUnlocked;
      if (perf.frameCap > 0) lastCustomCap = perf.frameCap;
      perf.fpsUnlocked = mode !== 'vsync';
      // Vsync leaves frameCap untouched so switching back restores it
      if (mode !== 'vsync') perf.frameCap = mode === 'custom' ? lastCustomCap : 0;
      syncFrameRows();
      applyPerf(wasVsync !== (mode === 'vsync'));
    },
  }));
  fpsGroup.appendChild(capRow);
  fpsGroup.appendChild(higherMaxRow);
  syncFrameRows();


  const sysGroup = createGroup(body, 'System');

  if (isWindows) {
    sysGroup.appendChild(createSelectRow({
      label: 'Process Priority',
      desc: 'OS-level process priority for the client (Windows only)',
      options: [
        { value: 'Normal', label: 'Normal' },
        { value: 'Above Normal', label: 'Above Normal' },
        { value: 'High', label: 'High' },
        { value: 'Below Normal', label: 'Below Normal' },
        { value: 'Low', label: 'Low' },
      ],
      value: perf.processPriority, restart: true, safety: 2,
      onChange: (v) => { perf.processPriority = v; savePerf(); },
    }));
  }

  sysGroup.appendChild(createNumberRow({
    label: 'CPU Throttling',
    desc: 'Slows the game\'s CPU work while playing (1 = off, 2 = half speed). Only use if the game is unstable, e.g. when your GPU is the bottleneck',
    min: 1, max: 3, step: 0.01, value: Number(perf.cpuThrottle ?? 1), instant: true, safety: 3,
    onChange: (v) => { perf.cpuThrottle = v; applyPerf(false); },
  }));

  sysGroup.appendChild(createNumberRow({
    label: 'CPU Throttling in Menu',
    desc: 'Same as above, but while you are in menus (1 = off). Can fix high or unstable FPS in menus',
    min: 1, max: 3, step: 0.01, value: Number(perf.cpuThrottleMenu ?? 1), instant: true, safety: 2,
    onChange: (v) => { perf.cpuThrottleMenu = v; applyPerf(false); },
  }));

  sysGroup.appendChild(createToggleRow({
    label: 'High-Performance GPU',
    desc: 'On laptops with two graphics chips, run the client on the dedicated GPU instead of the integrated one. More FPS, but more heat and battery use',
    checked: perf.highPerformanceGpu !== false, restart: true,
    onChange: (v) => { perf.highPerformanceGpu = v; savePerf(); },
  }));

  // GPU profile: auto-detects NVIDIA / Intel / weak GPUs at startup (see main/gpu-detect.ts + platform.ts)
  const gpuRow = createSelectRow({
    label: 'GPU Profile',
    desc: 'Auto detects your graphics card (NVIDIA, Intel, hybrid laptops) and picks safe flags for it. Low-End uses lighter settings for weak or old GPUs. Off restores the old generic behaviour',
    options: [
      { value: 'auto', label: 'Auto (recommended)' },
      { value: 'standard', label: 'Standard' },
      { value: 'low', label: 'Low-End' },
      { value: 'off', label: 'Off' },
    ],
    value: adv.gpuProfile || 'auto', restart: true,
    onChange: (v) => { adv.gpuProfile = v as typeof adv.gpuProfile; saveAdv(); },
  });
  sysGroup.appendChild(gpuRow);
  // Show what was detected under the dropdown (filled in asynchronously)
  const gpuDesc = gpuRow.querySelector('.krh-row-desc') as HTMLElement | null;
  ipcRenderer.invoke('get-gpu-info').then((g: any) => {
    if (!g || !gpuDesc) return;
    const names = (g.gpus || []).map((x: any) => x.name).join(' + ') || 'no GPU detected';
    const how = g.effective === 'off' ? 'profile off' : `using the ${g.effective} profile${g.hybrid ? ', hybrid graphics' : ''}`;
    gpuDesc.textContent += `. Detected: ${names} (${how})`;
  }).catch(() => { /* detection info is optional */ });

  sysGroup.appendChild(createToggleRow({
    label: 'Ignore Display Scaling',
    desc: 'Renders at 100% even when Windows scaling is 125% / 150%. Far fewer pixels for the GPU (big FPS gain on laptops) but the UI looks slightly softer',
    checked: !!adv.ignoreDisplayScaling, restart: true, safety: 1,
    onChange: (v) => { adv.ignoreDisplayScaling = v; saveAdv(); },
  }));

  sysGroup.appendChild(createButtonRow({
    label: 'Low-End PC Preset',
    desc: 'One click for weak GPUs: turns off animated video skins, motion blur, instant replay and the death-screen animation, and switches to the Low-End GPU profile. Every option can be switched back on',
    buttons: [{ icon: 'speed', label: 'Apply', title: 'Apply the Low-End preset', onClick: () => {
      ipcRenderer.invoke('apply-low-end-preset').then(() => onSettingChanged('restart'));
    } }],
  }).row);

  const angleOptions: Array<{ value: string; label: string }> = isWindows
    ? [
        { value: 'default', label: 'Default (D3D11)' },
        { value: 'gl',      label: 'OpenGL' },
        { value: 'd3d11',   label: 'Direct3D 11' },
        { value: 'd3d11on12', label: 'D3D11on12' },
      ]
    : [
        { value: 'default', label: 'Default' },
        { value: 'gl',     label: 'OpenGL' },
      ];
  // ANGLE has no Vulkan backend on macOS
  if (process.platform === 'linux') angleOptions.push({ value: 'vulkan', label: 'Vulkan' });

  sysGroup.appendChild(createSelectRow({
    label: 'ANGLE Backend',
    desc: 'Graphics API used for WebGL rendering',
    options: angleOptions,
    value: adv.angleBackend, restart: true,
    onChange: (v) => { adv.angleBackend = v; saveAdv(); },
  }));

  const flagsGroup = createGroup(body, 'Chromium Flags');

  flagsGroup.appendChild(createToggleRow({
    label: 'Remove Useless Features',
    desc: 'Disables crash dump reporting, Chromium logging, the renderer hang monitor, and other unused features',
    checked: !!adv.removeUselessFeatures, restart: true, safety: 1,
    onChange: (v) => { adv.removeUselessFeatures = v; saveAdv(); },
  }));

  flagsGroup.appendChild(createToggleRow({
    label: 'Extra Performance Tweaks',
    desc: 'Forces GPU rasterization past the driver blocklist, disables driver bug workarounds and the software fallback, prefers the high-performance GPU, and skips proxy resolution (breaks VPN/proxy setups). The two risky switches are skipped automatically on Intel graphics and weak GPUs',
    checked: !!adv.perfTweaks, restart: true, safety: 3,
    onChange: (v) => { adv.perfTweaks = v; saveAdv(); },
  }));

  flagsGroup.appendChild(createButtonRow({
    label: 'Custom Blocklist & Flags',
    desc: 'Opens the folder with user_blocklist.json (extra URLs to block, defaults you want to re-enable) and user_flags.json (extra Chromium flags, one per entry). Restart after editing',
    buttons: [{ icon: 'folder', label: 'Open Folder', title: 'Open Folder', onClick: () => ipcRenderer.invoke('open-user-lists-folder') }],
  }).row);

  const debugGroup = createGroup(body, 'Debugging');

  debugGroup.appendChild(createToggleRow({
    label: 'Verbose Logging',
    desc: 'Forward all preload console output to the Electron log file',
    checked: adv.verboseLogging, instant: true,
    onChange: (v) => {
      adv.verboseLogging = v; saveAdv();
      setVerbose(v);
    },
  }));
}

export function buildSwapperSection(body: HTMLElement, swapperConf: any, uiConfRaw: any): void {
  void swapperConf;
  const ui = uiConfRaw;

  function saveUI(): void {
    ipcRenderer.invoke('set-config', 'ui', ui);
  }

  // Above everything else: this is where people land when their swaps don't load
  const misplacedHolder = document.createElement('div');
  body.appendChild(misplacedHolder);

  const group = createGroup(body);

  group.appendChild(createButtonRow({
    label: 'Swapper Folder',
    desc: 'Always on: replace game files with your own, in the same folders Krunker uses (textures/, sound/, models/). Changes apply without a restart',
    buttons: [{ icon: 'folder', label: 'Swapper', title: 'Open Folder', onClick: () => ipcRenderer.invoke('open-swap-folder') }],
  }).row);

  group.appendChild(createButtonRow({
    label: 'External Swapper',
    desc: 'Point a Krunker resource at a web link instead of a local file: edit externalResourceSwapper.json in the swapper folder ({ "/textures/foo.png": "https://…" }, https only). Applies after a page reload. The link must allow cross-origin loading (images, models).',
    buttons: [{ icon: 'edit_note', label: 'Open File', title: 'Show externalResourceSwapper.json', onClick: () => ipcRenderer.invoke('open-external-swap-file') }],
  }).row);

  const renderMisplaced = (): void => {
    ipcRenderer.invoke('swap-misplaced').then((list: Array<{ from: string; to: string; files: number; blocked: number }>) => {
      misplacedHolder.innerHTML = '';
      for (const m of list) {
        let desc = m.from === 'main_custom.css'
          ? 'main_custom.css is loose in the swapper folder, so Krunker never loads it. It belongs in css/main_custom.css.'
          : `There's a swapper folder inside your swapper folder (${m.files} file${m.files === 1 ? '' : 's'}), so Krunker never finds them. They belong directly in swapper/.`;
        if (m.blocked) desc += ` ${m.blocked} already ${m.blocked === 1 ? 'has a file' : 'have files'} in the right place and will be left alone.`;
        const { row } = createButtonRow({
          label: 'Files in the Wrong Folder',
          desc,
          buttons: [{
            icon: 'drive_file_move', label: 'Move It', title: `Move to ${m.to}`,
            onClick: () => {
              ipcRenderer.invoke('swap-fix-misplaced').then((r: { moved: number; skipped: number }) => {
                showToast(`Moved ${r.moved} file${r.moved === 1 ? '' : 's'}` + (r.skipped ? `, left ${r.skipped} that would overwrite an existing file` : ''));
                renderMisplaced();
              });
            },
          }],
        });
        misplacedHolder.appendChild(row);
      }
    }).catch(() => { /* swapper not running (safe mode) */ });
  };
  renderMisplaced();

  // ── Sky ──
  // Applies on the next map load; the map being played is already built.
  const skyGroup = createGroup(body, 'Sky');

  const skyToggle = createToggleRow({
    label: 'Sky Swapper',
    desc: 'Replace the in-game sky with your own colours or image',
    checked: ui.skyOverride ?? DEFAULT_CONFIG.ui.skyOverride,
    refreshOnly: true,
    onChange: (v) => { ui.skyOverride = v; saveUI(); },
  });
  skyGroup.appendChild(skyToggle);

  skyGroup.appendChild(createColorRow({
    label: 'Sky Top',
    desc: 'Colour directly overhead',
    value: ui.skyZenith || DEFAULT_CONFIG.ui.skyZenith,
    defaultValue: DEFAULT_CONFIG.ui.skyZenith,
    refreshOnly: true,
    onChange: (v) => { ui.skyZenith = v; saveUI(); },
  }));

  skyGroup.appendChild(createColorRow({
    label: 'Sky Horizon',
    desc: 'Colour at the horizon',
    value: ui.skyHorizon || DEFAULT_CONFIG.ui.skyHorizon,
    defaultValue: DEFAULT_CONFIG.ui.skyHorizon,
    refreshOnly: true,
    onChange: (v) => { ui.skyHorizon = v; saveUI(); },
  }));

  // ── Sky Image (populated from swapper/skies/) ──
  // The image is wrapped around a dome, so flat photos distort badly.
  const skyImgR = createRowShell('Sky Image', 'Use an image instead of the gradient — browse for one, or drop files into swapper/skies/. Panoramic (equirectangular) images work best — ordinary photos will stretch');
  const skyImgSelect = createSelect([{ value: 'disabled', label: 'Loading...' }], 'disabled');
  skyImgR.control.appendChild(skyImgSelect);

  const populateSkies = async (): Promise<void> => {
    const images: Array<{ id: string; label: string }> = await ipcRenderer.invoke('list-sky-images');
    skyImgSelect.innerHTML = '';
    for (const img of images) {
      const opt = document.createElement('option');
      opt.value = img.id;
      opt.textContent = img.label;
      if (img.id === ui.skyImage) opt.selected = true;
      skyImgSelect.appendChild(opt);
    }
  };

  skyImgR.control.appendChild(makeButton({ icon: 'folder_open', title: 'Browse for Image', onClick: async () => {
    let id: string;
    try {
      id = await ipcRenderer.invoke('pick-sky-image');
    } catch {
      showToast('Couldn\'t add that sky image. Pick a .png, .jpg, or .webp file.');
      return;
    }
    if (!id) return;
    ui.skyImage = id;
    // The override is off by default, so without this the pick would do nothing
    ui.skyOverride = true;
    const cb = skyToggle.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
    if (cb) cb.checked = true;
    saveUI();
    await populateSkies();
    onSettingChanged('refresh');
  } }));
  skyImgR.control.appendChild(makeButton({ icon: 'folder', title: 'Open Skies Folder', onClick: () => ipcRenderer.invoke('open-skies-folder') }));
  skyGroup.appendChild(skyImgR.row);

  populateSkies();

  skyImgSelect.addEventListener('change', () => {
    ui.skyImage = skyImgSelect.value;
    saveUI();
    onSettingChanged('refresh');
  });
}

export function buildAppearanceSection(body: HTMLElement, uiConfRaw: any, ncConf: any, twConf?: any, spConf?: any): void {
  const ui = uiConfRaw;

  function saveUI(): void {
    ipcRenderer.invoke('set-config', 'ui', ui);
  }

  const themeGroup = createGroup(body, 'Theme');

  // ── CSS Theme selector (populated from swapper/themes/) ──
  const themeRowR = createRowShell('CSS Theme', 'Load a custom CSS theme from swapper/themes/ (subfolders and .css.txt files work too)');
  const themeSelect = createSelect([{ value: 'disabled', label: 'Loading...' }], 'disabled');
  themeRowR.control.appendChild(themeSelect);
  themeRowR.control.appendChild(makeButton({ icon: 'folder', title: 'Open Themes Folder', onClick: () => ipcRenderer.invoke('open-themes-folder') }));
  themeGroup.appendChild(themeRowR.row);

  ipcRenderer.invoke('list-themes').then((themes: Array<{ id: string; label: string }>) => {
    themeSelect.innerHTML = '';
    for (const t of themes) {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = t.label;
      if (t.id === ui.cssTheme) opt.selected = true;
      themeSelect.appendChild(opt);
    }
  });

  themeSelect.addEventListener('change', () => {
    ui.cssTheme = themeSelect.value;
    saveUI();
    onSettingChanged('refresh');
  });

  // ── Social CSS Theme selector (populated from swapper/socialthemes/) ──
  const socialThemeRowR = createRowShell('Social CSS Theme', 'Load a custom CSS theme for social/hub tabs from swapper/socialthemes/');
  const socialThemeSelect = createSelect([{ value: 'disabled', label: 'Loading...' }], 'disabled');
  socialThemeRowR.control.appendChild(socialThemeSelect);
  socialThemeRowR.control.appendChild(makeButton({ icon: 'folder', title: 'Open Social Themes Folder', onClick: () => ipcRenderer.invoke('open-social-themes-folder') }));
  themeGroup.appendChild(socialThemeRowR.row);

  ipcRenderer.invoke('list-social-themes').then((themes: Array<{ id: string; label: string }>) => {
    socialThemeSelect.innerHTML = '';
    for (const t of themes) {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = t.label;
      if (t.id === ui.socialCssTheme) opt.selected = true;
      socialThemeSelect.appendChild(opt);
    }
  });

  // Applies live to open tabs — no refresh needed
  socialThemeSelect.addEventListener('change', () => {
    ui.socialCssTheme = socialThemeSelect.value;
    saveUI();
  });

  const sc = statCounterConfig(ncConf);
  const statGroup = createGroup(body, 'Stat Counters');
  const statRows: HTMLElement[] = [];
  const goalRows = new Map<string, HTMLElement>();
  const syncStatRows = (): void => {
    for (const r of statRows) r.classList.toggle('krh-row-hidden', !sc.enabled);
    for (const [id, r] of goalRows) r.classList.toggle('krh-row-hidden', !sc.enabled || !sc.stats.includes(id));
  };
  const addStatRow = (row: HTMLElement): void => { statRows.push(row); statGroup.appendChild(row); };

  statGroup.appendChild(createToggleRow({
    label: 'Stat Counter Overlay',
    desc: 'Show career stats like nukes, kills and wins in-game. Kills, headshots, wallbangs, melee and thrown kills and K/D update live; the rest when the match ends. (Ported from Krunker Civilian Client 1.3.2.)',
    checked: sc.enabled, instant: true,
    onChange: (v) => { updateStatCounter({ enabled: v }); syncStatRows(); },
  }));

  addStatRow(createCheckboxGrid({
    header: 'Stats',
    items: STATS.map((s) => ({ value: s.id, label: s.label })),
    selected: [...sc.stats],
    onChange: (selected) => {
      updateStatCounter({ stats: STATS.map((s) => s.id).filter((id) => selected.includes(id)) });
      syncStatRows();
    },
  }));

  for (const def of STATS) {
    if (def.ratio) continue;
    const { row, input } = createTextRow({
      label: def.label + ' Goal',
      desc: def.tiers ? 'Blank aims for your next title. 0 hides the goal.' : 'Target shown next to the counter. Blank or 0 hides it.',
      value: sc.goals[def.id] !== undefined ? String(sc.goals[def.id]) : '',
      placeholder: def.tiers ? 'Next title' : 'None',
      instant: true,
      onChange: (v) => {
        const goals = { ...sc.goals };
        const n = Number(v.replace(/[\s,]/g, ''));
        if (v === '') delete goals[def.id];
        else if (Number.isSafeInteger(n) && n >= 0) goals[def.id] = n;
        input.value = goals[def.id] !== undefined ? String(goals[def.id]) : '';
        updateStatCounter({ goals });
      },
    });
    goalRows.set(def.id, row);
    statGroup.appendChild(row);
  }

  addStatRow(createSelectRow({
    label: 'Layout',
    desc: 'Stacked keeps every counter in one box. Separate lets you place each one on its own.',
    options: [{ value: 'stacked', label: 'Stacked' }, { value: 'separate', label: 'Separate' }],
    value: sc.layout, instant: true,
    onChange: (v) => updateStatCounter({ layout: v === 'separate' ? 'separate' : 'stacked' }),
  }));

  addStatRow(createToggleRow({
    label: 'Session Gain',
    desc: 'Show how much each counter has grown since the client started (+12)',
    checked: sc.session, instant: true,
    onChange: (v) => updateStatCounter({ session: v }),
  }));

  addStatRow(createToggleRow({
    label: 'Background',
    desc: 'Dark backdrop behind the counters',
    checked: sc.background, instant: true,
    onChange: (v) => updateStatCounter({ background: v }),
  }));

  addStatRow(createNumberRow({
    label: 'Scale',
    desc: 'Visual size of the counters',
    min: 0.5, max: 2, step: 0.05, value: sc.scale, instant: true,
    onChange: (v) => updateStatCounter({ scale: v }),
  }));

  addStatRow(createButtonRow({
    label: 'Position',
    desc: 'Drag the counters into place over the in-game HUD. Double-click one to reset it. (The Layout editor hotkey also moves the stacked box.)',
    buttons: [{ icon: 'open_with', label: 'Move', onClick: openStatCounterEditor }],
  }).row);

  syncStatRows();

  // ── Twitch Chat ──
  const tw: TwitchChatConfig = { ...DEFAULT_CONFIG.twitch, ...twConf };

  function saveTwitch(): void {
    ipcRenderer.invoke('set-config', 'twitch', tw);
    setTwitchChat(tw);
  }

  const twitchGroup = createGroup(body, 'Twitch Chat');
  const twitchSubRows: HTMLElement[] = [];
  const syncTwitchRows = (): void => {
    for (const r of twitchSubRows) r.classList.toggle('krh-row-hidden', !tw.enabled);
  };

  twitchGroup.appendChild(createToggleRow({
    label: 'Twitch Chat Overlay',
    desc: 'Read-only Twitch chat in-game (no login needed). Show or hide it while playing with Ctrl+Alt+T.',
    checked: tw.enabled, instant: true,
    onChange: (v) => { tw.enabled = v; saveTwitch(); syncTwitchRows(); },
  }));

  twitchSubRows.push(createTextRow({
    label: 'Channel',
    desc: 'Twitch channel name or link (for example twitch.tv/yourname)',
    value: tw.channel, placeholder: 'channel name', instant: true,
    onChange: (v) => { tw.channel = v; saveTwitch(); },
  }).row);

  twitchSubRows.push(createToggleRow({
    label: 'Channel Header',
    desc: 'Show the channel name and LIVE / OFFLINE status (with viewer count) above the chat',
    checked: tw.showHeader !== false, instant: true,
    onChange: (v) => { tw.showHeader = v; saveTwitch(); },
  }));

  twitchSubRows.push(createToggleRow({
    label: 'Badges',
    desc: 'Show broadcaster, mod, VIP and subscriber tags',
    checked: tw.showBadges, instant: true,
    onChange: (v) => { tw.showBadges = v; saveTwitch(); },
  }));

  twitchSubRows.push(createToggleRow({
    label: 'BTTV, FFZ and 7TV Emotes',
    desc: 'Show third-party emotes (Twitch emotes always work)',
    checked: tw.thirdPartyEmotes, instant: true,
    onChange: (v) => { tw.thirdPartyEmotes = v; saveTwitch(); },
  }));

  twitchSubRows.push(createNumberRow({
    label: 'Font Size',
    desc: 'Text size in pixels',
    min: 8, max: 40, step: 1, value: tw.fontSize, instant: true,
    onChange: (v) => { tw.fontSize = v; saveTwitch(); },
  }));

  twitchSubRows.push(createNumberRow({
    label: 'Width',
    desc: 'Chat width in pixels',
    min: 150, max: 1000, step: 10, value: tw.width, instant: true,
    onChange: (v) => { tw.width = v; saveTwitch(); },
  }));

  twitchSubRows.push(createNumberRow({
    label: 'Height',
    desc: 'Chat height in pixels',
    min: 80, max: 800, step: 10, value: tw.height, instant: true,
    onChange: (v) => { tw.height = v; saveTwitch(); },
  }));

  twitchSubRows.push(createToggleRow({
    label: 'Auto Placement',
    desc: 'Put the chat right next to the in-game chat so it never covers it (the X / Y position below is then ignored)',
    checked: tw.autoPlace !== false, instant: true,
    onChange: (v) => { tw.autoPlace = v; saveTwitch(); },
  }));

  twitchSubRows.push(createNumberRow({
    label: 'X Position',
    desc: 'Left edge, percent of screen width (only when Auto Placement is off)',
    min: 0, max: 100, step: 0.5, value: tw.x, instant: true,
    onChange: (v) => { tw.x = v; saveTwitch(); },
  }));

  twitchSubRows.push(createNumberRow({
    label: 'Y Position',
    desc: 'Top edge, percent of screen height (only when Auto Placement is off)',
    min: 0, max: 100, step: 0.5, value: tw.y, instant: true,
    onChange: (v) => { tw.y = v; saveTwitch(); },
  }));

  twitchSubRows.push(createNumberRow({
    label: 'Background Opacity',
    desc: 'Dark backdrop behind each message (0 = none)',
    min: 0, max: 1, step: 0.05, value: tw.background, instant: true,
    onChange: (v) => { tw.background = v; saveTwitch(); },
  }));

  // ── !link command (idea from the LaF Client) ──
  twitchSubRows.push(createToggleRow({
    label: '!link Command',
    desc: 'When a viewer types !link in your chat, answer with the link of the game you are in. Use your OWN channel above; needs the chat token below.',
    checked: tw.linkCommand === true, instant: true,
    onChange: (v) => { tw.linkCommand = v; saveTwitch(); },
  }));
  twitchSubRows.push(createToggleRow({
    label: '!link Only While Live',
    desc: 'Do not answer when your stream is offline',
    checked: tw.linkOnlyLive !== false, instant: true,
    onChange: (v) => { tw.linkOnlyLive = v; saveTwitch(); },
  }));

  const linkTokenInput = document.createElement('input');
  linkTokenInput.type = 'password';
  linkTokenInput.className = 'krh-input';
  linkTokenInput.placeholder = 'oauth token (chat:edit)';
  linkTokenInput.autocomplete = 'off';
  const linkStatus = document.createElement('span');
  linkStatus.style.cssText = 'margin-right:10px;opacity:0.8';
  const linkSave = makeButton({ label: 'Save', title: 'Store the token (encrypted on this computer)', onClick: () => {
    const v = linkTokenInput.value.trim();
    if (!v) return;
    ipcRenderer.invoke('twitch-link-save-token', v).then((r: { ok: boolean; error?: string }) => {
      if (r.ok) { linkTokenInput.value = ''; setLinkToken(true); showToast('Twitch chat token saved'); }
      else showToast(r.error || 'Could not save the token');
    }).catch(() => showToast('Could not save the token'));
  } });
  const linkClear = makeButton({ label: 'Remove', onClick: () => {
    ipcRenderer.send('twitch-link-clear-token');
    setLinkToken(false);
  } });
  function setLinkToken(has: boolean): void {
    linkStatus.textContent = has ? 'Token saved' : 'No token';
    linkClear.style.display = has ? '' : 'none';
  }
  setLinkToken(false);
  void ipcRenderer.invoke('twitch-link-status').then((s: { hasToken: boolean }) => setLinkToken(!!s?.hasToken)).catch(() => { /* keep default */ });
  const linkTokenRow = createButtonRow({
    label: 'Chat Token',
    desc: 'OAuth token of YOUR Twitch account with the chat:edit scope (create one at twitchtokengenerator.com, choose "Bot Chat Token"). Stored encrypted on this computer, never shown to the game page. Needed only so the answer can be sent.',
    buttons: [],
  });
  linkTokenRow.control.append(linkStatus, linkTokenInput, linkSave, linkClear);
  twitchSubRows.push(linkTokenRow.row);
  if (!(window as any).__krhLinkNoticeHooked) {
    (window as any).__krhLinkNoticeHooked = true;
    ipcRenderer.on('twitch-link-notice', (_e, t: unknown) => { if (typeof t === 'string') showToast(t); });
  }

  for (const r of twitchSubRows) twitchGroup.appendChild(r);
  syncTwitchRows();

  // ── Spotify ──
  const sp: SpotifyOverlayConfig = { ...DEFAULT_CONFIG.spotify, ...spConf };

  function saveSpotify(): void {
    ipcRenderer.invoke('set-config', 'spotify', sp);
    setSpotifyOverlay(sp);
  }

  const spotifyGroup = createGroup(body, 'Spotify');
  const spotifySubRows: HTMLElement[] = [];
  const syncSpotifyRows = (): void => {
    for (const r of spotifySubRows) r.classList.toggle('krh-row-hidden', !sp.enabled);
  };

  spotifyGroup.appendChild(createToggleRow({
    label: 'Spotify Overlay',
    desc: 'Now-playing card in-game. Works without any login (reads what plays on this PC, desktop app or browser, free accounts too). Ctrl+Alt+P play/pause, Ctrl+Alt+N next, Ctrl+Alt+B previous, Ctrl+Alt+S show/hide.',
    checked: sp.enabled,
    onChange: (v) => { sp.enabled = v; saveSpotify(); syncSpotifyRows(); },
  }));

  spotifySubRows.push(createToggleRow({
    label: 'Ignore Live Streams',
    desc: 'No-login mode: skip live streams such as a Twitch tab (they have no song length), so the card shows your music, not the stream title. Windows only exposes ONE media entry per browser: if the stream tab is the one playing, pause or close it, or use the Spotify desktop app.',
    checked: sp.ignoreLive !== false, instant: true,
    onChange: (v) => { sp.ignoreLive = v; saveSpotify(); },
  }));

  spotifySubRows.push(createTextRow({
    label: 'Ignore Words',
    desc: 'No-login mode: comma separated, anything whose title, artist, album or app contains one of these words is skipped (for example: twitch, youtube)',
    value: sp.ignoreWords ?? 'twitch',
    placeholder: 'twitch, youtube',
    onChange: (v) => { sp.ignoreWords = v; saveSpotify(); },
  }).row);

  spotifySubRows.push(createTextRow({
    label: 'Client ID',
    desc: 'Optional, Premium only: Client ID of your own Spotify developer app (adds album art). Leave empty to use the no-login mode.',
    value: sp.clientId,
    placeholder: '32 character Client ID',
    onChange: (v) => { sp.clientId = v; saveSpotify(); },
  }).row);

  const spStatus = document.createElement('span');
  spStatus.style.cssText = 'margin-right:10px;opacity:0.8';
  spStatus.textContent = 'Checking…';
  const spConnect = makeButton({ label: 'Connect', title: 'Opens Spotify in your browser to sign in', onClick: () => {
    spStatus.textContent = 'Waiting for the browser…';
    ipcRenderer.invoke('spotify-connect', sp.clientId).then((r: { ok: boolean; error?: string }) => {
      if (r.ok) { showToast('Spotify connected'); setSpotifyState(true); }
      else { showToast(r.error || 'Spotify login failed'); setSpotifyState(false, r.error); }
    }).catch(() => setSpotifyState(false, 'Spotify login failed'));
  } });
  const spDisconnect = makeButton({ label: 'Disconnect', onClick: () => {
    ipcRenderer.send('spotify-disconnect');
    setSpotifyState(false);
  } });
  function setSpotifyState(connected: boolean, err?: string): void {
    spStatus.textContent = connected ? 'Connected' : (err ? 'Not connected: ' + err : 'Not connected');
    spConnect.style.display = connected ? 'none' : '';
    spDisconnect.style.display = connected ? '' : 'none';
  }
  setSpotifyState(false);
  void ipcRenderer.invoke('spotify-status').then((s: { connected: boolean }) => setSpotifyState(!!s?.connected)).catch(() => { /* keep default */ });
  const spAcct = createButtonRow({
    label: 'Account',
    desc: 'Sign in once in your browser. Your login stays on this computer only.',
    buttons: [],
  });
  spAcct.control.append(spStatus, spConnect, spDisconnect);
  spotifySubRows.push(spAcct.row);

  spotifySubRows.push(createToggleRow({
    label: 'Album Art',
    desc: 'Show the cover next to the title',
    checked: sp.showArt,
    onChange: (v) => { sp.showArt = v; saveSpotify(); },
  }));

  spotifySubRows.push(createToggleRow({
    label: 'Progress Bar',
    desc: 'Show the song progress under the title',
    checked: sp.showProgress,
    onChange: (v) => { sp.showProgress = v; saveSpotify(); },
  }));

  spotifySubRows.push(createToggleRow({
    label: 'Hide When Nothing Plays',
    desc: 'Hide the card while Spotify is idle',
    checked: sp.hideWhenIdle,
    onChange: (v) => { sp.hideWhenIdle = v; saveSpotify(); },
  }));

  spotifySubRows.push(createNumberRow({
    label: 'Scale',
    desc: 'Size of the card (1 = normal)',
    min: 0.5, max: 3, step: 0.1, value: sp.scale, instant: true,
    onChange: (v) => { sp.scale = v; saveSpotify(); },
  }));

  spotifySubRows.push(createNumberRow({
    label: 'X Position',
    desc: 'Percent of screen width (centre of the card)',
    min: 0, max: 100, step: 0.5, value: sp.x, instant: true,
    onChange: (v) => { sp.x = v; saveSpotify(); },
  }));

  spotifySubRows.push(createNumberRow({
    label: 'Y Position',
    desc: 'Percent of screen height (top edge)',
    min: 0, max: 100, step: 0.5, value: sp.y, instant: true,
    onChange: (v) => { sp.y = v; saveSpotify(); },
  }));

  spotifySubRows.push(createNumberRow({
    label: 'Background',
    desc: 'Opacity of the dark card background (0 = none)',
    min: 0, max: 1, step: 0.05, value: sp.background, instant: true,
    onChange: (v) => { sp.background = v; saveSpotify(); },
  }));

  for (const r of spotifySubRows) spotifyGroup.appendChild(r);
  syncSpotifyRows();

  // ── Menu Music ──
  const musicGroup = createGroup(body, 'Menu Music');

  const applyMusic = (): void => {
    saveUI();
    updateSocialMusicConfig({
      source: ui.socialMusic || '',
      volume: ui.socialMusicVolume ?? 40,
      onSocial: ui.socialMusicOnSocial ?? DEFAULT_CONFIG.ui.socialMusicOnSocial,
      onMarket: ui.socialMusicOnMarket ?? DEFAULT_CONFIG.ui.socialMusicOnMarket,
    });
  };

  musicGroup.appendChild(createToggleRow({
    label: 'Play in Social Hub',
    desc: 'Loop the music while the social hub is open',
    checked: ui.socialMusicOnSocial ?? DEFAULT_CONFIG.ui.socialMusicOnSocial,
    instant: true,
    onChange: (v) => { ui.socialMusicOnSocial = v; applyMusic(); },
  }));

  musicGroup.appendChild(createToggleRow({
    label: 'Play in Market',
    desc: 'Loop the music while the Market & Trading menu is open',
    checked: ui.socialMusicOnMarket ?? DEFAULT_CONFIG.ui.socialMusicOnMarket,
    instant: true,
    onChange: (v) => { ui.socialMusicOnMarket = v; applyMusic(); },
  }));

  const musicR = createTextRow({
    label: 'Music Source',
    desc: 'Loops while an enabled menu (above) is open, and fades out when you close it. Use a direct audio file link ending in .mp3, .ogg, or .wav — page links (Pixabay, YouTube, etc.) will not work. The easiest way is to download the file and pick it with the browse button (local files must be under 30 MB). Leave blank to disable.',
    value: ui.socialMusic || '',
    placeholder: 'https://example.com/track.mp3  or  C:\\path\\to\\file.mp3',
    onChange: (v) => { ui.socialMusic = v; applyMusic(); },
  });
  const musicInput = musicR.input;
  const musicControl = musicR.row.querySelector('.krh-row-control') as HTMLElement;
  musicControl.appendChild(makeButton({ icon: 'folder_open', title: 'Browse for Audio File', onClick: async () => {
    const path: string = await ipcRenderer.invoke('pick-audio-file');
    if (path) { musicInput.value = path; ui.socialMusic = path; applyMusic(); }
  } }));

  stopMusicPreview(); // this panel is rebuilt on every open
  const resetMusicBtn = (failed?: boolean): void => {
    stopMusicPreview();
    musicPlayBtn.innerHTML = '<span class="material-icons">play_arrow</span>';
    if (failed) showToast('Couldn\'t load that music. Use a direct audio file link (.mp3/.ogg/.wav) or download it and pick the file — page links won\'t work.');
  };
  const musicPlayBtn = makeButton({ icon: 'play_arrow', title: 'Preview Music', onClick: async () => {
    if (musicPreview) { resetMusicBtn(); return; }
    const src = (await ipcRenderer.invoke('resolve-social-music', musicInput.value.trim())) as SocialMusicSource;
    let url = '';
    if (src && 'url' in src) {
      url = src.url;
    } else if (src && 'bytes' in src) {
      musicPreviewUrl = URL.createObjectURL(new Blob([src.bytes as unknown as BlobPart], { type: src.mime }));
      url = musicPreviewUrl;
    }
    if (!url) { resetMusicBtn(true); return; }
    musicPreview = new Audio(url);
    musicPreview.volume = Math.min(1, Math.max(0, (ui.socialMusicVolume ?? 40) / 100));
    musicPlayBtn.innerHTML = '<span class="material-icons">stop</span>';
    musicPreview.onended = () => resetMusicBtn();
    musicPreview.onerror = () => resetMusicBtn(true);
    musicPreview.play().catch(() => resetMusicBtn(true));
  } });
  musicControl.appendChild(musicPlayBtn);
  musicGroup.appendChild(musicR.row);

  musicGroup.appendChild(createNumberRow({
    label: 'Music Volume',
    desc: 'Playback volume (0-100)',
    min: 0, max: 100, value: ui.socialMusicVolume ?? 40, instant: true,
    onChange: (v) => { ui.socialMusicVolume = v; applyMusic(); },
  }));

  const loadingGroup = createGroup(body, 'Loading Screen');

  // ── Loading Screen Background ──
  const bgRowR = createRowShell('Loading Background', 'Custom background image for the loading screen (swapper/backgrounds/)');
  const bgSelect = createSelect([{ value: 'disabled', label: 'Loading...' }], 'disabled');
  bgRowR.control.appendChild(bgSelect);
  bgRowR.control.appendChild(makeButton({ icon: 'folder', title: 'Open Backgrounds Folder', onClick: () => ipcRenderer.invoke('open-backgrounds-folder') }));
  loadingGroup.appendChild(bgRowR.row);

  ipcRenderer.invoke('list-loading-themes').then((themes: Array<{ id: string; label: string }>) => {
    bgSelect.innerHTML = '';
    for (const t of themes) {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = t.label;
      if (t.id === ui.loadingTheme) opt.selected = true;
      bgSelect.appendChild(opt);
    }
  });

  bgSelect.addEventListener('change', () => {
    ui.loadingTheme = bgSelect.value;
    saveUI();
    onSettingChanged('refresh');
  });

  // ── Background URL (overrides loading theme selection) ──
  loadingGroup.appendChild(createTextRow({
    label: 'Background URL',
    desc: 'Direct image URL for loading screen (overrides dropdown above)',
    value: ui.backgroundUrl || '',
    placeholder: 'https://example.com/image.png',
    refreshOnly: true,
    onChange: (v) => { ui.backgroundUrl = v; saveUI(); },
  }).row);
}

export function buildMatchmakerSection(body: HTMLElement, mmConf: any, bag: SettingsBag): void {
  const mm = { ...DEFAULT_CONFIG.matchmaker, ...mmConf };

  function saveMM(): void {
    ipcRenderer.invoke('set-config', 'matchmaker', mm);
  }

  const mmGroup = createGroup(body, 'Matchmaking');

  mmGroup.appendChild(createToggleRow({
    label: 'Custom Matchmaker',
    desc: 'Use the matchmaker hotkey to find a game matching your criteria',
    checked: mm.enabled, instant: true,
    onChange: (v) => { mm.enabled = v; saveMM(); },
  }));

  mmGroup.appendChild(createToggleRow({
    label: 'Open Server Browser on Cancel',
    desc: 'Opens the server browser when no game is found and you cancel',
    checked: mm.openServerBrowser, instant: true,
    onChange: (v) => { mm.openServerBrowser = v; saveMM(); },
  }));

  mmGroup.appendChild(createToggleRow({
    label: 'Prioritize Player Count',
    desc: 'Sort results by most players first, then by ping (default is ping first)',
    checked: mm.sortByPlayers ?? false, instant: true,
    onChange: (v) => { mm.sortByPlayers = v; saveMM(); },
  }));

  mmGroup.appendChild(createToggleRow({
    label: 'Hide Search Overlay',
    desc: 'Skip the lobby search animation and join the match instantly',
    checked: mm.hideSearchOverlay ?? false, instant: true,
    onChange: (v) => { mm.hideSearchOverlay = v; saveMM(); },
  }));

  const hkGroup = createGroup(body, 'Hotkeys');

  hkGroup.appendChild(createKeybindRow('Matchmaker Hotkey', 'Key to trigger the custom matchmaker', bag.binds.matchmaker, (b) => {
    bag.binds.matchmaker = b;
    bag.saveBinds();
  }, undefined, true));
  hkGroup.appendChild(createKeybindRow('Matchmaker Cancel', 'Key to dismiss the matchmaker popup', bag.binds.matchmakerCancel, (b) => {
    bag.binds.matchmakerCancel = b;
    bag.saveBinds();
  }, undefined, true));

  // Quick Play key (F2 by default): same value as Extras > Quick Play Key, now rebindable right here.
  const qpRowHolder = document.createElement('div');
  hkGroup.appendChild(qpRowHolder);
  void ipcRenderer.invoke('get-config', 'extras').then((exRaw: Partial<ExtrasConfig> | undefined) => {
    const ex: ExtrasConfig = { ...DEFAULT_CONFIG.extras, ...(exRaw || {}) };
    qpRowHolder.appendChild(createSimpleKeyRow({
      label: 'Quick Play Key',
      desc: 'Key that opens the Quick Play window (matchmaker tiles, raids, Trade Plaza, ARG). Default: F2',
      value: ex.quickPlayKey || 'F2',
      instant: true,
      onChange: (k) => { ex.quickPlayKey = k; void ipcRenderer.invoke('set-config', 'extras', ex); },
    }));
  }).catch(() => { /* config unavailable: row skipped */ });

  const filtersGroup = createGroup(body, 'Filters');

  filtersGroup.appendChild(createNumberRow({
    label: 'Min Players', desc: 'Minimum player count in lobby (0-7)',
    min: 0, max: 7, value: mm.minPlayers, instant: true,
    onChange: (v) => { mm.minPlayers = v; saveMM(); },
  }));

  filtersGroup.appendChild(createNumberRow({
    label: 'Max Players', desc: 'Maximum player count in lobby (0-7)',
    min: 0, max: 7, value: mm.maxPlayers, instant: true,
    onChange: (v) => { mm.maxPlayers = v; saveMM(); },
  }));

  filtersGroup.appendChild(createNumberRow({
    label: 'Min Remaining Time', desc: 'Minimum seconds remaining in match (0-480)',
    min: 0, max: 480, value: mm.minRemainingTime, instant: true,
    onChange: (v) => { mm.minRemainingTime = v; saveMM(); },
  }));

  filtersGroup.appendChild(createCheckboxGrid({
    header: 'Regions (none selected = all)',
    items: MATCHMAKER_REGIONS.map(r => ({ value: r, label: MATCHMAKER_REGION_NAMES[r] || r })),
    selected: mm.regions,
    onChange: () => saveMM(),
  }));

  filtersGroup.appendChild(createCheckboxGrid({
    header: 'Gamemodes (none selected = every standard mode)',
    items: matchmakerModeItems(mm.gamemodes),
    selected: mm.gamemodes,
    onChange: () => saveMM(),
  }));

  filtersGroup.appendChild(createCheckboxGrid({
    header: 'Maps (none selected = every official map)',
    items: matchmakerMapNames().map(m => ({ value: m, label: MATCHMAKER_MAP_NAMES[m] || m.replace(/_/g, ' '), icon: mapIconUrl(m) ?? undefined })),
    selected: mm.maps,
    onChange: () => saveMM(),
  }));

  // ── Ranked Match Sound (URL or local file path; empty = default) ──
  const soundR = createTextRow({
    label: 'Ranked Match Sound',
    desc: 'Plays when a ranked match is found. Use a direct audio file link ending in .mp3, .ogg, or .wav — page links (Pixabay, YouTube, etc.) will not work. The easiest way is to download the file and pick it with the browse button. Leave blank for the default.',
    value: mm.rankedMatchSound || '',
    placeholder: 'https://example.com/sound.mp3  or  C:\\path\\to\\file.mp3',
    onChange: (v) => { mm.rankedMatchSound = v; saveMM(); },
  });
  const soundInput = soundR.input;
  const soundControl = soundR.row.querySelector('.krh-row-control') as HTMLElement;
  soundControl.appendChild(makeButton({ icon: 'folder_open', title: 'Browse for Audio File', onClick: async () => {
    const path: string = await ipcRenderer.invoke('pick-audio-file');
    if (path) {
      soundInput.value = path;
      mm.rankedMatchSound = path;
      saveMM();
    }
  } }));
  let previewAudio: HTMLAudioElement | null = null;
  const resetPlayBtn = (failed?: boolean): void => {
    previewAudio = null;
    soundPlayBtn.innerHTML = '<span class="material-icons">play_arrow</span>';
    if (failed) showToast('Couldn\'t load that sound. Use a direct audio file link (.mp3/.ogg/.wav) or download it and pick the file — page links won\'t work.');
  };
  const soundPlayBtn = makeButton({ icon: 'play_arrow', title: 'Preview Sound', onClick: async () => {
    if (previewAudio) { previewAudio.pause(); resetPlayBtn(); return; }
    const url: string = await ipcRenderer.invoke('resolve-ranked-sound', soundInput.value.trim());
    previewAudio = new Audio(url);
    previewAudio.volume = Math.min(1, Math.max(0, (mm.rankedMatchVolume ?? 100) / 100));
    soundPlayBtn.innerHTML = '<span class="material-icons">stop</span>';
    previewAudio.onended = () => resetPlayBtn();
    previewAudio.onerror = () => resetPlayBtn(true);
    previewAudio.play().catch(() => resetPlayBtn(true));
  } });
  soundControl.appendChild(soundPlayBtn);
  const rankedGroup = createGroup(body, 'Ranked');
  rankedGroup.appendChild(soundR.row);
  rankedGroup.appendChild(createNumberRow({
    label: 'Ranked Match Sound Volume',
    desc: 'Volume of the sound that plays when a ranked match is found',
    min: 0, max: 100, step: 5, value: mm.rankedMatchVolume ?? 100, instant: true,
    onChange: (v) => { mm.rankedMatchVolume = v; saveMM(); },
  }));
}

export function buildDiscordSection(body: HTMLElement, discordConf: any): void {
  const discord = { ...DEFAULT_CONFIG.discord, ...discordConf };

  const mainGroup = createGroup(body);

  mainGroup.appendChild(createToggleRow({
    label: 'Discord Rich Presence',
    desc: 'Show game activity in your Discord profile',
    checked: discord.enabled,
    restart: true,
    onChange: (v) => {
      discord.enabled = v;
      ipcRenderer.invoke('set-config', 'discord', discord);
    },
  }));

  const displayGroup = createGroup(body, 'Display');

  displayGroup.appendChild(createToggleRow({
    label: 'Show Map & Gamemode',
    desc: 'Display the current map and gamemode',
    checked: discord.showMapMode,
    refreshOnly: true,
    onChange: (v) => {
      discord.showMapMode = v;
      ipcRenderer.invoke('set-config', 'discord', discord);
    },
  }));

  displayGroup.appendChild(createToggleRow({
    label: 'Show Class',
    desc: 'Display your current class name',
    checked: discord.showClass,
    refreshOnly: true,
    onChange: (v) => {
      discord.showClass = v;
      ipcRenderer.invoke('set-config', 'discord', discord);
    },
  }));

  displayGroup.appendChild(createToggleRow({
    label: 'Show Elapsed Time',
    desc: 'Display how long you\'ve been in the current match',
    checked: discord.showTimer,
    refreshOnly: true,
    onChange: (v) => {
      discord.showTimer = v;
      ipcRenderer.invoke('set-config', 'discord', discord);
    },
  }));

  displayGroup.appendChild(createToggleRow({
    label: 'Show Menu/Spectating Status',
    desc: 'Display "In Menus" or "Spectating" when not in a match',
    checked: discord.showStatus,
    refreshOnly: true,
    onChange: (v) => {
      discord.showStatus = v;
      ipcRenderer.invoke('set-config', 'discord', discord);
    },
  }));
}

export function buildChatSection(body: HTMLElement, gameConf: any, translatorConf: any): void {
  const game = gameConf;

  function saveGame(): void {
    ipcRenderer.invoke('set-config', 'game', game);
  }

  const chatGroup = createGroup(body, 'Chat');

  chatGroup.appendChild(createToggleRow({
    label: 'Better Chat',
    desc: 'Merge team and all-chat with colored [T]/[M] prefixes',
    checked: game.betterChat, instant: true,
    onChange: (v) => { game.betterChat = v; saveGame(); setBetterChat(v); },
  }));

  chatGroup.appendChild(createToggleRow({
    label: 'Selectable Chat',
    desc: 'Lets you select and copy text from the in-game chat with the mouse',
    checked: game.selectableChat ?? false, instant: true,
    onChange: (v) => { game.selectableChat = v; saveGame(); setSelectableChat(v); },
  }));

  chatGroup.appendChild(createToggleRow({
    label: 'Auto-Hide Chat Input',
    desc: 'Fade the chat input box out in-game until you open chat',
    checked: game.autoHideChat, instant: true,
    onChange: (v) => { game.autoHideChat = v; saveGame(); setAutoHideChat(v); },
  }));

  chatGroup.appendChild(createNumberRow({
    label: 'Chat History Size', desc: 'Maximum chat messages to keep (0 to disable history preservation)',
    min: 0, max: 1000, value: game.chatHistorySize, instant: true,
    onChange: (v) => { game.chatHistorySize = v; saveGame(); setChatHistorySize(v); },
  }));

  // Translator settings inline
  const tl = { ...DEFAULT_CONFIG.translator, ...translatorConf };

  function saveTL(): void {
    ipcRenderer.invoke('set-config', 'translator', tl);
  }

  const tlGroup = createGroup(body, 'Translator');

  // Live preview — the .krh-translation line tracks the --krh-tl-* vars, so it
  // restyles in real time (even while dragging inside the color picker).
  // Built before the rows so their handlers can refresh the tag text.
  const pvShell = createRowShell('Preview', 'How translations appear in chat', { block: true });
  const pvBox = document.createElement('div');
  pvBox.className = 'krh-tl-preview';
  const pvChat = document.createElement('div');
  pvChat.textContent = 'Player_One: bonjour tout le monde';
  const pvTl = document.createElement('div');
  pvTl.className = 'krh-translation';
  const refreshPreview = (): void => {
    pvTl.textContent = '\u{1F310} Player_One: hello everyone' + (tl.showLanguageTag ? ' [FR]' : '');
  };
  refreshPreview();
  pvBox.appendChild(pvChat);
  pvBox.appendChild(pvTl);
  pvShell.control.appendChild(pvBox);

  tlGroup.appendChild(createToggleRow({
    label: 'Chat Translator',
    desc: 'Automatically translate non-English chat messages',
    checked: tl.enabled, instant: true,
    onChange: (v) => {
      tl.enabled = v;
      saveTL();
      updateTranslatorConfig({ enabled: v });
    },
  }));

  tlGroup.appendChild(createSelectRow({
    label: 'Target Language',
    desc: 'Language to translate messages into', instant: true,
    options: [
      { value: 'en', label: 'English' },
      { value: 'es', label: 'Spanish' },
      { value: 'fr', label: 'French' },
      { value: 'de', label: 'German' },
      { value: 'pt', label: 'Portuguese' },
      { value: 'ru', label: 'Russian' },
      { value: 'ja', label: 'Japanese' },
      { value: 'ko', label: 'Korean' },
      { value: 'zh', label: 'Chinese' },
      { value: 'ar', label: 'Arabic' },
      { value: 'hi', label: 'Hindi' },
      { value: 'tr', label: 'Turkish' },
      { value: 'pl', label: 'Polish' },
      { value: 'it', label: 'Italian' },
      { value: 'nl', label: 'Dutch' },
    ],
    value: tl.targetLanguage,
    onChange: (v) => {
      tl.targetLanguage = v;
      saveTL();
      updateTranslatorConfig({ targetLanguage: v });
    },
  }));

  tlGroup.appendChild(createToggleRow({
    label: 'Show Language Tag',
    desc: 'Show detected language code before translations (e.g. [FR])',
    checked: tl.showLanguageTag, instant: true,
    onChange: (v) => {
      tl.showLanguageTag = v;
      saveTL();
      updateTranslatorConfig({ showLanguageTag: v });
      refreshPreview();
    },
  }));

  tlGroup.appendChild(createColorRow({
    label: 'Translation Color',
    desc: 'Text color of translated messages',
    value: tl.textColor, defaultValue: DEFAULT_CONFIG.translator.textColor, instant: true,
    onInput: (v) => updateTranslatorConfig({ textColor: v }),
    onChange: (v) => {
      tl.textColor = v;
      saveTL();
      updateTranslatorConfig({ textColor: v });
    },
  }));

  tlGroup.appendChild(createSelectRow({
    label: 'Translation Style',
    desc: 'Font style of translated messages', instant: true,
    options: [
      { value: 'normal', label: 'Normal' },
      { value: 'italic', label: 'Italic' },
      { value: 'bold', label: 'Bold' },
      { value: 'bold-italic', label: 'Bold + Italic' },
    ],
    value: tl.textStyle,
    onChange: (v) => {
      tl.textStyle = v;
      saveTL();
      updateTranslatorConfig({ textStyle: v });
    },
  }));

  tlGroup.appendChild(pvShell.row);

  // Custom skip words — messages made entirely of these (plus built-in skip terms) won't be translated.
  tlGroup.appendChild(createTextRow({
    label: 'Custom Skip Words',
    desc: 'Comma-separated words to ignore (e.g. your nickname, friends\' names). Applies instantly.',
    value: tl.customSkipWords || '',
    placeholder: 'jakk, bigj, etc.',
    onChange: (v) => { tl.customSkipWords = v; saveTL(); updateTranslatorConfig({ customSkipWords: v }); },
  }).row);
}


// ── Extras: chat tools, mod downloader, display mode, menu hiding, Discord buttons, settings profiles ──
export function buildExtrasSection(body: HTMLElement, exConf: any): void {
  const ex: ExtrasConfig = {
    ...DEFAULT_CONFIG.extras, ...exConf,
    rpcButtons: { ...DEFAULT_CONFIG.extras.rpcButtons, ...(exConf?.rpcButtons || {}) },
    crosshair: { ...DEFAULT_CONFIG.extras.crosshair, ...(exConf?.crosshair || {}) },
    motionBlur: { ...DEFAULT_CONFIG.extras.motionBlur, ...(exConf?.motionBlur || {}) },
    nameColors: { ...DEFAULT_CONFIG.extras.nameColors, ...(exConf?.nameColors || {}) },
    settingPresets: normalisePresets(exConf?.settingPresets),
    liveAccuracy: { ...DEFAULT_CONFIG.extras.liveAccuracy, ...(exConf?.liveAccuracy || {}) },
    perfHud: { ...DEFAULT_CONFIG.extras.perfHud, ...(exConf?.perfHud || {}) },
    serverFilter: { ...DEFAULT_CONFIG.extras.serverFilter, ...(exConf?.serverFilter || {}) },
    gameLoop: { ...DEFAULT_CONFIG.extras.gameLoop, ...(exConf?.gameLoop || {}) },
    rpcRich: { ...DEFAULT_CONFIG.extras.rpcRich, ...(exConf?.rpcRich || {}) },
    instantReplay: { ...DEFAULT_CONFIG.extras.instantReplay, ...(exConf?.instantReplay || {}) },
    sessionStats: { ...DEFAULT_CONFIG.extras.sessionStats, ...(exConf?.sessionStats || {}) },
    packs: {
      enabled: [...(exConf?.packs?.enabled || [])],
      loadouts: (exConf?.packs?.loadouts || []).map((l: { name: string; ids: string[] }) => ({ name: l.name, ids: [...l.ids] })),
    },
  };
  const save = (): void => { void ipcRenderer.invoke('set-config', 'extras', ex); };

  // ── Chat tools ──
  const chat = createGroup(body, 'Chat Tools');
  chat.appendChild(createToggleRow({
    label: 'Chat Filters',
    desc: 'Type /players, /kills, /unbox, /server in the in-game chat to show only that kind of message (/all shows everything again). The command is not sent to the server.',
    checked: ex.chatFilters, refreshOnly: true,
    onChange: (v) => { ex.chatFilters = v; save(); },
  }));
  chat.appendChild(createTextRow({
    label: 'Chat Filter Key',
    desc: 'Key that cycles all, players, kills, server and unboxing (a key name such as F3; empty = off)',
    value: ex.chatFilterKey, placeholder: 'F3', refreshOnly: true,
    onChange: (v) => { ex.chatFilterKey = v.trim(); save(); },
  }).row);
  chat.appendChild(createToggleRow({
    label: 'Chat Logs',
    desc: 'Remember the newest 2000 chat messages in a window with filters, search, copy and clickable links',
    checked: ex.chatLogs, refreshOnly: true,
    onChange: (v) => { ex.chatLogs = v; save(); },
  }));
  chat.appendChild(createTextRow({
    label: 'Chat Logs Key',
    desc: 'Key that opens and closes the Chat Logs window',
    value: ex.chatLogsKey, placeholder: 'F1', refreshOnly: true,
    onChange: (v) => { ex.chatLogsKey = v.trim(); save(); },
  }).row);

  // ── Game menu ──
  const menu = createGroup(body, 'Menu and Leaderboards');
  menu.appendChild(createToggleRow({
    label: 'Ranked Badges on the Leaderboard',
    desc: 'Show a player\'s ranked badge next to their name on the normal in-game leaderboard (taken from the ranked list once it has been shown)',
    checked: ex.rankedBadges, refreshOnly: true,
    onChange: (v) => { ex.rankedBadges = v; save(); },
  }));
  menu.appendChild(createToggleRow({
    label: 'One-Click Mod Downloader',
    desc: 'Adds a download icon to every mod in Krunker\'s Mods window. Mods are saved to Downloads/KRH Client/Mods under their own name.',
    checked: ex.modDownloader, refreshOnly: true,
    onChange: (v) => { ex.modDownloader = v; save(); },
  }));
  menu.appendChild(createTextRow({
    label: 'Quick Play Key',
    desc: 'Key that opens the Quick Play tile picker (regions, gamemodes and maps for the custom matchmaker)',
    value: ex.quickPlayKey, placeholder: 'F2', refreshOnly: true,
    onChange: (v) => { ex.quickPlayKey = v.trim(); save(); },
  }).row);
  menu.appendChild(createToggleRow({
    label: 'Auto Find After Disconnect',
    desc: 'When Krunker shows its update / disconnect screen, start a custom matchmaker search by itself (at most once every 8 seconds). Idea from Lombre_Blanche\'s matchmaker script.',
    checked: ex.autoRejoin, refreshOnly: true,
    onChange: (v) => { ex.autoRejoin = v; save(); },
  }));
  menu.appendChild(createCheckboxGrid({
    header: 'Hide Menu Elements',
    items: HIDE_ITEMS.map((i) => ({ value: i.key, label: i.label })),
    selected: ex.hiddenMenu,
    onChange: (sel) => { ex.hiddenMenu = sel; save(); setHiddenMenu(sel); },
  }));

  // ── Crosshair (idea from Lombre_Blanche's matchmaker script) ──
  const xh = createGroup(body, 'Crosshair');
  const xhRows: HTMLElement[] = [];
  const xhApply = (): void => { save(); setCrosshair(ex.crosshair); };
  const xhSync = (): void => { for (const r of xhRows) r.classList.toggle('krh-row-hidden', !ex.crosshair.enabled); };
  xh.appendChild(createToggleRow({
    label: 'Custom Crosshair',
    desc: 'Draws your own crosshair in the middle of the screen while you aim and hides the game\'s one. It is drawn once, so it costs no performance.',
    checked: ex.crosshair.enabled, instant: true,
    onChange: (v) => { ex.crosshair.enabled = v; xhApply(); xhSync(); },
  }));
  const xhAdd = (row: HTMLElement): void => { xhRows.push(row); xh.appendChild(row); };
  xhAdd(createSelectRow({
    label: 'Shape', desc: 'Cross has a gap in the middle, Plus is a solid +',
    options: [
      { value: 'cross', label: 'Cross' }, { value: 'plus', label: 'Plus' }, { value: 'circle', label: 'Circle' },
      { value: 'hCircle', label: 'Hollow circle' }, { value: 'square', label: 'Square' }, { value: 'hSquare', label: 'Hollow square' },
      { value: 'symbol', label: 'Symbol / text' }, { value: 'image', label: 'Image' },
    ],
    value: ex.crosshair.shape, instant: true,
    onChange: (v) => { ex.crosshair.shape = v as ExtrasConfig['crosshair']['shape']; xhApply(); },
  }));
  xhAdd(createTextRow({
    label: 'Symbol', desc: 'Used by the Symbol shape (up to 4 characters, for example a star)',
    value: ex.crosshair.symbol, placeholder: '\u2605', instant: true,
    onChange: (v) => { if (v) { ex.crosshair.symbol = Array.from(v).slice(0, 4).join(''); xhApply(); } },
  }).row);
  const xhImg = createButtonRow({
    label: 'Crosshair Image',
    desc: 'A picture for the Image shape (PNG, JPEG, WebP or GIF, up to 150 KB). It is saved inside your settings, so it keeps working even if the place you got it from goes offline.',
    buttons: [],
  });
  const xhFile = document.createElement('input');
  xhFile.type = 'file';
  xhFile.accept = 'image/png,image/jpeg,image/webp,image/gif';
  xhFile.style.display = 'none';
  xhFile.addEventListener('change', () => {
    const f = xhFile.files?.[0];
    xhFile.value = '';
    if (!f) return;
    if (f.size > CROSSHAIR_IMAGE_MAX_BYTES) { showToast('That image is over 150 KB, pick a smaller one'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const url = typeof reader.result === 'string' ? cleanCrosshairImage(reader.result) : '';
      if (!url) { showToast('That file is not a PNG, JPEG, WebP or GIF image'); return; }
      ex.crosshair.image = url;
      ex.crosshair.shape = 'image';
      xhApply();
      showToast('Crosshair image saved');
    };
    reader.readAsDataURL(f);
  });
  xhImg.control.append(
    xhFile,
    makeButton({ label: 'Choose Image', title: 'Pick an image file', onClick: () => xhFile.click() }),
    makeButton({ label: 'Remove', title: 'Forget the saved image', onClick: () => { ex.crosshair.image = ''; xhApply(); showToast('Crosshair image removed'); } }),
  );
  xhAdd(xhImg.row);
  const xhNum = (label: string, desc: string, key: 'size' | 'thick' | 'gap' | 'dot' | 'outWidth', min: number, max: number): void => {
    xhAdd(createNumberRow({
      label, desc, min, max, step: 1, value: ex.crosshair[key], instant: true,
      onChange: (v) => { ex.crosshair[key] = v; xhApply(); },
    }));
  };
  xhNum('Size', 'Length of the arms / radius of the shape', 'size', 1, 80);
  xhNum('Thickness', 'Line thickness', 'thick', 1, 30);
  xhNum('Gap', 'Space in the middle of the Cross shape', 'gap', -10, 80);
  xhNum('Center Dot', 'Size of the dot in the middle (0 = none)', 'dot', 0, 30);
  xhNum('Outline Width', 'Outline around every part (0 = none)', 'outWidth', 0, 8);
  xhAdd(createColorRow({
    label: 'Color', desc: 'Crosshair color', value: ex.crosshair.color, defaultValue: '#00ff00', instant: true,
    onChange: (v) => { ex.crosshair.color = v; xhApply(); },
  }));
  xhAdd(createColorRow({
    label: 'Outline Color', desc: 'Outline color', value: ex.crosshair.outline, defaultValue: '#000000', instant: true,
    onChange: (v) => { ex.crosshair.outline = v; xhApply(); },
  }));
  xhSync();

  // ── Visuals and menu (motion blur and quick class picker from WOK Client, classic menu from Kute) ──
  const vis = createGroup(body, 'Visuals and Menu');
  const mbRows: HTMLElement[] = [];
  const mbApply = (): void => { save(); setMotionBlur(ex.motionBlur); };
  const mbSync = (): void => { for (const r of mbRows) r.classList.toggle('krh-row-hidden', !ex.motionBlur.enabled); };
  vis.appendChild(createToggleRow({
    label: 'Motion Blur',
    desc: 'A slight blur trail while you turn the camera. The HUD, crosshair and menus stay sharp, and nothing runs while you stand still. It costs some performance, so it is off by default. Adapted from WOK Client.',
    checked: ex.motionBlur.enabled, instant: true,
    onChange: (v) => { ex.motionBlur.enabled = v; mbApply(); mbSync(); },
  }));
  const mbAdd = (row: HTMLElement): void => { mbRows.push(row); vis.appendChild(row); };
  mbAdd(createNumberRow({
    label: 'Motion Blur Strength', desc: '0 is none, 100 is the strongest trail', min: 0, max: 100, step: 5,
    value: ex.motionBlur.strength, instant: true,
    onChange: (v) => { ex.motionBlur.strength = v; mbApply(); },
  }));
  mbAdd(createSelectRow({
    label: 'Motion Blur Quality', desc: 'Native keeps the full resolution. Balanced and Performance process fewer pixels, which is lighter on weak GPUs.',
    options: [{ value: 'native', label: 'Native' }, { value: 'balanced', label: 'Balanced' }, { value: 'performance', label: 'Performance' }],
    value: ex.motionBlur.quality, instant: true,
    onChange: (v) => { ex.motionBlur.quality = v as ExtrasConfig['motionBlur']['quality']; mbApply(); },
  }));
  mbSync();
  const colorList = (label: string, desc: string, field: 'friends' | 'clans', placeholder: string): void => {
    const { row, control } = createRowShell(label, escapeHtml(desc), { refreshOnly: true, block: true });
    const area = document.createElement('textarea');
    area.className = 'krh-input';
    area.rows = 4;
    area.spellcheck = false;
    area.placeholder = placeholder;
    area.value = ex.nameColors[field];
    area.addEventListener('change', () => { ex.nameColors[field] = area.value.slice(0, 4000); save(); onSettingChanged('refresh'); });
    control.appendChild(area);
    vis.appendChild(row);
  };
  colorList('Friend Name Colours', 'Names to colour on the leaderboards, end-of-match tables and player list. One per line: the name, a colour, and optionally "bold". Adapted from NM/NZ Client.', 'friends', 'PlayerName #48eaff bold');
  colorList('Clan Name Colours', 'Clan tags to colour (the tag only, without brackets). Same format. A friend\'s own colour wins for their name.', 'clans', 'TAG #e4552e');
  vis.appendChild(createToggleRow({
    label: 'Live Accuracy',
    desc: 'Shows your accuracy for the match and for the current life under the top-centre HUD (or at the bottom). It is counted from your ammo and the hit sound, so it is an estimate, not Krunker\'s official figure. Adapted from NM/NZ Client.',
    checked: ex.liveAccuracy.enabled, instant: true,
    onChange: (v) => { ex.liveAccuracy.enabled = v; save(); setLiveAccuracy(v, ex.liveAccuracy.placement); },
  }));
  vis.appendChild(createSelectRow({
    label: 'Live Accuracy Position', desc: 'Where the accuracy readout sits',
    options: [{ value: 'top', label: 'Top centre' }, { value: 'bottom', label: 'Bottom centre' }],
    value: ex.liveAccuracy.placement, instant: true,
    onChange: (v) => { ex.liveAccuracy.placement = v === 'bottom' ? 'bottom' : 'top'; save(); setLiveAccuracy(ex.liveAccuracy.enabled, ex.liveAccuracy.placement); },
  }));
  const phApply = (): void => { save(); setPerfHud(ex.perfHud); };
  vis.appendChild(createTextRow({
    label: 'Frame-Time HUD Key', desc: 'Key that shows or hides an FPS counter with 1% and 0.1% lows (a key name such as F10; empty = off). Adapted from NM/NZ Client.',
    value: ex.perfHud.key, placeholder: 'F10', instant: true,
    onChange: (v) => { ex.perfHud.key = v.trim(); phApply(); },
  }).row);
  vis.appendChild(createSelectRow({
    label: 'Frame-Time HUD Corner', desc: 'Where the counter sits',
    options: [{ value: 'top-left', label: 'Top left' }, { value: 'top-right', label: 'Top right' }, { value: 'bottom-left', label: 'Bottom left' }, { value: 'bottom-right', label: 'Bottom right' }],
    value: ex.perfHud.corner, instant: true,
    onChange: (v) => { ex.perfHud.corner = v as ExtrasConfig['perfHud']['corner']; phApply(); },
  }));
  vis.appendChild(createSelectRow({
    label: 'Frame-Time HUD Detail', desc: 'FPS only, or FPS with frame time and the lows',
    options: [{ value: 'full', label: 'Full' }, { value: 'fps', label: 'FPS only' }],
    value: ex.perfHud.detail, instant: true,
    onChange: (v) => { ex.perfHud.detail = v === 'fps' ? 'fps' : 'full'; phApply(); },
  }));
  vis.appendChild(createToggleRow({
    label: 'Frame-Time HUD On At Start', desc: 'Show the counter as soon as the game loads (takes effect the next launch)',
    checked: ex.perfHud.startOn, refreshOnly: true,
    onChange: (v) => { ex.perfHud.startOn = v; phApply(); },
  }));
  vis.appendChild(createToggleRow({
    label: 'Quick Class Picker',
    desc: 'Shows the class icons above the play buttons, so one click switches class. Idea and styling from WOK Client.',
    checked: ex.quickClassPicker, instant: true,
    onChange: (v) => { ex.quickClassPicker = v; save(); setQuickClassPicker(v); },
  }));
  vis.appendChild(createToggleRow({
    label: 'Classic Menu',
    desc: 'The Season 9 main menu layout (play buttons in a grid, class card on the right) over the current menu. Adapted from Kute. If Krunker changes its menu, turn this off.',
    checked: ex.classicMenu, instant: true,
    onChange: (v) => { ex.classicMenu = v; save(); setClassicMenu(v); },
  }));
  vis.appendChild(createToggleRow({
    label: 'Disable Video Skins',
    desc: 'Animated video skins (like Glitch) are not loaded, which saves FPS. Takes effect the next time the game loads. Idea from Kute.',
    checked: ex.disableVideoSkins, refreshOnly: true,
    onChange: (v) => { ex.disableVideoSkins = v; save(); },
  }));

  // ── Server list ──
  const sl = createGroup(body, 'Server List');
  const slApply = (): void => { save(); setServerFilter(ex.serverFilter.enabled, ex.serverFilter.words); };
  sl.appendChild(createToggleRow({
    label: 'Server List Filter',
    desc: 'Hides the servers whose map name contains one of the words below from Krunker\'s server browser. It works on the server list answer itself, so the game is not changed. Idea and default words from j4k0xb\'s Serverlist Filter.',
    checked: ex.serverFilter.enabled, instant: true,
    onChange: (v) => { ex.serverFilter.enabled = v; slApply(); },
  }));
  sl.appendChild(createTextRow({
    label: 'Hidden Map Words',
    desc: 'Separate the words with commas. A server is hidden when its map name contains any of them (case does not matter). Applies the next time the server list is loaded.',
    value: ex.serverFilter.words, placeholder: 'infect, trade, trading, fun-parkour', instant: true,
    onChange: (v) => { ex.serverFilter.words = v.slice(0, 600); slApply(); },
  }).row);

  // ── Experiments ──
  const xp = createGroup(body, 'Experiments');
  const glApply = (): void => { save(); setGameLoop(ex.gameLoop); };
  xp.appendChild(createToggleRow({
    label: 'Separate Game Loop (Experimental)',
    desc: 'Runs the game\'s frame between screen frames, so key presses and game updates are handled several times per screen frame while only one of them is drawn, to get low input delay without uncapped FPS. Idea by KNLZVX. WebGL only and not tested in every mode: if the game looks wrong (missing shadows or reflections) or plays worse, turn it off.',
    checked: ex.gameLoop.enabled, instant: true,
    onChange: (v) => { ex.gameLoop.enabled = v; glApply(); },
  }));
  xp.appendChild(createNumberRow({
    label: 'Game Loop Interval', desc: 'Milliseconds between the extra game runs. 4 is the lowest a browser timer allows (250 per second), 8 is a lighter default (125 per second).',
    min: 4, max: 33, step: 1, value: ex.gameLoop.intervalMs, instant: true,
    onChange: (v) => { ex.gameLoop.intervalMs = v; glApply(); },
  }));

  // ── Convenience (all three adapted from Kute) ──
  const conv = createGroup(body, 'Convenience');
  conv.appendChild(createToggleRow({
    label: 'Ranked Match Alert',
    desc: 'When Krunker\'s ranked queue finds a match while you are in another window, bring KRH Client to the front (or flash it in the taskbar if the system does not allow that).',
    checked: ex.rankedAlert, instant: true,
    onChange: (v) => { ex.rankedAlert = v; save(); setRankedAlert(v); },
  }));
  conv.appendChild(createToggleRow({
    label: 'Keep Friend Chat Drafts',
    desc: 'Krunker empties the message box of a friend chat whenever a new message arrives. This puts your unsent text back.',
    checked: ex.chatDraft, instant: true,
    onChange: (v) => { ex.chatDraft = v; save(); setChatDraft(v); },
  }));
  conv.appendChild(createToggleRow({
    label: 'End Message Per Account',
    desc: 'Krunker\'s Match End Message is remembered for each account. An account without a message of its own sends nothing, so an alt never sends your main account\'s message.',
    checked: ex.accountEndMessage, instant: true,
    onChange: (v) => { ex.accountEndMessage = v; save(); void setAccountEndMessage(v, true); },
  }));
  conv.appendChild(createToggleRow({
    label: 'Fast Escape',
    desc: 'Pressing Escape to leave a match normally makes clicking back in wait about two seconds (a Chromium rule). With this on, the client lets go of the mouse itself, so you can click straight back in. Escape is only taken while the game holds the mouse and its window is focused. Not available where the system blocks global shortcuts (some Linux Wayland setups).',
    checked: ex.escapeFastRelease, instant: true,
    onChange: (v) => { ex.escapeFastRelease = v; save(); },
  }));

  // ── Window and scripts ──
  const win = createGroup(body, 'Window and Scripts');
  win.appendChild(createSelectRow({
    label: 'Display Mode',
    desc: 'How the window opens and what it switches to right now. F11 still toggles fullscreen.',
    options: [{ value: 'windowed', label: 'Windowed' }, { value: 'maximized', label: 'Maximized' }, { value: 'fullscreen', label: 'Fullscreen' }],
    value: ex.displayMode, instant: true,
    onChange: (v) => { ex.displayMode = v as ExtrasConfig['displayMode']; save(); },
  }));
  win.appendChild(createSelectRow({
    label: 'Userscript Hot Reload',
    desc: 'When a file in your userscripts folder changes: do nothing, show a notice, or reload the page right away (leaves a running match)',
    options: [{ value: 'off', label: 'Off' }, { value: 'notify', label: 'Show a notice' }, { value: 'reload', label: 'Reload the page' }],
    value: ex.userscriptReload, instant: true,
    onChange: (v) => { ex.userscriptReload = v as ExtrasConfig['userscriptReload']; save(); },
  }));

  // ── Discord buttons ──
  const rpc = createGroup(body, 'Discord Presence Buttons');
  const rpcRows: HTMLElement[] = [];
  const syncRpc = (): void => { for (const r of rpcRows) r.classList.toggle('krh-row-hidden', !ex.rpcButtons.enabled); };
  rpc.appendChild(createToggleRow({
    label: 'Custom Buttons',
    desc: 'Up to two link buttons on your Discord status (https links only, label up to 32 characters). Needs Discord Rich Presence on; other people see the buttons, you do not.',
    checked: ex.rpcButtons.enabled, instant: true,
    onChange: (v) => { ex.rpcButtons.enabled = v; save(); syncRpc(); },
  }));
  const rpcField = (label: string, key: 'label1' | 'url1' | 'label2' | 'url2', placeholder: string): void => {
    const r = createTextRow({
      label, desc: '', value: ex.rpcButtons[key], placeholder, instant: true,
      onChange: (v) => { ex.rpcButtons[key] = v.trim(); save(); },
    }).row;
    rpcRows.push(r);
    rpc.appendChild(r);
  };
  rpcField('Button 1 Label', 'label1', 'My Twitch');
  rpcField('Button 1 Link', 'url1', 'https://twitch.tv/…');
  rpcField('Button 2 Label', 'label2', 'My Discord');
  rpcField('Button 2 Link', 'url2', 'https://discord.gg/…');
  syncRpc();

  // ── Sensitivity and FOV presets (adapted from NM/NZ Client) ──
  const presetGroup = createGroup(body, 'Sensitivity & FOV Presets');
  for (const scope of PRESET_SCOPES) {
    const sel = createSelect([{ value: '', label: '(none saved)' }], '');
    const refresh = (keep?: string): void => {
      sel.innerHTML = '';
      const list = ex.settingPresets.filter((p) => p.scope === scope.id);
      const items = list.length ? list.map((p) => ({ value: p.id, label: p.name + ' (' + summarisePreset(scope, p.values) + ')' })) : [{ value: '', label: '(none saved)' }];
      for (const o of items) { const op = document.createElement('option'); op.value = o.value; op.textContent = o.label; sel.appendChild(op); }
      if (keep && list.some((p) => p.id === keep)) sel.value = keep;
    };
    refresh();
    const nameRow = createTextRow({
      label: scope.label + ' Preset Name', desc: 'Name for the ' + scope.label.toLowerCase() + ' preset you save below (for example Sniper). Saving with an existing name replaces it.',
      value: '', placeholder: scope.label === 'FOV' ? 'Wide' : 'Sniper', instant: true, onChange: () => { /* read on Save */ },
    });
    presetGroup.appendChild(nameRow.row);
    const row = createButtonRow({ label: scope.label + ' Presets', desc: scope.hint, buttons: [] });
    row.control.append(
      sel,
      makeButton({ label: 'Save Current', title: 'Save the current in-game ' + scope.label.toLowerCase() + ' settings', onClick: () => {
        const name = presetName(nameRow.input.value);
        if (!name) { showToast('Type a preset name first'); return; }
        const values = capturePreset(scope, gameSetting, storedGameSettingIds());
        const existing = ex.settingPresets.find((p) => p.scope === scope.id && p.name.toLowerCase() === name.toLowerCase());
        if (!existing && ex.settingPresets.filter((p) => p.scope === scope.id).length >= PRESET_LIMIT) { showToast('Too many presets saved, delete one first'); return; }
        const id = existing ? existing.id : scope.id + '-' + Date.now().toString(36);
        const next = { id, name, scope: scope.id, values };
        if (existing) ex.settingPresets[ex.settingPresets.indexOf(existing)] = next; else ex.settingPresets.push(next);
        save(); refresh(id); showToast('Preset saved: ' + name);
      } }),
      makeButton({ label: 'Apply', title: 'Switch the game to the selected preset', onClick: () => {
        const p = ex.settingPresets.find((x) => x.id === sel.value);
        if (!p) { showToast('Pick a preset first'); return; }
        const writes = planPreset(scope, p.values, gameSetting, storedGameSettingIds());
        if (writes.length === 0) { showToast('Already using ' + p.name); return; }
        showToast(setGameSettings(writes) ? 'Preset applied: ' + p.name : 'Krunker is not ready for that yet');
      } }),
      makeButton({ label: 'Delete', title: 'Delete the selected preset', onClick: () => {
        const i = ex.settingPresets.findIndex((x) => x.id === sel.value);
        if (i < 0) return;
        const name = ex.settingPresets[i].name;
        ex.settingPresets.splice(i, 1);
        save(); refresh(); showToast('Preset deleted: ' + name);
      } }),
    );
    presetGroup.appendChild(row.row);
  }

  // ── Settings profiles ──
  const prof = createGroup(body, 'Settings Profiles');
  const profSelect = createSelect([{ value: '', label: '(no profiles saved)' }], '');
  const refreshProfiles = (keep?: string): void => {
    profSelect.innerHTML = '';
    const list = ex.settingsProfiles;
    const opts = list.length ? list.map((p) => ({ value: p.name, label: p.name })) : [{ value: '', label: '(no profiles saved)' }];
    for (const o of opts) {
      const op = document.createElement('option');
      op.value = o.value;
      op.textContent = o.label;
      profSelect.appendChild(op);
    }
    if (keep && list.some((p) => p.name === keep)) profSelect.value = keep;
  };
  refreshProfiles();

  const nameRow = createTextRow({
    label: 'Profile Name',
    desc: 'Name for the profile you save below, for example Ranked or Low-end. Saving with an existing name replaces it.',
    value: '', placeholder: 'Ranked', instant: true,
    onChange: () => { /* read when you press Save */ },
  });
  prof.appendChild(nameRow.row);

  const readKrunkerSettings = (): string => {
    const fn = (window as any).exportSettings;
    if (typeof fn !== 'function') return '';
    try { const r = fn(1); return typeof r === 'string' ? r : ''; } catch { return ''; }
  };

  const actions = createButtonRow({
    label: 'Profiles',
    desc: 'Save your current in-game Krunker settings (sensitivity, controls, graphics...) and load them again later with one click.',
    buttons: [],
  });
  actions.control.append(
    profSelect,
    makeButton({ label: 'Save Current', title: 'Save the current Krunker settings under the name above', onClick: () => {
      const name = nameRow.input.value.trim().slice(0, 60);
      if (!name) { showToast('Type a profile name first'); return; }
      const data = readKrunkerSettings();
      if (!data) { showToast('Could not read Krunker settings (open Krunker once and try again)'); return; }
      const i = ex.settingsProfiles.findIndex((p) => p.name === name);
      if (i >= 0) ex.settingsProfiles[i] = { name, data }; else ex.settingsProfiles.push({ name, data });
      save();
      refreshProfiles(name);
      showToast('Profile saved: ' + name);
    } }),
    makeButton({ label: 'Load', title: 'Apply the selected profile to Krunker', onClick: () => {
      const p = ex.settingsProfiles.find((x) => x.name === profSelect.value);
      if (!p) { showToast('Pick a profile first'); return; }
      const w = window as any;
      if (typeof w.importSettingsPopup !== 'function' || typeof w.importSettings !== 'function') { showToast('Krunker settings import is not available right now'); return; }
      // Goes through Krunker\'s own import so the game validates the text and refreshes its UI.
      w.importSettingsPopup(1);
      setTimeout(() => {
        const box = document.getElementById('importTxt') as HTMLTextAreaElement | null;
        if (!box) { showToast('Could not open Krunker\'s import box'); return; }
        box.value = p.data;
        w.importSettings(1);
        showToast('Profile loaded: ' + p.name);
      }, 150);
    } }),
    makeButton({ label: 'Delete', title: 'Delete the selected profile', onClick: () => {
      const i = ex.settingsProfiles.findIndex((x) => x.name === profSelect.value);
      if (i < 0) return;
      const name = ex.settingsProfiles[i].name;
      ex.settingsProfiles.splice(i, 1);
      save();
      refreshProfiles();
      showToast('Profile deleted: ' + name);
    } }),
  );
  prof.appendChild(actions.row);

  // ── Version 1.1: updates, presence extras, streamer mode, replay, stats, layout, packs, share codes ──
  buildV11Section(body, ex, save);
}
