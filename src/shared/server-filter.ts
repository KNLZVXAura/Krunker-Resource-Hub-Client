// ── Server list filter (pure logic, no DOM or Electron) ──
// Krunker's server browser gets its list from matchmaker.krunker.io/game-list as
// { games: [[id, region, players, maxPlayers, { i: mapName, g: gameMode, ... }], ...] }.
// Idea and the default words from j4k0xb's "Krunker Serverlist Filter".

/** The words used until the player changes them. */
export const DEFAULT_SERVER_FILTER_WORDS = 'infect, trade, trading, fun-parkour';

/** Matches the game-list request on any Krunker host (krunker.io, comp.krunker.io, ...). */
export const GAME_LIST_URL_RE = /^https:\/\/matchmaker\.krunker\.io\/game-list(\?|$)/i;

/** "Infect, Trade ; fun-parkour" -> ['infect', 'trade', 'fun-parkour'] (lower case, no empties, at most 50). */
export function parseFilterWords(raw: string): string[] {
  const out: string[] = [];
  for (const part of String(raw || '').split(/[,;\n]/)) {
    const w = part.trim().toLowerCase();
    if (w && !out.includes(w)) out.push(w);
    if (out.length >= 50) break;
  }
  return out;
}

/**
 * The same object without the games whose map name contains one of the words.
 * Returns null when nothing has to change (no words, no match, or an answer that does not look
 * like a game list), so the caller can hand back the original response untouched.
 * A game without a readable map name is always kept.
 */
export function filterGameList(list: unknown, words: string[]): { games: unknown[]; [k: string]: unknown } | null {
  if (!words.length || !list || typeof list !== 'object') return null;
  const games = (list as { games?: unknown }).games;
  if (!Array.isArray(games)) return null;
  const kept = games.filter((g) => {
    const info = Array.isArray(g) ? (g[4] as { i?: unknown } | undefined) : undefined;
    const name = info && typeof info.i === 'string' ? info.i.toLowerCase() : '';
    return !name || !words.some((w) => name.includes(w));
  });
  if (kept.length === games.length) return null;
  return { ...(list as object), games: kept } as { games: unknown[]; [k: string]: unknown };
}
