/** `pt:serve` options -> the game URL's dev params. Pure, unit-tested. */
import { listModes, modeById, type ExpansionId, type OptionValue } from '../../src/engine';
import { defaultSetup, playerRange, setMode, setScenario } from '../../src/ui/setup/model';

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
  /** `--mode` / `--scenario`: an expansion game (null = base). Defaults as on the setup screen. */
  expansion: OnlineExpansion | null;
}

export interface OnlineExpansion {
  mode: string;
  scenario: string | null;
  options: Record<ExpansionId, Record<string, OptionValue>>;
  /** The mode / scenario's VP target (`--vp` overrides it). */
  vpToWin: number;
}

/**
 * `--mode ck` / `--mode seafarers --scenario fogIslands` (the `<id>/` prefix may be left out).
 * Validated against the expansion registry and the seat count.
 */
function expansionOf(
  flags: Record<string, string>,
  total: number,
): OnlineExpansion | null | { error: string } {
  if (!flags.mode || flags.mode === 'base') {
    return flags.scenario ? { error: '--scenario needs an expansion --mode' } : null;
  }
  const mode = modeById(flags.mode);
  if (!mode) {
    const ids = listModes().map((m) => m.id);
    return { error: `--mode must be one of: ${ids.join(', ')}` };
  }
  let d = setMode(defaultSetup(Math.min(Math.max(total, 3), 8)), mode.id);
  if (flags.scenario) {
    const want = flags.scenario.toLowerCase();
    const id = mode.scenarios.find(
      (s) => s.toLowerCase() === want || s.split('/')[1]?.toLowerCase() === want,
    );
    if (!id) {
      return { error: `--scenario for ${mode.id} must be one of: ${mode.scenarios.join(', ')}` };
    }
    d = setScenario(d, id);
  }
  const range = playerRange(d);
  if (total < range.min || total > range.max) {
    return { error: `${mode.name} seats ${range.min} to ${range.max} players (got ${total})` };
  }
  return { mode: mode.id, scenario: d.scenario, options: d.options, vpToWin: d.vpToWin };
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
  const expansion = expansionOf(flags, total);
  if (expansion && 'error' in expansion) return expansion;
  const minSeats = expansion ? 2 : MIN_SEATS;
  if (total < minSeats || total > MAX_SEATS) {
    return { error: `seats + bots must be ${minSeats} to ${MAX_SEATS} (got ${total})` };
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
  // Expansion modes play their scenario's map; the base map only has to exist.
  if (!expansion && total > max)
    return { error: `map ${map} seats at most ${max} players (got ${total})` };
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
  return { humans, bots, total, map, timer, vp, headed: 'headed' in flags, remote, expansion };
}

/** What the room accepts for `turnTimerSec` (src/ui/setup/model.ts TIMER_STEPS, minus "off"). */
const ONLINE_TIMER_STEPS = [30, 45, 60, 90, 120, 180, 300];
