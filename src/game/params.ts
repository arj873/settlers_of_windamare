/** Dev query parameters. */
import type { Layout } from '../engine';
import type { Controller } from '../ui';

export interface DevParams {
  /** `?fixture=midGame`: load an engine fixture (all seats human unless `?seats`). */
  fixture: string | null;
  /** `?seed=…` / `?layout=beginner|random`: start a game right away (skips the new-game screen). */
  seed: string | null;
  layout: Layout | null;
  /** `?autoplay=4bots` (or `3bots`): all-bot game, no autosave. */
  autoplay: 3 | 4 | null;
  /** `?speed=ms`: bot delay per move; 0 = instant. */
  speed: number | null;
  /** `?vp=5`: points to win (new games started from params). */
  vpToWin: number | null;
  /** `?seats=hbbb`: h = human, b = bot, per seat. */
  seats: Controller[] | null;
  /** `?hl=vertices|edges|hexes`: board highlight preview (render dev aid). */
  hl: 'vertices' | 'edges' | 'hexes' | null;
  /** `?names=Ann,Bob,Cy`: player names for games started from params (count must match). */
  names: string[] | null;
  /** `?debug=1`: install the read-only `window.__catanDebug` hook (playtest harness). */
  debug: boolean;
}

export function parseParams(search: string): DevParams {
  const p = new URLSearchParams(search);
  const num = (key: string, min: number, max: number): number | null => {
    const raw = p.get(key);
    if (raw === null || raw.trim() === '') return null;
    const n = Number(raw);
    return Number.isFinite(n) && n >= min && n <= max ? n : null;
  };
  const layout = p.get('layout');
  const auto = /^([34])bots?$/.exec(p.get('autoplay') ?? '');
  const seats = /^[hb]{3,4}$/.exec(p.get('seats') ?? '');
  const hl = p.get('hl');
  const names = (p.get('names') ?? '')
    .split(',')
    .map((s) => s.trim().slice(0, 16))
    .filter(Boolean);
  return {
    fixture: p.get('fixture'),
    seed: p.get('seed'),
    layout: layout === 'beginner' || layout === 'random' ? layout : null,
    autoplay: auto ? (Number(auto[1]) as 3 | 4) : null,
    speed: num('speed', 0, 60000),
    vpToWin: num('vp', 3, 20),
    seats: seats ? [...seats[0]].map((c) => (c === 'h' ? 'human' : 'bot')) : null,
    hl: hl === 'vertices' || hl === 'edges' || hl === 'hexes' ? hl : null,
    names: names.length > 0 ? names : null,
    debug: p.get('debug') === '1',
  };
}
