/**
 * Online views (engine/view.ts, docs/EXPANSIONS.md §5): the Seafarers secrets a view may not
 * carry. Hidden from every viewer, game over included (face-down components, not hands):
 *  - fog.terrains / fog.tokens (Fog Islands, §4.7): the face-down hex and number-token stacks
 *    -> FOG_TERRAIN / FOG_TOKEN x length (their sizes are public: the stacks lie on the table);
 *  - gifts[e].card (Forgotten Tribe, §2.6): the development cards dealt face down onto the
 *    board, "not looked at" -> GIFT_CARD (the kind of each gift stays: chits and harbours are
 *    face up; a card back shows it is a development card).
 * Public on purpose: harbours on gift edges and harbours taken but not placed (the tokens are
 * flipped face up at setup, §2.6), ships, the pirate, chits, cloth, the fleet, wonders, the
 * board (New World and variable set-ups are laid face up) and every Seafarers log line (they
 * name no card: "received a gift: a development card"). A gift card in a hand is masked by the
 * base view (newDevCards). The rng that draws future hexes is masked by the base view.
 *
 * Imports types only besides the slice (no engine/view.ts: it would close an import cycle).
 */
import type { DevCardType, EdgeId, GameState, Terrain } from '../../../engine/types';
import type { Viewer } from '../../../engine/viewer';
import { SEAFARERS } from './maps';
import { seaSlice, type Gift, type SeaSlice } from './state';

/** Placeholder of every face-down fog hex: only `fog.terrains.length` is meaningful in a view. */
export const FOG_TERRAIN: Terrain = 'fog';
/** Placeholder of every face-down fog token: only `fog.tokens.length` is meaningful. */
export const FOG_TOKEN = 0;
/** Placeholder of every face-down gift card (same as the base view's hidden dev card). */
export const GIFT_CARD: DevCardType = 'knight';

/** `view` with the fog stacks and the gift cards face down (same shape; inputs untouched). */
export function seaMaskFor(view: GameState, _viewer: Viewer, _state: GameState): GameState {
  const s = seaSlice(view);
  if (!s.fog && !s.gifts) return view;
  const out: SeaSlice = { ...s };
  if (s.fog) {
    out.fog = {
      terrains: s.fog.terrains.map(() => FOG_TERRAIN),
      tokens: s.fog.tokens.map(() => FOG_TOKEN),
    };
  }
  if (s.gifts) {
    const gifts: Record<EdgeId, Gift> = {};
    for (const [e, g] of Object.entries(s.gifts) as [EdgeId, Gift][]) {
      gifts[e] = g.kind === 'dev' ? { kind: 'dev', card: GIFT_CARD } : g;
    }
    out.gifts = gifts;
  }
  return { ...view, ext: { ...view.ext, [SEAFARERS]: out } };
}
