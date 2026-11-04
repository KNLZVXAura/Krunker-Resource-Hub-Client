// ── Separate game loop (EXPERIMENTAL, off by default) ──
// Idea: KNLZVX (Krunker community). Krunker does everything once per screen frame: read the inputs, update the
// game, draw. On a 60 Hz screen that adds up to 16 ms between a key press and the game seeing it, and the usual
// workaround is uncapped FPS, which makes the CPU and GPU work for frames nobody can see.
// What this does: the game's own frame function is run on a timer (default every 8 ms) between the screen
// frames, so input and game updates happen several times per frame, but the drawing calls of those extra runs
// are skipped, and only the run on the real screen frame (requestAnimationFrame) draws.
// Limits, honestly: the game's frame function is one block, so the JavaScript side of rendering still runs on
// every extra run; only the WebGL draw and clear calls are skipped. The game may also render some things only
// once (a shadow map that is rebuilt on demand) and an extra run could swallow that draw, so a missing shadow or
// reflection is possible. WebGPU rendering is not handled. If the game throws too often in the extra runs the
// loop turns itself off.

import { savedConsole as _console } from './saved-console';

const ID_BASE = 1_000_000_000; // our ids never collide with the browser's own small ones
const MAX_ERRORS = 40;
const DRAW_CALLS = [
  'drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced', 'drawRangeElements',
  'clear', 'clearBufferfv', 'clearBufferiv', 'clearBufferuiv', 'clearBufferfi', 'blitFramebuffer',
] as const;

let on = false;
let intervalMs = 8;
let installed = false;
let skipDraw = false;
let nextId = ID_BASE;
let pending = new Map<number, FrameRequestCallback>();
let timer = 0;
let vsyncQueued = false;
let errors = 0;
let nativeRAF: typeof window.requestAnimationFrame;
let nativeCAF: typeof window.cancelAnimationFrame;

/** Apply the setting. Turning it on or off works live: the next frame request picks the right path. */
export function setGameLoop(cfg: { enabled: boolean; intervalMs: number }): void {
  intervalMs = Math.max(4, Math.min(33, Math.round(Number(cfg.intervalMs) || 8)));
  if (cfg.enabled) { errors = 0; if (!install()) return; }
  on = cfg.enabled;
  if (!on) flushToNative();
}

function install(): boolean {
  if (installed) return true;
  try {
    nativeRAF = window.requestAnimationFrame.bind(window);
    nativeCAF = window.cancelAnimationFrame.bind(window);
    for (const Ctx of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
      if (!Ctx) continue;
      for (const name of DRAW_CALLS) {
        if (!Object.prototype.hasOwnProperty.call(Ctx.prototype, name)) continue;
        const orig = (Ctx.prototype as unknown as Record<string, (...a: unknown[]) => unknown>)[name];
        if (typeof orig !== 'function') continue;
        (Ctx.prototype as unknown as Record<string, unknown>)[name] = function (this: unknown, ...args: unknown[]): unknown {
          if (skipDraw) return undefined;
          return orig.apply(this, args);
        };
      }
    }
    window.requestAnimationFrame = function (cb: FrameRequestCallback): number {
      if (!on) return nativeRAF(cb);
      const id = nextId++;
      pending.set(id, cb);
      arm();
      return id;
    };
    window.cancelAnimationFrame = function (id: number): void {
      if (pending.delete(id)) return;
      nativeCAF(id);
    };
    installed = true;
    return true;
  } catch (err) {
    _console.warn('[KRH-GameLoop] could not install:', err);
    return false;
  }
}

function arm(): void {
  if (!vsyncQueued) { vsyncQueued = true; nativeRAF(onVsync); }
  if (!timer) timer = window.setTimeout(onTick, intervalMs);
}

function onVsync(ts: number): void {
  vsyncQueued = false;
  run(ts, false);
}

function onTick(): void {
  timer = 0;
  if (document.hidden || !pending.size) return; // nothing to do; the next frame request re-arms the timer
  run(performance.now(), true);
}

/** Run the callbacks that are waiting. A sub run (timer) does not draw; the screen-frame run does. */
function run(ts: number, sub: boolean): void {
  const batch = pending;
  pending = new Map();
  skipDraw = sub;
  try {
    for (const cb of batch.values()) {
      try { cb(ts); } catch (err) {
        if (sub && ++errors > MAX_ERRORS) {
          _console.warn('[KRH-GameLoop] too many errors in the extra runs, turning the separate loop off');
          on = false; skipDraw = false; flushToNative();
        }
        const e = err; window.setTimeout(() => { throw e; }); // keep the error visible like a normal frame error
      }
    }
  } finally { skipDraw = false; }
}

/** Hand whatever is waiting back to the browser so the game's loop never stalls when the feature is switched off. */
function flushToNative(): void {
  if (!installed || !pending.size) return;
  const batch = pending;
  pending = new Map();
  for (const cb of batch.values()) nativeRAF(cb);
}
