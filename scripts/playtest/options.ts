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
  };
  return { seats, map, seed, vp, headed: 'headed' in flags, query };
}
