// ── Updates for userscripts that came from the KRH website ──
// When a script is added with "Use in KRH Client" on the website the client remembers where it came from and which text it
// installed. Later the website's copy is compared with it. A script is only ever updated from the same KRH website address, and an
// update is never applied over a copy you edited yourself without asking. Pure decisions only (hashes and files are in the main
// process, see main/script-updates.ts).

export type UpdateMode = 'off' | 'ask' | 'auto';

/** What the website's copy means for the file on your computer. */
export type Verdict = 'same' | 'update' | 'edited' | 'gone';

/**
 * originHash: the text the client installed (or last updated to). localHash: the file now (null = deleted). remoteHash: the website now.
 *  - gone:   the file is not there any more, forget it
 *  - same:   the website still has what the client installed
 *  - edited: the website has something new, but you changed the file yourself: asking is the only safe thing
 *  - update: the website has something new and the file is untouched
 */
export function judge(originHash: string, localHash: string | null, remoteHash: string): Verdict {
  if (localHash === null) return 'gone';
  if (remoteHash === originHash) return 'same';
  if (localHash !== originHash) return 'edited';
  return 'update';
}

/** Automatic only in "auto" mode, only on an untouched file, and only when the new text brings no new warning (network, eval, ...). */
export function canAuto(mode: UpdateMode, verdict: Verdict, newRisks: readonly string[]): boolean {
  return mode === 'auto' && verdict === 'update' && newRisks.length === 0;
}

/** Disconnects this soon after an update are suspected to come from it. */
export const ROLLBACK_WINDOW_MS = 30 * 60 * 1000;
/** Disconnects after an update before it is taken back by itself (auto mode) or flagged (ask mode, from the first one). */
export const ROLLBACK_DROPS = 2;

export function suspect(updatedAt: number, now: number): boolean {
  return updatedAt > 0 && now - updatedAt >= 0 && now - updatedAt <= ROLLBACK_WINDOW_MS;
}

/** A line for the activity list. */
export function activityLine(kind: 'updated' | 'undone' | 'rolled-back' | 'skipped', title: string, extra = ''): string {
  const t = title.slice(0, 60);
  switch (kind) {
    case 'updated': return `Updated "${t}"${extra ? ` (${extra})` : ''}`;
    case 'undone': return `Went back to the earlier version of "${t}"`;
    case 'rolled-back': return `Took back the update of "${t}": the connection dropped ${extra || 'soon after it'}`;
    default: return `Skipped the update of "${t}"`;
  }
}
