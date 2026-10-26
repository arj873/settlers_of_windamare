/**
 * Online views (engine/view.ts, docs/EXPANSIONS.md §5): the Traders & Barbarians secrets a view
 * may not carry (docs/rules/traders-barbarians.md).
 *
 * Hands (hidden from everyone but the owner until the game is over, `hiddenFrom`):
 *  - fish.hands[p] (Fishermen §4.5.1: "hidden hand of tokens"; the HUD shows "count only",
 *    §9.6) -> HIDDEN_FISH x length (the number of tokens a player holds is public);
 *  - traders.swift.held[p] / fresh[p] (T&B §4.7.6: Swift Journey is a development card, drawn
 *    face down from the dev deck) -> 0.
 * Face-down stacks (hidden from every viewer, game over included):
 *  - fish.pool (§2.2: tokens "mixed face down") -> HIDDEN_FISH x length (its size is public);
 *  - ba.deck (Barbarian Attack cards, §4.8.5, a shuffled deck) -> HIDDEN_BA_CARD x length;
 *  - traders.stacks[hex] (§2.6: commodity tokens "shuffled", only the backs show)
 *    -> HIDDEN_COMMODITY x length;
 *  - traders.swift.deck (how many of the undrawn dev cards are Swift Journeys) -> 0, its cards
 *    folded into the base view's face-down `devDeck` (HIDDEN_DEV_CARD), so the view shows the
 *    true number of undrawn cards and not the split. Only when the game has a dev deck (with C&K
 *    there is none and the Swift Journeys never come into play).
 * Public on purpose: fish.spent and the old boot (face up, §4.5.2-4.5.3), gold (§4.6 "public"),
 * commodity held and delivered (on the wagon / face-down VP tokens whose count is public, §9.6),
 * baggage levels, wagons, barbarians, knights, prisoners, camels, votes (face up, §4.3.2),
 * bridges, Catan for Two tokens and neutral pieces, ba.discard, the board (`board.ext`), and
 * every T&B log line (none names a hidden value: "caught 2 fish" counts tokens, paid fish are
 * spent face up, BA cards and loaded commodities are revealed when drawn, steals and forced trades
 * name no card). Event Cards, dev cards and hands are masked by the base view.
 *
 * Imports no engine/view.ts (it would close an import cycle): HIDDEN_DEV_CARD is mirrored here.
 */
import type { DevCardType, GameState, HexId } from '../../../engine/types';
import { hiddenFrom, type Viewer } from '../../../engine/viewer';
import { supplyOf } from '../../../engine/mapLookup';
import { TB, tbSlice, type BaCard, type Commodity, type TbSlice } from './state';

/** Placeholder of every hidden fish token (pool and opponents' hands); only lengths count. */
export const HIDDEN_FISH = 0;
/** Placeholder of every undrawn Barbarian Attack card. */
export const HIDDEN_BA_CARD: BaCard = 'knighthood';
/** Placeholder of every face-down commodity token in a trade hex's stack. */
export const HIDDEN_COMMODITY: Commodity = 'sand';
/** Same as engine/view.ts HIDDEN_DEV_CARD (the base view's face-down dev card). */
const HIDDEN_DEV_CARD: DevCardType = 'knight';

/** Has this game a development deck at all (a public fact of the settings)? */
function hasDevDeck(state: GameState): boolean {
  const deck = supplyOf(state).devDeck;
  return Object.values(deck).some((n) => n > 0);
}

/** `view` with the T&B secrets above masked (same shape; inputs untouched). */
export function tbMaskFor(view: GameState, viewer: Viewer, state: GameState): GameState {
  const s = tbSlice(view);
  if (!s.fish && !s.ba && !s.traders) return view;
  const hidden = (p: number) => hiddenFrom(state, viewer, p);
  const out: TbSlice = { ...s };
  let devDeck = view.devDeck;
  if (s.fish) {
    out.fish = {
      ...s.fish,
      pool: s.fish.pool.map(() => HIDDEN_FISH),
      hands: s.fish.hands.map((h, p) => (hidden(p) ? h.map(() => HIDDEN_FISH) : h)),
    };
  }
  if (s.ba) out.ba = { ...s.ba, deck: s.ba.deck.map(() => HIDDEN_BA_CARD) };
  if (s.traders) {
    const t = s.traders;
    const stacks: Record<HexId, Commodity[]> = {};
    for (const [h, stack] of Object.entries(t.stacks) as [HexId, Commodity[]][]) {
      stacks[h] = stack.map(() => HIDDEN_COMMODITY);
    }
    const fold = t.swift.deck > 0 && hasDevDeck(state);
    if (fold) {
      devDeck = [...view.devDeck, ...Array<DevCardType>(t.swift.deck).fill(HIDDEN_DEV_CARD)];
    }
    out.traders = {
      ...t,
      stacks,
      swift: {
        deck: fold ? 0 : t.swift.deck,
        held: t.swift.held.map((n, p) => (hidden(p) ? 0 : n)),
        fresh: t.swift.fresh.map((n, p) => (hidden(p) ? 0 : n)),
      },
    };
  }
  return { ...view, devDeck, ext: { ...view.ext, [TB]: out } };
}
