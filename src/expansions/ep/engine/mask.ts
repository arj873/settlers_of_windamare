/**
 * Explorers & Pirates online views (docs/EXPANSIONS.md §5, `maskFor`): the module's secrets are
 * all face-down components nobody has seen (rules doc §2.2 steps 3-4, §4.3, §4.8), so they are
 * hidden from every viewer, also once the game is over (stacks stay hidden):
 *  - `hidden` (what each face-down hex is: terrain, shoal face, spice farm kind and number; in
 *    Fish 3-4 also which parrot shoal was returned unseen)  -> HIDDEN_CONTENT per hex (the set of
 *    face-down hexes is public: their backs lie on the board)
 *  - `discs.parrot` / `discs.goose` (face-down number disc stacks)  -> HIDDEN_DISC x length
 *  - `lairTokens` (face-down lair token stack)                      -> HIDDEN_LAIR_TOKEN x length
 *  - `lairs[h].token` of an uncaptured lair (placed "without looking at the number", §4.3)
 *                                                                   -> HIDDEN_LAIR_TOKEN
 * Public: gold (§10 E1), ships and their cargo, harbors and basins, explored shoals, hauls,
 * spice farms and sacks, lair crews, the pirate, mission tracks, the board (face-down hexes carry
 * only their region back, `ep/parrot` / `ep/goose`, and no token) and the log (a discovery is
 * logged when the hex is turned over; a lair's number when it is flipped on capture; the pirate's
 * steal names no card). E&P has no per-seat secret beyond the base hand.
 */
import type { GameState, Terrain } from '../../../engine/types';
import type { Viewer } from '../../../engine/viewer';
import { EP, type EpSlice, type Hidden, type Lair } from './state';

/** Placeholder terrain of a face-down hex in a view (not a real terrain). */
export const HIDDEN_TERRAIN: Terrain = 'ep/hidden';
/** Placeholder of every face-down hex's content; only the keys of `hidden` are meaningful. */
export const HIDDEN_CONTENT: Readonly<Hidden> = { terrain: HIDDEN_TERRAIN };
/** Placeholder of every face-down number disc; only the stack lengths are meaningful. */
export const HIDDEN_DISC = 0;
/** Placeholder of every face-down lair token (stack and uncaptured lairs). */
export const HIDDEN_LAIR_TOKEN = 0;

export function maskEp(view: GameState, _viewer: Viewer, _state: GameState): GameState {
  const s = view.ext[EP] as EpSlice | undefined;
  if (!s) return view;
  const hidden: Record<string, Hidden> = {};
  for (const h of Object.keys(s.hidden)) hidden[h] = { ...HIDDEN_CONTENT };
  const lairs: Record<string, Lair> = {};
  for (const [h, lair] of Object.entries(s.lairs)) {
    lairs[h] = lair.captured ? lair : { ...lair, token: HIDDEN_LAIR_TOKEN };
  }
  const masked: EpSlice = {
    ...s,
    hidden: hidden as EpSlice['hidden'],
    discs: {
      parrot: s.discs.parrot.map(() => HIDDEN_DISC),
      goose: s.discs.goose.map(() => HIDDEN_DISC),
    },
    lairTokens: s.lairTokens.map(() => HIDDEN_LAIR_TOKEN),
    lairs: lairs as EpSlice['lairs'],
  };
  return { ...view, ext: { ...view.ext, [EP]: masked } };
}
