// The server region of the game you are in: the letters before the colon of the game id in the address (FRA:abc123 -> FRA).
export function gameRegion(): string {
  try {
    return (/^([A-Za-z]{2,5}):/.exec(new URLSearchParams(location.search).get('game') || '')?.[1] ?? '').toUpperCase();
  } catch { return ''; }
}
