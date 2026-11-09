// ── Session list as CSV ──
// Turns the saved sessions into a CSV file for a spreadsheet. Names of maps and classes come from the game, so every
// cell is protected against spreadsheet formulas (a cell starting with = + - @ gets a leading apostrophe) and quoted
// the way RFC 4180 asks. Pure functions only.

export interface CsvSession {
  start: number;
  end: number;
  kills: number;
  deaths: number;
  seconds: number;
  matches: number;
  bestStreak: number;
  maps: Record<string, number>;
  classes: Record<string, { k: number; d: number }>;
  mapKd: Record<string, { k: number; d: number }>;
  /** Label chosen for the session, if any. */
  tag?: string;
}

export const CSV_COLUMNS = ['start', 'end', 'label', 'minutes', 'kills', 'deaths', 'kd', 'matches', 'best_streak', 'top_map', 'maps_played', 'kd_by_class', 'kd_by_map'] as const;

export function csvCell(value: string | number): string {
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
  return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

function localStamp(ms: number): string {
  const d = new Date(ms);
  const p = (n: number): string => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

function ratio(kills: number, deaths: number): string {
  return deaths > 0 ? (kills / deaths).toFixed(2) : kills > 0 ? kills.toFixed(2) : '0.00';
}

function joinKd(m: Record<string, { k: number; d: number }>): string {
  return Object.entries(m).map(([name, v]) => name + ' ' + v.k + '/' + v.d).join('; ');
}

export function sessionsToCsv(sessions: readonly CsvSession[]): string {
  const lines = [CSV_COLUMNS.join(',')];
  for (const s of sessions) {
    let top = '';
    let topN = 0;
    for (const [name, n] of Object.entries(s.maps)) if (n > topN) { top = name; topN = n; }
    lines.push([
      localStamp(s.start), localStamp(s.end), s.tag ?? '', Math.round(s.seconds / 60), s.kills, s.deaths, ratio(s.kills, s.deaths), s.matches, s.bestStreak,
      top, Object.entries(s.maps).map(([name, n]) => name + ' x' + n).join('; '), joinKd(s.classes), joinKd(s.mapKd),
    ].map(csvCell).join(','));
  }
  return lines.join('\r\n') + '\r\n';
}
