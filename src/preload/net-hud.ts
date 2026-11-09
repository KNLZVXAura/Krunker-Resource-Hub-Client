// ── Network HUD ──
// Ping, jitter and packet loss of the game server, plus a small graph of the last minute, in a corner of the screen.
// Toggled with a key combination (Ctrl+Alt+H by default). Once a second it asks the main process for a TCP connect
// time to the game server (the same measurement the direct ping display uses), keeps the last 60 samples and paints
// from them. A failed measurement counts as a lost sample. While it is hidden nothing is measured.
//
// Region tip: when the average stays high, the HUD looks at the region pings the matchmaker already measures from this
// computer and names a region that was clearly faster than the one the current game is in (the game id starts with the
// region code, for example "FRA:abc12"). It only reads numbers; it never changes region or joins anything.

import { ipcRenderer } from 'electron';
import { matchCombo, typingInField } from './hotkey';
import { REGION_NAMES, cleanHistory, suggestForHour, suggestionText } from '../shared/ping-history';

export type NetHudCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
export interface NetHudOptions { key: string; corner: NetHudCorner; startOn: boolean; suggestRegion: boolean }

const ID = 'krh-net-hud';
const STYLE_ID = 'krh-net-hud-style';
const WINDOW = 60;            // samples kept (one per second)
const SAMPLE_MS = 1000;
const TIP_AFTER = 20;         // samples before a tip can show
const TIP_EVERY_MS = 30_000;  // how often the region list is looked at
const GRAPH_W = 120;
const GRAPH_H = 26;

const CSS = `
#${ID}{position:fixed;z-index:2147483000;display:none;padding:5px 8px;border-radius:4px;background:rgba(0,0,0,.55);color:#fff;font:600 12px/1.35 ui-monospace,Consolas,monospace;white-space:pre;pointer-events:none;text-shadow:0 1px 2px #000}
#${ID}.on{display:block}
#${ID}.top-left{top:8px;left:8px}#${ID}.top-right{top:8px;right:8px}
#${ID}.bottom-left{bottom:8px;left:8px}#${ID}.bottom-right{bottom:8px;right:8px}
#${ID} .nh-tip{color:#ffe44d;white-space:normal;max-width:170px;margin-top:3px}
#${ID} svg{display:block;margin-top:3px}
`;

let options: NetHudOptions = { key: 'Ctrl+Alt+H', corner: 'top-right', startOn: false, suggestRegion: true };
let root: HTMLElement | null = null;
let textEl: HTMLElement | null = null;
let graphEl: SVGSVGElement | null = null;
let tipEl: HTMLElement | null = null;
let visible = false;
let timer: ReturnType<typeof setInterval> | null = null;
let hooked = false;
let samples: number[] = [];   // ms, or -1 for a lost sample
let tip = '';
let lastTipCheck = 0;
let busy = false;

export interface NetStats { last: number; avg: number; min: number; max: number; jitter: number; lossPct: number; count: number }

/** Summary of a list of samples (ms, -1 = lost). Exported for tests. */
export function summarize(list: number[]): NetStats {
  const ok = list.filter((x) => x >= 0);
  const lost = list.length - ok.length;
  let diffs = 0;
  for (let i = 1; i < ok.length; i++) diffs += Math.abs(ok[i] - ok[i - 1]);
  return {
    last: list.length ? list[list.length - 1] : -1,
    avg: ok.length ? ok.reduce((a, b) => a + b, 0) / ok.length : -1,
    min: ok.length ? Math.min(...ok) : -1,
    max: ok.length ? Math.max(...ok) : -1,
    jitter: ok.length > 1 ? diffs / (ok.length - 1) : 0,
    lossPct: list.length ? (lost / list.length) * 100 : 0,
    count: list.length,
  };
}

/** Name of a clearly faster region, or '' when there is none. Exported for tests. */
export function pickTip(currentCode: string, avgMs: number, pings: Record<string, number>): string {
  const mine = pings[currentCode];
  // Compare with the HUD's own average when the region list has no number for this region
  const base = avgMs > 0 ? avgMs : (typeof mine === 'number' && mine > 0 ? mine : -1);
  if (base < 0) return '';
  let bestCode = '';
  let best = Infinity;
  for (const [code, ms] of Object.entries(pings)) {
    if (code === currentCode || !(code in REGION_NAMES) || typeof ms !== 'number' || ms <= 0) continue;
    if (ms < best) { best = ms; bestCode = code; }
  }
  // Clearly faster: at least 25 ms and at least 40 % lower
  if (bestCode && base - best >= 25 && best <= base * 0.6) return `${REGION_NAMES[bestCode]} measured ${Math.round(best)} ms from here`;
  return '';
}

function currentRegionCode(): string {
  try {
    const g = new URLSearchParams(location.search).get('game') || '';
    const m = /^([A-Za-z]{2,5}):/.exec(g);
    return m ? m[1].toUpperCase() : '';
  } catch { return ''; }
}

function ensureRoot(): HTMLElement {
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    (document.head ?? document.documentElement).appendChild(style);
  }
  if (!root) {
    root = document.createElement('div');
    root.id = ID;
    textEl = document.createElement('div');
    graphEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    graphEl.setAttribute('width', String(GRAPH_W));
    graphEl.setAttribute('height', String(GRAPH_H));
    graphEl.setAttribute('viewBox', `0 0 ${GRAPH_W} ${GRAPH_H}`);
    tipEl = document.createElement('div');
    tipEl.className = 'nh-tip';
    root.append(textEl, graphEl, tipEl);
  }
  if (!root.isConnected) document.documentElement.appendChild(root);
  root.className = `${options.corner}${visible ? ' on' : ''}`;
  return root;
}

function colorFor(ms: number): string {
  if (ms < 0) return '#ff5a5a';
  return ms < 60 ? '#6dff8a' : ms < 120 ? '#ffe44d' : '#ff8a4d';
}

function paint(): void {
  if (!root || !textEl || !graphEl || !tipEl) return;
  const s = summarize(samples);
  const fmt = (n: number): string => (n < 0 ? '--' : String(Math.round(n)));
  textEl.textContent =
    `${s.last < 0 ? 'lost' : fmt(s.last) + ' ms'}   avg ${fmt(s.avg)}\n` +
    `jitter ${s.count > 1 ? s.jitter.toFixed(1) : '--'}   loss ${s.lossPct.toFixed(0)}%`;
  textEl.style.color = colorFor(s.last);
  // Graph: a polyline over the samples; lost samples leave a gap (a red tick at the bottom)
  while (graphEl.firstChild) graphEl.removeChild(graphEl.firstChild);
  const ok = samples.filter((x) => x >= 0);
  const top = Math.max(50, ok.length ? Math.max(...ok) : 50);
  const step = GRAPH_W / (WINDOW - 1);
  const ns = 'http://www.w3.org/2000/svg';
  let points = '';
  samples.forEach((ms, i) => {
    const x = (WINDOW - samples.length + i) * step;
    if (ms < 0) {
      const tick = document.createElementNS(ns, 'line');
      tick.setAttribute('x1', String(x)); tick.setAttribute('x2', String(x));
      tick.setAttribute('y1', String(GRAPH_H - 5)); tick.setAttribute('y2', String(GRAPH_H));
      tick.setAttribute('stroke', '#ff5a5a');
      graphEl?.appendChild(tick);
      return;
    }
    const y = GRAPH_H - 1 - (ms / top) * (GRAPH_H - 6);
    points += `${x.toFixed(1)},${y.toFixed(1)} `;
  });
  if (points) {
    const line = document.createElementNS(ns, 'polyline');
    line.setAttribute('points', points.trim());
    line.setAttribute('fill', 'none');
    line.setAttribute('stroke', '#38c8ff');
    line.setAttribute('stroke-width', '1.5');
    graphEl.appendChild(line);
  }
  tipEl.textContent = tip ? `Tip: ${tip}` : '';
}

async function sample(): Promise<void> {
  if (busy || document.visibilityState !== 'visible') return;
  busy = true;
  try {
    const ms = Number(await ipcRenderer.invoke('game-server-ping'));
    samples.push(Number.isFinite(ms) && ms >= 0 ? ms : -1);
    if (samples.length > WINDOW) samples.shift();
    const now = Date.now();
    if (options.suggestRegion && samples.length >= TIP_AFTER && now - lastTipCheck >= TIP_EVERY_MS) {
      lastTipCheck = now;
      const code = currentRegionCode();
      const avg = summarize(samples).avg;
      let next = '';
      if (code && avg >= 70) {
        const pings = (await ipcRenderer.invoke('ping-regions').catch(() => ({}))) as Record<string, number>;
        next = pickTip(code, avg, pings);
      }
      // No live difference: look at the saved history for this hour of the day (Settings > Extras > Ping History)
      if (code && !next) {
        const res = (await ipcRenderer.invoke('ping-history-get').catch(() => null)) as { history?: unknown; hour?: number } | null;
        const s = res ? suggestForHour(cleanHistory(res.history), typeof res.hour === 'number' ? res.hour : new Date().getHours(), code) : null;
        if (s) next = suggestionText(s);
      }
      tip = next;
    }
    paint();
  } catch {
    samples.push(-1);
    if (samples.length > WINDOW) samples.shift();
    paint();
  } finally {
    busy = false;
  }
}

function show(): void {
  if (visible) return;
  visible = true;
  samples = [];
  tip = '';
  lastTipCheck = 0;
  ensureRoot();
  if (textEl) textEl.textContent = 'measuring...';
  void sample();
  timer = setInterval(() => { void sample(); }, SAMPLE_MS);
}

function hide(): void {
  if (!visible) return;
  visible = false;
  if (timer !== null) clearInterval(timer);
  timer = null;
  root?.classList.remove('on');
}

export function setNetHud(next: NetHudOptions): void {
  const first = !hooked;
  options = next;
  if (first) {
    hooked = true;
    window.addEventListener('keydown', (e) => {
      if (e.repeat || typingInField(e) || !options.key.trim() || !matchCombo(e, options.key.trim())) return;
      e.preventDefault();
      if (visible) hide(); else show();
    }, true);
    if (next.startOn) show();
  }
  if (root) root.className = `${options.corner}${visible ? ' on' : ''}`;
  if (visible) paint();
}
