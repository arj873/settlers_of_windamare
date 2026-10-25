import { HANDLERS, LEGAL_GENERATORS } from './actions';
import type { Handler } from './actions/common';
import { updateAwards } from './rules/awards';
import { checkVictory } from './rules/victory';
import type { Action, ActionResult, ActionType, GameState, PlayerId } from './types';

/**
 * Pure transition: never mutates `state`. Pipeline:
 *   generic checks -> deep copy -> HANDLERS[type](draft, action) -> updateAwards -> checkVictory
 */
export function applyAction(state: GameState, action: Action): ActionResult {
  if (state.phase.kind === 'gameOver') return { ok: false, error: 'game is over' };
  const handler = Object.hasOwn(HANDLERS, action.type)
    ? (HANDLERS[action.type] as Handler<ActionType>)
    : undefined;
  if (!handler) return { ok: false, error: `unknown action type: ${String(action.type)}` };
  if (!isPlayerId(state, action.player)) {
    return { ok: false, error: `invalid player: ${String(action.player)}` };
  }

  const draft = structuredClone(state);
  const result = handler(draft, action);
  if (!result.ok) return result;
  updateAwards(result.state);
  checkVictory(result.state);
  return result;
}

/**
 * Every legal action right now, for all players who may act (see actingPlayers), or only for
 * `player` if given. Sound: each returned action is accepted by applyAction.
 * Complete except offerTrade (open-ended; only a bounded sample is returned).
 */
export function legalActions(state: GameState, player?: PlayerId): Action[] {
  if (state.phase.kind === 'gameOver') return [];
  const all = LEGAL_GENERATORS.flatMap((gen) => gen(state));
  return player === undefined ? all : all.filter((a) => a.player === player);
}

function isPlayerId(state: GameState, p: unknown): p is PlayerId {
  return typeof p === 'number' && Number.isInteger(p) && p >= 0 && p < state.players.length;
}
