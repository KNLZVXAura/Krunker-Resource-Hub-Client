// ── Settings render orchestration ──
// Hooks Krunker's settings window and renders the Client tab as a sidebar: a header
// band, a category rail + content pane (sections built via settings-sections),
// cross-category search, and the userscripts section. hookSettings() is the entry
// point, called once the settings window is available.

import { ipcRenderer } from 'electron';
import type { Keybind } from '../main/config';
import { DEFAULT_CONFIG } from '../main/config-defaults';
import { escapeHtml, showToast } from './utils';
import { KRH_ICON_DATA_URL } from './header-icon';
import { savedConsole as _console } from './saved-console';
import { openKeybindDialog, keybindDisplayString } from './keybind-dialog';
import { showConfirm } from './confirm-dialog';
import { isSkippedKey, newImportChoices, skippedGroups } from './import-groups';
import type { ImportGroup } from './import-groups';
import {
  createToggleRow, createButtonRow, createInfoRow, createGroup,
  createRowShell, createSelect, onSettingChanged,
  resetRefreshNotification,
} from './settings-controls';
import {
  type SettingsBag,
  buildGeneralSection, buildGameSection, buildKeystrokesRows, buildPerformanceSection,
  buildSwapperSection, buildAppearanceSection, buildMatchmakerSection, buildDiscordSection, buildExtrasSection,
  buildChatSection, stopMusicPreview,
} from './settings-sections';
import { buildAccountsSection } from './alt-manager';
import { getInstances, setScriptEnabled } from './userscripts';
import type { UserscriptInstance } from './userscripts';

// ── Krunker native settings (localStorage) ──
// Krunker persists its in-game settings in localStorage: the settings menu uses
// the `kro_setngss_` prefix (FOV, sensitivity, crosshair, colors, etc.) and a few
// extras (e.g. ranked region prefs) use `s_`. We capture only these setting
// namespaces — never auth tokens (`__FRVR_*`, `krunker_username`) or other keys.
const KRUNKER_SETTING_PREFIXES = ['kro_setngss_', 's_'];

const GITHUB_ISSUES_URL = 'https://github.com/krunkerresourcehub/krh-client/issues';
const GITHUB_MARK_SVG = '<svg class="krh-issues-mark" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.012 8.012 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/></svg>';
let issueCountCache: number | null = null;

function isKrunkerSettingKey(key: string): boolean {
  return KRUNKER_SETTING_PREFIXES.some((p) => key.startsWith(p));
}

function collectKrunkerSettings(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && isKrunkerSettingKey(key)) {
        const val = localStorage.getItem(key);
        if (val !== null) out[key] = val;
      }
    }
  } catch (err) {
    _console.warn('[KRH] Could not read Krunker settings:', err);
  }
  return out;
}

function applyKrunkerSettings(settings: Record<string, string> | undefined, skip: Set<ImportGroup>): void {
  if (!settings || typeof settings !== 'object') return;
  try {
    for (const [key, val] of Object.entries(settings)) {
      if (isKrunkerSettingKey(key) && typeof val === 'string' && !isSkippedKey(key, skip)) {
        localStorage.setItem(key, val);
      }
    }
  } catch (err) {
    _console.warn('[KRH] Could not apply Krunker settings:', err);
  }
}

// Handle to the currently rendered settings UI so the search box can filter the
// existing DOM in place rather than rebuilding the whole tree on every keystroke.
let rendered: { container: HTMLElement; panels: HTMLElement[]; setActiveCat: (key: string) => void; activeKey: string } | null = null;

// Last category the user viewed — remembered across opening/closing the settings
// window within a session. Kept in memory only, so it resets on app relaunch (and
// page reload), which is the intended behaviour.
let lastActiveCategory: string | null = null;

export function hookSettings(): void {
  const w = window as any;
  const settingsWindow = w.windows[0];
  let selectedTab: number = settingsWindow.tabIndex;

  function isClientTab(): boolean {
    const tabs = settingsWindow.tabs[settingsWindow.settingType];
    return tabs && selectedTab === tabs.length - 1;
  }

  function safeRender(): void {
    if (!isClientTab()) return;
    const query = (document.getElementById('settSearch') as HTMLInputElement | null)?.value?.trim() ?? '';
    renderSettings(query.length > 0 ? query : undefined);
  }

  // Closing the settings window is neither a tab change nor a search, so none of the
  // hooks below fire — without this a running music preview plays on over the game.
  const holder = document.getElementById('windowHolder');
  if (holder) {
    new MutationObserver(() => {
      if (!holder.style.display || holder.style.display === 'none') stopMusicPreview();
    }).observe(holder, { attributes: true, attributeFilter: ['style'] });
  }

  const origShowWindow = w.showWindow.bind(w);
  const origChangeTab = settingsWindow.changeTab.bind(settingsWindow);
  const origSearchList = settingsWindow.searchList.bind(settingsWindow);

  w.showWindow = (...args: unknown[]) => {
    const result = origShowWindow(...args);
    if (args[0] === 1) {
      if (settingsWindow.settingType === 'basic') {
        settingsWindow.toggleType({ checked: true });
      }
      const advSlider = document.querySelector('.advancedSwitch input#typeBtn') as HTMLInputElement | null;
      if (advSlider) {
        advSlider.disabled = true;
        if (advSlider.nextElementSibling) {
          advSlider.nextElementSibling.setAttribute('title', 'Client auto-enables advanced settings mode');
        }
      }

      const searchInput = document.getElementById('settSearch') as HTMLInputElement | null;
      const searchQuery = searchInput?.value?.trim() ?? '';
      if (searchQuery.length > 0) renderSettings(searchQuery);
      else if (isClientTab()) renderSettings();
    }
    return result;
  };

  settingsWindow.changeTab = (...args: unknown[]) => {
    const result = origChangeTab(...args);
    const tabChanged = settingsWindow.tabIndex !== selectedTab;
    selectedTab = settingsWindow.tabIndex;
    // Only (re)render on an actual tab switch — re-clicking the already-active Client
    // tab would otherwise rebuild the panel and look like a refresh. Still restore if
    // Krunker wiped our injected content.
    const needsRestore = isClientTab() && !document.querySelector('#settHolder .krh-settings');
    if (tabChanged || needsRestore) safeRender();
    return result;
  };

  settingsWindow.searchList = (...args: unknown[]) => {
    const result = origSearchList(...args);
    const searchInput = document.getElementById('settSearch') as HTMLInputElement | null;
    const query = searchInput?.value?.trim() ?? '';
    // Filter the already-built DOM in place when it's present — rebuilding here would
    // re-run every section's IPC plus the theme/background folder scans on every
    // keystroke. Only (re)build when our container is missing (first search, or a tab
    // switch wiped it).
    const haveDom = rendered !== null && document.body.contains(rendered.container);
    if (query.length > 0) {
      if (haveDom) updateSearch(query);
      else renderSettings(query);
    } else if (isClientTab()) {
      if (haveDom) updateSearch('');
      else renderSettings();
    } else {
      document.querySelector('#settHolder .krh-settings')?.remove();
      rendered = null;
    }
    return result;
  };

  safeRender();
}

// ── Search filter (cross-category) ──
// In search mode the rail is hidden (CSS) and every category panel is stacked with
// its heading; rows that don't match the query are hidden, and panels with no
// matches are hidden entirely. The active filter is retained so categories that
// populate asynchronously (Userscripts, saved Accounts) can re-apply it once their
// rows land — otherwise they'd stay hidden after the initial sync pass.
let activeSearch: { query: string; panels: HTMLElement[] } | null = null;

// The dashboard's search box wants to know how many settings match (for its counter and the "no match" note).
let searchResultListener: ((count: number) => void) | null = null;

/** Re-run the active search filter (no-op when not searching). Async sections call
 *  this after appending their rows. Every word of the query has to match, in the
 *  setting's own text or in the name of its category ("performance fps" works). */
function reapplySearch(): void {
  if (!activeSearch) return;
  const { query, panels } = activeSearch;
  const words = query.split(/\s+/).filter(Boolean);
  let total = 0;
  panels.forEach((panel) => {
    const catText = ((panel.dataset.cat || '') + ' ' + (panel.querySelector('.krh-cat-head')?.textContent || '')).toLowerCase();
    let visible = 0;
    panel.querySelectorAll('.krh-row').forEach((el) => {
      const text = (el.textContent || '').toLowerCase();
      const match = !el.classList.contains('krh-row-hidden') && words.every((w) => text.includes(w) || catText.includes(w));
      (el as HTMLElement).style.display = match ? '' : 'none';
      if (match) visible++;
    });
    panel.style.display = visible > 0 ? '' : 'none';
    total += visible;
  });
  if (searchResultListener) searchResultListener(total);
}

function applySearchFilter(container: HTMLElement, holder: HTMLElement, searchQuery: string, panels: HTMLElement[]): void {
  container.classList.add('krh-searching');
  activeSearch = { query: searchQuery.toLowerCase(), panels };
  reapplySearch();
  if (panels.some((p) => p.style.display !== 'none')) {
    Array.from(holder.children).forEach((child) => {
      if ((child as HTMLElement).textContent?.toLowerCase().includes('no settings')) {
        (child as HTMLElement).remove();
      }
    });
  }
}

// Update the search filter against the already-rendered DOM (no rebuild). Called on
// every keystroke once the settings tree exists; falls back to a build only when the
// container is gone (see the searchList hook).
function updateSearch(query: string): void {
  if (!rendered) return;
  // Krunker's native searchList may hide non-matching #settHolder children — make
  // sure our container stays visible since we filter inside it ourselves.
  rendered.container.style.display = '';
  if (query.length > 0) {
    const holder = document.getElementById('settHolder');
    if (holder) applySearchFilter(rendered.container, holder, query, rendered.panels);
  } else {
    // Exit search: drop the per-row/per-panel display overrides and restore the
    // single active category.
    activeSearch = null;
    rendered.container.classList.remove('krh-searching');
    rendered.panels.forEach((panel) => {
      panel.style.display = '';
      panel.querySelectorAll('.krh-row').forEach((el) => { (el as HTMLElement).style.display = ''; });
    });
    rendered.setActiveCat(rendered.activeKey);
  }
}

// ── Backup & reset actions ──
// Grouped action page: backup and client maintenance as icon buttons, with the
// destructive actions set apart in a red danger zone with per-action descriptions.
function buildManageSection(body: HTMLElement, dashboard = false): void {
  const makeActionBtn = (icon: string, label: string, onClick: () => void): HTMLElement => {
    const btn = document.createElement('div');
    btn.className = 'krh-manage-btn';
    btn.innerHTML = '<span class="material-icons">' + icon + '</span>' + escapeHtml(label);
    btn.addEventListener('click', onClick);
    return btn;
  };
  const makeSection = (label: string): HTMLElement => {
    const l = document.createElement('div');
    l.className = 'krh-group-label';
    l.textContent = label;
    body.appendChild(l);
    const grid = document.createElement('div');
    grid.className = 'krh-manage-grid';
    body.appendChild(grid);
    return grid;
  };

  const backupGrid = makeSection('Backup');
  if (dashboard) {
    const note = createInfoRow('From the dashboard, only your KRH Client settings are saved and loaded. To include your Krunker settings, use Backup &amp; Reset inside the game.');
    body.insertBefore(note, backupGrid);
  }
  backupGrid.appendChild(makeActionBtn('file_download', 'Export Settings', () => {
    const krunker = dashboard ? {} : collectKrunkerSettings();
    ipcRenderer.invoke('export-settings', krunker).then((res: any) => {
      if (res && res.success) showToast('Settings exported');
      else if (res && !res.canceled) showToast('Export failed: ' + (res.error || 'unknown error'));
    });
  }));
  backupGrid.appendChild(makeActionBtn('file_upload', 'Import Settings', () => {
    const choices = newImportChoices();
    showConfirm({
      title: 'Import Settings',
      message: 'Import settings from a file? This overwrites your current client and Krunker settings (alt accounts are not affected) and restarts the client. Unchecked groups keep your current settings.',
      confirmLabel: 'Import',
      checkboxes: choices,
    }).then((ok) => {
      if (!ok) return;
      const skip = skippedGroups(choices);
      ipcRenderer.invoke('import-settings', [...skip]).then((res: any) => {
        if (res && res.success) {
          if (!dashboard) applyKrunkerSettings(res.krunker, skip);
          ipcRenderer.invoke('restart-client');
        } else if (res && !res.canceled) {
          showToast('Import failed: ' + (res.error || 'unknown error'));
        }
      });
    });
  }));

  const clientGrid = makeSection('Client');
  clientGrid.appendChild(makeActionBtn('folder_open', 'Client Folder', () => ipcRenderer.invoke('open-client-folder')));
  clientGrid.appendChild(makeActionBtn('folder', 'Swapper Folder', () => ipcRenderer.invoke('open-swap-folder')));
  clientGrid.appendChild(makeActionBtn('description', 'Electron Logs', () => ipcRenderer.invoke('open-electron-log')));
  clientGrid.appendChild(makeActionBtn('refresh', 'Restart Client', () => ipcRenderer.invoke('restart-client')));

  const dzLabel = document.createElement('div');
  dzLabel.className = 'krh-group-label krh-dzone-label';
  dzLabel.textContent = 'Danger Zone';
  body.appendChild(dzLabel);
  const dzone = document.createElement('div');
  dzone.className = 'krh-dzone';
  body.appendChild(dzone);

  const dangerActions: Array<{ title: string; desc: string; button: string; action: () => void }> = [
    { title: 'Reset Resource Swapper', desc: 'Deletes all files in the swapper folder. Cannot be undone.', button: 'Reset', action: () => {
      showConfirm({
        title: 'Reset Resource Swapper',
        message: 'This deletes all files in the swapper folder and cannot be undone.',
        confirmLabel: 'Reset', danger: true,
      }).then((ok) => { if (ok) ipcRenderer.invoke('reset-swapper'); });
    }},
    { title: 'Reset Options', desc: 'Resets all client settings to their defaults and restarts the client.', button: 'Reset', action: () => {
      showConfirm({
        title: 'Reset Options',
        message: 'Reset all settings to their defaults? The client will restart.',
        confirmLabel: 'Reset', danger: true,
      }).then((ok) => { if (ok) ipcRenderer.invoke('reset-options'); });
    }},
    { title: 'Delete All Data', desc: 'Clears config, logs, and all Krunker site data including logins and in-game settings. Userscripts and swapper files are kept.', button: 'Delete', action: () => {
      showConfirm({
        title: 'Delete All Data',
        message: 'Clears your config, logs, and all Krunker site data — including your logins and in-game settings. Your userscripts and swapper files are kept. The client will restart.',
        confirmLabel: 'Delete', danger: true,
      }).then((ok) => { if (ok) ipcRenderer.invoke('delete-all-data'); });
    }},
  ];

  for (const d of dangerActions) {
    const row = document.createElement('div');
    row.className = 'krh-drow';
    row.innerHTML =
      '<div class="krh-drow-main">' +
        '<div class="krh-drow-title">' + escapeHtml(d.title) + '</div>' +
        '<div class="krh-drow-desc">' + escapeHtml(d.desc) + '</div>' +
      '</div>';
    const btn = document.createElement('button');
    btn.className = 'krh-dbtn';
    btn.textContent = d.button;
    btn.addEventListener('click', d.action);
    row.appendChild(btn);
    dzone.appendChild(row);
  }
}

/** Accounts in the dashboard: alt accounts sign in on the game page, so this points to the game. */
function buildDashboardAccountsSection(body: HTMLElement): void {
  const group = createGroup(body);
  group.appendChild(createInfoRow('Alt accounts sign in on the game page, so they are added and switched inside the game (Settings > Client > Accounts).'));
  group.appendChild(createButtonRow({
    label: 'Accounts',
    desc: 'Opens the game and its Client settings',
    buttons: [{ icon: 'open_in_new', label: 'Open in game', title: 'Open the game settings window', onClick: () => { void ipcRenderer.invoke('dash:open', 'game-settings'); } }],
  }).row);
}

interface CatDef { key: string; label: string; icon: string; build: (body: HTMLElement) => void; }

/** Where the settings go and what to leave out. The KRH Dashboard window renders the same panel as the game's settings window. */
interface RenderOptions { skip?: string[]; forceHeader?: boolean; dashboard?: boolean }

/** The same settings panel, for the KRH Dashboard window (it has a #settHolder of its own). */
export function renderDashboardSettings(): void {
  // Every category is here. Three of them work on the game page itself (Accounts, Userscripts, Backup & Reset),
  // so in the dashboard they show the part that works without the game and point to the game for the rest.
  renderSettings(undefined, { forceHeader: true, dashboard: true });
}

/** Search box of the KRH Dashboard's Client Settings page. An empty query shows the normal category view again. */
export function searchDashboardSettings(query: string, onResult?: (count: number) => void): void {
  searchResultListener = onResult ?? null;
  const q = query.trim();
  if (!q && onResult) onResult(-1);
  updateSearch(q);
}

function renderSettings(searchQuery?: string, opts?: RenderOptions): void {
  const holder = document.getElementById('settHolder');
  if (!holder) return;

  resetRefreshNotification();

  const container = document.createElement('div');
  container.className = 'krh-settings';

  // Synchronous fetch + build so the whole panel rebuilds in one tick — an async
  // gap here lets the browser paint the (Krunker-cleared) empty holder = a flash.
  let data: { config: any; platform: any; version: string };
  try {
    data = ipcRenderer.sendSync('get-settings-data-sync', ['swapper', 'matchmaker', 'keybinds', 'advanced', 'game', 'ui', 'discord', 'translator', 'performance', 'nukeCounter', 'twitch', 'spotify', 'extras']);
  } catch (err: any) {
    _console.error('[KRH] Settings render error:', err);
    return;
  }
  const allConf = data.config;
  const platformInfo = data.platform;
  const version = data.version;
  // Shared across every section builder — each one posts the whole game/ui
  // object, so they must mutate one copy or later writes clobber earlier ones.
  const gameConf = { ...DEFAULT_CONFIG.game, ...allConf.game };
  const uiConfRaw = { ...DEFAULT_CONFIG.ui, ...allConf.ui };
  const isWindows = platformInfo && platformInfo.isWindows;
  const binds = { ...DEFAULT_CONFIG.keybinds, ...allConf.keybinds };
  const bag: SettingsBag = {
    binds,
    saveBinds: () => ipcRenderer.invoke('set-config', 'keybinds', binds),
    isWindows,
  };

  // ── Header band (shown only when the KRH watermark setting is on; rendered
  // either way so the watermark toggle can show/hide it live) ──
  const showBrand = uiConfRaw?.watermark ?? DEFAULT_CONFIG.ui.watermark;
  const header = document.createElement('div');
  header.className = 'krh-header';
  if (!showBrand && !opts?.forceHeader) header.style.display = 'none';
  header.innerHTML =
    '<div class="krh-header-mark"><img src="' + KRH_ICON_DATA_URL + '" alt="KRH" draggable="false"></div>' +
    '<div class="krh-header-text">' +
      '<div class="krh-header-name">KRH Client</div>' +
      '<div class="krh-header-ver">v' + escapeHtml(version || '') + '</div>' +
    '</div>' +
    '<div class="krh-header-issues" title="Opens the GitHub issue tracker in your browser">' +
      GITHUB_MARK_SVG +
      '<span>Report an Issue</span>' +
      '<span class="krh-issues-count"></span>' +
    '</div>';
  const issuesBadge = header.querySelector('.krh-header-issues') as HTMLElement;
  const issuesCount = issuesBadge.querySelector('.krh-issues-count') as HTMLElement;
  issuesBadge.addEventListener('click', () => ipcRenderer.invoke('open-external', GITHUB_ISSUES_URL));
  const setIssueCount = (count: number | null): void => {
    if (typeof count !== 'number') return;
    issueCountCache = count;
    issuesCount.textContent = count + ' open';
  };
  // Remembered across renders so a rebuilt badge is not briefly narrower.
  if (issueCountCache !== null) setIssueCount(issueCountCache);
  else ipcRenderer.invoke('github-issue-count').then(setIssueCount);
  container.appendChild(header);

  // ── Shell: category rail + content pane ──
  const shell = document.createElement('div');
  shell.className = 'krh-shell';
  const rail = document.createElement('div');
  rail.className = 'krh-rail';
  const pane = document.createElement('div');
  pane.className = 'krh-pane';
  shell.appendChild(rail);
  shell.appendChild(pane);
  container.appendChild(shell);

  const allCats: CatDef[] = [
    { key: 'General', label: 'General', icon: 'tune', build: (b) => buildGeneralSection(b, gameConf, uiConfRaw, bag) },
    { key: 'Game', label: 'Game', icon: 'sports_esports', build: (b) => buildGameSection(b, gameConf, uiConfRaw, bag) },
    { key: 'Performance', label: 'Performance', icon: 'speed', build: (b) => buildPerformanceSection(b, allConf.performance, allConf.advanced, isWindows) },
    { key: 'Swapper', label: 'Swapper', icon: 'swap_horiz', build: (b) => buildSwapperSection(b, allConf.swapper, uiConfRaw) },
    { key: 'Appearance', label: 'Appearance', icon: 'palette', build: (b) => buildAppearanceSection(b, uiConfRaw, allConf.nukeCounter, allConf.twitch, allConf.spotify) },
    { key: 'Matchmaker', label: 'Matchmaker', icon: 'travel_explore', build: (b) => buildMatchmakerSection(b, allConf.matchmaker, bag) },
    { key: 'Extras', label: 'Extras', icon: 'extension', build: (b) => buildExtrasSection(b, allConf.extras) },
    { key: 'Chat', label: 'Chat', icon: 'chat', build: (b) => buildChatSection(b, gameConf, allConf.translator) },
    { key: 'Discord', label: 'Discord', icon: 'forum', build: (b) => buildDiscordSection(b, allConf.discord) },
    { key: 'Accounts', label: 'Accounts', icon: 'people', build: (b) => (opts?.dashboard ? buildDashboardAccountsSection(b) : buildAccountsSection(createGroup(b), reapplySearch)) },
    { key: 'Keystrokes', label: 'Keystrokes', icon: 'keyboard', build: (b) => buildKeystrokesRows(b) },
    { key: 'Userscripts', label: 'Userscripts', icon: 'code', build: (b) => renderUserscriptsSection(b, opts?.dashboard === true) },
    { key: 'Manage', label: 'Backup & Reset', icon: 'restart_alt', build: (b) => buildManageSection(b, opts?.dashboard === true) },
  ];
  const cats = opts?.skip ? allCats.filter((c) => !opts.skip!.includes(c.key)) : allCats;

  const panels: HTMLElement[] = [];
  const items: HTMLElement[] = [];

  const setActiveCat = (key: string): void => {
    items.forEach((it) => it.classList.toggle('krh-active', it.dataset.cat === key));
    panels.forEach((pnl) => { pnl.style.display = pnl.dataset.cat === key ? '' : 'none'; });
    lastActiveCategory = key;
    if (rendered) rendered.activeKey = key;
  };

  cats.forEach((cat) => {
    const item = document.createElement('div');
    item.className = 'krh-rail-item';
    item.dataset.cat = cat.key;
    item.innerHTML = '<span class="material-icons">' + cat.icon + '</span><span class="krh-rail-label">' + escapeHtml(cat.label) + '</span>';
    item.addEventListener('click', () => setActiveCat(cat.key));
    rail.appendChild(item);
    items.push(item);

    const panel = document.createElement('div');
    panel.className = 'krh-cat';
    panel.dataset.cat = cat.key;
    const head = document.createElement('div');
    head.className = 'krh-cat-head';
    head.textContent = cat.label;
    panel.appendChild(head);
    pane.appendChild(panel);
    panels.push(panel);

    cat.build(panel);
  });

  // Restore the last-viewed category (this session); fall back to the first.
  const initialKey = lastActiveCategory && cats.some((c) => c.key === lastActiveCategory)
    ? lastActiveCategory
    : cats[0].key;
  rendered = { container, panels, setActiveCat, activeKey: initialKey };

  if (searchQuery) {
    applySearchFilter(container, holder, searchQuery, panels);
  } else {
    activeSearch = null;
    setActiveCat(initialKey);
  }

  // Swap the freshly built panel in only now — deferring the clear until the build
  // is done keeps the previous content painted, avoiding the flash on tab clicks.
  if (searchQuery) {
    const existing = holder.querySelector('.krh-settings');
    if (existing) existing.remove();
  } else {
    while (holder.firstChild) holder.removeChild(holder.firstChild);
  }
  holder.appendChild(container);
}

// ── Userscripts settings section ──
function renderUserscriptsSection(body: HTMLElement, dashboard = false): void {
  ipcRenderer.invoke('get-config', 'userscripts').then((usConf: any) => {
    const us = { ...DEFAULT_CONFIG.userscripts, ...usConf };

    const engineGroup = createGroup(body);

    engineGroup.appendChild(createToggleRow({
      label: 'Userscripts',
      desc: 'Load custom scripts from the scripts folder',
      checked: us.enabled, restart: true,
      onChange: (v) => { us.enabled = v; ipcRenderer.invoke('set-config', 'userscripts', us); },
    }));

    engineGroup.appendChild(createButtonRow({
      label: 'Scripts Folder',
      desc: 'Place .js userscript files here',
      buttons: [{ icon: 'folder', label: 'Scripts', title: 'Open Folder', onClick: () => ipcRenderer.invoke('userscripts-open-folder') }],
    }).row);

    engineGroup.appendChild(createButtonRow({
      label: 'Example Userscripts',
      desc: 'Adds five scripts to the scripts folder: Class Roulette (a random class on every respawn) and Quick Sell by Rarity (both from Kute), Krunker Reconnector (by Swat: starts your private game again after "Server limit reached") and Quick Krunker Docs Integration (by KNLZVX: the Quick KrunkScript docs in the Editor and scripting screen) and Kill Streak (a +N pop-up for every kill in a row, a nuke at 25). They start switched off, and files that already exist are never replaced.',
      buttons: [{ icon: 'download', label: 'Install', title: 'Copy the example scripts into the scripts folder', onClick: () => {
        void ipcRenderer.invoke('install-example-userscripts').then((r: { ok: boolean; error: string; added: string[] }) => {
          if (!r.ok) { showToast(r.error); return; }
          showToast(r.added.length
            ? 'Installed ' + r.added.join(', ') + '. Reload the page, then switch them on in the list below'
            : 'The example scripts are already in your scripts folder');
        });
      } }],
    }).row);

    if (dashboard) {
      // The per-script settings live in the running game page; the list, switches and editor are on the Userscripts page of the dashboard.
      engineGroup.appendChild(createInfoRow('Switch scripts on or off and write them on the Userscripts page of this dashboard. The settings a script offers appear in the game, under Settings > Client > Userscripts.'));
      reapplySearch();
      return;
    }
    const scriptsGroup = createGroup(body, 'Installed Scripts');

    const scriptInstances = getInstances();
    if (scriptInstances.length === 0) {
      scriptsGroup.appendChild(createInfoRow('No userscripts found. Place .js files in the scripts folder and reload.'));
      reapplySearch();
      return;
    }

    for (const inst of scriptInstances) {
      const metaParts: string[] = [];
      if (inst.meta.author) metaParts.push('by ' + escapeHtml(inst.meta.author));
      if (inst.meta.version) metaParts.push('v' + escapeHtml(inst.meta.version));
      const metaLine = metaParts.length > 0 ? '<span class="krh-us-meta">' + metaParts.join(' &middot; ') + '</span>' : '';
      const descHtml = escapeHtml(inst.meta.desc || '') + (metaLine ? '<br>' + metaLine : '');

      const { row: scriptRow, control } = createRowShell(inst.meta.name || inst.filename, descHtml);
      control.innerHTML =
        '<label class="krh-toggle"><input type="checkbox"' + (inst.enabled ? ' checked' : '') + '><span class="krh-toggle-track"></span></label>';
      scriptsGroup.appendChild(scriptRow);

      const cb = control.querySelector('input[type="checkbox"]') as HTMLInputElement;
      const settingsContainer = document.createElement('div');
      settingsContainer.className = 'krh-us-settings';
      scriptsGroup.appendChild(settingsContainer);

      if (inst.enabled && inst.settings) {
        renderScriptSettings(inst, settingsContainer);
      }

      cb.addEventListener('change', () => {
        const { needsReload } = setScriptEnabled(inst.filename, cb.checked, _console);
        settingsContainer.innerHTML = '';
        if (cb.checked && inst.settings) {
          renderScriptSettings(inst, settingsContainer);
        }
        if (needsReload) {
          onSettingChanged('refresh');
        }
      });
    }
    reapplySearch();
  });
}

function renderScriptSettings(inst: UserscriptInstance, container: HTMLElement): void {
  if (!inst.settings) return;

  for (const [, setting] of Object.entries(inst.settings)) {
    const { row, control } = createRowShell(setting.title, setting.desc ? escapeHtml(setting.desc) : '');

    switch (setting.type) {
      case 'bool': {
        control.innerHTML =
          '<label class="krh-toggle"><input type="checkbox"' + (setting.value ? ' checked' : '') + '><span class="krh-toggle-track"></span></label>';
        const input = control.querySelector('input') as HTMLInputElement;
        input.addEventListener('change', () => {
          setting.value = input.checked;
          if (typeof setting.changed === 'function') setting.changed(setting.value);
          saveScriptSetting(inst);
        });
        break;
      }
      case 'num': {
        const input = document.createElement('input');
        input.type = 'number';
        input.className = 'krh-num-val';
        input.value = String(setting.value);
        if (setting.min !== undefined) input.min = String(setting.min);
        if (setting.max !== undefined) input.max = String(setting.max);
        if (setting.step !== undefined) input.step = String(setting.step);
        control.appendChild(input);
        input.addEventListener('change', () => {
          setting.value = parseFloat(input.value) || 0;
          if (typeof setting.changed === 'function') setting.changed(setting.value);
          saveScriptSetting(inst);
        });
        break;
      }
      case 'sel': {
        const select = createSelect((setting.opts || []).map((o) => ({ value: String(o), label: String(o) })), String(setting.value));
        control.appendChild(select);
        select.addEventListener('change', () => {
          setting.value = select.value;
          if (typeof setting.changed === 'function') setting.changed(setting.value);
          saveScriptSetting(inst);
        });
        break;
      }
      case 'color': {
        const input = document.createElement('input');
        input.type = 'color';
        input.className = 'krh-color-input';
        input.value = String(setting.value) || '#ffffff';
        control.appendChild(input);
        input.addEventListener('input', () => {
          setting.value = input.value;
          if (typeof setting.changed === 'function') setting.changed(setting.value);
          saveScriptSetting(inst);
        });
        break;
      }
      case 'keybind': {
        const bind = setting.value as Keybind;
        const keyEl = document.createElement('span');
        keyEl.className = 'krh-keyIcon';
        keyEl.textContent = keybindDisplayString(bind);
        keyEl.addEventListener('click', () => {
          openKeybindDialog(setting.title).then((newBind) => {
            setting.value = newBind;
            keyEl.textContent = keybindDisplayString(newBind);
            if (typeof setting.changed === 'function') setting.changed(setting.value);
            saveScriptSetting(inst);
          });
        });
        control.appendChild(keyEl);
        break;
      }
    }

    container.appendChild(row);
  }
}

function saveScriptSetting(inst: UserscriptInstance): void {
  if (!inst.settings) return;
  const prefs: Record<string, unknown> = {};
  for (const [k, s] of Object.entries(inst.settings)) {
    prefs[k] = s.value;
  }
  ipcRenderer.invoke('userscripts-save-prefs', inst.filename, prefs);
}
