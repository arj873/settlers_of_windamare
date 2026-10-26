/**
 * Map veto (settings.mapSelection 'veto', RULES.md §18.7). createGame generates
 * MAP_VETO_CANDIDATES boards and starts in phase `mapVeto`.
 * vetoMap (phase mapVeto, player = order[next] = turn.current): veto one candidate nobody has
 *   vetoed yet. When one candidate is left, it becomes the board (and robber), and setup starts
 *   with the starting player. Vetoers go counter-clockwise from the player before the starting
 *   player (the starting player already places first), one veto each, until one map is left.
 * The phase holds everything needed, so a server can drive it with the same action.
 */
import { playerName } from '../rules/text';
import type { Action, GameState, PlayerId } from '../types';
import { type HandlerMap, type LegalGenerator, fail, isCurrent, log, ok } from './common';

export const MAP_VETO_CANDIDATES = 3;

/** Vetoers in order: counter-clockwise from the seat before `start`, one per remaining veto. */
export function vetoOrder(playerCount: number, start: PlayerId, candidates: number): PlayerId[] {
  const vetoes = Math.min(candidates - 1, playerCount);
  return Array.from({ length: vetoes }, (_, i) => (start - 1 - i + 2 * playerCount) % playerCount);
}

export const vetoHandlers: HandlerMap<'vetoMap'> = {
  vetoMap: (draft, { player, candidate }) => {
    const phase = draft.phase;
    if (phase.kind !== 'mapVeto') return fail('no map vote now');
    if (!isCurrent(draft, player)) return fail('not your veto');
    if (!Number.isInteger(candidate) || candidate < 0 || candidate >= phase.candidates.length) {
      return fail('invalid map');
    }
    if (phase.vetoed[candidate] !== null) return fail('that map is already vetoed');

    const vetoed = [...phase.vetoed];
    vetoed[candidate] = player;
    log(draft, player, `${playerName(draft, player)} vetoed map ${candidate + 1}`);
    const left = vetoed.flatMap((v, i) => (v === null ? [i] : []));
    const next = phase.next + 1;
    const nextVoter = phase.order[next];
    if (left.length > 1 && nextVoter !== undefined) {
      draft.phase = { ...phase, vetoed, next };
      draft.turn.current = nextVoter;
      return ok(draft);
    }
    // One map left (or, defensively, no vetoer left: the first map not vetoed).
    const chosen = left[0] ?? 0;
    const pick = phase.candidates[chosen];
    if (pick) {
      draft.board = pick.board;
      draft.robber = pick.robber;
    }
    log(draft, null, `Map ${chosen + 1} was chosen`);
    draft.turn.current = draft.settings.startingPlayer;
    draft.phase = { kind: 'setup', index: 0, step: 'settlement', lastSettlement: null };
    return ok(draft);
  },
};

export const vetoLegal: LegalGenerator = (state: GameState): Action[] => {
  const phase = state.phase;
  if (phase.kind !== 'mapVeto') return [];
  const player = state.turn.current;
  return phase.vetoed.flatMap((v, candidate): Action[] =>
    v === null ? [{ type: 'vetoMap', player, candidate }] : [],
  );
};
