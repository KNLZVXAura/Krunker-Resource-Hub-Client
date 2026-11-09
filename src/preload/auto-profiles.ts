// ── Auto profiles (game side) ──
// Every second or so it reads the class, game mode and map from the game, picks the rule that fits best (see
// shared/auto-profiles.ts) and applies it once the same match has been seen twice in a row: the sensitivity and FOV
// presets are written the way the Presets buttons do it, the crosshair is swapped, and extra CSS files are added on top
// of the normal ones. Nothing is changed while you are in the menu or when no rule fits, except that a crosshair or
// CSS file that only a rule added is taken away again.

import { ipcRenderer } from 'electron';
import { pickRule } from '../shared/auto-profiles';
import type { AutoProfiles, AutoProfileRule, MatchContext } from '../shared/auto-profiles';
import { planPreset, presetScope } from '../shared/presets';
import type { SettingPreset } from '../shared/presets';
import { gameSetting, setGameSettings, storedGameSettingIds } from './game-settings';
import { setCrosshair } from './crosshair';
import type { CrosshairConfig } from './crosshair';
import { showToast } from './utils';

const STYLE_ID = 'krh-profile-css';
const POLL_MS = 1500;

type Rules = AutoProfiles<CrosshairConfig>;
let rules: Rules = { enabled: false, rules: [] };
let presets: SettingPreset[] = [];
let baseCrosshair: CrosshairConfig | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let activeId: string | null = null;
let lastSig = '';
let stable = 0;
let applyToken = 0;

/** Class, mode and map as the game reports them, or null in the menu / when the game does not say. */
function readContext(): MatchContext | null {
  const w = window as unknown as { getGameActivity?: () => Record<string, unknown> | null };
  const ui = document.getElementById('uiBase');
  if (ui && ui.className === 'onMenu') return null;
  if (typeof w.getGameActivity !== 'function') return null;
  let a: Record<string, unknown> | null;
  try { a = w.getGameActivity() ?? null; } catch { return null; }
  if (!a) return null;
  const s = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
  const cls = a.class && typeof a.class === 'object' ? s((a.class as Record<string, unknown>).name) : '';
  // Region: the start of the game id in the address (FRA:abc123). Game type: only when the game says it (custom: true / false).
  let region: string;
  try { region = (/^([A-Za-z]{2,5}):/.exec(new URLSearchParams(location.search).get('game') || '')?.[1] ?? '').toUpperCase(); } catch { region = ''; }
  const gameType: MatchContext['gameType'] = typeof a.custom === 'boolean' ? (a.custom ? 'custom' : 'public') : '';
  const ctx: MatchContext = { class: cls || s(document.getElementById('menuClassName')?.textContent), mode: s(a.mode), map: s(a.map), region, gameType };
  return ctx.class || ctx.mode || ctx.map ? ctx : null;
}

function applyPresetById(id: string, scope: 'sensitivity' | 'fov'): void {
  if (!id) return;
  const p = presets.find((x) => x.id === id && x.scope === scope);
  const sc = presetScope(scope);
  if (!p || !sc) return;
  const writes = planPreset(sc, p.values, gameSetting, storedGameSettingIds());
  if (writes.length) setGameSettings(writes);
}

async function applyCss(files: string[]): Promise<void> {
  const token = ++applyToken;
  let css = '';
  if (files.length) {
    try { css = String(await ipcRenderer.invoke('profile-css', files) || ''); } catch { css = ''; }
  }
  if (token !== applyToken) return; // a newer choice was made while the files were being read
  let el = document.getElementById(STYLE_ID);
  if (!css) { el?.remove(); return; }
  if (!el) { el = document.createElement('style'); el.id = STYLE_ID; (document.head || document.documentElement).appendChild(el); }
  el.textContent = css;
}

function activate(rule: AutoProfileRule<CrosshairConfig> | null): void {
  activeId = rule ? rule.id : null;
  if (rule) {
    applyPresetById(rule.sensPreset, 'sensitivity');
    applyPresetById(rule.fovPreset, 'fov');
  }
  // The crosshair of the rule replaces the normal one; without a rule the normal one comes back.
  if (rule?.crosshair) setCrosshair({ ...rule.crosshair, enabled: true });
  else if (baseCrosshair) setCrosshair(baseCrosshair);
  void applyCss(rule ? rule.cssFiles : []);
}

function tick(): void {
  if (!rules.enabled || !rules.rules.length) return;
  const ctx = readContext();
  if (!ctx) { lastSig = ''; stable = 0; return; }
  const sig = [ctx.class, ctx.mode, ctx.map, ctx.region, ctx.gameType].join('|');
  if (sig === lastSig) stable += 1; else { lastSig = sig; stable = 1; }
  if (stable !== 2) return; // act once, when the same class / mode / map has been seen twice in a row
  const rule = pickRule(rules.rules, ctx);
  const id = rule ? rule.id : null;
  if (id === activeId) return;
  activate(rule);
  if (rule) showToast('Profile: ' + rule.name);
}

function stop(): void {
  if (timer) { clearInterval(timer); timer = null; }
  if (activeId !== null) activate(null);
  lastSig = ''; stable = 0;
}

/** Start, change or stop the auto profiles. `base` is the normal crosshair that comes back when no rule fits. */
export function setAutoProfiles(next: Rules, savedPresets: SettingPreset[], base: CrosshairConfig): void {
  rules = next;
  presets = savedPresets;
  baseCrosshair = base;
  if (!next.enabled || !next.rules.length) { stop(); return; }
  // A rule that was active may have been edited or deleted: undo it, then choose again from the next reading.
  if (activeId !== null) activate(null);
  lastSig = ''; stable = 0;
  if (!timer) timer = setInterval(tick, POLL_MS);
}
