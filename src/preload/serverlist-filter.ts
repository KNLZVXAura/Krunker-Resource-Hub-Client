// ── Server list filter ──
// Hides the games whose map name contains a word of the player's list from Krunker's server browser.
// The old userscript replaced fetch and returned the ORIGINAL response with a patched json(); the game
// reads the body more than once and stopped loading. Here the answer is read from a clone and, only when
// something is removed, returned as a brand-new Response (the same pattern as the Sky override), and any
// error hands back the untouched response.

import { savedConsole as _console } from './saved-console';
import { GAME_LIST_URL_RE, filterGameList, parseFilterWords } from '../shared/server-filter';

let on = false;
let words: string[] = [];
let installed = false;

/** Turn the filter on or off and set its words. Safe to call again at any time (no reload needed). */
export function setServerFilter(enabled: boolean, rawWords: string): void {
  on = enabled;
  words = parseFilterWords(rawWords);
  if (enabled) install();
}

function install(): void {
  if (installed) return;
  installed = true;
  const origFetch = window.fetch;
  window.fetch = async function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const res = await origFetch.call(window, input, init);
    if (!on || !words.length) return res;
    try {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
      if (!GAME_LIST_URL_RE.test(url) || !res.ok) return res;
      const filtered = filterGameList(await res.clone().json(), words);
      if (!filtered) return res;
      return new Response(JSON.stringify(filtered), { status: res.status, statusText: res.statusText, headers: res.headers });
    } catch (err) {
      _console.warn('[KRH-ServerFilter] passing the list through:', err);
      return res;
    }
  };
}
