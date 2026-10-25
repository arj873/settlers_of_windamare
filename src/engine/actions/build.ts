/**
 * OWNER: T2 (rules-core).
 * Phase main only. Pay COSTS.* into the bank; respect piecesLeft().
 * buildCity returns the settlement piece to the supply (implicit: piecesLeft is derived).
 * Helpers: canPlaceRoad, canPlaceSettlement(.., { requireRoad: true }), canPlaceCity.
 */
import { COSTS, RESOURCES } from '../constants';
import { canPlaceCity, canPlaceRoad, canPlaceSettlement } from '../rules/placement';
import { playerName } from '../rules/text';
import { hasResources } from '../resources';
import { buildingsOf, piecesLeft } from '../selectors';
import { isBoardEdge, isBoardVertex, TOPOLOGY } from '../topology';
import type {
  Action,
  ActionResult,
  EdgeId,
  GameState,
  PlayerId,
  ResourceCounts,
  VertexId,
} from '../types';
import { type HandlerMap, type LegalGenerator, fail, isCurrent, log, ok } from './common';

type Piece = 'road' | 'settlement' | 'city';

/** Phase, turn, cost and supply checks shared by all builds. Returns an error or null. */
function buildPrecheck(state: GameState, player: PlayerId, piece: Piece): string | null {
  if (state.phase.kind !== 'main') return 'can only build in the main phase';
  if (!isCurrent(state, player)) return 'not your turn';
  const hand = state.players[player]?.resources;
  if (!hand || !hasResources(hand, COSTS[piece])) return `cannot afford a ${piece}`;
  if (piecesLeft(state, player)[piece] <= 0) return `no ${piece}s left`;
  return null;
}

function pay(draft: GameState, player: PlayerId, cost: ResourceCounts): void {
  const hand = draft.players[player]?.resources;
  if (!hand) return;
  for (const r of RESOURCES) {
    hand[r] -= cost[r];
    draft.bank[r] += cost[r];
  }
}

function built(draft: GameState, player: PlayerId, piece: Piece): ActionResult {
  pay(draft, player, COSTS[piece]);
  log(draft, player, `${playerName(draft, player)} built a ${piece}`);
  return ok(draft);
}

export function canBuildRoad(state: GameState, player: PlayerId, e: EdgeId): boolean {
  return buildPrecheck(state, player, 'road') === null && canPlaceRoad(state, player, e);
}

export function canBuildSettlement(state: GameState, player: PlayerId, v: VertexId): boolean {
  return (
    buildPrecheck(state, player, 'settlement') === null &&
    canPlaceSettlement(state, player, v, { requireRoad: true })
  );
}

export function canBuildCity(state: GameState, player: PlayerId, v: VertexId): boolean {
  return buildPrecheck(state, player, 'city') === null && canPlaceCity(state, player, v);
}

export const buildHandlers: HandlerMap<'buildRoad' | 'buildSettlement' | 'buildCity'> = {
  buildRoad: (draft, action) => {
    const err = buildPrecheck(draft, action.player, 'road');
    if (err) return fail(err);
    if (!isBoardEdge(action.edge)) return fail('invalid edge');
    if (!canPlaceRoad(draft, action.player, action.edge)) {
      return fail('road must be on an empty edge connected to your network');
    }
    draft.pieces.roads[action.edge] = action.player;
    return built(draft, action.player, 'road');
  },

  buildSettlement: (draft, action) => {
    const err = buildPrecheck(draft, action.player, 'settlement');
    if (err) return fail(err);
    if (!isBoardVertex(action.vertex)) return fail('invalid vertex');
    if (!canPlaceSettlement(draft, action.player, action.vertex, { requireRoad: true })) {
      return fail('settlement must be on an open vertex touching your road');
    }
    draft.pieces.buildings[action.vertex] = { owner: action.player, kind: 'settlement' };
    return built(draft, action.player, 'settlement');
  },

  buildCity: (draft, action) => {
    const err = buildPrecheck(draft, action.player, 'city');
    if (err) return fail(err);
    if (!isBoardVertex(action.vertex)) return fail('invalid vertex');
    if (!canPlaceCity(draft, action.player, action.vertex)) {
      return fail('a city must replace one of your settlements');
    }
    draft.pieces.buildings[action.vertex] = { owner: action.player, kind: 'city' };
    return built(draft, action.player, 'city');
  },
};

export const buildLegal: LegalGenerator = (state: GameState): Action[] => {
  if (state.phase.kind !== 'main') return [];
  const player = state.turn.current;
  const out: Action[] = [];
  if (buildPrecheck(state, player, 'road') === null) {
    for (const edge of TOPOLOGY.edges) {
      if (canPlaceRoad(state, player, edge)) out.push({ type: 'buildRoad', player, edge });
    }
  }
  if (buildPrecheck(state, player, 'settlement') === null) {
    for (const vertex of TOPOLOGY.vertices) {
      if (canPlaceSettlement(state, player, vertex, { requireRoad: true })) {
        out.push({ type: 'buildSettlement', player, vertex });
      }
    }
  }
  if (buildPrecheck(state, player, 'city') === null) {
    for (const vertex of buildingsOf(state, player, 'settlement')) {
      out.push({ type: 'buildCity', player, vertex });
    }
  }
  return out;
};
