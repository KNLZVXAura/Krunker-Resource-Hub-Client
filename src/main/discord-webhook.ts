// ── Discord webhook (main process) ──
// Posts a short message, and a file when it is small enough, to the Discord webhook the player pasted in the settings. Used for
// automatic replay clips and the weekly card. The address is a secret: it is checked here again, never written to the log and never
// part of a backup or an export. Only discord.com / discordapp.com is ever contacted. Posts are spaced out so a burst of clips cannot
// flood a channel, and mentions are switched off so a message can never ping anybody.

import { electronLog } from './logger';

const HOOK_RE = /^https:\/\/(discord|discordapp)\.com\/api\/webhooks\/\d{5,25}\/[\w-]{20,100}$/;
/** Discord's limit for a webhook upload without server boosts is 10 MB; stay below it. */
export const MAX_UPLOAD = 9 * 1024 * 1024;
const MIN_GAP_MS = 8000;
let lastAt = 0;

export const isWebhook = (url: unknown): url is string => typeof url === 'string' && HOOK_RE.test(url);

export interface Attachment { name: string; data: Buffer; mime: string }

export async function postToDiscord(url: unknown, text: string, file?: Attachment): Promise<{ ok: boolean; error?: string; sentFile?: boolean }> {
  if (!isWebhook(url)) return { ok: false, error: 'No valid Discord webhook is set (Client Settings > Extras).' };
  const wait = lastAt + MIN_GAP_MS - Date.now();
  if (wait > 0) return { ok: false, error: 'Too many posts in a row: try again in a few seconds.' };
  lastAt = Date.now();
  try {
    const body = new FormData();
    body.append('payload_json', JSON.stringify({ content: text.slice(0, 1800), username: 'KRH Client', allowed_mentions: { parse: [] } }));
    const attach = !!file && file.data.length > 0 && file.data.length <= MAX_UPLOAD;
    if (attach && file) body.append('files[0]', new Blob([new Uint8Array(file.data)], { type: file.mime }), file.name.replace(/[^\w.\- ]+/g, '_').slice(0, 80));
    const res = await fetch(url, { method: 'POST', body, redirect: 'error', signal: AbortSignal.timeout(30_000) });
    if (res.status === 429) return { ok: false, error: 'Discord says slow down: try again in a minute.' };
    if (res.status === 404 || res.status === 401) return { ok: false, error: 'Discord does not know this webhook any more: it was deleted or the address is wrong.' };
    if (!res.ok) return { ok: false, error: `Discord answered HTTP ${res.status}.` };
    return { ok: true, sentFile: attach };
  } catch (err) {
    // Never log the address: only what went wrong
    electronLog.warn('[KRH-Discord] Post failed:', (err as Error).name === 'TimeoutError' ? 'timed out' : (err as Error).message.replace(/https?:\/\/\S+/g, '[url]'));
    return { ok: false, error: 'Could not reach Discord.' };
  }
}
