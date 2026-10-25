/** Bots (T5). A bot is a function choosing one Action from the legal ones. */
import {
  actingPlayers,
  legalActions,
  type Action,
  type ActionType,
  type GameState,
  type PlayerId,
  type Rng,
} from '../engine';

/**
 * `legal` may be passed when the caller already computed `legalActions(state, player)`
 * (saves recomputing it); otherwise the bot asks the engine. Returns null if there is no move.
 */
export type Bot = (
  state: GameState,
  player: PlayerId,
  rng: Rng,
  legal?: readonly Action[],
) => Action | null;

export interface RandomBotOptions {
  /**
   * Probability in [0, 1] that this decision drops the "stalling" actions (see `avoid`) whenever
   * something else is legal. 0 (default) = pure uniform choice. Raise it so simulated games
   * reach game end instead of every player ending the turn at the first chance.
   */
  progressBias?: number;
  /** Actions dropped when the bias triggers. Default: endTurn. */
  avoid?: readonly ActionType[];
}

/** Uniform random bot, with an optional bias away from `endTurn`. Uses the bot's own `rng`. */
export function createRandomBot(options: RandomBotOptions = {}): Bot {
  const bias = options.progressBias ?? 0;
  const avoid = options.avoid ?? ['endTurn'];
  if (!(bias >= 0 && bias <= 1)) throw new Error(`progressBias must be in [0, 1], got ${bias}`);
  return (state, player, rng, legal) => {
    const all = legal ?? legalActions(state, player);
    const options = all.filter((a) => a.player === player);
    if (options.length === 0) return null;
    // Only consume randomness for the bias when it is enabled, so pure mode is plain rng.pick.
    if (bias > 0 && rng.float() < bias) {
      const progress = options.filter((a) => !avoid.includes(a.type));
      if (progress.length > 0) return rng.pick(progress);
    }
    return rng.pick(options);
  };
}

/** Pure-uniform default bot. */
export const randomBot: Bot = createRandomBot();

/** `chooseAction(state, player, rng)`: uniform pick from legalActions(state, player). */
export const chooseAction: Bot = randomBot;

/**
 * Players who may submit an action right now (per the phase state machine):
 *  - discard:  every player who still owes cards, in any order
 *  - trade:    the offerer plus every responder still 'pending'
 *  - gameOver: nobody
 *  - otherwise only the current player
 * Not every actor necessarily has a legal action (e.g. the offerer while responses are pending).
 */
export function actorsFor(state: GameState): PlayerId[] {
  return [...new Set(actingPlayers(state))];
}
