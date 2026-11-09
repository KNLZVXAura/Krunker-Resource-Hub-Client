// ── Settings for the 1.1 features ──
// Called at the end of buildExtrasSection (settings-sections.ts). Groups: Updates, Discord Presence+,
// Streamer Mode, Instant Replay, Session Stats, Overlay Layout, Resource Packs, Share Codes.

import { ipcRenderer } from 'electron';
import type { ExtrasConfig } from '../main/config-defaults';
import {
  createGroup, createToggleRow, createSelectRow, createNumberRow, createTextRow, createButtonRow,
  createRowShell, createInfoRow, makeButton, createSelect,
} from './settings-controls';
import { showToast } from './utils';
import { checkCombo, noteHotkey } from './hotkey-check';
import { setCrosshair } from './crosshair';
import { setAutoProfiles } from './auto-profiles';
import { toggleStatsPanel } from './session-tracker';
import { openLayoutEditor } from './layout-editor';

interface PackView { id: string; name: string; source: string; files: number; bytes: number; skipped: number }
interface PacksState { packs: PackView[]; enabled: string[]; dir: string; swapperRunning: boolean; safeMode: boolean }

function mb(b: number): string { return b >= 1e9 ? (b / 1e9).toFixed(2) + ' GB' : (b / 1e6).toFixed(1) + ' MB'; }

async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall back below */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;left:-9999px;top:0;';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch { return false; }
}

export async function shareCode(kind: 'profile' | 'crosshair' | 'loadout' | 'autoprofile', name: string, data: unknown): Promise<void> {
  const r = await ipcRenderer.invoke('share-encode', kind, name, data) as { ok: boolean; code?: string; error?: string };
  if (!r.ok || !r.code) { showToast(r.error || 'Could not make a code'); return; }
  showToast((await copyText(r.code)) ? 'Code copied. Paste it in Discord or a chat.' : 'Could not copy the code');
}

export function buildV11Section(body: HTMLElement, ex: ExtrasConfig, save: () => void): void {
  // ── Updates ──
  const upd = createGroup(body, 'Updates');
  upd.appendChild(createSelectRow({
    label: 'Update Mode',
    desc: 'Ask at launch: the update screen appears when the client starts (default). Background: the client starts at once, downloads a new version quietly while you play and then shows "Restart to update" in the KRH Hub. Windows installer builds only.',
    options: [{ value: 'ask', label: 'Ask at launch' }, { value: 'background', label: 'Download in background' }],
    value: ex.updateMode, instant: true,
    onChange: (v) => { ex.updateMode = v === 'background' ? 'background' : 'ask'; save(); },
  }));
  upd.appendChild(createToggleRow({
    label: 'Install When I Close the Client',
    desc: 'Background mode only: a downloaded update installs by itself, silently, the next time you close the client.',
    checked: ex.updateInstallOnQuit, instant: true,
    onChange: (v) => { ex.updateInstallOnQuit = v; save(); },
  }));
  const readyRow = createButtonRow({ label: 'Update Ready', desc: 'No downloaded update right now.', buttons: [] });
  upd.appendChild(readyRow.row);
  void ipcRenderer.invoke('update-ready-info').then((info: { version: string } | null) => {
    if (!info) return;
    const d = readyRow.row.querySelector('.krh-row-desc');
    if (d) d.textContent = `Version ${info.version} is downloaded and checked.`;
    readyRow.control.appendChild(makeButton({ label: 'Restart to update', onClick: () => { void ipcRenderer.invoke('update-install-now'); } }));
  }).catch(() => { /* keep the default text */ });

  // ── Discord Presence+ ──
  const rpc = createGroup(body, 'Discord Presence+');
  rpc.appendChild(createInfoRow('Needs Discord Rich Presence on (Discord tab). Pictures only show when the Discord app has images with these names under <b>Rich Presence &gt; Art Assets</b>: <b>class_&lt;name&gt;</b> and <b>map_&lt;name&gt;</b>, lowercase, with _ instead of spaces (for example class_triggerman, map_sandstorm).'));
  rpc.appendChild(createToggleRow({
    label: 'Class Icon',
    desc: 'Small picture in the corner of your presence with your current class (asset class_<name>).',
    checked: ex.rpcRich.classIcon, refreshOnly: true,
    onChange: (v) => { ex.rpcRich.classIcon = v; save(); },
  }));
  rpc.appendChild(createToggleRow({
    label: 'Map Picture',
    desc: 'Show the map as the big picture instead of the KRH logo while you are in a match (asset map_<name>).',
    checked: ex.rpcRich.mapArt, refreshOnly: true,
    onChange: (v) => { ex.rpcRich.mapArt = v; save(); },
  }));
  rpc.appendChild(createToggleRow({
    label: 'Join Button',
    desc: 'Friends can join your match straight from your Discord profile. While it is shown, your custom link buttons are hidden (Discord does not show both).',
    checked: ex.rpcRich.join, refreshOnly: true,
    onChange: (v) => { ex.rpcRich.join = v; save(); },
  }));

  // ── Streamer mode ──
  const st = createGroup(body, 'Streamer Mode');
  st.appendChild(createToggleRow({
    label: 'Streamer Mode',
    desc: 'Hides your Discord presence, the saved-accounts button and list, and the Spotify card. Also switched by the key below.',
    checked: ex.streamerMode, instant: true,
    onChange: (v) => { ex.streamerMode = v; void ipcRenderer.invoke('streamer-set', v); },
  }));
  st.appendChild(createTextRow({
    label: 'Streamer Mode Key', desc: 'Key or combination, for example Ctrl+Alt+M (empty = off)',
    value: ex.streamerKey, placeholder: 'Ctrl+Alt+M', instant: true,
    validate: (v) => checkCombo('extra-streamer', v),
    onChange: (v) => { ex.streamerKey = v.trim(); noteHotkey('extra-streamer', v); save(); },
  }).row);

  // ── Instant replay ──
  const ir = createGroup(body, 'Instant Replay');
  ir.appendChild(createInfoRow('Keeps the last seconds of the game in memory and saves them on a key, to your Videos / KRH Client folder. It records all the time while the game is open, so it uses some GPU power (like a running recording). A clip can start with a short stretch of picture glitches.'));
  ir.appendChild(createToggleRow({
    label: 'Instant Replay', desc: 'Keep the buffer running while the game is open',
    checked: ex.instantReplay.enabled, refreshOnly: true,
    onChange: (v) => { ex.instantReplay.enabled = v; save(); },
  }));
  ir.appendChild(createNumberRow({
    label: 'Length', desc: 'How many seconds each clip contains (the buffer holds this much video in memory)',
    min: 10, max: 120, step: 5, value: ex.instantReplay.seconds, instant: true,
    onChange: (v) => { ex.instantReplay.seconds = v; save(); },
  }));
  ir.appendChild(createTextRow({
    label: 'Save Clip Key', desc: 'Key or combination, for example Ctrl+Alt+R',
    value: ex.instantReplay.key, placeholder: 'Ctrl+Alt+R', refreshOnly: true,
    validate: (v) => checkCombo('extra-replay', v),
    onChange: (v) => { ex.instantReplay.key = v.trim(); noteHotkey('extra-replay', v); save(); },
  }).row);
  ir.appendChild(createNumberRow({
    label: 'Auto Clip at Kill Streak', desc: 'Also save a clip by itself when you reach this many kills without dying (0 = off)',
    min: 0, max: 30, step: 1, value: ex.instantReplay.autoStreak, refreshOnly: true,
    onChange: (v) => { ex.instantReplay.autoStreak = v; save(); },
  }));

  // ── Session stats ──
  const ss = createGroup(body, 'Session Stats');
  ss.appendChild(createToggleRow({
    label: 'Track Session Stats',
    desc: 'Counts your kills, deaths, play time, matches and maps. Everything stays on this computer.',
    checked: ex.sessionStats.enabled, refreshOnly: true,
    onChange: (v) => { ex.sessionStats.enabled = v; save(); },
  }));
  ss.appendChild(createToggleRow({
    label: 'Summary When I Leave the Game',
    desc: 'Show a notification with the session summary when you close the game window and go back to the hub.',
    checked: ex.sessionStats.summary, instant: true,
    onChange: (v) => { ex.sessionStats.summary = v; save(); },
  }));
  ss.appendChild(createTextRow({
    label: 'Stats Panel Key', desc: 'Key or combination that shows your stats in the game',
    value: ex.sessionStats.key, placeholder: 'Ctrl+Alt+K', refreshOnly: true,
    validate: (v) => checkCombo('extra-stats', v),
    onChange: (v) => { ex.sessionStats.key = v.trim(); noteHotkey('extra-stats', v); save(); },
  }).row);
  ss.appendChild(createNumberRow({
    label: 'Daily Kill Goal', desc: 'A message shows when you reach this many kills in a day (0 = off). Counted from the saved statistics.',
    min: 0, max: 100000, step: 10, value: ex.sessionStats.dailyKillGoal ?? 0, refreshOnly: true,
    onChange: (v) => { ex.sessionStats.dailyKillGoal = v; save(); },
  }));
  ss.appendChild(createNumberRow({
    label: 'Break Reminder (minutes)', desc: 'A message suggests a short break after this many minutes of play without a pause of 5 minutes or more, and again after each further interval (0 = off).',
    min: 0, max: 600, step: 5, value: ex.sessionStats.breakMinutes ?? 0, refreshOnly: true,
    onChange: (v) => { ex.sessionStats.breakMinutes = v; save(); },
  }));
  ss.appendChild(createButtonRow({
    label: 'Show Stats', desc: 'Open the stats panel now',
    buttons: [{ label: 'Open', onClick: () => { void toggleStatsPanel(); } }],
  }).row);

  // ── Overlay layout ──
  const lay = createGroup(body, 'Overlay Layout');
  lay.appendChild(createTextRow({
    label: 'Layout Editor Key', desc: 'Key or combination that opens the drag-and-drop editor for the nuke counter, Spotify card and Twitch chat',
    value: ex.layoutEditorKey, placeholder: 'Ctrl+Alt+L', instant: true,
    validate: (v) => checkCombo('extra-layout', v),
    onChange: (v) => { ex.layoutEditorKey = v.trim(); noteHotkey('extra-layout', v); save(); },
  }).row);
  lay.appendChild(createButtonRow({
    label: 'Layout Editor', desc: 'Drag each overlay to where you want it. Positions are saved right away.',
    buttons: [{ label: 'Open editor', onClick: () => { void openLayoutEditor(); } }],
  }).row);

  buildPacksGroup(body, ex, save);
  buildShareGroup(body, ex, save);
}

// ── Resource packs ──
function buildPacksGroup(body: HTMLElement, ex: ExtrasConfig, save: () => void): void {
  const g = createGroup(body, 'Resource Packs');
  g.appendChild(createInfoRow('A pack is a zip of Krunker resources (textures, sounds, models) with the same folders as the swapper. Install it once, then switch it on or off whenever you like. Your own swapper files always win over packs, and later packs in the list win over earlier ones. Packs never run any code. Reload the game (F5) after changing packs.'));

  let state: PacksState = { packs: [], enabled: [], dir: '', swapperRunning: true, safeMode: false };
  const list = createRowShell('Installed Packs', '', { block: true });
  g.appendChild(list.row);
  list.control.style.cssText = 'display:flex;flex-direction:column;gap:6px;width:100%;';

  const applyEnabled = async (ids: string[]): Promise<void> => {
    const r = await ipcRenderer.invoke('packs-set-enabled', ids) as { ok: boolean; needsRestart: boolean; enabled: string[] };
    ex.packs.enabled = r.enabled;
    showToast(r.needsRestart ? 'Saved. Restart the client once to start using packs.' : 'Packs updated. Reload the game (F5) to see them.');
    await refresh();
  };

  const render = (): void => {
    list.control.innerHTML = '';
    if (state.safeMode) {
      const n = document.createElement('div');
      n.textContent = 'Safe Mode is on: packs are not loaded this time.';
      n.style.cssText = 'opacity:.8';
      list.control.appendChild(n);
    }
    if (!state.packs.length) {
      const n = document.createElement('div');
      n.textContent = 'No packs installed yet.';
      n.style.cssText = 'opacity:.6';
      list.control.appendChild(n);
      return;
    }
    const byId = new Map(state.packs.map((p) => [p.id, p] as const));
    const ordered: PackView[] = [];
    for (const id of state.enabled) { const p = byId.get(id); if (p) ordered.push(p); }
    for (const p of state.packs) if (!state.enabled.includes(p.id)) ordered.push(p);
    for (const p of ordered) {
      const on = state.enabled.includes(p.id);
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:6px 8px;border-radius:8px;background:rgba(255,255,255,0.05);';
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.checked = on; cb.style.cursor = 'pointer';
      cb.addEventListener('change', () => {
        const next = cb.checked ? [...state.enabled, p.id] : state.enabled.filter((x) => x !== p.id);
        void applyEnabled(next);
      });
      const info = document.createElement('div');
      info.style.cssText = 'flex:1;min-width:0;';
      const nm = document.createElement('div');
      nm.textContent = p.name;
      nm.style.cssText = 'font-weight:bold;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
      const sub = document.createElement('div');
      sub.textContent = `${p.files} files · ${mb(p.bytes)}${p.skipped ? ` · ${p.skipped} left out` : ''}${p.source ? '' : ' · from a file'}`;
      sub.style.cssText = 'opacity:.6;font-size:12px;';
      info.append(nm, sub);
      row.append(cb, info);
      const idx = state.enabled.indexOf(p.id);
      const move = (dir: -1 | 1): void => {
        const arr = [...state.enabled];
        const j = idx + dir;
        if (idx < 0 || j < 0 || j >= arr.length) return;
        [arr[idx], arr[j]] = [arr[j], arr[idx]];
        void applyEnabled(arr);
      };
      if (on) {
        row.append(makeButton({ label: '▲', title: 'Earlier (weaker)', onClick: () => move(-1) }), makeButton({ label: '▼', title: 'Later (stronger)', onClick: () => move(1) }));
      }
      row.append(makeButton({ label: 'Delete', title: 'Delete this pack from disk', onClick: () => {
        void ipcRenderer.invoke('packs-delete', p.id).then(async () => { showToast('Pack deleted: ' + p.name); await refresh(); });
      } }));
      list.control.appendChild(row);
    }
  };

  async function refresh(): Promise<void> {
    try { state = await ipcRenderer.invoke('packs-list') as PacksState; ex.packs.enabled = state.enabled; } catch { /* keep the old list */ }
    render();
    syncLoadouts();
  }

  const urlRow = createTextRow({
    label: 'Install From Link', desc: 'A direct link to a zip from the Krunker Resource Hub, krunker.io, GitHub or Discord',
    value: '', placeholder: 'https://…/my-pack.zip', instant: true, onChange: () => { /* read on Install */ },
  });
  g.appendChild(urlRow.row);
  urlRow.row.querySelector('.krh-row-control')?.appendChild(makeButton({ label: 'Install', onClick: () => {
    const url = urlRow.input.value.trim();
    if (!url) { showToast('Paste a link first'); return; }
    showToast('Downloading pack…');
    void ipcRenderer.invoke('packs-install-url', url).then(async (r: { ok: boolean; error?: string; pack?: PackView }) => {
      showToast(r.ok ? `Installed: ${r.pack?.name}` : (r.error || 'Install failed'));
      if (r.ok) urlRow.input.value = '';
      await refresh();
    });
  } }));
  g.appendChild(createButtonRow({
    label: 'Install From File', desc: 'Pick a zip you downloaded yourself',
    buttons: [
      { label: 'Choose zip…', onClick: () => {
        void ipcRenderer.invoke('packs-install-file').then(async (r: { ok: boolean; error?: string; pack?: PackView }) => {
          if (r.error === 'cancelled') return;
          showToast(r.ok ? `Installed: ${r.pack?.name}` : (r.error || 'Install failed'));
          await refresh();
        });
      } },
      { label: 'Open packs folder', onClick: () => { void ipcRenderer.invoke('packs-open-folder'); } },
    ],
  }).row);

  // Loadouts: saved sets of switched-on packs
  const loadSel = createSelect([{ value: '', label: '(no loadouts saved)' }], '');
  const syncLoadouts = (keep?: string): void => {
    loadSel.innerHTML = '';
    const opts = ex.packs.loadouts.length ? ex.packs.loadouts.map((l) => ({ value: l.name, label: `${l.name} (${l.ids.length})` })) : [{ value: '', label: '(no loadouts saved)' }];
    for (const o of opts) { const op = document.createElement('option'); op.value = o.value; op.textContent = o.label; loadSel.appendChild(op); }
    if (keep && ex.packs.loadouts.some((l) => l.name === keep)) loadSel.value = keep;
  };
  const nameRow = createTextRow({
    label: 'Loadout Name', desc: 'Name for the set of packs that are switched on right now, for example Clean or Winter. Saving with an existing name replaces it.',
    value: '', placeholder: 'Clean', instant: true, onChange: () => { /* read on Save */ },
  });
  g.appendChild(nameRow.row);
  const lo = createButtonRow({ label: 'Loadouts', desc: 'Switch a whole set of packs on with one click, or share it as a code.', buttons: [] });
  lo.control.append(
    loadSel,
    makeButton({ label: 'Save current', onClick: () => {
      const name = nameRow.input.value.trim().slice(0, 60);
      if (!name) { showToast('Type a loadout name first'); return; }
      const i = ex.packs.loadouts.findIndex((l) => l.name === name);
      const entry = { name, ids: [...state.enabled] };
      if (i >= 0) ex.packs.loadouts[i] = entry; else ex.packs.loadouts.push(entry);
      save();
      syncLoadouts(name);
      showToast('Loadout saved: ' + name);
    } }),
    makeButton({ label: 'Apply', onClick: () => {
      const l = ex.packs.loadouts.find((x) => x.name === loadSel.value);
      if (!l) { showToast('Pick a loadout first'); return; }
      const have = new Set(state.packs.map((p) => p.id));
      const ids = l.ids.filter((id) => have.has(id));
      void applyEnabled(ids).then(() => { if (ids.length < l.ids.length) showToast('Some packs of this loadout are not installed any more'); });
    } }),
    makeButton({ label: 'Share', title: 'Copy a code with this loadout', onClick: () => {
      const l = ex.packs.loadouts.find((x) => x.name === loadSel.value);
      if (!l) { showToast('Pick a loadout first'); return; }
      const byId = new Map(state.packs.map((p) => [p.id, p] as const));
      const packs = l.ids.map((id) => byId.get(id)).filter((p): p is PackView => !!p).map((p) => ({ name: p.name, source: p.source }));
      if (!packs.some((p) => p.source)) { showToast('Only packs installed from a link can be shared'); return; }
      void shareCode('loadout', l.name, { packs });
    } }),
    makeButton({ label: 'Delete', onClick: () => {
      const i = ex.packs.loadouts.findIndex((x) => x.name === loadSel.value);
      if (i < 0) return;
      const name = ex.packs.loadouts[i].name;
      ex.packs.loadouts.splice(i, 1);
      save();
      syncLoadouts();
      showToast('Loadout deleted: ' + name);
    } }),
  );
  g.appendChild(lo.row);

  syncLoadouts();
  void refresh();
}

// ── Share codes ──
function buildShareGroup(body: HTMLElement, ex: ExtrasConfig, save: () => void): void {
  const g = createGroup(body, 'Share Codes');
  g.appendChild(createInfoRow('A code is text you can paste in Discord. It contains the data itself, so nothing is uploaded and nobody needs an account. Share a Krunker settings profile, your crosshair or a pack loadout, and import a code someone sent you.'));

  const profSel = createSelect([{ value: '', label: '(no profiles saved)' }], '');
  const syncProf = (): void => {
    profSel.innerHTML = '';
    const opts = ex.settingsProfiles.length ? ex.settingsProfiles.map((p) => ({ value: p.name, label: p.name })) : [{ value: '', label: '(no profiles saved)' }];
    for (const o of opts) { const op = document.createElement('option'); op.value = o.value; op.textContent = o.label; profSel.appendChild(op); }
  };
  syncProf();
  const share = createButtonRow({ label: 'Share', desc: 'Copy a code for a settings profile (Settings Profiles above) or for your current crosshair.', buttons: [] });
  share.control.append(
    profSel,
    makeButton({ label: 'Share profile', onClick: () => {
      const p = ex.settingsProfiles.find((x) => x.name === profSel.value);
      if (!p) { showToast('Pick a profile first'); return; }
      void shareCode('profile', p.name, { data: p.data });
    } }),
    makeButton({ label: 'Share crosshair', onClick: () => { void shareCode('crosshair', 'Crosshair', ex.crosshair); } }),
  );
  g.appendChild(share.row);

  const imp = createTextRow({
    label: 'Import a Code', desc: 'Paste a code you received, then press Import',
    value: '', placeholder: 'KRH1.…', instant: true, onChange: () => { /* read on Import */ },
  });
  g.appendChild(imp.row);
  imp.row.querySelector('.krh-row-control')?.appendChild(makeButton({ label: 'Import', onClick: () => {
    const code = imp.input.value.trim();
    if (!code) { showToast('Paste a code first'); return; }
    void importCode(code, ex, save, syncProf).then((ok) => { if (ok) imp.input.value = ''; });
  } }));
}

async function importCode(code: string, ex: ExtrasConfig, save: () => void, syncProf: () => void): Promise<boolean> {
  const r = await ipcRenderer.invoke('share-decode', code) as
    | { ok: false; error: string }
    | { ok: true; kind: 'profile'; name: string; data: string }
    | { ok: true; kind: 'crosshair'; name: string; data: ExtrasConfig['crosshair'] }
    | { ok: true; kind: 'loadout'; name: string; packs: Array<{ name: string; source: string }> }
    | { ok: true; kind: 'autoprofile'; name: string; rule: ExtrasConfig['autoProfiles']['rules'][number]; presets: ExtrasConfig['settingPresets'] };
  if (!r.ok) { showToast(r.error); return false; }
  if (r.kind === 'profile') {
    let name = r.name.slice(0, 60) || 'Shared profile';
    const taken = new Set(ex.settingsProfiles.map((p) => p.name));
    for (let n = 2; taken.has(name); n++) name = `${r.name.slice(0, 52)} (${n})`;
    if (ex.settingsProfiles.length >= 30) { showToast('You already have 30 profiles. Delete one first.'); return false; }
    ex.settingsProfiles.push({ name, data: r.data });
    save();
    syncProf();
    showToast(`Profile added: ${name}. Load it under Settings Profiles (reopen Settings to see it there).`);
    return true;
  }
  if (r.kind === 'crosshair') {
    ex.crosshair = { ...ex.crosshair, ...r.data, enabled: true };
    save();
    setCrosshair(ex.crosshair);
    showToast('Crosshair imported and switched on. Reopen Settings to see its values.');
    return true;
  }
  if (r.kind === 'autoprofile') {
    if (ex.autoProfiles.rules.length >= 20) { showToast('You already have 20 rules. Delete one first.'); return false; }
    // The presets that came with the rule are added to yours (an identical one you already have is reused); the rule then points at them
    const mapPreset = (oldId: string, scope: 'sensitivity' | 'fov'): string => {
      const src = r.presets.find((p) => p.id === oldId && p.scope === scope);
      if (!src) return '';
      const same = ex.settingPresets.find((p) => p.scope === scope && p.name === src.name && JSON.stringify(p.values) === JSON.stringify(src.values));
      if (same) return same.id;
      if (ex.settingPresets.length >= 40) return '';
      const copy = { ...src, id: 'shared-' + Math.random().toString(36).slice(2, 10) };
      ex.settingPresets.push(copy);
      return copy.id;
    };
    const rule = { ...r.rule, id: 'rule-' + Date.now().toString(36), sensPreset: mapPreset(r.rule.sensPreset, 'sensitivity'), fovPreset: mapPreset(r.rule.fovPreset, 'fov') };
    ex.autoProfiles.rules.push(rule);
    save();
    setAutoProfiles(ex.autoProfiles, ex.settingPresets, ex.crosshair);
    showToast(`Rule added: ${rule.name}. Reopen Settings to see it under Auto Profiles. CSS files named in it only work if you have files with the same names.`);
    return true;
  }
  // loadout: install what is missing, then save it as a loadout
  const state = await ipcRenderer.invoke('packs-list') as PacksState;
  const ids: string[] = [];
  let failed = 0;
  for (const p of r.packs) {
    const have = state.packs.find((x) => x.source && x.source === p.source);
    if (have) { ids.push(have.id); continue; }
    if (!p.source) { failed++; continue; }
    showToast('Downloading ' + p.name + '…');
    const res = await ipcRenderer.invoke('packs-install-url', p.source) as { ok: boolean; pack?: PackView };
    if (res.ok && res.pack) ids.push(res.pack.id); else failed++;
  }
  if (!ids.length) { showToast('None of the packs in this loadout could be installed'); return false; }
  let name = r.name.slice(0, 60) || 'Shared loadout';
  const names = new Set(ex.packs.loadouts.map((l) => l.name));
  for (let n = 2; names.has(name); n++) name = `${r.name.slice(0, 52)} (${n})`;
  if (ex.packs.loadouts.length < 30) { ex.packs.loadouts.push({ name, ids }); save(); }
  showToast(`Loadout "${name}" added${failed ? ` (${failed} pack${failed === 1 ? '' : 's'} could not be installed)` : ''}. Reopen Settings and press Apply.`);
  return true;
}
