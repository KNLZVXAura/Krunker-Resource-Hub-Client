// ── Play monitor ──
// While you are in a match (not in the menu, not spectating, page visible) this sends a small sample to the main process every
// ten seconds: map, class, the ping to the game server and the kills and deaths since the last sample. The main process turns
// them into the play log (K/D by ping range, rounds) and the connection journal. Nothing runs between matches.

import { ipcRenderer } from 'electron';
import { getCounts } from './session-tracker';
import { gameRegion } from './game-region';

const EVERY_MS = 10_000;

let enabled = false;
let timer: ReturnType<typeof setInterval> | null = null;
let lastAt = 0;
let last = { kills: 0, deaths: 0 };
let busy = false;

function inMatch(): boolean {
  const ui = document.getElementById('uiBase');
  if (!ui || ui.className === 'onMenu') return false;
  return !(window as unknown as { spectating?: boolean }).spectating && document.visibilityState === 'visible';
}

function activity(): { map: string; cls: string } {
  try {
    const ga = (window as unknown as { getGameActivity?: () => { map?: unknown; class?: { name?: unknown } } }).getGameActivity?.();
    return { map: typeof ga?.map === 'string' ? ga.map.trim() : '', cls: typeof ga?.class?.name === 'string' ? ga.class.name.trim() : '' };
  } catch { return { map: '', cls: '' }; }
}

async function tick(): Promise<void> {
  if (!enabled || busy) return;
  if (!inMatch()) { lastAt = 0; return; }
  busy = true;
  try {
    const now = Date.now();
    const counts = getCounts();
    const first = lastAt === 0;
    const dt = first ? 0 : (now - lastAt) / 1000;
    const dk = first ? 0 : Math.max(0, counts.kills - last.kills);
    const dd = first ? 0 : Math.max(0, counts.deaths - last.deaths);
    lastAt = now; last = counts;
    let ms = -1;
    try { ms = Number(await ipcRenderer.invoke('game-server-ping')); } catch { ms = -1; }
    const a = activity();
    ipcRenderer.send('play-sample', { map: a.map, cls: a.cls, ms: Number.isFinite(ms) ? ms : -1, kills: dk, deaths: dd, dt, region: gameRegion() });
  } finally { busy = false; }
}

/** Switch the monitor on or off. */
export function setPlayMonitor(on: boolean): void {
  enabled = on;
  if (on && !timer) { last = getCounts(); timer = setInterval(() => { void tick(); }, EVERY_MS); }
  if (!on && timer) { clearInterval(timer); timer = null; lastAt = 0; }
}
