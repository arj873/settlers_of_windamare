/**
 * Catan Event Cards (settings.eventCards): the official 36-card deck that replaces the dice.
 * Source: CATAN – Traders & Barbarians rulebook (catan.com, 2020), pp. 4–5 and p. 23. RULES.md §18.2.
 *
 * Each card shows a number (2..12, the 2d6 distribution: 1-2-3-4-5-6-5-4-3-2-1) and an event.
 * The event is resolved first, then the number produces. The New Year card sits under the last
 * 5 cards, so the deck is reshuffled when 5 cards remain (same cycle as balanced dice).
 */
import { DICE_DECK_RESHUFFLE_AT } from '../constants';
import { Rng } from '../rng';
import type { EventKind, GameState } from '../types';

export interface EventCard {
  number: number;
  event: EventKind;
}

const card = (number: number, event: EventKind): EventCard => ({ number, event });
const times = (n: number, c: EventCard): EventCard[] => Array.from({ length: n }, () => c);

/** The 36 event cards (T&B 2020 p. 23). Index = card id in `GameState.eventDeck`. */
export const EVENT_CARDS: readonly EventCard[] = [
  card(2, 'plentifulYear'),
  card(3, 'conflict'),
  card(3, 'none'),
  card(4, 'robberFlees'),
  card(4, 'robberFlees'),
  card(4, 'none'),
  card(5, 'tournament'),
  card(5, 'tradeAdvantage'),
  ...times(2, card(5, 'none')),
  card(6, 'epidemic'),
  card(6, 'earthquake'),
  card(6, 'goodNeighbors'),
  ...times(2, card(6, 'none')),
  ...times(6, card(7, 'robberAttacks')),
  card(8, 'epidemic'),
  ...times(4, card(8, 'none')),
  card(9, 'calmSea'),
  ...times(3, card(9, 'none')),
  card(10, 'neighborlyAssistance'),
  ...times(2, card(10, 'none')),
  card(11, 'neighborlyAssistance'),
  card(11, 'none'),
  card(12, 'calmSea'),
];

export const EVENT_CARD_IDS: readonly number[] = EVENT_CARDS.map((_, i) => i);

/** Short names and rule texts (our wording of the card texts) for the log and the UI. */
export const EVENT_INFO: Record<EventKind, { name: string; text: string }> = {
  none: { name: 'Catan prospers', text: 'No event.' },
  robberAttacks: {
    name: 'Robber Attacks!',
    text: 'As a rolled 7: discard half above the limit, move the robber, steal.',
  },
  epidemic: { name: 'Epidemic', text: 'Cities produce only 1 resource this turn.' },
  earthquake: {
    name: 'Earthquake',
    text: 'Each player damages 1 road: no new roads (or settlements next to it) until repaired for 1 brick + 1 lumber.',
  },
  goodNeighbors: {
    name: 'Good Neighbors',
    text: 'Each player gives the next player 1 resource of their choice.',
  },
  tournament: {
    name: 'Tournament',
    text: 'The player(s) with the most knights played take 1 resource from the bank.',
  },
  tradeAdvantage: {
    name: 'Trade Advantage',
    text: 'The Longest Road holder may take 1 random card from any player.',
  },
  calmSea: {
    name: 'Calm Sea',
    text: 'The player(s) with the most harbors take 1 resource from the bank.',
  },
  robberFlees: { name: 'Robber Flees', text: 'The robber returns to the desert. No steal.' },
  neighborlyAssistance: {
    name: 'Neighborly Assistance',
    text: 'The player(s) with the most points give 1 resource to a player with fewer.',
  },
  conflict: {
    name: 'Conflict',
    text: 'The Largest Army holder takes 1 random card from any player.',
  },
  plentifulYear: { name: 'Plentiful Year', text: 'Each player takes 1 resource from the bank.' },
};

/**
 * Dice faces shown for a card's number (the card has no dice): the two most even faces,
 * e.g. 7 -> 3+4, 8 -> 4+4, 2 -> 1+1.
 */
export function facesFor(n: number): [number, number] {
  return [Math.floor(n / 2), Math.ceil(n / 2)];
}

/** Draw the next event card into `draft` (reshuffling the deck first when ≤ 5 cards remain). */
export function drawEventCard(draft: GameState): { card: EventCard; reshuffled: boolean } {
  let deck = draft.eventDeck ?? [];
  let reshuffled = false;
  if (deck.length <= DICE_DECK_RESHUFFLE_AT) {
    const rng = new Rng(draft.rng);
    deck = rng.shuffle(EVENT_CARD_IDS);
    draft.rng = rng.state;
    reshuffled = true;
  }
  const id = deck.pop() as number;
  draft.eventDeck = deck;
  return { card: EVENT_CARDS[id] as EventCard, reshuffled };
}
