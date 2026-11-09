// ── Session stats tracker ──
// Counts what happens on this page and reports small deltas to the main process, which keeps the session
// and the history (see src/main/session-stats.ts).
//   kills   - the game's own "you got a kill" frame (event 6, same signal the headshot sound uses)
//   deaths  - #uiBase gets the onDeathScrn class when you die
//   seconds - time spent in a match (not in the menu, not spectating)
//   matches - a new ?game= id while in a match, then one more every 4 min match + 20 s break in the same lobby; each map is counted once
// Also fires the optional kill-streak clip (instant replay) and shows the stats panel on a key.

import { ipcRenderer } from 'electron';
import { onGameFrame } from './game-socket';
import { matchCombo, typingInField } from './hotkey';
import { showToast } from './utils';
import { savedConsole as _console } from './saved-console';
import { breakDue } from '../shared/stats-compare';

export interface TrackerOptions {
  enabled: boolean;
  key: string;
  /** Save an instant replay clip at this kill streak (0 = off). */
  autoStreak: number;
  /** Kills per day to aim for (0 = off). */
  dailyKillGoal: number;
  /** Minutes of play after which a break is suggested (0 = off). */
  breakMinutes: number;
}

interface KD { k: number; d: number }
interface Delta { kills: number; deaths: number; seconds: number; matches: number; bestStreak: number; maps: Record<string, number>; classes: Record<string, KD>; mapKd: Record<string, KD> }

const PANEL_ID = 'krh-stats-panel';
const FLUSH_MS = 20_000;
const TICK_MS = 1000;

let started = false;
let opts: TrackerOptions = { enabled: true, key: 'Ctrl+Alt+K', autoStreak: 0, dailyKillGoal: 0, breakMinutes: 0 };
let delta: Delta = fresh();
let streak = 0;
let wasDead = false;
let lastGame = '';
let mapPending = false;
// Krunker plays matches of 4 minutes with a 20 second break, again and again in the same lobby, so the page (and
// the ?game= id) does not change between them. Matches are counted from the time spent in the lobby instead.
const MATCH_CYCLE_MS = (240 + 20) * 1000;
const MAP_SETTLE_MS = 8000; // a new match picks its map right when it starts: read it a few seconds later
let gameJoinedAt = 0;
let matchesCounted = 0;
let mapAt = 0;

function fresh(): Delta { return { kills: 0, deaths: 0, seconds: 0, matches: 0, bestStreak: 0, maps: {}, classes: {}, mapKd: {} }; }

function flush(): void {
  const d = delta;
  if (!d.kills && !d.deaths && !d.seconds && !d.matches) return;
  delta = fresh();
  try { ipcRenderer.send('session-stats-delta', d); } catch { /* page is going away */ }
}

function inMatch(): boolean {
  const ui = document.getElementById('uiBase');
  if (!ui || ui.className === 'onMenu') return false;
  return !(window as unknown as { spectating?: boolean }).spectating;
}

function currentMap(): string {
  try {
    const ga = (window as unknown as { getGameActivity?: () => { map?: unknown } }).getGameActivity?.();
    return typeof ga?.map === 'string' ? ga.map.trim() : '';
  } catch { return ''; }
}

function currentClass(): string {
  try {
    const ga = (window as unknown as { getGameActivity?: () => { class?: { name?: unknown } } }).getGameActivity?.();
    const n = ga?.class?.name;
    return typeof n === 'string' ? n.trim() : '';
  } catch { return ''; }
}

/** Counts a kill (`k`) or death (`d`) for the class played and the map it happened on. */
function tally(which: 'k' | 'd'): void {
  const c = currentClass();
  if (c) (delta.classes[c] ??= { k: 0, d: 0 })[which]++;
  const m = currentMap();
  if (m) (delta.mapKd[m] ??= { k: 0, d: 0 })[which]++;
}

// ── Daily goal and break reminder ──
let deathsSinceLoad = 0;
let todayBase = -1;       // kills already saved today when the page loaded (-1 = not read yet)
let killsSinceLoad = 0;
let playedRun = 0;        // seconds of play since the last real pause
let pausedFor = 0;        // seconds outside a match
let nextBreakAt = 0;      // seconds of play at which the next break message is due
const PAUSE_RESETS_RUN_S = 300;

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function loadTodayBase(): Promise<void> {
  try {
    const v = await ipcRenderer.invoke('session-stats-get') as { days?: Array<{ day: string; kills: number }> };
    const t = v?.days?.find((d) => d.day === todayKey());
    todayBase = t ? t.kills : 0;
  } catch { todayBase = -1; }
}

function checkGoal(): void {
  if (opts.dailyKillGoal <= 0 || todayBase < 0) return;
  const total = todayBase + killsSinceLoad;
  if (total < opts.dailyKillGoal) return;
  const day = todayKey();
  try {
    if (localStorage.getItem('krh_goal_day') === day) return;
    localStorage.setItem('krh_goal_day', day);
  } catch { /* storage blocked: the message may repeat after a reload */ }
  showToast(`Daily goal reached: ${total} kills today (goal ${opts.dailyKillGoal})`);
}

function checkBreak(match: boolean): void {
  if (opts.breakMinutes <= 0) return;
  if (!match) {
    pausedFor++;
    if (pausedFor >= PAUSE_RESETS_RUN_S) { playedRun = 0; nextBreakAt = 0; }
    return;
  }
  pausedFor = 0;
  playedRun++;
  if (nextBreakAt === 0) nextBreakAt = opts.breakMinutes * 60;
  if (breakDue(playedRun, opts.breakMinutes, nextBreakAt)) {
    showToast(`You have been playing for ${Math.round(playedRun / 60)} min. Time for a short break?`);
    nextBreakAt = playedRun + opts.breakMinutes * 60; // ask again after another full interval
  }
}

/** Kills and deaths counted since the page loaded (they only grow; the play monitor takes the difference between two readings). */
export function getCounts(): { kills: number; deaths: number } {
  return { kills: killsSinceLoad, deaths: deathsSinceLoad };
}

/** What a saved replay clip is named after: the map, the class and the kill streak at this moment. */
export function clipContext(streakNow: number = streak): { map: string; cls: string; streak: number } {
  try {
    const ga = (window as unknown as { getGameActivity?: () => { map?: unknown; class?: { name?: unknown } } }).getGameActivity?.();
    return { map: typeof ga?.map === 'string' ? ga.map : '', cls: typeof ga?.class?.name === 'string' ? ga.class.name : '', streak: streakNow };
  } catch { return { map: '', cls: '', streak: streakNow }; }
}

function onKill(): void {
  delta.kills++;
  killsSinceLoad++;
  checkGoal();
  tally('k');
  streak++;
  if (streak > delta.bestStreak) delta.bestStreak = streak;
  if (opts.autoStreak > 0 && streak === opts.autoStreak) {
    // a moment later, so the clip also shows the end of the streak
    const reached = streak;
    setTimeout(() => { void ipcRenderer.invoke('replay-save', clipContext(reached)); }, 2500);
  }
}

function tick(): void {
  const ui = document.getElementById('uiBase');
  const match = inMatch();
  const dead = !!ui && ui.classList.contains('onDeathScrn');
  if (match && dead && !wasDead) { delta.deaths++; deathsSinceLoad++; tally('d'); streak = 0; }
  wasDead = dead;
  checkBreak(match);
  if (!match) { lastGame = ''; mapPending = false; matchesCounted = 0; return; }
  if (document.visibilityState === 'visible') delta.seconds++;
  const now = Date.now();
  const gid = new URLSearchParams(location.search).get('game') || '';
  if (gid && gid !== lastGame) {
    lastGame = gid; gameJoinedAt = now; matchesCounted = 1; delta.matches++; mapPending = true; mapAt = now;
  } else if (gid && gameJoinedAt) {
    // every full cycle (4 min match + 20 s break) a new match has started in this lobby
    const should = 1 + Math.floor((now - gameJoinedAt) / MATCH_CYCLE_MS);
    if (should > matchesCounted) {
      delta.matches += Math.min(should - matchesCounted, 5);
      matchesCounted = should;
      mapPending = true;
      mapAt = now + MAP_SETTLE_MS;
    }
  }
  if (mapPending && now >= mapAt) {
    const m = currentMap();
    if (m) { delta.maps[m] = (delta.maps[m] || 0) + 1; mapPending = false; }
  }
}

// ── Stats panel ──
interface Rec { kills: number; deaths: number; seconds: number; matches: number; bestStreak: number; maps: Record<string, number>; start: number }
interface NamedKd { name: string; k: number; d: number }
interface StatsView {
  current: Rec | null; recent: Rec[];
  total: { kills: number; deaths: number; seconds: number; matches: number; sessions: number; bestStreak: number };
  days: Array<{ day: string; kills: number; deaths: number; seconds: number }>;
  classes: NamedKd[]; mapsKd: NamedKd[];
  timeOfDay: HourRow[]; weekdays: HourRow[]; bestTime: string; bestDay: string;
  tag: string; tags: string[]; byTag: Array<{ tag: string; kills: number; deaths: number; sessions: number; kd: number; kph: number }>;
}
interface HourRow { label: string; kills: number; deaths: number; sessions: number; kd: number; kph: number }

function kd(r: { kills: number; deaths: number }): string {
  return r.deaths > 0 ? (r.kills / r.deaths).toFixed(2) : r.kills.toFixed(2);
}
function dur(sec: number): string {
  const m = Math.round(sec / 60);
  return m < 1 ? '<1 min' : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}
function topMap(r: Rec): string {
  let best = '', n = 0;
  for (const [k, v] of Object.entries(r.maps)) if (v > n) { best = k; n = v; }
  return best || '-';
}

function kdSection(heading: string, list: NamedKd[], esc: (t: string) => string, title: (t: string) => string, row: (a: string, b: string) => string): string {
  if (!list.length) return '';
  return title(heading) + list.map((r) => row(esc(r.name), `${r.k} / ${r.d} (K/D ${kd({ kills: r.k, deaths: r.d })})`)).join('');
}

/** Seven small bars: kills per day for the last week (built from numbers only, nothing from the page goes in as markup). */
function weekChart(days: StatsView['days'], title: (t: string) => string): string {
  const max = Math.max(1, ...days.map((d) => d.kills));
  const bars = days.map((d) => {
    const h = Math.round((d.kills / max) * 56);
    const label = d.day.slice(5);
    return `<div style="flex:1;text-align:center;font-size:11px;opacity:.85"><div style="height:60px;display:flex;align-items:flex-end;justify-content:center"><div title="${d.kills} kills, ${d.deaths} deaths" style="width:70%;height:${Math.max(2, h)}px;background:linear-gradient(180deg,#38c8ff,#1f6fe0);border-radius:3px 3px 0 0"></div></div>${d.kills}<div style="opacity:.6">${label}</div><div style="opacity:.6">${d.kills || d.deaths ? 'K/D ' + kd(d) : '-'}</div></div>`;
  }).join('');
  return title('Kills, last 7 days') + `<div style="display:flex;gap:6px;margin-top:4px">${bars}</div>`;
}

/** When you play best: K/D and kills per hour by part of the day and by weekday, by session start. Only blocks with sessions are listed. */
function hoursSection(v: StatsView, esc: (t: string) => string, title: (t: string) => string, row: (a: string, b: string) => string): string {
  const list = (rows: HourRow[], best: string): string => rows.filter((r) => r.sessions > 0).map((r) => row(esc(r.label) + (r.label === best ? ' (best)' : ''), `K/D ${r.kd.toFixed(2)} · ${Math.round(r.kph)} kills/h · ${r.sessions} session${r.sessions === 1 ? '' : 's'}`)).join('');
  const a = list(v.timeOfDay ?? [], v.bestTime);
  const b = list(v.weekdays ?? [], v.bestDay);
  if (!a && !b) return '';
  return title('When you play best') + '<div style="opacity:.6;font-size:12px;margin-bottom:2px">By when a session started. "Best" needs 3 sessions and 30 minutes in at least two blocks.</div>' + a + (a && b ? '<div style="height:8px"></div>' : '') + b;
}

/** Totals per label, shown once at least one session has a label. */
function tagSection(v: StatsView, esc: (t: string) => string, title: (t: string) => string, row: (a: string, b: string) => string): string {
  const rows = v.byTag ?? [];
  if (!rows.some((r) => r.tag)) return '';
  return title('By label') + rows.map((r) => row(esc(r.tag || 'No label'), `K/D ${r.kd.toFixed(2)} · ${Math.round(r.kph)} kills/h · ${r.sessions} session${r.sessions === 1 ? '' : 's'}`)).join('');
}

export function closeStatsPanel(): void {
  document.getElementById(PANEL_ID)?.remove();
}

export async function toggleStatsPanel(): Promise<void> {
  if (document.getElementById(PANEL_ID)) { closeStatsPanel(); return; }
  flush();
  let v: StatsView;
  try { v = await ipcRenderer.invoke('session-stats-get'); } catch { showToast('Could not read session stats'); return; }
  if (document.pointerLockElement) document.exitPointerLock();
  const cur = v.current;
  const box = document.createElement('div');
  box.id = PANEL_ID;
  box.style.cssText = 'position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.55);font-family:inherit;color:#fff;';
  const card = document.createElement('div');
  card.style.cssText = 'width:min(520px,92vw);background:rgba(10,16,34,0.97);border:1px solid rgba(120,170,255,0.35);border-radius:14px;padding:18px 20px;max-height:90vh;overflow-y:auto;box-shadow:0 14px 50px rgba(0,0,0,0.6);';
  const row = (a: string, b: string): string => `<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid rgba(255,255,255,0.07)"><span style="opacity:.7">${a}</span><b>${b}</b></div>`;
  const esc = (t: string): string => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
  const title = (t: string): string => `<div style="margin:14px 0 4px;font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:#38c8ff">${t}</div>`;
  let html = '<div style="font-size:20px;font-weight:bold;margin-bottom:2px">Session stats</div><div style="opacity:.6;font-size:13px">Kept on this computer only</div>';
  // Label for this and the next sessions (ranked, scrim ...): the statistics below are also grouped by label
  const tagOptions = ['<option value="">No label</option>', ...(v.tags ?? []).map((t) => `<option value="${esc(t)}"${t.toLowerCase() === (v.tag ?? '').toLowerCase() ? ' selected' : ''}>${esc(t)}</option>`)].join('');
  html += '<div style="display:flex;gap:8px;align-items:center;margin-top:10px;flex-wrap:wrap"><span style="opacity:.7">Label</span>'
    + `<select id="krhStatsTag" style="background:rgba(255,255,255,0.1);color:#fff;border:1px solid rgba(255,255,255,0.2);border-radius:6px;padding:4px 8px">${tagOptions}</select>`
    + '<input id="krhStatsTagNew" maxlength="20" placeholder="new label, Enter" style="background:rgba(255,255,255,0.1);color:#fff;border:1px solid rgba(255,255,255,0.2);border-radius:6px;padding:4px 8px;width:140px">'
    + '<span style="opacity:.5;font-size:12px">applies to this and the next sessions</span></div>';
  html += title('This session');
  html += cur
    ? row('Kills / deaths', `${cur.kills} / ${cur.deaths} (K/D ${kd(cur)})`) + row('Play time', dur(cur.seconds)) + row('Matches', String(cur.matches)) + row('Best kill streak', String(cur.bestStreak)) + row('Most played map', esc(topMap(cur)))
    : '<div style="opacity:.6;padding:6px 0">Nothing yet. Play a match.</div>';
  if (opts.dailyKillGoal > 0) {
    const today = v.days.find((d) => d.day === todayKey());
    const got = today ? today.kills : 0;
    html += title('Daily goal') + row('Kills today', `${got} / ${opts.dailyKillGoal}` + (got >= opts.dailyKillGoal ? ' (reached)' : ''));
  }
  html += title(`All time (${v.total.sessions} session${v.total.sessions === 1 ? '' : 's'})`);
  html += row('Kills / deaths', `${v.total.kills} / ${v.total.deaths} (K/D ${kd(v.total)})`) + row('Play time', dur(v.total.seconds)) + row('Matches', String(v.total.matches)) + row('Best kill streak', String(v.total.bestStreak));
  if (v.recent.length) {
    html += title('Recent sessions');
    html += '<div style="max-height:190px;overflow-y:auto">';
    for (const r of v.recent.slice(0, 10)) {
      const when = new Date(r.start);
      html += row(when.toLocaleDateString() + ' ' + when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), `${r.kills}/${r.deaths} · K/D ${kd(r)} · ${dur(r.seconds)} · ${r.matches} m · ${esc(topMap(r))}`);
    }
    html += '</div>';
  }
  html += kdSection('K/D by class', v.classes, esc, title, row);
  html += kdSection('K/D by map', v.mapsKd, esc, title, row);
  html += weekChart(v.days, title);
  html += hoursSection(v, esc, title, row);
  html += tagSection(v, esc, title, row);
  html += '<div style="display:flex;gap:10px;justify-content:flex-end;margin-top:16px"><button id="krhStatsExport" style="border:0;border-radius:8px;padding:8px 14px;cursor:pointer;color:#fff;background:rgba(255,255,255,0.12)">Export CSV</button><button id="krhStatsClear" style="border:0;border-radius:8px;padding:8px 14px;cursor:pointer;color:#fff;background:rgba(255,255,255,0.12)">Clear history</button><button id="krhStatsClose" style="border:0;border-radius:8px;padding:8px 18px;cursor:pointer;color:#fff;font-weight:bold;background:linear-gradient(90deg,#1f6fe0,#38c8ff)">Close</button></div>';
  card.innerHTML = html;
  box.appendChild(card);
  box.addEventListener('mousedown', (e) => { if (e.target === box) closeStatsPanel(); });
  document.body.appendChild(box);
  card.querySelector('#krhStatsClose')?.addEventListener('click', closeStatsPanel);
  const setTag = (value: string): void => {
    void ipcRenderer.invoke('session-stats-tag', value).then((t: string) => {
      showToast(t ? `Label: ${t}` : 'Label removed');
      closeStatsPanel();
      void toggleStatsPanel();
    });
  };
  card.querySelector('#krhStatsTag')?.addEventListener('change', (e) => setTag((e.target as HTMLSelectElement).value));
  card.querySelector('#krhStatsTagNew')?.addEventListener('keydown', (e) => {
    const ke = e as KeyboardEvent;
    ke.stopPropagation();
    if (ke.key === 'Enter') { const t = (e.target as HTMLInputElement).value.trim(); if (t) setTag(t); }
  });
  card.querySelector('#krhStatsExport')?.addEventListener('click', () => {
    void ipcRenderer.invoke('session-stats-export').then((r: { ok?: boolean; count?: number; error?: string } | null) => {
      if (r?.ok) showToast('Exported ' + (r.count ?? 0) + ' sessions to CSV');
      else if (r?.error) showToast(r.error);
    });
  });
  card.querySelector('#krhStatsClear')?.addEventListener('click', () => {
    void ipcRenderer.invoke('session-stats-clear').then(() => { closeStatsPanel(); showToast('Session history cleared'); });
  });
}

export function initSessionTracker(o: TrackerOptions): void {
  opts = o;
  if (started) return;
  started = true;
  if (!o.enabled) return;
  if (o.dailyKillGoal > 0) void loadTodayBase();
  onGameFrame((event) => { if (event === '6') onKill(); });
  setInterval(tick, TICK_MS);
  setInterval(flush, FLUSH_MS);
  window.addEventListener('pagehide', flush);
  _console.log('[KRH-Stats] session tracker running');
  window.addEventListener('keydown', (e) => {
    if (e.repeat || typingInField(e)) return;
    if (e.key === 'Escape' && document.getElementById(PANEL_ID)) { closeStatsPanel(); return; }
    if (opts.key && matchCombo(e, opts.key)) { e.preventDefault(); e.stopPropagation(); void toggleStatsPanel(); }
  }, true);
}
