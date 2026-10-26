/** Shared types and helpers for action handlers. Owned by T1; extend carefully (everyone imports it). */
import type {
  Action,
  ActionOf,
  ActionResult,
  ActionType,
  GameState,
  Phase,
  PlayerId,
  ResumePhase,
} from '../types';

/**
 * A handler receives a PRIVATE DEEP COPY of the state (`draft`) — mutate it freely.
 * Return `ok(draft)` on success or `fail('reason')`. On failure the draft is discarded.
 * Handlers must validate everything in the action (IDs, actor, phase, costs): actions may come
 * from a UI, a bot, or later the network.
 */
export type Handler<T extends ActionType> = (draft: GameState, action: ActionOf<T>) => ActionResult;

/** Handlers for a subset of action types. Each area file exports one of these. */
export type HandlerMap<T extends ActionType> = { [K in T]: Handler<K> };

/**
 * Enumerates every legal action of the area's types for the given state (all actors).
 * Must be SOUND: every returned action is accepted by applyAction.
 */
export type LegalGenerator = (state: GameState) => Action[];

export function ok(state: GameState): ActionResult {
  return { ok: true, state };
}

export function fail(error: string): ActionResult {
  return { ok: false, error };
}

export function notImplemented(): ActionResult {
  return fail('not implemented');
}

/** Append a log line for the current turn. */
export function log(draft: GameState, player: PlayerId | null, text: string): void {
  draft.log.push({ turn: draft.turn.number, player, text });
}

/**
 * The phase to return to after an interrupt (robber / road building). A special build step
 * (5+ player rule set) resumes to `specialBuild{builder = turn.current, owner = turn.specialOwner}`.
 */
export function resumePhase(state: GameState, resume: ResumePhase): Phase {
  if (resume !== 'specialBuild') return { kind: resume };
  return { kind: 'specialBuild', builder: state.turn.current, owner: state.turn.specialOwner ?? 0 };
}

/** Common guard: is it `player`'s turn? */
export function isCurrent(state: GameState, player: PlayerId): boolean {
  return state.turn.current === player;
}
