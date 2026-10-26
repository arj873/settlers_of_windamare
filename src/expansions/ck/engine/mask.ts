/**
 * Cities & Knights online views (`maskFor`, docs/EXPANSIONS.md §5; engine/view.ts). Runs after
 * the base masks, so the base hands are already zeroed for other seats.
 *
 * Masked (for everyone but the owner, until the game is over; a spectator owns nothing):
 *  - players[p].progress (progress cards in hand) -> HIDDEN_PROGRESS_CARD x length
 *  - players[p].commodities (the per-type split)   -> all 0; the total is in `commodityCounts`
 * Masked for everyone, game over included:
 *  - decks (order and composition of the three stacks) -> HIDDEN_PROGRESS_CARD x length
 * Public: improvements, revealed VP cards, Defender cards, knights, walls, barbarians, attacks,
 * metropolises, the merchant, the commodity bank, the event die, per-turn flags, the commodity
 * part of an open trade offer. The log never names a secretly drawn or stolen card ("drew a
 * science progress card", "took a progress card from ..."), so it needs no rewriting.
 *
 * Reveals to one seat (the rules let that player look):
 *  - Spy, victim chosen: the current player sees the victim's progress cards;
 *  - Master Merchant, victim chosen: the current player sees the victim's resources and
 *    commodities (the base mask zeroed the resources; they are restored from `state`).
 *
 * Pure; shares every unchanged part with `view`, mutates neither argument.
 */
import type { GameState, PlayerId } from '../../../engine/types';
import { hiddenFrom, type Viewer } from '../../../engine/viewer';
import {
  CK,
  commodityTotal,
  emptyCommodities,
  phaseOf,
  type CkPlayer,
  type CkSlice,
  type ProgressCard,
} from './state';

/** Placeholder for every hidden progress card (hand or stack); only the length is meaningful. */
export const HIDDEN_PROGRESS_CARD: ProgressCard = 'alchemist';

/** The victim whose hand `viewer` may look at in the current `card` phase, or null. */
function lookedAt(
  state: GameState,
  viewer: Viewer,
  card: 'spy' | 'masterMerchant',
): PlayerId | null {
  const phase = phaseOf(state);
  if (phase.kind !== 'ck/card' || viewer !== state.turn.current) return null;
  if (phase.card !== 'spy' && phase.card !== 'masterMerchant') return null;
  return phase.card === card ? phase.victim : null;
}

export function ckMaskFor(view: GameState, viewer: Viewer, state: GameState): GameState {
  const full = state.ext[CK] as CkSlice | undefined;
  const shown = view.ext[CK] as CkSlice | undefined;
  if (!full || !shown) return view;
  const spied = lookedAt(state, viewer, 'spy');
  const searched = lookedAt(state, viewer, 'masterMerchant');
  const hide = (cards: readonly ProgressCard[]) => cards.map(() => HIDDEN_PROGRESS_CARD);

  const players = shown.players.map((pl, p): CkPlayer => {
    if (!hiddenFrom(state, viewer, p)) return pl;
    return {
      ...pl,
      progress: p === spied ? pl.progress : hide(pl.progress),
      commodities: p === searched ? pl.commodities : emptyCommodities(),
    };
  });
  const slice: CkSlice = {
    ...shown,
    players,
    decks: {
      trade: hide(shown.decks.trade),
      politics: hide(shown.decks.politics),
      science: hide(shown.decks.science),
    },
    commodityCounts: full.players.map((pl) => commodityTotal(pl.commodities)),
  };

  const victim = searched === null ? undefined : state.players[searched];
  const basePlayers =
    victim === undefined
      ? view.players
      : view.players.map((pl) =>
          pl.id === victim.id ? { ...pl, resources: { ...victim.resources } } : pl,
        );
  return { ...view, players: basePlayers, ext: { ...view.ext, [CK]: slice } };
}
