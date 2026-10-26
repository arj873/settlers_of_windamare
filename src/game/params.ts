/** Dev query parameters. */
import { isMapId, modeById, scenarioById, type Layout, type MapId } from '../engine';
import type { Controller } from '../ui';

export interface DevParams {
  /** `?fixture=midGame`: load an engine fixture (all seats human unless `?seats`). */
  fixture: string | null;
  /** `?seed=…` / `?layout=beginner|random` / `?map=base56`: start a game right away (skips the new-game screen). */
  seed: string | null;
  layout: Layout | null;
  map: MapId | null;
  /** `?autoplay=4bots` (3..8): all-bot game, no autosave. */
  autoplay: number | null;
  /** `?speed=ms`: bot delay per move; 0 = instant. */
  speed: number | null;
  /** `?vp=5`: points to win (new games started from params). */
  vpToWin: number | null;
  /** `?timer=20`: turn timer in seconds (games started from params; also on a `?fixture`). */
  timer: number | null;
  /** `?first=0`: starting seat as a PlayerId (0-based) for games started from params. Default: random. */
  first: number | null;
  /** `?seats=hbbb`: h = human, b = bot, per seat. */
  seats: Controller[] | null;
  /** `?hl=vertices|edges|hexes`: board highlight preview (render dev aid). */
  hl: 'vertices' | 'edges' | 'hexes' | null;
  /** `?names=Ann,Bob,Cy`: player names for games started from params (count must match). */
  names: string[] | null;
  /** `?debug=1`: install the read-only `window.__catanDebug` hook (playtest harness). */
  debug: boolean;
  /** `?mode=demo`: start an expansion mode at once (its first scenario; docs/EXPANSIONS.md). */
  mode: string | null;
  /** `?scenario=tb/traders`: with `?mode=`, one of the mode's scenarios (E4). */
  scenario: string | null;
}

export function parseParams(search: string): DevParams {
  const p = new URLSearchParams(search);
  const num = (key: string, min: number, max: number): number | null => {
    const raw = p.get(key);
    if (raw === null || raw.trim() === '') return null;
    const n = Number(raw);
    return Number.isFinite(n) && n >= min && n <= max ? n : null;
  };
  const integer = (n: number | null) => (n !== null && Number.isInteger(n) ? n : null);
  const layout = p.get('layout');
  const map = p.get('map');
  // 2 seats only make sense in a mode that allows them (createGame checks; T&B Catan for Two).
  const auto = /^([2-8])bots?$/.exec(p.get('autoplay') ?? '');
  const seats = /^[hb]{2,8}$/.exec(p.get('seats') ?? '');
  const hl = p.get('hl');
  const names = (p.get('names') ?? '')
    .split(',')
    .map((s) => s.trim().slice(0, 16))
    .filter(Boolean);
  return {
    fixture: p.get('fixture'),
    seed: p.get('seed'),
    layout: layout === 'beginner' || layout === 'random' ? layout : null,
    map: isMapId(map) ? map : null,
    autoplay: auto ? Number(auto[1]) : null,
    speed: num('speed', 0, 60000),
    vpToWin: num('vp', 3, 20),
    timer: integer(num('timer', 1, 3600)),
    first: integer(num('first', 0, 7)),
    seats: seats ? [...seats[0]].map((c) => (c === 'h' ? 'human' : 'bot')) : null,
    hl: hl === 'vertices' || hl === 'edges' || hl === 'hexes' ? hl : null,
    names: names.length > 0 ? names : null,
    debug: p.get('debug') === '1',
    mode: modeById(p.get('mode') ?? '') ? p.get('mode') : null,
    scenario: scenarioById(p.get('scenario') ?? '') ? p.get('scenario') : null,
  };
}
