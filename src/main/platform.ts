import { app } from 'electron';
import { join } from 'path';
import { execFile } from 'child_process';
import { loadUserFlags } from './user-lists';
import type { AppConfig } from './config';
import { detectGpus, nvidiaProprietaryLoaded, type GpuSummary } from './gpu-detect';

export type Platform = 'win32' | 'linux' | 'darwin';

export interface PlatformInfo {
  os: Platform;
  isWindows: boolean;
  isLinux: boolean;
}

export function detectPlatform(): PlatformInfo {
  const os = process.platform as Platform;
  const isWindows = os === 'win32';
  const isLinux = os === 'linux';

  return {
    os,
    isWindows,
    isLinux,
  };
}

// Explicit window icon for dev; packaged builds use the exe/icns/desktop icon
// (build/ isn't in the asar). Undefined when packaged.
export function devWindowIcon(): string | undefined {
  if (app.isPackaged) return undefined;
  return join(app.getAppPath(), 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png');
}

/** 0 = uncapped; anything else lands in 30..1000. Mirrors the binary-side clamp. */
export function clampFrameCap(raw: unknown): number {
  const fps = Math.round(Number(raw ?? 0)) || 0;
  return fps > 0 ? Math.min(1000, Math.max(30, fps)) : 0;
}

/** Canonical set of valid `angleBackend` values per platform. The settings UI dropdown must stay in sync. */
export function getValidAngleBackends(info: PlatformInfo): readonly string[] {
  if (info.isWindows) return ['default', 'gl', 'd3d11', 'd3d11on12'];
  // macOS ANGLE has no Vulkan backend (Metal/GL only)
  return info.isLinux ? ['default', 'gl', 'vulkan'] : ['default', 'gl'];
}

/**
 * Windows hybrid-graphics laptops (Intel/AMD iGPU + NVIDIA dGPU) can run the game on the weak
 * iGPU. This is the same switch as Settings > System > Display > Graphics > "High performance"
 * for this exe: a per-user registry value. It only takes effect from the next launch, and an
 * existing choice (set by the user or by Windows) is never overwritten.
 * Opt out with the environment variable KRH_NO_GPU_PREFERENCE=1.
 */
export function ensureHighPerformanceGpu(): void {
  if (process.platform !== 'win32' || !app.isPackaged || process.env.KRH_NO_GPU_PREFERENCE) return;
  // Portable builds run from a temp dir; the preference must name the real exe the user launches.
  const exe = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
  const key = 'HKCU\\Software\\Microsoft\\DirectX\\UserGpuPreferences';
  execFile('reg', ['query', key, '/v', exe], { windowsHide: true, timeout: 5000 }, (err) => {
    if (!err) return; // a preference for this exe already exists
    execFile('reg', ['add', key, '/v', exe, '/t', 'REG_SZ', '/d', 'GpuPreference=2;', '/f'],
      { windowsHide: true, timeout: 5000 }, () => { /* best effort */ });
  });
}

export type GpuProfileSetting = 'auto' | 'standard' | 'low' | 'off';
export const GPU_PROFILES: readonly GpuProfileSetting[] = ['auto', 'standard', 'low', 'off'];
/** What the flags below were actually built for: standard, low (weak GPU) or legacy (very old GPU). */
export type EffectiveGpuProfile = 'standard' | 'low' | 'legacy' | 'off';

export interface GpuProfileInfo {
  setting: GpuProfileSetting;
  effective: EffectiveGpuProfile;
  summary: GpuSummary;
}
let lastGpuInfo: GpuProfileInfo | null = null;
/** Result of the GPU detection / profile choice made at startup (null before applyPlatformFlags ran). */
export function getGpuProfileInfo(): GpuProfileInfo | null { return lastGpuInfo; }

export function resolveGpuProfile(setting: unknown, summary: GpuSummary): { setting: GpuProfileSetting; effective: EffectiveGpuProfile } {
  const s: GpuProfileSetting = GPU_PROFILES.includes(setting as GpuProfileSetting) ? (setting as GpuProfileSetting) : 'auto';
  if (s === 'off') return { setting: s, effective: 'off' };
  if (s === 'standard') return { setting: s, effective: 'standard' };
  if (s === 'low') return { setting: s, effective: 'low' };
  const tier = summary.primary?.tier;
  return { setting: s, effective: tier === 'legacy' ? 'legacy' : tier === 'low' ? 'low' : 'standard' };
}

/** Chromium's value for --proxy-server, or null when no valid proxy is set (host and port are checked here too). */
export function proxyRules(n: Partial<AppConfig['network']> | undefined): string | null {
  if (!n || n.proxyEnabled !== true) return null;
  const host = String(n.proxyHost || '').trim();
  const port = Number(n.proxyPort);
  const type = ['socks5', 'socks4', 'http', 'https'].includes(String(n.proxyType)) ? String(n.proxyType) : 'socks5';
  if (!host || !/^[A-Za-z0-9.-]+$|^\[[0-9A-Fa-f:]+\]$/.test(host) || !Number.isInteger(port) || port < 1 || port > 65535) return null;
  return `${type}://${host}:${port}`;
}

export function applyPlatformFlags(info: PlatformInfo, advanced: AppConfig['advanced'], performance: AppConfig['performance'], network?: Partial<AppConfig['network']>): void {
  // Proxy: one switch for every window and tab of the client. Changing it needs a restart.
  const proxy = proxyRules(network);
  if (proxy) {
    app.commandLine.appendSwitch('proxy-server', proxy);
    app.commandLine.appendSwitch('proxy-bypass-list', 'localhost;127.0.0.1;<local>');
  }
  // Chromium's CommandLine stores ONE value per switch name — every
  // `appendSwitch('enable-features', X)` call overwrites the previous one.
  // Accumulate into Sets and emit a single combined value at the end.
  const enabledFeatures = new Set<string>();
  const disabledFeatures = new Set<string>();
  const enableFeatures = (...names: string[]): void => { for (const n of names) enabledFeatures.add(n); };
  const disableFeatures = (...names: string[]): void => { for (const n of names) disabledFeatures.add(n); };

  // ── FPS uncap ──
  // disable-frame-rate-limit causes compositor CPU spin on Chromium 84+, starving
  // input events. On Electron 43 (Chromium 150), this is fixed by a patch to
  // cc/scheduler/scheduler.cc in our custom Electron build.
  if (performance.fpsUnlocked) {
    app.commandLine.appendSwitch('disable-frame-rate-limit');
    app.commandLine.appendSwitch('disable-gpu-vsync');
    app.commandLine.appendSwitch('max-gum-fps', '9999');
    // macOS: VSyncAlignedPresentationForScrolling (default-on since M140) holds
    // CA commits for the next CVDisplayLink tick during scroll interactions or
    // while a previous swap is still queued. Swap acks only fire on commit, and
    // the frame-pacing patch paces draws by acks, so a single 2-deep queue
    // moment (settings-menu scroll, cmd-tab stall) latches the game to exactly
    // vsync until rendering pauses — the "reverts to vsync until refresh" bug.
    // The second name covers pre-M148 Chromium; unknown names are ignored.
    if (info.os === 'darwin') {
      disableFeatures('VSyncAlignedPresentationForScrolling', 'VSyncAlignedPresent');
    }
    // Read by the custom Electron's CustomFrameCap feature param: paces swap-ack
    // release per window, so the cap holds exact values above the display refresh.
    const frameCap = clampFrameCap(performance.frameCap);
    if (frameCap > 0) enableFeatures(`CustomFrameCap:fps/${frameCap}`);
    // Opt-in deeper compositor frame queue (depth 2 vs the patched default of 1),
    // read by the CustomMaxPendingFrames param. Suppressed under a cap: at depth ≥ 2
    // the renderer decouples from the paced draw loop and the cap stops working.
    if (performance.higherMaxFps && frameCap <= 0) enableFeatures('CustomMaxPendingFrames:count/2');
  }

  // ── Always-on platform flags ──
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
  // Never throttle the game while unfocused/alt-tabbed (completes the switch
  // above), and let game audio start without a first click.
  app.commandLine.appendSwitch('disable-background-timer-throttling');
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
  app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
  app.commandLine.appendSwitch('overscroll-history-navigation', '0');
  app.commandLine.appendSwitch('pull-to-refresh', '0');
  // WebGL is mandatory for Krunker — force it past any GPU blocklist.
  // On Chromium 134+ the blocklist is stricter and silently disables WebGL on many Linux GPUs.
  app.commandLine.appendSwitch('ignore-gpu-blocklist');
  // Dual-GPU laptops otherwise default to the integrated GPU unless the user sets a per-app preference
  if (performance?.highPerformanceGpu !== false) app.commandLine.appendSwitch('force-high-performance-gpu');

  // ── GPU-aware tuning (NVIDIA / Intel / hybrid laptops / weak GPUs) ──
  // Detected from the OS before the GPU process starts (see gpu-detect.ts). Settings > Performance >
  // GPU Profile can force a profile; "Off" restores the old generic behaviour exactly.
  const gpuSummary = detectGpus();
  const { setting: gpuSetting, effective: gpuProfile } = resolveGpuProfile(advanced.gpuProfile, gpuSummary);
  lastGpuInfo = { setting: gpuSetting, effective: gpuProfile, summary: gpuSummary };
  const primaryVendor = gpuSummary.primary?.vendor;
  // Force-style switches (driver workarounds off, no software fallback) are only kept for healthy
  // modern non-Intel GPUs: on Intel iGPUs and weak/old cards they are the usual cause of black
  // screens and crashes, and the 'low' / 'legacy' profiles exist to keep those machines working.
  const forceSwitchesOk = gpuProfile === 'off' || (gpuProfile === 'standard' && primaryVendor !== 'intel');

  if (gpuProfile !== 'off') {
    // Laptops with an iGPU + a discrete card: make Chromium pick the discrete one right away
    // (the registry preference in ensureHighPerformanceGpu() only works from the 2nd launch).
    if (gpuSummary.hybrid) app.commandLine.appendSwitch('force-high-performance-gpu');

    // Hardware raster + zero-copy upload: cheap wins on Intel iGPUs (shared memory) and fine on NVIDIA.
    // Skipped on very old GPUs where they are more likely to misbehave than to help.
    if (gpuProfile !== 'legacy') {
      app.commandLine.appendSwitch('enable-gpu-rasterization');
      if (primaryVendor === 'intel') app.commandLine.appendSwitch('enable-zero-copy');
    }

    // Weak GPU: halve the MSAA cost when the game's anti-aliasing is on (no effect when it is off).
    if (gpuProfile === 'low' || gpuProfile === 'legacy') {
      app.commandLine.appendSwitch('webgl-msaa-sample-count', '2');
    }

    if (info.isLinux) {
      // Mesa (Intel / AMD): move GL command submission to its own thread. Only when the user has not set it.
      if (primaryVendor !== 'nvidia' && !process.env.mesa_glthread) process.env.mesa_glthread = 'true';
      // NVIDIA proprietary: never purge the driver shader cache, so shaders compile once instead of stuttering again.
      if (nvidiaProprietaryLoaded() && !process.env.__GL_SHADER_DISK_CACHE_SKIP_CLEANUP) process.env.__GL_SHADER_DISK_CACHE_SKIP_CLEANUP = '1';
    }
  }

  // Render at 1x even when Windows display scaling is 125% / 150%: far fewer pixels for the GPU
  // (a big win on laptops), at the price of a slightly softer UI. Opt-in.
  if (advanced.ignoreDisplayScaling) app.commandLine.appendSwitch('force-device-scale-factor', '1');

  // ── ANGLE backend ──
  // 'default' means platform default: D3D11 on Windows, no override on Linux
  if (advanced.angleBackend && advanced.angleBackend !== 'default') {
    app.commandLine.appendSwitch('use-angle', advanced.angleBackend);
  } else if (info.isWindows) {
    app.commandLine.appendSwitch('use-angle', 'd3d11');
  }

  if (info.isWindows) {
    disableFeatures('CalculateNativeWinOcclusion', 'HardwareMediaKeyHandling');
  }

  if (info.isLinux) {
    // NOTE: --ozone-platform must be set on the launcher CLI — Chromium parses it
    // during early C++ startup, before our JS runs, so app.commandLine.appendSwitch
    // is silently ignored at module-load time. The x11 flag is injected by:
    //   - npm start / npm run dev → scripts/launch-electron.js
    //   - packaged AppImage → scripts/afterPack-linux.js (wrapper)
    app.commandLine.appendSwitch('ozone-platform-hint', 'auto');
    // GPU sandbox can fail inside AppImage FUSE mounts and on certain Mesa driver versions,
    // causing the GPU process to crash and leaving a black screen.
    app.commandLine.appendSwitch('disable-gpu-sandbox');
    // NVIDIA proprietary doesn't implement VAAPI; if the GPU process probes libva
    // it logs `vaInitialize failed` and can segfault during command-buffer creation.
    // Krunker doesn't use HW video decode anyway, so disable defensively.
    app.commandLine.appendSwitch('disable-accelerated-video-decode');
    app.commandLine.appendSwitch('disable-accelerated-video-encode');
    app.commandLine.appendSwitch('disable-accelerated-mjpeg-decode');
  }

  // ── Remove useless features ──
  // Pruned to switches that exist in Electron 43 — chrome-layer switches (print
  // preview, component update, metrics, hyperlink pings) are not compiled into
  // Electron and never had any effect.
  if (advanced.removeUselessFeatures) {
    app.commandLine.appendSwitch('disable-breakpad');
    app.commandLine.appendSwitch('disable-logging');
    app.commandLine.appendSwitch('disable-hang-monitor');
    app.commandLine.appendSwitch('disable-2d-canvas-clip-aa');
    // Windows: skip the extra GPU process that only collects DirectX 12 info after launch
    if (process.platform === 'win32') app.commandLine.appendSwitch('disable-gpu-process-for-dx12-info-collection');
    disableFeatures('MediaRouter');
  }

  // ── Extra performance tweaks ──
  // Force-past-safety switches: GPU rasterization past the driver blocklist,
  // driver bug workarounds off, no software-rasterizer fallback, discrete GPU
  // on dual-GPU machines, 1ms Windows timer frequency,
  // and no proxy resolution (breaks proxied setups).
  if (advanced.perfTweaks) {
    if (gpuProfile !== 'legacy') app.commandLine.appendSwitch('enable-gpu-rasterization');
    // Keep Chromium's driver-bug workarounds ON for mac: disabling them makes
    // Krunker's draws fail command-buffer validation on ANGLE Metal
    // (GL_INVALID_OPERATION "Vertex buffer is not big enough" spam; confirmed
    // 2026-07-08 — errors vanish with workarounds active, Crankshaft never
    // disables them). Windows/Linux keep the switch.
    if (info.os !== 'darwin' && forceSwitchesOk) app.commandLine.appendSwitch('disable-gpu-driver-bug-workarounds');
    if (forceSwitchesOk) app.commandLine.appendSwitch('disable-software-rasterizer');
    app.commandLine.appendSwitch('force-high-performance-gpu');
    app.commandLine.appendSwitch('raise-timer-frequency');
    if (!proxy) app.commandLine.appendSwitch('no-proxy-server');
  }

  // ── Single emission of accumulated feature flag sets ──
  // ── User flags (<userData>/KRH Client/user_flags.json) ──
  // enable/disable-features merge into the sets above (one value per switch name in Chromium).
  for (const f of loadUserFlags((m) => console.warn(m))) {
    if (f.name === 'enable-features') f.value.split(',').filter(Boolean).forEach((n) => enabledFeatures.add(n.trim()));
    else if (f.name === 'disable-features') f.value.split(',').filter(Boolean).forEach((n) => disabledFeatures.add(n.trim()));
    else if (f.value) app.commandLine.appendSwitch(f.name, f.value);
    else app.commandLine.appendSwitch(f.name);
  }

  if (enabledFeatures.size) app.commandLine.appendSwitch('enable-features', [...enabledFeatures].join(','));
  if (disabledFeatures.size) app.commandLine.appendSwitch('disable-features', [...disabledFeatures].join(','));
}

