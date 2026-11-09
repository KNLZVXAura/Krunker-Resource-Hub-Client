// ── Script hunt ──
// Finds the userscript that causes a problem (Lost Connection, a freeze, a broken menu) by switching scripts off in halves.
//   Test 1: every script is off. If the problem is still there, no script causes it.
//   Next tests: half of the suspects are off. Problem gone -> the culprit is among those that are off. Still there -> it is
//   among those that are on. The scripts cleared by a test go back on at once.
// With n scripts this takes about log2(n) + 1 tests. Pure functions only: the main process applies the switches.

export type HuntPhase = 'testing' | 'found' | 'not-scripts';

export interface HuntState {
  phase: HuntPhase;
  /** Test number, starting at 1 (test 1 = everything off). */
  step: number;
  /** The scripts that were switched on when the hunt started. */
  original: string[];
  /** Scripts that could still be the cause. */
  suspects: string[];
  /** Scripts switched off for the current test. */
  off: string[];
  /** Set when phase is 'found'. */
  culprit?: string;
}

export interface Switches { on: string[]; off: string[] }

/**
 * Starts a hunt with the scripts that are on now, or returns null when none is on. Scripts in `recentFirst` (changed lately)
 * are listed first, so they are in the first half that is switched off and the search reaches them soonest.
 */
export function startHunt(enabled: readonly string[], recentFirst: readonly string[] = []): HuntState | null {
  const recent = new Set(recentFirst);
  const original = [...new Set(enabled)].sort((a, b) => Number(recent.has(b)) - Number(recent.has(a)) || a.localeCompare(b));
  if (!original.length) return null;
  return { phase: 'testing', step: 1, original, suspects: original.slice(), off: original.slice() };
}

function halfOff(suspects: readonly string[]): string[] {
  return suspects.slice(0, Math.ceil(suspects.length / 2));
}

/** The next state after the player tested: did the problem still happen with the current switches? */
export function answerHunt(s: HuntState, problemStillThere: boolean): HuntState {
  if (s.phase !== 'testing') return s;
  if (s.step === 1) {
    if (problemStillThere) return { ...s, phase: 'not-scripts', off: [], suspects: [] };
    if (s.suspects.length === 1) return { ...s, phase: 'found', culprit: s.suspects[0], off: [], suspects: [] };
    return { ...s, step: 2, off: halfOff(s.suspects) };
  }
  const suspects = problemStillThere ? s.suspects.filter((n) => !s.off.includes(n)) : s.off.slice();
  if (suspects.length === 1) return { ...s, phase: 'found', culprit: suspects[0], suspects, off: [] };
  if (suspects.length === 0) return { ...s, phase: 'not-scripts', suspects: [], off: [] }; // contradictory answers: stop without blaming anyone
  return { ...s, step: s.step + 1, suspects, off: halfOff(suspects) };
}

/** What each script should be right now: during a test the chosen ones are off, at the end everything is back on except the culprit. */
export function switchesFor(s: HuntState): Switches {
  if (s.phase === 'testing') return { off: s.off.slice(), on: s.original.filter((n) => !s.off.includes(n)) };
  if (s.phase === 'found' && s.culprit) return { off: [s.culprit], on: s.original.filter((n) => n !== s.culprit) };
  return { off: [], on: s.original.slice() };
}

/** Switches that undo a hunt that is cancelled: everything that was on is on again. */
export function cancelSwitches(s: HuntState): Switches {
  return { off: [], on: s.original.slice() };
}

/** Keeps a saved state to the known shape (null when it is not one). */
export function cleanHuntState(raw: unknown): HuntState | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length < 200).slice(0, 300) : []);
  if (r.phase !== 'testing' && r.phase !== 'found' && r.phase !== 'not-scripts') return null;
  const original = list(r.original);
  if (!original.length) return null;
  const inOriginal = (names: string[]): string[] => names.filter((n) => original.includes(n));
  const culprit = typeof r.culprit === 'string' && original.includes(r.culprit) ? r.culprit : undefined;
  if (r.phase === 'found' && !culprit) return null;
  return {
    phase: r.phase, step: typeof r.step === 'number' && r.step >= 1 && r.step <= 50 ? Math.floor(r.step) : 1,
    original, suspects: inOriginal(list(r.suspects)), off: inOriginal(list(r.off)), culprit,
  };
}

/** Rough number of tests left (for the progress line). */
export function testsLeft(s: HuntState): number {
  if (s.phase !== 'testing') return 0;
  return s.step === 1 ? Math.max(1, Math.ceil(Math.log2(Math.max(2, s.suspects.length))) + 1) : Math.max(1, Math.ceil(Math.log2(Math.max(2, s.suspects.length))));
}
