/**
 * Cities & Knights cards in the hand (#cardinfo): what a commodity is for, and the "can I play
 * it" line of a progress card. "Playable" comes from the viewer's legal actions only (ui.ts
 * `handCardInfo`); these lines only explain a refusal, in the order the engine checks
 * (engine/cards.ts `playBlocker`). Card texts: `CARD_TEXT` (engine), shared with the sidebar list.
 */
import type { GameState, PlayerId } from '../../engine';
import {
  PROGRESS_HAND_MAX,
  ckSlice,
  effectBlocker,
  isVpCard,
  phaseOf,
  type Commodity,
  type ProgressCard,
} from './engine';

/** What each commodity is for (the hand's info card). */
export const COMMODITY_TEXT: Readonly<Record<Commodity, string>> = {
  paper:
    'Your cities on forests make 1 paper besides 1 lumber. Pay paper for Science city improvements. Trade it with players or the bank like a resource; it counts in your hand on a 7.',
  cloth:
    'Your cities on pastures make 1 cloth besides 1 wool. Pay cloth for Trade city improvements. Trade it with players or the bank like a resource; it counts in your hand on a 7.',
  coin: 'Your cities on mountains make 1 coin besides 1 ore. Pay coin for Politics city improvements. Trade it with players or the bank like a resource; it counts in your hand on a 7.',
};

/** "Playable now" line of a progress card the viewer can play. */
export const PLAY_NOW = 'Playable now: click the card to play it.';
export const ALCHEMIST_NOW = 'Playable now: click the card to choose the dice, then roll.';

/** Why the viewer has to wait, by the phase in the way (own turn, after the roll). */
function waitFor(kind: string): string {
  switch (kind) {
    case 'discard':
    case 'moveRobber':
    case 'steal':
      return 'Finish the robber first';
    case 'trade':
      return 'Close your trade offer first';
    case 'roadBuilding':
      return 'Place your free roads first';
    case 'event':
      return 'Finish the event first';
    case 'ck/card':
    case 'ck/sabotage':
    case 'ck/wedding':
    case 'back/deserter': // Barbarian Attack + C&K's own card flows
    case 'back/intrigue':
    case 'back/smith':
    case 'back/taxation':
      return 'Finish the progress card being played first';
    case 'ck/knight':
      return 'Finish with your selected knight first';
    case 'back/knights':
      return 'Finish your knight actions first';
    // Explorers & Pirates, Seafarers (+ C&K).
    case 'ep/pirate':
    case 'ep/pirateSteal':
      return 'Finish with the pirate first';
    case 'seafarers/moveShip':
      return 'Finish moving your ship first';
    case 'ck/pillage':
    case 'ck/defender':
      return 'Finish the barbarian attack first';
    case 'ck/progressDiscard':
      return 'Wait for the extra progress cards to be discarded first';
    case 'ck/aqueduct':
      return 'Wait for the Aqueduct picks first';
    case 'ck/metropolis':
      return 'Place the metropolis first';
    case 'ck/relocate':
    case 'back/relocate':
      return 'Wait for the displaced knight to move first';
    default:
      return 'Finish the current step first';
  }
}

/** Generic last resort: tests check no refusal in bot games ends here. */
export const CANT_NOW = "Can't be played right now.";

/**
 * The status line of `card` in `viewer`'s hand. `playable`: a legal action of the viewer plays it
 * (`ck/play`, or `ck/alchemist` for the Alchemist).
 */
export function progressStatus(
  state: GameState,
  viewer: PlayerId,
  card: ProgressCard,
  playable: boolean,
): string {
  if (isVpCard(card)) return 'Victory point card: it counts as soon as it is drawn.';
  const kind = phaseOf(state).kind;
  if (kind === 'gameOver') return 'The game is over.';
  if (playable) return card === 'alchemist' ? ALCHEMIST_NOW : PLAY_NOW;
  if (kind === 'specialBuild') {
    return 'No progress cards in the special building phase: play it on your own turn.';
  }
  const mine = state.turn.current === viewer;
  if (card === 'alchemist') {
    if (!mine) return 'Not your turn. You can play this on your turn, before you roll.';
    if (kind === 'setup' || kind === 'mapVeto') return 'The game has not started yet.';
    return 'The dice are rolled this turn: play the Alchemist before you roll, on a later turn.';
  }
  if (!mine) return 'Not your turn. You can play this on your turn, after you roll.';
  if (kind === 'setup' || kind === 'mapVeto') return 'The game has not started yet.';
  if (kind === 'preRoll') {
    return 'Roll the dice first: progress cards are played after the roll (only the Alchemist comes before).';
  }
  if (kind !== 'main') return `${waitFor(kind)}, then you can play this.`;
  const why = effectBlocker(state, viewer, card);
  return why ? `Not now: it would have no effect (${why}).` : CANT_NOW;
}

/** Extra lines about the progress hand limit (4 cards, not counting victory point cards). */
export function handLimitNotes(state: GameState, viewer: PlayerId): string[] {
  const n = ckSlice(state).players[viewer]?.progress.length ?? 0;
  if (n > PROGRESS_HAND_MAX) {
    return state.turn.current === viewer && phaseOf(state).kind !== 'ck/progressDiscard'
      ? [
          `You hold ${n} progress cards, the limit is ${PROGRESS_HAND_MAX}: play or discard down to ${PROGRESS_HAND_MAX} before you end your turn.`,
        ]
      : [`You hold ${n} progress cards, the limit is ${PROGRESS_HAND_MAX}: discard one now.`];
  }
  if (n === PROGRESS_HAND_MAX) {
    return [
      `You hold ${PROGRESS_HAND_MAX} progress cards, the most you may keep: drawing another means a discard.`,
    ];
  }
  return [];
}
