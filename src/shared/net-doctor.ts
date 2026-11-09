// ── Network doctor ──
// Turns a handful of measurements into a plain answer to "is it my connection, my DNS or the game servers?":
//   DNS     how long names such as krunker.io take to resolve (null = failed)
//   base    TCP connect times to well-known hosts that have nothing to do with Krunker (Cloudflare, Google)
//   regions ping samples to the Krunker region servers (-1 = no answer)
// If the well-known hosts are fine and one region is bad, the problem is the route to that region, not your connection.
// Pure functions only: the main process makes the measurements.

export interface DoctorInput {
  dns: Array<{ host: string; ms: number | null }>;
  base: Array<{ host: string; samples: number[] }>;
  regions: Array<{ code: string; name: string; samples: number[] }>;
}

export type Level = 'ok' | 'warn' | 'bad';
export type Verdict = 'ok' | 'no-internet' | 'dns' | 'local' | 'server' | 'far';

export interface DoctorFinding { level: Level; text: string }
export interface DoctorResult { verdict: Verdict; level: Level; headline: string; findings: DoctorFinding[] }

export interface SampleStats { avg: number; jitter: number; lossPct: number; count: number }

/** Average of the answers, jitter (average change between answers) and the share of lost answers. */
export function sampleStats(samples: readonly number[]): SampleStats {
  const ok = samples.filter((s) => s >= 0);
  const avg = ok.length ? ok.reduce((a, b) => a + b, 0) / ok.length : 0;
  let diffs = 0;
  for (let i = 1; i < ok.length; i++) diffs += Math.abs(ok[i] - ok[i - 1]);
  return { avg, jitter: ok.length > 1 ? diffs / (ok.length - 1) : 0, lossPct: samples.length ? ((samples.length - ok.length) / samples.length) * 100 : 0, count: samples.length };
}

const ms = (n: number): string => Math.round(n) + ' ms';

export function diagnose(input: DoctorInput): DoctorResult {
  const findings: DoctorFinding[] = [];
  const baseAll = input.base.flatMap((b) => b.samples);
  const baseStats = sampleStats(baseAll);
  const baseAlive = baseAll.some((s) => s >= 0);

  if (!baseAlive) {
    findings.push({ level: 'bad', text: 'No answer from well-known servers (Cloudflare, Google). The computer is not reaching the internet.' });
    return { verdict: 'no-internet', level: 'bad', headline: 'No internet connection: the problem is on your side (cable, Wi-Fi, router or provider).', findings };
  }

  for (const b of input.base) {
    const s = sampleStats(b.samples);
    findings.push({ level: s.lossPct >= 5 || s.avg > 120 || s.jitter > 30 ? 'warn' : 'ok', text: `${b.host}: ${s.count && s.lossPct < 100 ? ms(s.avg) + ', jitter ' + ms(s.jitter) + ', lost ' + Math.round(s.lossPct) + '%' : 'no answer'}` });
  }

  const dnsFailed = input.dns.filter((d) => d.ms === null);
  const dnsSlow = input.dns.filter((d) => d.ms !== null && d.ms > 400);
  for (const d of input.dns) findings.push({ level: d.ms === null ? 'bad' : d.ms > 400 ? 'warn' : 'ok', text: `DNS ${d.host}: ${d.ms === null ? 'could not be resolved' : ms(d.ms)}` });

  const live = input.regions.map((r) => ({ ...r, st: sampleStats(r.samples) }));
  for (const r of live) {
    findings.push({ level: r.st.lossPct >= 100 ? 'warn' : r.st.lossPct >= 10 || r.st.jitter > 40 ? 'warn' : 'ok', text: `${r.name}: ${r.st.lossPct >= 100 ? 'no answer (it may block ping)' : ms(r.st.avg) + ', jitter ' + ms(r.st.jitter) + ', lost ' + Math.round(r.st.lossPct) + '%'}` });
  }

  // 1. DNS: the internet works but names do not resolve
  if (dnsFailed.length === input.dns.length && input.dns.length > 0) {
    return { verdict: 'dns', level: 'bad', headline: 'The internet works but names cannot be resolved: a DNS problem. Try another DNS server (1.1.1.1 or 8.8.8.8) in your network settings.', findings };
  }
  // 2. Your own connection is poor, whatever server you talk to
  if (baseStats.lossPct >= 5 || baseStats.avg > 120 || baseStats.jitter > 30) {
    return { verdict: 'local', level: 'bad', headline: 'Your connection itself is unstable or slow even to servers that have nothing to do with Krunker: look at Wi-Fi, other downloads on the network, the router and your provider.', findings };
  }
  // 3. A region with trouble while your connection is fine: the route to that region
  const answering = live.filter((r) => r.st.lossPct < 100);
  const troubled = answering.filter((r) => r.st.lossPct >= 10 || r.st.jitter > 40);
  if (answering.length >= 3 && troubled.length > 0 && troubled.length <= Math.ceil(answering.length / 2)) {
    return { verdict: 'server', level: 'warn', headline: `Your connection is fine, but the route to ${troubled.map((r) => r.name).join(', ')} is unstable. Pick another region for now.`, findings };
  }
  // 4. Everything is fine but the servers are far away
  const nearest = answering.length ? answering.reduce((a, b) => (b.st.avg < a.st.avg ? b : a)) : null;
  if (nearest && nearest.st.avg > 90 && baseStats.avg < 60) {
    return { verdict: 'far', level: 'warn', headline: `Your connection is fine, but even the nearest region (${nearest.name}, ${ms(nearest.st.avg)}) is far from you. Ping will stay high; that is distance, not a fault.`, findings };
  }
  if (dnsSlow.length || dnsFailed.length) {
    return { verdict: 'dns', level: 'warn', headline: 'Everything is fine except DNS, which is slow or fails for some names. A different DNS server (1.1.1.1 or 8.8.8.8) may help joining games.', findings };
  }
  return { verdict: 'ok', level: 'ok', headline: nearest ? `Your connection looks fine. The nearest region is ${nearest.name} at ${ms(nearest.st.avg)}.` : 'Your connection looks fine. No region answered ping, which can be normal when they block it.', findings };
}
