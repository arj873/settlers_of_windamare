import { HANDLERS, LEGAL_GENERATORS } from './actions';
import type { Handler } from './actions/common';
import { cloneState } from './clone';
import { LOG_LIMIT } from './constants';
import { namespaceOf } from './expansions/ext';
import { moduleChangesRoads, runAfterAction } from './expansions/hooks';
import { activeModules } from './expansions/registry';
import type { ExtHandler } from './expansions/types';
import { changesRoads, updateAwards } from './rules/awards';
import { checkVictory } from './rules/victory';
import type {
  Action,
  ActionResult,
  ActionType,
  BaseActionType,
  ExpansionActionType,
  GameState,
  PlayerId,
} from './types';

type AnyHandler = (draft: GameState, action: Action) => ActionResult;

/**
 * The handler for `type` in this game, or undefined: a namespaced type goes to its (active)
 * module's `actions`; a base type to the base handler wrapped by every active module's override
 * (docs/EXPANSIONS.md §4; the first module listed is innermost).
 */
function handlerFor(state: GameState, type: string): AnyHandler | undefined {
  const ns = namespaceOf(type);
  if (ns !== null) {
    const m = activeModules(state).find((x) => x.id === ns);
    const actions = m?.actions;
    if (!actions || !Object.hasOwn(actions, type)) return undefined;
    return actions[type as ExpansionActionType] as ExtHandler as AnyHandler;
  }
  if (!Object.hasOwn(HANDLERS, type)) return undefined;
  let h = HANDLERS[type as BaseActionType] as Handler<ActionType> as AnyHandler;
  for (const m of activeModules(state)) {
    const wrap = m.overrides?.[type as BaseActionType] as
      ((d: GameState, a: Action, next: AnyHandler) => ActionResult) | undefined;
    if (wrap) {
      const next = h;
      h = (d, a) => wrap(d, a, next);
    }
  }
  return h;
}

/**
 * Pure transition: never mutates `state`. Pipeline:
 *   generic checks -> cloneState -> handler(draft, action) -> afterAction hooks -> updateAwards
 *   -> checkVictory -> trim log to LOG_LIMIT
 */
export function applyAction(state: GameState, action: Action): ActionResult {
  if (state.phase.kind === 'gameOver') return { ok: false, error: 'game is over' };
  const handler = handlerFor(state, String(action.type));
  if (!handler) return { ok: false, error: `unknown action type: ${String(action.type)}` };
  if (!isPlayerId(state, action.player)) {
    return { ok: false, error: `invalid player: ${String(action.player)}` };
  }

  const draft = cloneState(state);
  const result = handler(draft, action);
  if (!result.ok) return result;
  runAfterAction(result.state, action);
  const roads = changesRoads(action.type) || moduleChangesRoads(state, action.type);
  updateAwards(result.state, { roads });
  checkVictory(result.state);
  trimLog(result.state);
  return result;
}

/** Keep only the newest LOG_LIMIT log entries, so state size and copy cost stay bounded. */
function trimLog(draft: GameState): void {
  const extra = draft.log.length - LOG_LIMIT;
  if (extra > 0) draft.log.splice(0, extra);
}

/**
 * Every legal action right now, for all players who may act (see actingPlayers), or only for
 * `player` if given. Sound: each returned action is accepted by applyAction.
 * Complete except offerTrade (open-ended; only a bounded sample is returned).
 * Expansions: their `legal` generators are appended, then each `filterLegal` runs in order.
 */
export function legalActions(state: GameState, player?: PlayerId): Action[] {
  if (state.phase.kind === 'gameOver') return [];
  let all = LEGAL_GENERATORS.flatMap((gen) => gen(state));
  const modules = activeModules(state);
  for (const m of modules) if (m.legal) all = all.concat(m.legal(state));
  for (const m of modules) if (m.filterLegal) all = m.filterLegal(state, all);
  return player === undefined ? all : all.filter((a) => a.player === player);
}

function isPlayerId(state: GameState, p: unknown): p is PlayerId {
  return typeof p === 'number' && Number.isInteger(p) && p >= 0 && p < state.players.length;
}
