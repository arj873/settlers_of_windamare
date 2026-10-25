/** Bots (T5). A bot is a pure-ish function choosing one Action from legalActions. */
import { legalActions, type Rng, type Action, type GameState, type PlayerId } from '../engine';

export type Bot = (state: GameState, player: PlayerId, rng: Rng) => Action | null;

/** Placeholder random bot: uniformly picks a legal action for `player`. T5 owns this. */
export const randomBot: Bot = (state, player, rng) => {
  const options = legalActions(state, player);
  return options.length > 0 ? rng.pick(options) : null;
};
