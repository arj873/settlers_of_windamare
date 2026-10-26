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
import { botExtensionsFor } from './expansions';

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

/**
 * How the random bot picks among its legal actions:
 *  - 'byType'  (default): an action type uniformly, then an action of that type uniformly, so
 *    types with many variants (discard combos, trade offers, road spots) don't flood the choice.
 *  - 'uniform': one action uniformly from the whole list.
 */
export type PickMode = 'byType' | 'uniform';

export interface RandomBotOptions {
  /** Default 'byType'. */
  mode?: PickMode;
  /**
   * Probability in [0, 1] that this decision drops the "stalling" actions (see `avoid`) whenever
   * something else is legal. 0 (default) = pure uniform choice. Raise it so simulated games
   * reach game end instead of every player ending the turn at the first chance.
   */
  progressBias?: number;
  /** Actions dropped when the bias triggers. Default: endTurn and passSpecialBuild. */
  avoid?: readonly ActionType[];
}

/** The "stop doing things" actions a progress bias skips by default. */
export const STALLING_ACTIONS: readonly ActionType[] = ['endTurn', 'passSpecialBuild'];

/** Uniform pick of a type, then of an action of that type. */
function pickByType(options: readonly Action[], rng: Rng): Action {
  const byType = new Map<ActionType, Action[]>();
  for (const a of options) {
    const group = byType.get(a.type);
    if (group) group.push(a);
    else byType.set(a.type, [a]);
  }
  return rng.pick(rng.pick([...byType.values()]));
}

/**
 * Random bot (see PickMode), with an optional bias away from `endTurn` / `passSpecialBuild`.
 * A bot whose trade offer was accepted confirms with a random accepter instead of withdrawing.
 * Uses the bot's own `rng`. In a special build step its options are the builds, buyDevCard and
 * passSpecialBuild, so with byType it passes with probability 1/(number of types) per decision;
 * every build spends cards, so a step always ends.
 */
export function createRandomBot(options: RandomBotOptions = {}): Bot {
  const bias = options.progressBias ?? 0;
  const avoid = options.avoid ?? STALLING_ACTIONS;
  const mode = options.mode ?? 'byType';
  if (!(bias >= 0 && bias <= 1)) throw new Error(`progressBias must be in [0, 1], got ${bias}`);
  if (mode !== 'byType' && mode !== 'uniform') throw new Error(`unknown pick mode ${String(mode)}`);
  const pick = (from: readonly Action[], rng: Rng) =>
    mode === 'uniform' ? rng.pick(from) : pickByType(from, rng);
  return (state, player, rng, legal) => {
    const all = legal ?? legalActions(state, player);
    const options = all.filter((a) => a.player === player);
    if (options.length === 0) return null;
    // An own offer someone accepted: trade with one of them (never withdraw on an accepter).
    // Withdrawing stays possible while nobody has accepted yet.
    const confirms = options.filter((a) => a.type === 'confirmTrade');
    if (confirms.length > 0) return rng.pick(confirms);
    // Only consume randomness for the bias when it is enabled, so bias 0 is a plain pick.
    if (bias > 0 && rng.float() < bias) {
      // An expansion's own idea of progress first (BotExtension.steer).
      for (const x of botExtensionsFor(state)) {
        const a = x.steer?.(state, player, options, rng);
        if (a) return a;
      }
      const progress = options.filter((a) => !avoid.includes(a.type));
      if (progress.length > 0) return pick(progress, rng);
    }
    return pick(options, rng);
  };
}

/** Default bot: type-first random pick, no bias. */
export const randomBot: Bot = createRandomBot();

/** Pure-uniform bot: uniform pick from legalActions(state, player), no bias. */
export const uniformBot: Bot = createRandomBot({ mode: 'uniform' });

/** `chooseAction(state, player, rng)`: the default bot. */
export const chooseAction: Bot = randomBot;

// Difficulty levels (B1): Easy = random (above), Normal / Hard = src/bots/smart. The bot of a
// level: `botForLevel` in ./byLevel (not re-exported here: it builds bots at import time).
export * from './levels';

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
