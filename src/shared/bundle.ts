// ── Setup bundle ──
// A bundle is one share code (kind "bundle") with the parts of a setup that are plain data: the crosshair and one Krunker settings
// profile (sensitivity, FOV, keys ...). The KRH website can keep a bundle next to the userscript posts that belong to it, and "Use in
// KRH Client" applies it after a confirmation. Scripts are NOT inside the code: the website adds them itself from its own script
// posts (so only scripts that passed the website's rules are ever installed). Pure functions only.

export interface BundleProfile { name: string; data: string }
export interface Bundle { crosshair: Record<string, unknown> | null; profile: BundleProfile | null }

export const MAX_PROFILE_CHARS = 1_900_000;

/** Keeps a bundle to the known shape. Returns null when it carries nothing usable. */
export function cleanBundle(raw: unknown): Bundle | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const crosshair = r.crosshair && typeof r.crosshair === 'object' && !Array.isArray(r.crosshair) ? (r.crosshair as Record<string, unknown>) : null;
  let profile: BundleProfile | null = null;
  const p = r.profile as Record<string, unknown> | null | undefined;
  if (p && typeof p === 'object' && typeof p.data === 'string' && p.data.length >= 2 && p.data.length <= MAX_PROFILE_CHARS) {
    profile = { name: Array.from(typeof p.name === 'string' ? p.name : '', (c) => (c.charCodeAt(0) < 32 ? ' ' : c)).join('').trim().slice(0, 60) || 'Shared profile', data: p.data };
  }
  return crosshair || profile ? { crosshair, profile } : null;
}

/** What applying a bundle will do, one line each, for the confirmation. */
export function describeBundle(b: Bundle, profilesFull: boolean): string[] {
  const out: string[] = [];
  if (b.crosshair) out.push('Replace your crosshair with the one in this bundle (and switch it on).');
  if (b.profile) out.push(profilesFull ? `Skip the Krunker settings profile "${b.profile.name}": you already have 30 profiles.` : `Add the Krunker settings profile "${b.profile.name}" to your Settings Profiles (you load it yourself under Settings > Settings Profiles).`);
  return out;
}

/** A name that is not taken yet: "Name", "Name (2)", ... */
export function freeName(name: string, taken: ReadonlySet<string>): string {
  const base = name.slice(0, 52);
  if (!taken.has(name)) return name;
  for (let n = 2; n < 1000; n++) { const c = `${base} (${n})`; if (!taken.has(c)) return c; }
  return `${base} (${Date.now() % 10000})`;
}
