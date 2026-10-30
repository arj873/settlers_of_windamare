/**
 * Traders & Barbarians things in the hand (#cardinfo): what gold, fish, the old boot and trade
 * tokens are for, and the "can I play it" line of a Swift Journey. "Playable" comes from the
 * viewer's legal actions only (ui.ts `handCardInfo`); these lines only explain a refusal, from
 * the rules the engine checks (engine/traders.ts `swiftBlocker`).
 */
import type { GameState, PlayerId } from '../../engine';
import { FISH_USES, GOLD_PER_RESOURCE, fishCost, has, tradersOf, type FishUse } from './engine';

/** Generic last resort: tests check no refusal in bot games ends here. */
export const CANT_NOW = "Can't be played right now.";
export const SWIFT_NOW = 'Playable now: click the card to move your wagon again.';

export const SWIFT_TEXT =
  'A development card of Traders & Barbarians. Play it after your wagon moved: the wagon moves again, with all the movement points of your baggage train. It counts as your one development card of the turn.';

export function goldText(state: GameState): string {
  const rivers = has(state, 'rivers')
    ? ' Rivers: the player with the most coins gets +1 VP, everyone tied for the fewest −2 VP.'
    : '';
  return `Coins are not resource cards: never stolen, never discarded on a 7, never taken by a Monopoly. On your turn, before or after rolling, ${GOLD_PER_RESOURCE} coins buy 1 resource from the bank (at most twice per turn). Trade coins with other players, or sell 4 cards of one resource (3 with a 3:1 harbour) to the bank for 1 coin.${rivers}`;
}

const FISH_DOES: Readonly<Record<FishUse, string>> = {
  robber: 'chase the robber off the board',
  steal: 'steal a card from a player',
  resource: 'take a resource from the bank',
  road: 'build a road for free',
  devCard: 'draw a development card',
};

export function fishText(state: GameState, viewer: PlayerId): string {
  const uses = FISH_USES.map((u) => `${fishCost(state, viewer, u)} to ${FISH_DOES[u]}`);
  return `Fish tokens of 1, 2 or 3 fish, from fishing grounds and the lake. On your turn spend whole tokens (no change): ${uses.join(', ')}. Not cards: never discarded on a 7, stolen or traded; hold at most 7 tokens.`;
}

export const BOOT_TEXT =
  'Whoever holds the old boot needs 1 more victory point to win. After your roll you may give it to a player with at least as many points as you (Traders & Barbarians panel); if you alone have the most points, you keep it.';

export const TOKEN_TEXT =
  'Trade tokens of Catan for Two. Once per turn, before rolling or after, pay 1 token (2 while you are ahead) for a Forced Trade (swap 2 cards with your opponent) or to move the robber to the desert. Earn them by building on the coast or by the desert, or by discarding a played Knight.';

/** The Swift Journey line. `playable`: the viewer's legal actions hold `tb/swiftJourney`. */
export function swiftStatus(state: GameState, viewer: PlayerId, playable: boolean): string {
  if (state.phase.kind === 'gameOver') return 'The game is over.';
  if (playable) return SWIFT_NOW;
  if (state.turn.current !== viewer) {
    return 'Not your turn. You can play this on your turn, right after your wagon moves.';
  }
  const s = tradersOf(state).swift;
  if ((s.held[viewer] ?? 0) === 0) return 'Bought this turn: playable from your next turn.';
  if (state.turn.devCardPlayed) {
    return 'You already played a development card this turn (one per turn). Play this one on a later turn.';
  }
  if (state.phase.kind !== 'tb/wagon') {
    return 'Move your wagon first (Move wagon), then play this to move it again.';
  }
  if (tradersOf(state).move.steps === 0) {
    return 'Move your wagon at least one step first, then play this.';
  }
  return CANT_NOW;
}
