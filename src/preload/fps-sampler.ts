// ── FPS sampler ──
// Measures FPS in windows of five seconds while you are in a match and reports each window (average FPS and the 1 % low)
// with the current map and class to the main process, which adds them up per map and per class (see shared/fps-stats.ts).
// Between matches, in the menu and while the page is hidden nothing runs: the animation loop only exists during a match.

import { ipcRenderer } from 'electron';
import { windowStats } from '../shared/fps-stats';

const WINDOW_MS = 5000;
const CHECK_MS = 1000;
const MAX_FRAMES = 4096;

let enabled = false;
let checker: ReturnType<typeof setInterval> | null = null;
let raf: number | null = null;
let times = new Float32Array(MAX_FRAMES);
let count = 0;
let lastFrame = 0;
let windowStart = 0;
let map = '';
let cls = '';

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

function resetWindow(now: number): void {
  count = 0; lastFrame = 0; windowStart = now;
  const a = activity();
  map = a.map; cls = a.cls;
}

function frame(now: number): void {
  if (lastFrame !== 0 && count < MAX_FRAMES) times[count++] = now - lastFrame;
  lastFrame = now;
  if (now - windowStart >= WINDOW_MS) {
    const r = windowStats(times, count, (now - windowStart) / 1000);
    // A window is only kept when the map and class did not change while it ran
    const a = activity();
    if (r && r.fps >= 1 && a.map === map && a.cls === cls && (map || cls)) {
      try { ipcRenderer.send('fps-sample', { map, cls, fps: Math.round(r.fps * 10) / 10, low: Math.round(r.low * 10) / 10 }); } catch { /* page is going away */ }
    }
    resetWindow(now);
  }
  raf = requestAnimationFrame(frame);
}

function check(): void {
  const want = enabled && inMatch();
  if (want && raf === null) { resetWindow(performance.now()); raf = requestAnimationFrame(frame); }
  else if (!want && raf !== null) { cancelAnimationFrame(raf); raf = null; count = 0; lastFrame = 0; }
}

/** Switch the sampler on or off. */
export function setFpsSampler(on: boolean): void {
  enabled = on;
  if (on && !checker) checker = setInterval(check, CHECK_MS);
  if (!on) {
    if (checker) { clearInterval(checker); checker = null; }
    if (raf !== null) { cancelAnimationFrame(raf); raf = null; }
    times = new Float32Array(MAX_FRAMES); count = 0; lastFrame = 0;
  }
}
