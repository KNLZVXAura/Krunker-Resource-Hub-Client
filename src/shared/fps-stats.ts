// ── FPS per map and per class ──
// While you play, the game page measures FPS in windows of a few seconds and reports the average and the 1 % low. Here the
// windows are added up per map and per class, so you can see which maps and classes cost the most performance on this
// computer. Old data fades: when a bucket holds many windows both its sums and its count are halved. Pure functions only.

export interface FpsBucket { sumFps: number; sumLow: number; n: number }
export interface FpsStats { maps: Record<string, FpsBucket>; classes: Record<string, FpsBucket> }

export const FPS_BUCKET_CAP = 5000;
export const FPS_MAX_NAMES = 200;
export const FPS_NAME_MAX = 40;

export function emptyFpsStats(): FpsStats { return { maps: {}, classes: {} }; }

function nameOf(v: unknown): string {
  return typeof v === 'string' ? Array.from(v, (c) => (c.charCodeAt(0) < 32 ? ' ' : c)).join('').trim().slice(0, FPS_NAME_MAX) : '';
}

function addTo(group: Record<string, FpsBucket>, name: string, fps: number, low: number): void {
  if (!name) return;
  if (!(name in group) && Object.keys(group).length >= FPS_MAX_NAMES) return;
  const b = group[name] ?? (group[name] = { sumFps: 0, sumLow: 0, n: 0 });
  b.sumFps += fps; b.sumLow += low; b.n += 1;
  if (b.n > FPS_BUCKET_CAP) { b.sumFps /= 2; b.sumLow /= 2; b.n = Math.round(b.n / 2); }
}

/** Adds one measured window. Returns false for numbers that cannot be real (so a stalled page adds nothing). */
export function addFpsSample(stats: FpsStats, map: unknown, cls: unknown, fps: unknown, low: unknown): boolean {
  if (typeof fps !== 'number' || typeof low !== 'number' || !Number.isFinite(fps) || !Number.isFinite(low)) return false;
  if (fps < 1 || fps > 1000 || low < 0 || low > 1000) return false;
  const l = Math.min(low, fps);
  const m = nameOf(map);
  const c = nameOf(cls);
  if (!m && !c) return false;
  addTo(stats.maps, m, fps, l);
  addTo(stats.classes, c, fps, l);
  return true;
}

export function cleanFpsStats(raw: unknown): FpsStats {
  const out = emptyFpsStats();
  if (!raw || typeof raw !== 'object') return out;
  const src = raw as Record<string, unknown>;
  for (const key of ['maps', 'classes'] as const) {
    const g = src[key];
    if (!g || typeof g !== 'object') continue;
    for (const [rawName, value] of Object.entries(g as Record<string, unknown>)) {
      const name = nameOf(rawName);
      if (!name || !value || typeof value !== 'object' || Object.keys(out[key]).length >= FPS_MAX_NAMES) continue;
      const v = value as Record<string, unknown>;
      const num = (x: unknown, hi: number): number => (typeof x === 'number' && Number.isFinite(x) ? Math.max(0, Math.min(hi, x)) : 0);
      const n = Math.floor(num(v.n, FPS_BUCKET_CAP * 2));
      if (n > 0) out[key][name] = { sumFps: num(v.sumFps, 1e9), sumLow: num(v.sumLow, 1e9), n };
    }
  }
  return out;
}

export interface FpsRow { name: string; avg: number; low: number; windows: number; minutes: number }

/** Maps or classes with at least `minWindows` measured windows, the heaviest (lowest FPS) first. `windowSeconds` converts windows to minutes. */
export function summariseFps(group: Record<string, FpsBucket>, windowSeconds = 5, minWindows = 6): FpsRow[] {
  return Object.entries(group)
    .filter(([, b]) => b.n >= minWindows)
    .map(([name, b]) => ({ name, avg: b.sumFps / b.n, low: b.sumLow / b.n, windows: b.n, minutes: Math.round((b.n * windowSeconds) / 60) }))
    .sort((a, b) => a.avg - b.avg);
}

/** FPS and 1 % low of one window from its frame times in milliseconds, or null when there are too few frames. */
export function windowStats(frameTimesMs: ArrayLike<number>, count: number, seconds: number): { fps: number; low: number } | null {
  if (count < 30 || seconds <= 0) return null;
  const times = Array.from({ length: count }, (_, i) => frameTimesMs[i]).filter((t) => t > 0 && Number.isFinite(t)).sort((a, b) => a - b);
  if (times.length < 30) return null;
  const worst = times[Math.min(times.length - 1, Math.floor(times.length * 0.99))];
  return { fps: count / seconds, low: worst > 0 ? 1000 / worst : 0 };
}
