/**
 * Smart bots (B1): score every legal action, play the best. Base actions are scored by base.ts,
 * expansion actions by their module's `BotExtension.score` (a module may also re-score base
 * actions). Expansion actions nobody scores fall back to the module's `steer` or a random pick,
 * offered only on some decisions so a bot never loops on moves that change nothing.
 *
 * Deterministic: the bot's own `rng` is the only randomness (noise, ties, fallbacks).
 */
import { legalActions, type Action, type GameState, type PlayerId, type Rng } from '../../engine';
import { botExtensionsFor } from '../expansions';
import type { Bot } from '../index';
import { baseScore } from './base';
import { BotContext, type SmartParams } from './context';

export { BotContext, PIP_VALUE, VP, hexPips, hexResource } from './context';
export type { BotGoal, SmartParams, Spot } from './context';
export { ROLL, baseScore, conflict, robberHex, setupRoad, setupSettlement, trade } from './base';

/** Score of a module action its `steer` picked (above ending the turn, below building). */
const STEERED = 25;
/** Unscored module actions, on the decisions they are offered at all. */
const UNSCORED = 12;
/** Share of decisions on which unscored module actions are considered. */
const UNSCORED_SHARE = 0.4;

export const NORMAL_PARAMS: SmartParams = {
  noise: 0.12,
  longestRoad: false,
  guardLeader: false,
  offers: true,
  rates: false,
};

export const HARD_PARAMS: SmartParams = {
  noise: 0,
  longestRoad: true,
  guardLeader: true,
  offers: true,
  rates: true,
};

export interface ScoredAction {
  action: Action;
  score: number;
}

/** Every option of `player` with its score (noise included), in option order. For tests and tools. */
export function scoreOptions(
  state: GameState,
  player: PlayerId,
  rng: Rng,
  options: readonly Action[],
  params: SmartParams,
): ScoredAction[] {
  const extensions = botExtensionsFor(state);
  const ctx = new BotContext(state, player, params, rng, extensions);
  let steered: Action | null | undefined;
  let offerUnscored: boolean | undefined;
  const fallback = (a: Action): number => {
    if (steered === undefined) {
      steered = null;
      for (const x of extensions) {
        steered = x.steer?.(state, player, options, rng) ?? null;
        if (steered) break;
      }
    }
    if (a === steered) return STEERED;
    offerUnscored ??= rng.float() < UNSCORED_SHARE;
    return offerUnscored ? UNSCORED + 5 * rng.float() : -50 + rng.float();
  };
  return options.map((action) => {
    let score: number | null = null;
    for (const x of extensions) {
      score = x.score?.(ctx, action) ?? null;
      if (score !== null) break;
    }
    score ??= action.type.includes('/') ? fallback(action) : baseScore(ctx, action);
    score ??= 0;
    if (params.noise > 0) score += params.noise * Math.abs(score) * (2 * rng.float() - 1);
    return { action, score };
  });
}

/** A smart bot with the given parameters (NORMAL_PARAMS, HARD_PARAMS). */
export function createSmartBot(params: SmartParams): Bot {
  return (state, player, rng, legal) => {
    const all = legal ?? legalActions(state, player);
    const options = all.filter((a) => a.player === player);
    if (options.length <= 1) return options[0] ?? null;
    let best: ScoredAction | null = null;
    let ties = 0;
    for (const s of scoreOptions(state, player, rng, options, params)) {
      if (!best || s.score > best.score) {
        best = s;
        ties = 1;
      } else if (s.score === best.score && rng.int(++ties) === 0) {
        best = s;
      }
    }
    return best?.action ?? null;
  };
}

export const normalBot: Bot = createSmartBot(NORMAL_PARAMS);
export const hardBot: Bot = createSmartBot(HARD_PARAMS);
