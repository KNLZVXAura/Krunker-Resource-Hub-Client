// ── Live data from Krunker's public game API ──
// Read-only lookups for the dashboard's Live Data page: player and clan profiles, Turf Wars, leaderboards and the
// item market. Endpoints and fields are documented by the krapio project (https://nulldev.github.io/krapio,
// MIT, NullDev); Krunker does not document them itself, so any of them can change. Nothing here needs a login
// and nothing is sent except the name or number you typed.
//
// gapi.svc.krunker.io allows 5 requests per second per endpoint: replies are cached for a minute and calls are
// spaced out so a page that fires several requests never trips the limit.

import { net } from 'electron';
import { electronLog } from './logger';

const GAPI = 'https://gapi.svc.krunker.io';
const LEGACY = 'https://api.krunker.io';
const CACHE_MS = 60_000;
const MIN_GAP_MS = 220;

export type LiveKind =
  | 'player' | 'player-search' | 'clan' | 'turf-status' | 'turf-clan' | 'turf-top-clans'
  | 'board-players' | 'board-clans' | 'market-stats' | 'market-sales' | 'market-info' | 'item-prices' | 'streams';

const PLAYER_BOARDS = new Set([
  'player_score', 'player_kills', 'player_wins', 'player_timeplayed', 'player_funds',
  'player_followed', 'player_nukes', 'player_skinvalue', 'player_eventcount', 'player_ranked_matches',
]);

const cache = new Map<string, { at: number; value: unknown }>();
let lastCall = 0;

const NAME_RE = /^[\w .\-[\]]{1,32}$/;
const int = (v: unknown, min: number, max = 1e9): number | null =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : null;

interface Target { url: string; envelope: boolean }

function resolve(kind: LiveKind, arg: Record<string, unknown>): Target | null {
  const g = (path: string, query?: Record<string, string | number | undefined>): Target => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== '') q.set(k, String(v));
    const s = q.toString();
    return { url: GAPI + path + (s ? '?' + s : ''), envelope: true };
  };
  const name = typeof arg.name === 'string' ? arg.name.trim() : '';
  switch (kind) {
    case 'player': return NAME_RE.test(name) ? g('/players/' + encodeURIComponent(name)) : null;
    case 'player-search': return name.length >= 2 && name.length <= 32 ? g('/players/search', { q: name, limit: 8 }) : null;
    case 'clan': return NAME_RE.test(name) ? g('/clans/by-name/' + encodeURIComponent(name)) : null;
    case 'turf-status': return g('/territorial-wars/status');
    case 'turf-clan': { const id = int(arg.id, 1); return id ? g(`/territorial-wars/clan/${id}`) : null; }
    case 'turf-top-clans': return g('/territorial-wars/leaderboards/top-performing-clans', { map_id: int(arg.mapId, 0, 50) ?? undefined });
    case 'board-players': return typeof arg.type === 'string' && PLAYER_BOARDS.has(arg.type) ? g('/leaderboards/' + arg.type) : null;
    case 'board-clans': return g('/leaderboards/player_clan', { sort: arg.sort === 'members' ? 'members' : 'score' });
    case 'market-stats': {
      const term = typeof arg.term === 'string' ? arg.term.trim().slice(0, 40) : '';
      return g('/market/stats', { limit: 50, sort: 'rarity', searchTerm: term, cursor: int(arg.cursor, 0) ?? undefined });
    }
    case 'market-sales': { const id = int(arg.id, 0); return id !== null ? g(`/market/items/${id}/sales-statistics`, { daysback: 30 }) : null; }
    case 'market-info': { const id = int(arg.id, 0); return id !== null ? g(`/market/items/${id}/sales`) : null; }
    case 'item-prices': return { url: LEGACY + '/webhooks/general/items/prices', envelope: false };
    case 'streams': return { url: LEGACY + '/streams/top?cb=2', envelope: true };
    default: return null;
  }
}

export async function liveData(kind: LiveKind, arg: Record<string, unknown>): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  const target = resolve(kind, arg ?? {});
  if (!target) return { ok: false, error: 'Invalid request' };
  const hit = cache.get(target.url);
  if (hit && Date.now() - hit.at < CACHE_MS) return { ok: true, data: hit.value };
  const wait = lastCall + MIN_GAP_MS - Date.now();
  lastCall = Date.now() + Math.max(0, wait);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  try {
    const res = await net.fetch(target.url, { signal: AbortSignal.timeout(12_000), headers: { accept: 'application/json' } });
    if (res.status === 404) return { ok: false, error: 'Not found' };
    if (!res.ok) return { ok: false, error: `Krunker answered ${res.status}` };
    const body = await res.json() as { data?: unknown; error?: unknown };
    if (target.envelope && body && typeof body === 'object' && 'error' in body && body.error) return { ok: false, error: 'Krunker returned an error' };
    const value = target.envelope && body && typeof body === 'object' && 'data' in body ? body.data : body;
    cache.set(target.url, { at: Date.now(), value });
    if (cache.size > 200) cache.delete(cache.keys().next().value as string);
    return { ok: true, data: value };
  } catch (err) {
    electronLog.warn('[KRH] Live data request failed:', err);
    return { ok: false, error: 'Could not reach Krunker' };
  }
}
