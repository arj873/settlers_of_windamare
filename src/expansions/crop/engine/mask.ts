/**
 * Crop Trust online views (`maskFor`, docs/EXPANSIONS.md §5; engine/view.ts).
 *
 * Event tokens are face down until revealed (docs/rules/crop-trust.md rules 5 and 8): the supply
 * stack, the token under each unbuilt settlement / city piece and the tokens on the Longest Road /
 * Largest Army cards. No one (the owner of a piece included) looks at them, so every viewer gets
 * a same-length list of HIDDEN_EVENT placeholders: the counts stay public. `used` (revealed) and
 * everything else in the slice (crops, supply, vaults, records) is public.
 */
import type { GameState } from '../../../engine/types';
import type { Viewer } from '../../../engine/viewer';
import { CROP, cropSlice, type CropEvent, type CropSlice } from './state';

/** Placeholder of every face-down event token. */
export const HIDDEN_EVENT: CropEvent = { k: 'mono' };

const down = (tokens: readonly CropEvent[]): CropEvent[] => tokens.map(() => ({ ...HIDDEN_EVENT }));

export function cropMaskFor(view: GameState, _viewer: Viewer, _state: GameState): GameState {
  if (!view.ext[CROP]) return view;
  const s = cropSlice(view);
  const out: CropSlice = {
    ...s,
    stack: down(s.stack),
    pieces: s.pieces.map((p) => ({ settlement: down(p.settlement), city: down(p.city) })),
    cards: {
      longestRoad: s.cards.longestRoad && { ...HIDDEN_EVENT },
      largestArmy: s.cards.largestArmy && { ...HIDDEN_EVENT },
    },
  };
  return { ...view, ext: { ...view.ext, [CROP]: out } };
}
