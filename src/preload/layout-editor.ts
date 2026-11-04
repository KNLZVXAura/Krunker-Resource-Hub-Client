// ── Overlay layout editor ──
// One drag-and-drop screen for the on-screen overlays (stat counters, Spotify card, Twitch chat), instead of typing
// X / Y numbers in three different settings pages. Every enabled overlay gets a dashed box you can drag; the
// position is saved and applied right away. Open it with the key from Settings (default Ctrl+Alt+L).
// The keystrokes overlay sits at a fixed spot in the game HUD, so it is not part of this.

import { ipcRenderer } from 'electron';
import { DEFAULT_CONFIG } from '../main/config-defaults';
import { applyStatCounterConfig } from './stat-counter';
import { setSpotifyOverlay } from './spotify-overlay';
import { setTwitchChat } from './twitch-chat';
import { matchCombo, typingInField } from './hotkey';
import { showToast } from './utils';

type Key = 'nukeCounter' | 'spotify' | 'twitch';

interface Target {
  key: Key;
  label: string;
  elId: string;
  /** Size of the box when the real overlay is not on screen right now. */
  fallback: { w: number; h: number };
  apply: (cfg: any) => void;
}

const TARGETS: Target[] = [
  { key: 'nukeCounter', label: 'Stat counters', elId: 'krh-stat-stack', fallback: { w: 200, h: 120 }, apply: (c) => applyStatCounterConfig({ ...DEFAULT_CONFIG.nukeCounter, ...c }) },
  { key: 'spotify', label: 'Spotify card', elId: 'krh-spotify', fallback: { w: 300, h: 76 }, apply: (c) => setSpotifyOverlay({ ...DEFAULT_CONFIG.spotify, ...c }) },
  { key: 'twitch', label: 'Twitch chat', elId: 'krh-twitch-chat', fallback: { w: 360, h: 300 }, apply: (c) => setTwitchChat({ ...DEFAULT_CONFIG.twitch, ...c }) },
];

const ROOT_ID = 'krh-layout-editor';
let root: HTMLElement | null = null;
let started = false;

const clampPct = (n: number): number => Math.min(100, Math.max(0, Math.round(n * 100) / 100));

function ghostRect(t: Target, cfg: any): { left: number; top: number; w: number; h: number } {
  const W = window.innerWidth, H = window.innerHeight;
  const el = document.getElementById(t.elId);
  const r = el ? el.getBoundingClientRect() : null;
  if (r && r.width > 4 && r.height > 4) return { left: r.left, top: r.top, w: r.width, h: r.height };
  const w = t.key === 'twitch' ? Math.max(120, Number(cfg.width) || t.fallback.w) : t.fallback.w;
  const h = t.key === 'twitch' ? Math.max(80, Number(cfg.height) || t.fallback.h) : t.fallback.h;
  const x = (Number(cfg.x) || 0) / 100 * W, y = (Number(cfg.y) || 0) / 100 * H;
  if (t.key === 'nukeCounter') return { left: x - w / 2, top: y - h / 2, w, h };      // x/y are the centre
  if (t.key === 'spotify') return { left: x - w / 2, top: y, w, h };                  // x is the centre, y the top
  return { left: x, top: y, w, h };                                                   // twitch: top-left corner
}

async function saveMove(t: Target, cfg: any, start: { left: number; top: number }, dx: number, dy: number): Promise<any> {
  const W = window.innerWidth, H = window.innerHeight;
  const next = { ...cfg };
  if (t.key === 'twitch') {
    next.x = clampPct((start.left + dx) / W * 100);
    next.y = clampPct((start.top + dy) / H * 100);
    next.autoPlace = false;
  } else {
    next.x = clampPct((Number(cfg.x) || 0) + dx / W * 100);
    next.y = clampPct((Number(cfg.y) || 0) + dy / H * 100);
  }
  await ipcRenderer.invoke('set-config', t.key, next);
  t.apply(next);
  return next;
}

export function closeLayoutEditor(): void {
  root?.remove();
  root = null;
}

export async function openLayoutEditor(): Promise<void> {
  if (root) { closeLayoutEditor(); return; }
  if (document.pointerLockElement) document.exitPointerLock();
  const cfgs = new Map<Key, any>();
  for (const t of TARGETS) {
    const c = await ipcRenderer.invoke('get-config', t.key).catch(() => null);
    // Separate stat counters are placed one by one with the Move button in Settings > Appearance
    if (c && c.enabled && !(t.key === 'nukeCounter' && c.layout === 'separate')) cfgs.set(t.key, c);
  }
  if (cfgs.size === 0) { showToast('Turn on the stat counters (stacked layout), Spotify card or Twitch chat first'); return; }

  root = document.createElement('div');
  root.id = ROOT_ID;
  root.style.cssText = 'position:fixed;inset:0;z-index:2147483200;background:rgba(0,10,30,0.45);font-family:inherit;color:#fff;';

  const bar = document.createElement('div');
  bar.style.cssText = 'position:absolute;top:12px;left:50%;transform:translateX(-50%);display:flex;gap:10px;align-items:center;padding:8px 14px;border-radius:12px;background:rgba(10,16,34,0.95);border:1px solid rgba(120,170,255,0.4);font-size:14px;';
  const text = document.createElement('span');
  text.textContent = 'Layout editor: drag the boxes';
  const mkBtn = (label: string, primary: boolean, onClick: () => void): HTMLElement => {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = 'border:0;border-radius:8px;padding:6px 14px;cursor:pointer;color:#fff;font:inherit;font-weight:bold;' + (primary ? 'background:linear-gradient(90deg,#1f6fe0,#38c8ff);' : 'background:rgba(255,255,255,0.14);');
    b.addEventListener('click', onClick);
    return b;
  };
  bar.append(text,
    mkBtn('Reset positions', false, async () => {
      for (const t of TARGETS) {
        const c = cfgs.get(t.key);
        if (!c) continue;
        const d = (DEFAULT_CONFIG as any)[t.key];
        const next = { ...c, x: d.x, y: d.y, ...(t.key === 'twitch' ? { autoPlace: true } : {}) };
        await ipcRenderer.invoke('set-config', t.key, next);
        cfgs.set(t.key, next);
        t.apply(next);
      }
      closeLayoutEditor();
      void openLayoutEditor();
    }),
    mkBtn('Done', true, closeLayoutEditor));
  root.appendChild(bar);

  for (const t of TARGETS) {
    const cfg = cfgs.get(t.key);
    if (!cfg) continue;
    const r = ghostRect(t, cfg);
    const g = document.createElement('div');
    g.style.cssText = `position:absolute;left:${r.left}px;top:${r.top}px;width:${r.w}px;height:${r.h}px;border:2px dashed #38c8ff;border-radius:8px;background:rgba(56,200,255,0.14);cursor:move;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:bold;text-shadow:0 1px 3px #000;touch-action:none;user-select:none;`;
    g.textContent = t.label;
    let startX = 0, startY = 0, startLeft = 0, startTop = 0, dragging = false;
    g.addEventListener('pointerdown', (e) => {
      dragging = true; startX = e.clientX; startY = e.clientY;
      startLeft = g.offsetLeft; startTop = g.offsetTop;
      g.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    g.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const W = window.innerWidth, H = window.innerHeight;
      g.style.left = Math.min(W - 20, Math.max(-r.w + 20, startLeft + e.clientX - startX)) + 'px';
      g.style.top = Math.min(H - 20, Math.max(0, startTop + e.clientY - startY)) + 'px';
    });
    g.addEventListener('pointerup', async (e) => {
      if (!dragging) return;
      dragging = false;
      try { g.releasePointerCapture(e.pointerId); } catch { /* already released */ }
      const dx = g.offsetLeft - startLeft, dy = g.offsetTop - startTop;
      if (!dx && !dy) return;
      const next = await saveMove(t, cfgs.get(t.key), { left: startLeft, top: startTop }, dx, dy);
      cfgs.set(t.key, next);
    });
    root.appendChild(g);
  }
  document.body.appendChild(root);
}

export function initLayoutEditor(key: string): void {
  if (started) return;
  started = true;
  let hotkey = key;
  ipcRenderer.on('layout-editor-key', (_e, k: string) => { hotkey = k; });
  window.addEventListener('keydown', (e) => {
    if (e.repeat || typingInField(e)) return;
    if (e.key === 'Escape' && root) { closeLayoutEditor(); return; }
    if (hotkey && matchCombo(e, hotkey)) { e.preventDefault(); e.stopPropagation(); void openLayoutEditor(); }
  }, true);
}
