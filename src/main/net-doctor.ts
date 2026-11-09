// ── Network doctor (main process) ──
// Makes the measurements for shared/net-doctor.ts: DNS lookups, TCP connects to well-known hosts, pings to the Krunker
// region servers (the list the matchmaker uses). About 10 to 15 seconds. Nothing is sent anywhere except these small
// connection tests, and nothing is kept.

import { promises as dns } from 'dns';
import { diagnose } from '../shared/net-doctor';
import type { DoctorInput, DoctorResult } from '../shared/net-doctor';
import { REGION_NAMES } from '../shared/ping-history';

export interface DoctorDeps {
  tcpPing(host: string, port: number): Promise<number>;
  osPing(host: string): Promise<number>;
  fetchPingList(): Promise<Record<string, string>>;
  /** Server name in the list -> region code (FRA, SV ...). */
  serverMap: Record<string, string>;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function withCap<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);
}

async function timedLookup(host: string): Promise<number | null> {
  const start = process.hrtime.bigint();
  try {
    await Promise.race([dns.lookup(host), new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000))]);
    return Math.round(Number(process.hrtime.bigint() - start) / 1_000_000);
  } catch { return null; }
}

async function samples(count: number, gapMs: number, one: () => Promise<number>): Promise<number[]> {
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    out.push(await one());
    if (i < count - 1) await sleep(gapMs);
  }
  return out;
}

let running: Promise<DoctorResult> | null = null;

/** Runs the whole test (one at a time: a second call gets the running one). `quick` takes fewer samples (about 6 seconds). */
export function runNetDoctor(deps: DoctorDeps, quick = false): Promise<DoctorResult> {
  if (running) return running;
  running = (async () => {
    try {
      const dnsHosts = ['krunker.io', 'matchmaker.krunker.io'];
      const baseHosts: Array<{ host: string; port: number }> = [{ host: '1.1.1.1', port: 443 }, { host: '8.8.8.8', port: 443 }];

      const dnsPart = Promise.all(dnsHosts.map(async (host) => ({ host, ms: await timedLookup(host) })));
      const basePart = Promise.all(baseHosts.map(async (b) => ({ host: b.host, samples: await samples(quick ? 3 : 5, 150, () => deps.tcpPing(b.host, b.port)) })));
      let listFailed = false;
      const regionPart = (async () => {
        let list: Record<string, string>;
        try { list = await withCap(deps.fetchPingList(), 4000, {}); } catch { list = {}; }
        if (!Object.keys(list).length) listFailed = true;
        return Promise.all(Object.entries(list).map(async ([server, ip]) => {
          const code = deps.serverMap[server] ?? server;
          return { code, name: REGION_NAMES[code] ?? code, samples: await withCap(samples(quick ? 2 : 4, 150, () => deps.osPing(String(ip).split(':')[0])), quick ? 5000 : 9000, quick ? [-1, -1] : [-1, -1, -1, -1]) };
        }));
      })();

      const input: DoctorInput = { dns: await dnsPart, base: await basePart, regions: await regionPart };
      const result = diagnose(input);
      if (listFailed) {
        result.findings.push({ level: 'warn', text: 'The Krunker region list (matchmaker.krunker.io) could not be loaded.' });
        if (result.verdict === 'ok') {
          result.level = 'warn';
          result.headline = 'Your own connection looks fine, but the Krunker server list could not be loaded. That can be a temporary problem on their side or something on your network blocking it.';
        }
      }
      return result;
    } finally {
      running = null;
    }
  })();
  return running;
}
