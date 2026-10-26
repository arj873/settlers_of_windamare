/**
 * Dice for rollDice. Plain dice: two Rng.die() calls. Balanced dice (settings.balancedDice):
 * draw a card from `state.diceDeck`, a shuffled deck holding each of the 36 ordered two-dice
 * outcomes once; before a draw, the deck is refilled and reshuffled when DICE_DECK_RESHUFFLE_AT
 * or fewer cards remain (the first roll finds it empty). Seeded RNG only. RULES.md §17.
 */
import { DICE_DECK_RESHUFFLE_AT, DICE_DECK_SIZE } from '../constants';
import { Rng } from '../rng';
import type { GameState } from '../types';

/** Every dice card, 0..35: `(d1 - 1) * 6 + (d2 - 1)`. */
export const DICE_CARDS: readonly number[] = Array.from({ length: DICE_DECK_SIZE }, (_, i) => i);

export function diceOfCard(card: number): [number, number] {
  return [Math.floor(card / 6) + 1, (card % 6) + 1];
}

/** Roll two dice into `draft` (rng, and diceDeck with balanced dice). Returns the dice. */
export function rollTwoDice(draft: GameState): { dice: [number, number]; reshuffled: boolean } {
  const rng = new Rng(draft.rng);
  let dice: [number, number];
  let reshuffled = false;
  if (draft.settings.balancedDice) {
    if (draft.diceDeck.length <= DICE_DECK_RESHUFFLE_AT) {
      draft.diceDeck = rng.shuffle(DICE_CARDS);
      reshuffled = true;
    }
    dice = diceOfCard(draft.diceDeck.pop() as number);
  } else {
    dice = [rng.die(), rng.die()];
  }
  draft.rng = rng.state;
  return { dice, reshuffled };
}
