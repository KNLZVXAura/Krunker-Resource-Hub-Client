// ── Quick Play grid ──
// A tile picker for the custom matchmaker: tap regions, gamemodes and maps, then "Find Match".
// It edits the same settings as Settings > Matchmaker, so both stay in sync.
// Idea: the Quick Play grid of the Water Client (https://github.com/ghostypostie/Water); written from scratch.

import { ipcRenderer } from 'electron';
import { fetchGame, MATCHMAKER_REGIONS, MATCHMAKER_REGION_NAMES, MATCHMAKER_MAP_NAMES, mapIconUrl, matchmakerMapNames, matchmakerModeItems } from './matchmaker';
import type { MatchmakerConfig } from './matchmaker';
import { savedConsole as _console } from './saved-console';
import { RAIDS, joinRaid, joinTradePlaza, joinArg, tradePlazaInfo } from './quick-join';
import type { RaidSort } from './quick-join';

const ID = 'krhQuickPlay';
const STYLE_ID = 'krhQuickPlayStyle';
const CSS = `
#${ID} { position: fixed; inset: 0; z-index: 2147483000; display: none; align-items: center; justify-content: center; background: rgba(0,0,0,0.55); font-family: inherit; color: #fff; }
#${ID} .qp-box { width: min(900px, 92vw); max-height: 86vh; display: flex; flex-direction: column; background: rgba(20,20,26,0.98); border: 1px solid rgba(255,255,255,0.15); border-radius: 16px; box-shadow: 0 14px 50px rgba(0,0,0,0.6); }
#${ID} .qp-head { display: flex; align-items: center; gap: 10px; padding: 12px 16px; border-bottom: 1px solid rgba(255,255,255,0.1); }
#${ID} .qp-title { font-size: 20px; font-weight: bold; flex: 1; }
#${ID} .qp-body { overflow-y: auto; padding: 8px 16px 16px; }
#${ID} h4 { margin: 14px 0 6px; font-size: 14px; opacity: 0.7; text-transform: uppercase; letter-spacing: 1px; font-weight: normal; }
#${ID} .qp-grid { display: flex; flex-wrap: wrap; gap: 8px; }
#${ID} .qp-tile { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-radius: 999px; cursor: pointer; background: rgba(255,255,255,0.08); border: 2px solid transparent; font-size: 15px; user-select: none; }
#${ID} .qp-tile:hover { background: rgba(255,255,255,0.16); }
#${ID} .qp-tile.on { border-color: #8b5cf6; background: rgba(139,92,246,0.25); }
#${ID} .qp-tile img { width: 44px; height: 28px; object-fit: cover; border-radius: 4px; }
#${ID} .qp-foot { display: flex; gap: 10px; align-items: center; padding: 12px 16px; border-top: 1px solid rgba(255,255,255,0.1); }
#${ID} .qp-hint { flex: 1; font-size: 13px; opacity: 0.6; }
#${ID} button { border: 0; border-radius: 10px; padding: 9px 16px; cursor: pointer; font-family: inherit; font-size: 15px; color: #fff; background: rgba(255,255,255,0.14); }
#${ID} button:hover { background: rgba(255,255,255,0.25); }
#${ID} button.qp-go { background: linear-gradient(135deg,#8b5cf6,#d946ef); font-weight: bold; }
#${ID} button.qp-go:hover { filter: brightness(1.15); }
`;

let root: HTMLElement | null = null;
let mm: MatchmakerConfig & Record<string, unknown> = {} as never;
let cancelKey: unknown = null;

function save(): void { void ipcRenderer.invoke('set-config', 'matchmaker', mm); }

function tiles(parent: HTMLElement, title: string, items: Array<{ value: string; label: string; icon?: string }>, field: 'regions' | 'gamemodes' | 'maps'): void {
  const h = document.createElement('h4');
  h.textContent = title + ' (none selected = all)';
  parent.appendChild(h);
  const grid = document.createElement('div');
  grid.className = 'qp-grid';
  const sel = new Set<string>(((mm as any)[field] as string[]) || []);
  for (const it of items) {
    const t = document.createElement('div');
    t.className = 'qp-tile' + (sel.has(it.value) ? ' on' : '');
    if (it.icon) {
      const img = document.createElement('img');
      img.src = it.icon;
      img.alt = '';
      img.onerror = () => { img.style.display = 'none'; };
      t.appendChild(img);
    }
    t.appendChild(document.createTextNode(it.label));
    t.addEventListener('click', () => {
      if (sel.has(it.value)) sel.delete(it.value); else sel.add(it.value);
      t.classList.toggle('on', sel.has(it.value));
      (mm as any)[field] = [...sel];
      save();
    });
    grid.appendChild(t);
  }
  parent.appendChild(grid);
}

async function build(): Promise<void> {
  const all: any = await ipcRenderer.invoke('get-all-config', ['matchmaker', 'keybinds']);
  mm = { ...all.matchmaker } as never;
  cancelKey = all.keybinds?.matchmakerCancel ?? null;
  if (!document.getElementById(STYLE_ID)) {
    const st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = CSS;
    (document.head || document.documentElement).appendChild(st);
  }
  root?.remove();
  root = document.createElement('div');
  root.id = ID;
  const box = document.createElement('div');
  box.className = 'qp-box';
  const head = document.createElement('div');
  head.className = 'qp-head';
  head.innerHTML = '<span class="qp-title">Quick Play</span>';
  const close = document.createElement('button');
  close.textContent = '✕';
  close.addEventListener('click', closeQuickPlay);
  head.appendChild(close);
  const body = document.createElement('div');
  body.className = 'qp-body';
  tiles(body, 'Regions', MATCHMAKER_REGIONS.map((r) => ({ value: r, label: MATCHMAKER_REGION_NAMES[r] || r })), 'regions');
  tiles(body, 'Gamemodes', matchmakerModeItems(((mm as any).gamemodes as string[]) || []), 'gamemodes');
  tiles(body, 'Maps', matchmakerMapNames().map((m) => ({ value: m, label: MATCHMAKER_MAP_NAMES[m] || m.replace(/_/g, ' '), icon: mapIconUrl(m) ?? undefined })), 'maps');
  // Raids and Trade Plaza (idea from Lombre_Blanche's matchmaker script)
  const rh = document.createElement('h4');
  rh.textContent = 'Raids and Trade';
  body.appendChild(rh);
  const rgrid = document.createElement('div');
  rgrid.className = 'qp-grid';
  let raidSort: RaidSort = localStorage.getItem('krh_raid_sort') === 'desc' ? 'desc' : 'asc';
  const sortTile = document.createElement('div');
  sortTile.className = 'qp-tile';
  const paintSort = (): void => { sortTile.textContent = raidSort === 'asc' ? 'Raids: least players first' : 'Raids: most players first'; };
  paintSort();
  sortTile.addEventListener('click', () => {
    raidSort = raidSort === 'asc' ? 'desc' : 'asc';
    try { localStorage.setItem('krh_raid_sort', raidSort); } catch { /* ignore */ }
    paintSort();
  });
  rgrid.appendChild(sortTile);
  for (const r of RAIDS) {
    const t = document.createElement('div');
    t.className = 'qp-tile';
    t.textContent = r.label;
    t.addEventListener('click', () => { closeQuickPlay(); void joinRaid(r.key, raidSort); });
    rgrid.appendChild(t);
  }
  const plaza = document.createElement('div');
  plaza.className = 'qp-tile';
  plaza.textContent = 'Trade Plaza';
  plaza.addEventListener('click', () => { closeQuickPlay(); void joinTradePlaza(); });
  rgrid.appendChild(plaza);
  void tradePlazaInfo().then((info) => { if (info && plaza.isConnected) plaza.textContent = 'Trade Plaza \u00B7 ' + info; });
  const arg = document.createElement('div');
  arg.className = 'qp-tile';
  arg.textContent = 'ARG';
  arg.addEventListener('click', () => { closeQuickPlay(); joinArg(); });
  rgrid.appendChild(arg);
  body.appendChild(rgrid);

  const foot = document.createElement('div');
  foot.className = 'qp-foot';
  const hint = document.createElement('span');
  hint.className = 'qp-hint';
  hint.textContent = 'Same filters as Settings > Matchmaker. Esc closes. Raids / Trade / ARG idea: Lombre_Blanche.';
  const go = document.createElement('button');
  go.className = 'qp-go';
  go.textContent = 'Find Match';
  go.addEventListener('click', () => {
    closeQuickPlay();
    fetchGame({ ...(mm as MatchmakerConfig), cancelKey } as MatchmakerConfig, _console).catch((err) => _console.error('[KRH] Quick Play error:', err));
  });
  foot.append(hint, go);
  box.append(head, body, foot);
  root.appendChild(box);
  root.addEventListener('mousedown', (e) => { if (e.target === root) closeQuickPlay(); });
  (document.body || document.documentElement).appendChild(root);
}

export function closeQuickPlay(): void { if (root) root.style.display = 'none'; }

export async function toggleQuickPlay(): Promise<void> {
  if (root && root.style.display === 'flex') { closeQuickPlay(); return; }
  await build(); // rebuilt each time so it always reflects the current matchmaker settings
  if (!root) return;
  root.style.display = 'flex';
  if (document.pointerLockElement) document.exitPointerLock();
}

let started = false;
export function initQuickPlay(key: string): void {
  if (started) return;
  started = true;
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (key && e.key.toLowerCase() === key.trim().toLowerCase()) { e.preventDefault(); void toggleQuickPlay(); }
    else if (e.key === 'Escape' && root && root.style.display === 'flex') closeQuickPlay();
  }, true);
}

// Auto find: when Krunker shows its update / disconnect screen, start a matchmaker search by itself
// (at most once every 8 seconds). Off by default (Settings > Extras).
export function initAutoRejoin(): void {
  // After a disconnect the connection can take a moment to come back, so a search that fails (or finds nothing)
  // is tried again a couple of seconds later instead of after the old 8 s wait, up to a few times in a row.
  const MAX_TRIES = 6;
  let tries = 0;
  let busy = false;
  setInterval(() => {
    if (document.pointerLockElement) return;
    const screen = document.getElementById('instructionsUpdate');
    if (!screen || screen.offsetHeight === 0) { tries = 0; return; }
    if (busy || tries >= MAX_TRIES) return;
    const last = Number(sessionStorage.getItem('krh_auto_rejoin') || 0);
    if (Date.now() - last < 2500) return;
    busy = true;
    tries++;
    sessionStorage.setItem('krh_auto_rejoin', String(Date.now()));
    void ipcRenderer.invoke('get-all-config', ['matchmaker', 'keybinds']).then((all: any) =>
      fetchGame({ ...all.matchmaker, cancelKey: all.keybinds?.matchmakerCancel } as MatchmakerConfig, _console),
    ).catch((err) => _console.error('[KRH] Auto find error:', err))
      .finally(() => { busy = false; sessionStorage.setItem('krh_auto_rejoin', String(Date.now())); });
  }, 1000);
}
