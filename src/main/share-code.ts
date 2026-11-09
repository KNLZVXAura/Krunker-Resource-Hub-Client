// ── Share codes ──
// A share code is a piece of text that can be pasted into Discord or a chat. It carries the data itself
// (compressed), so it needs no server and nothing is uploaded anywhere:
//   KRH1.<kind>.<base64url of deflate(JSON)>
// kinds: profile (a Krunker settings profile), crosshair, loadout (a list of resource packs + where to get them),
// autoprofile (one Auto Profiles rule with the presets it uses).
// A code only ever carries plain data. The receiver checks it again before using it (see index.ts).

import { deflateRawSync, inflateRawSync } from 'zlib';

export type ShareKind = 'profile' | 'crosshair' | 'loadout' | 'autoprofile';

const KINDS: ReadonlySet<string> = new Set<ShareKind>(['profile', 'crosshair', 'loadout', 'autoprofile']);
const PREFIX = 'KRH1';
const MAX_CODE_CHARS = 3_000_000;
const MAX_JSON_BYTES = 2_500_000;

export interface SharePayload { name: string; data: unknown }

export function encodeShare(kind: ShareKind, name: string, data: unknown): string {
  if (!KINDS.has(kind)) throw new Error('Unknown share kind');
  const json = JSON.stringify({ v: 1, n: String(name || '').slice(0, 60), d: data });
  if (Buffer.byteLength(json) > MAX_JSON_BYTES) throw new Error('This is too big to share as a code');
  const body = deflateRawSync(Buffer.from(json, 'utf-8'), { level: 9 }).toString('base64url');
  return `${PREFIX}.${kind}.${body}`;
}

export type DecodeResult =
  | { ok: true; kind: ShareKind; name: string; data: unknown }
  | { ok: false; error: string };

export function decodeShare(code: string): DecodeResult {
  const text = String(code || '').trim().replace(/\s+/g, '');
  if (text.length > MAX_CODE_CHARS) return { ok: false, error: 'That code is too long' };
  const m = /^KRH1\.([a-z]+)\.([A-Za-z0-9_-]+)$/.exec(text);
  if (!m) return { ok: false, error: 'That is not a KRH share code' };
  const kind = m[1];
  if (!KINDS.has(kind)) return { ok: false, error: 'That code is for a newer version of the client' };
  try {
    const raw = inflateRawSync(Buffer.from(m[2], 'base64url'), { maxOutputLength: MAX_JSON_BYTES });
    const j = JSON.parse(raw.toString('utf-8')) as { v?: unknown; n?: unknown; d?: unknown };
    if (!j || j.v !== 1) return { ok: false, error: 'That code is for a newer version of the client' };
    return { ok: true, kind: kind as ShareKind, name: typeof j.n === 'string' ? j.n.slice(0, 60) : '', data: j.d };
  } catch {
    return { ok: false, error: 'That code is damaged or incomplete (copy all of it)' };
  }
}
