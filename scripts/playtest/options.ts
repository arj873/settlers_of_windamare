/** `pt:serve` options -> the game URL's dev params. Pure, unit-tested. */

export const MIN_SEATS = 3;
export const MAX_SEATS = 8;
/** Map names the orchestrator uses. `base56` / `base78` need the 5–8 player boards (s2-boards). */
export const MAPS = ['base', 'baseRandom', 'base56', 'base78'] as const;
export type MapName = (typeof MAPS)[number];

export interface ServeOptions {
  seats: number;
  map: MapName | null;
  seed: string;
  vp: number | null;
  headed: boolean;
  /** Dev query params for the app URL (`?seats=hhh&names=…&debug=1…`). */
  query: Record<string, string>;
}

export const seatNames = (n: number): string[] =>
  Array.from({ length: n }, (_, i) => `Seat${i + 1}`);

/**
 * Validate `pt:serve` flags. Errors are returned, not thrown, so the server can print them.
 * `--map` is always passed through as `?map=`; `base`/`baseRandom` also set today's
 * `?layout=beginner|random`, so the map works on builds that only know `layout`.
 */
export function serveOptions(
  flags: Record<string, string>,
  fallbackSeed: string,
): ServeOptions | { error: string } {
  const seats = flags.seats ? Number(flags.seats) : MIN_SEATS;
  if (!Number.isInteger(seats) || seats < MIN_SEATS || seats > MAX_SEATS) {
    return { error: `--seats must be a whole number from ${MIN_SEATS} to ${MAX_SEATS}` };
  }
  const vp = flags.vp ? Number(flags.vp) : null;
  if (vp !== null && !(Number.isInteger(vp) && vp >= 3 && vp <= 20)) {
    return { error: '--vp must be a whole number from 3 to 20' };
  }
  const timer = flags.timer ? Number(flags.timer) : null;
  if (timer !== null && !(Number.isInteger(timer) && timer >= 5 && timer <= 3600)) {
    return { error: '--timer must be a whole number of seconds from 5 to 3600' };
  }
  let map: MapName | null = null;
  if (flags.map) {
    const found = MAPS.find((m) => m.toLowerCase() === flags.map?.toLowerCase());
    if (!found) return { error: `--map must be one of: ${MAPS.join(', ')}` };
    map = found;
  }
  const layout =
    map === 'base' || flags.layout === 'beginner'
      ? 'beginner'
      : map === 'baseRandom' || flags.layout === 'random' || map === null
        ? 'random'
        : null;
  const seed = flags.seed || fallbackSeed;
  const query: Record<string, string> = {
    seats: 'h'.repeat(seats),
    names: seatNames(seats).join(','),
    seed,
    ...(layout ? { layout } : {}),
    ...(map ? { map } : {}),
    debug: '1',
    ...(vp === null ? {} : { vp: String(vp) }),
    ...(timer === null ? {} : { timer: String(timer) }),
  };
  return { seats, map, seed, vp, headed: 'headed' in flags, query };
}

// ---------------------------------------------------------------------------
// Online (`pt:serve --online`)
// ---------------------------------------------------------------------------

export interface OnlineServeOptions {
  /** Human seats: one browser context each (Seat1..SeatN). */
  humans: number;
  bots: number;
  /** humans + bots = the room's seatCount. */
  total: number;
  map: MapName;
  /** Turn timer in seconds; null = off (the default: LLM players are slow). */
  timer: number | null;
  vp: number | null;
  headed: boolean;
  /** Room server origin to use instead of a local `pnpm dev:server`. */
  remote: string | null;
}

/** Validate `pt:serve --online` flags. Errors are returned, not thrown. */
export function onlineOptions(
  flags: Record<string, string>,
): OnlineServeOptions | { error: string } {
  const humans = flags.seats ? Number(flags.seats) : MIN_SEATS;
  if (!Number.isInteger(humans) || humans < 1 || humans > MAX_SEATS) {
    return { error: `--seats (human seats) must be a whole number from 1 to ${MAX_SEATS}` };
  }
  const bots = flags.bots ? Number(flags.bots) : 0;
  if (!Number.isInteger(bots) || bots < 0 || bots > MAX_SEATS) {
    return { error: `--bots must be a whole number from 0 to ${MAX_SEATS}` };
  }
  const total = humans + bots;
  if (total < MIN_SEATS || total > MAX_SEATS) {
    return { error: `seats + bots must be ${MIN_SEATS} to ${MAX_SEATS} (got ${total})` };
  }
  let map: MapName;
  if (flags.map) {
    const found = MAPS.find((m) => m.toLowerCase() === flags.map?.toLowerCase());
    if (!found) return { error: `--map must be one of: ${MAPS.join(', ')}` };
    map = found;
  } else {
    map = total <= 4 ? 'baseRandom' : total <= 6 ? 'base56' : 'base78';
  }
  const max = map === 'base' || map === 'baseRandom' ? 4 : map === 'base56' ? 6 : 8;
  if (total > max) return { error: `map ${map} seats at most ${max} players (got ${total})` };
  let timer: number | null = null;
  if (flags.timer) {
    timer = Number(flags.timer);
    if (!ONLINE_TIMER_STEPS.includes(timer)) {
      return {
        error: `--timer must be one of ${ONLINE_TIMER_STEPS.join(', ')} seconds (the room allows only these)`,
      };
    }
  }
  const vp = flags.vp ? Number(flags.vp) : null;
  if (vp !== null && !(Number.isInteger(vp) && vp >= 3 && vp <= 20)) {
    return { error: '--vp must be a whole number from 3 to 20' };
  }
  let remote: string | null = null;
  if (flags.remote) {
    try {
      const u = new URL(flags.remote);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('protocol');
      remote = u.origin;
    } catch {
      return { error: '--remote must be an http(s) URL, e.g. http://localhost:8787' };
    }
  }
  return { humans, bots, total, map, timer, vp, headed: 'headed' in flags, remote };
}

/** What the room accepts for `turnTimerSec` (src/ui/setup/model.ts TIMER_STEPS, minus "off"). */
const ONLINE_TIMER_STEPS = [30, 45, 60, 90, 120, 180, 300];
