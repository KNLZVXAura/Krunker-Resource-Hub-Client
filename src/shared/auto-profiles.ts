// ── Auto profiles ──
// Rules that switch settings by themselves while you play: when the class, game mode, map, server region or game type matches a rule, that rule's
// sensitivity preset, FOV preset, crosshair and extra CSS files are applied. A rule with no class, mode or map is the
// default and applies when nothing more specific fits. Pure functions only (no Electron, no DOM), so the choice of rule
// can be tested without a game.

export const AUTO_PROFILE_LIMIT = 20;
export const AUTO_PROFILE_FIELD_MAX = 40;

export interface AutoProfileRule<C = unknown> {
  id: string;
  name: string;
  /** Text the class / mode / map name must contain (not case-sensitive). Empty = any. */
  class: string;
  mode: string;
  map: string;
  /** Region code of the server (the start of the game id: FRA, SV, TOK ...), or empty for any region. */
  region: string;
  /** 'custom' = only custom games, 'public' = only public games, '' = any. A game that does not say never matches a rule that names a type. */
  gameType: '' | 'custom' | 'public';
  /** Ids of saved Sensitivity / FOV presets (Settings > Extras). Empty = leave the setting alone. */
  sensPreset: string;
  fovPreset: string;
  /** A crosshair that replaces the normal one while this rule is active, or null to keep the normal one. */
  crosshair: C | null;
  /** Names of CSS files (Dashboard > Custom CSS) that are added on top while this rule is active, even when switched off there. */
  cssFiles: string[];
}

export interface AutoProfiles<C = unknown> {
  enabled: boolean;
  rules: AutoProfileRule<C>[];
}

export interface MatchContext { class: string; mode: string; map: string; region: string; gameType: '' | 'custom' | 'public' }

type Conditions = Pick<AutoProfileRule, 'class' | 'mode' | 'map' | 'region' | 'gameType'>;

const CSS_NAME = /^[^\\/:*?"<>|]{1,120}\.css$/i;

function stripControls(v: string): string {
  return Array.from(v, (c) => (c.charCodeAt(0) < 32 ? ' ' : c)).join('');
}

function text(v: unknown, max: number): string {
  return typeof v === 'string' ? stripControls(v).trim().slice(0, max) : '';
}

export function normaliseAutoProfiles<C>(raw: unknown, cleanCrosshair: (v: unknown) => C | null): AutoProfiles<C> {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const list = Array.isArray(src.rules) ? src.rules : [];
  const rules: AutoProfileRule<C>[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    let id = text(r.id, 40).replace(/[^A-Za-z0-9_-]/g, '');
    if (!id || seen.has(id)) id = 'rule-' + rules.length.toString(36) + '-' + Math.random().toString(36).slice(2, 8);
    seen.add(id);
    const css = Array.isArray(r.cssFiles) ? r.cssFiles.filter((n): n is string => typeof n === 'string' && CSS_NAME.test(n) && stripControls(n) === n).slice(0, 8) : [];
    rules.push({
      id,
      name: text(r.name, 60) || 'Rule ' + (rules.length + 1),
      class: text(r.class, AUTO_PROFILE_FIELD_MAX),
      mode: text(r.mode, AUTO_PROFILE_FIELD_MAX),
      map: text(r.map, AUTO_PROFILE_FIELD_MAX),
      region: text(r.region, 5).toUpperCase().replace(/[^A-Z]/g, ''),
      gameType: r.gameType === 'custom' || r.gameType === 'public' ? r.gameType : '',
      sensPreset: text(r.sensPreset, 60),
      fovPreset: text(r.fovPreset, 60),
      crosshair: r.crosshair ? cleanCrosshair(r.crosshair) : null,
      cssFiles: css,
    });
    if (rules.length >= AUTO_PROFILE_LIMIT) break;
  }
  return { enabled: src.enabled === true, rules };
}

/** How many of class / mode / map / region / game type the rule names. 0 = the default rule. */
export function specificity(rule: Conditions): number {
  return (rule.class ? 1 : 0) + (rule.mode ? 1 : 0) + (rule.map ? 1 : 0) + (rule.region ? 1 : 0) + (rule.gameType ? 1 : 0);
}

export function ruleMatches(rule: Conditions, ctx: MatchContext): boolean {
  const has = (want: string, got: string): boolean => !want || (!!got && got.toLowerCase().includes(want.toLowerCase()));
  const region = !rule.region || (!!ctx.region && ctx.region.toUpperCase() === rule.region);
  const type = !rule.gameType || ctx.gameType === rule.gameType;
  return has(rule.class, ctx.class) && has(rule.mode, ctx.mode) && has(rule.map, ctx.map) && region && type;
}

/** The rule to use: the matching one that names the most fields (ties: the earlier one), or null when none fits. */
export function pickRule<R extends Conditions>(rules: readonly R[], ctx: MatchContext): R | null {
  let best: R | null = null;
  let bestScore = -1;
  for (const r of rules) {
    if (!ruleMatches(r, ctx)) continue;
    const s = specificity(r);
    if (s > bestScore) { best = r; bestScore = s; }
  }
  return best;
}

/** "Sniper class, Free for All" style line for the settings list. */
export function ruleSummary(rule: AutoProfileRule): string {
  const when: string[] = [];
  if (rule.class) when.push('class "' + rule.class + '"');
  if (rule.mode) when.push('mode "' + rule.mode + '"');
  if (rule.map) when.push('map "' + rule.map + '"');
  if (rule.region) when.push('region ' + rule.region);
  if (rule.gameType) when.push(rule.gameType === 'custom' ? 'a custom game' : 'a public game');
  const does: string[] = [];
  if (rule.sensPreset) does.push('sensitivity');
  if (rule.fovPreset) does.push('FOV');
  if (rule.crosshair) does.push('crosshair');
  if (rule.cssFiles.length) does.push(rule.cssFiles.length === 1 ? '1 CSS file' : rule.cssFiles.length + ' CSS files');
  return (when.length ? 'When ' + when.join(' and ') : 'Default (when no other rule fits)') + ': ' + (does.length ? does.join(', ') : 'changes nothing');
}
