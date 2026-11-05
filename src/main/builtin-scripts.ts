import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { electronLog } from './logger';
import classRoulette from '../../assets/builtin-scripts/classRoulette.js?raw';
import reconnector from '../../assets/builtin-scripts/Krunker_Reconnector.js?raw';
import quickDocs from '../../assets/builtin-scripts/Quick_Krunker_Docs_Integration.js?raw';
import killStreak from '../../assets/builtin-scripts/killstreak.js?raw';

/**
 * The userscripts that ship inside KRH Client. They are not files in the scripts folder: the code is part of the app, they
 * work even when the "Userscripts" (folder) switch is off, and each has its own on/off switch (Settings > Userscripts, and
 * the dashboard). Everything starts switched off.
 */
export interface BuiltinScript {
  /** Stable name, also used for the preferences file. Never changes between versions. */
  filename: string;
  content: string;
}

export const BUILTIN_SCRIPTS: BuiltinScript[] = [
  { filename: 'builtin-killStreak.js', content: killStreak },
  { filename: 'builtin-classRoulette.js', content: classRoulette },
  { filename: 'builtin-reconnector.js', content: reconnector },
  { filename: 'builtin-quickDocs.js', content: quickDocs },
];

export const isBuiltinFilename = (name: unknown): name is string =>
  typeof name === 'string' && BUILTIN_SCRIPTS.some((s) => s.filename === name);

export class BuiltinScripts {
  private statePath: string;
  private prefsDir: string;
  private state: Record<string, boolean> = {};

  constructor(baseDir: string) {
    this.statePath = join(baseDir, 'state.json');
    this.prefsDir = join(baseDir, 'preferences');
    try { mkdirSync(this.prefsDir, { recursive: true }); } catch (err) { electronLog.warn('[KRH] Built-in scripts folder:', (err as Error).message); }
    try {
      const raw = JSON.parse(readFileSync(this.statePath, 'utf-8'));
      if (raw && typeof raw === 'object') for (const s of BUILTIN_SCRIPTS) if (raw[s.filename] === true) this.state[s.filename] = true;
    } catch { /* first run: everything off */ }
  }

  list(): { filename: string; content: string; enabled: boolean }[] {
    return BUILTIN_SCRIPTS.map((s) => ({ filename: s.filename, content: s.content, enabled: this.state[s.filename] === true }));
  }

  setEnabled(filename: string, enabled: boolean): boolean {
    if (!isBuiltinFilename(filename)) return false;
    this.state[filename] = enabled;
    try { writeFileSync(this.statePath, JSON.stringify(this.state, null, 2), 'utf-8'); }
    catch (err) { electronLog.warn('[KRH] Could not save the built-in script switches:', (err as Error).message); }
    return true;
  }

  loadPrefs(filename: string): Record<string, unknown> {
    if (!isBuiltinFilename(filename)) return {};
    try { return JSON.parse(readFileSync(join(this.prefsDir, filename + '.json'), 'utf-8')); } catch { return {}; }
  }

  savePrefs(filename: string, prefs: Record<string, unknown>): void {
    if (!isBuiltinFilename(filename)) return;
    try { writeFileSync(join(this.prefsDir, filename + '.json'), JSON.stringify(prefs, null, 2), 'utf-8'); }
    catch (err) { electronLog.warn('[KRH] Could not save built-in script settings:', (err as Error).message); }
  }
}
