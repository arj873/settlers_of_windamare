/**
 * OWNER: T2 (rules-core).
 * Phase main, or specialBuild for its builder (T13). Pay COSTS.* into the bank; respect piecesLeft().
 * buildCity returns the settlement piece to the supply (implicit: piecesLeft is derived).
 * Helpers: canPlaceRoad, canPlaceSettlement(.., { requireRoad: true }), canPlaceCity.
 */
import { COSTS, RESOURCES } from '../constants';
import { canPlaceCity, canPlaceRoad, canPlaceSettlement } from '../rules/placement';
import { playerName } from '../rules/text';
import { hasResources } from '../resources';
import { buildingsOf, piecesLeft } from '../selectors';
import { isBoardEdge, isBoardVertex, topologyOf } from '../topology';
import type {
  Action,
  ActionResult,
  EdgeId,
  GameState,
  PlayerId,
  ResourceCounts,
  VertexId,
} from '../types';
import { nextToDamagedRoad, roadsBlocked } from '../variants';
import { type HandlerMap, type LegalGenerator, fail, isCurrent, log, ok } from './common';

type Piece = 'road' | 'settlement' | 'city';
const PLURAL: Record<Piece, string> = { road: 'roads', settlement: 'settlements', city: 'cities' };

/** Building is allowed in `main` and in the special building phase (turn.current = builder). */
export function isBuildPhase(state: GameState): boolean {
  return state.phase.kind === 'main' || state.phase.kind === 'specialBuild';
}

/** Phase, turn, cost and supply checks shared by all builds. Returns an error or null. */
function buildPrecheck(state: GameState, player: PlayerId, piece: Piece): string | null {
  if (!isBuildPhase(state)) return 'can only build in the main or special building phase';
  if (!isCurrent(state, player)) return 'not your turn';
  const hand = state.players[player]?.resources;
  if (!hand || !hasResources(hand, COSTS[piece])) return `cannot afford a ${piece}`;
  if (piecesLeft(state, player)[piece] <= 0) return `no ${PLURAL[piece]} left`;
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

/** Road placement incl. the Earthquake event (no roads while one of yours is damaged). */
function roadSpotOk(state: GameState, player: PlayerId, e: EdgeId): boolean {
  return !roadsBlocked(state, player) && canPlaceRoad(state, player, e);
}

/** Settlement placement incl. the Earthquake event (not at your damaged road). */
function settlementSpotOk(state: GameState, player: PlayerId, v: VertexId): boolean {
  return (
    canPlaceSettlement(state, player, v, { requireRoad: true }) &&
    !nextToDamagedRoad(state, player, v)
  );
}

export function canBuildRoad(state: GameState, player: PlayerId, e: EdgeId): boolean {
  return buildPrecheck(state, player, 'road') === null && roadSpotOk(state, player, e);
}

export function canBuildSettlement(state: GameState, player: PlayerId, v: VertexId): boolean {
  return buildPrecheck(state, player, 'settlement') === null && settlementSpotOk(state, player, v);
}

/** Earthquake: can `player` repair their damaged road now (build phase, 1 brick + 1 lumber)? */
export function canRepairRoad(state: GameState, player: PlayerId): string | null {
  if (!isBuildPhase(state)) return 'can only repair in the main or special building phase';
  if (!isCurrent(state, player)) return 'not your turn';
  if (!roadsBlocked(state, player)) return 'you have no damaged road';
  const hand = state.players[player]?.resources;
  if (!hand || !hasResources(hand, COSTS.road)) return 'repairs cost 1 brick and 1 lumber';
  return null;
}

export function canBuildCity(state: GameState, player: PlayerId, v: VertexId): boolean {
  return buildPrecheck(state, player, 'city') === null && canPlaceCity(state, player, v);
}

export const buildHandlers: HandlerMap<
  'buildRoad' | 'buildSettlement' | 'buildCity' | 'repairRoad'
> = {
  buildRoad: (draft, action) => {
    const err = buildPrecheck(draft, action.player, 'road');
    if (err) return fail(err);
    if (!isBoardEdge(topologyOf(draft), action.edge)) return fail('invalid edge');
    if (roadsBlocked(draft, action.player)) return fail('repair your damaged road first');
    if (!canPlaceRoad(draft, action.player, action.edge)) {
      return fail('road must be on an empty edge connected to your network');
    }
    draft.pieces.roads[action.edge] = action.player;
    return built(draft, action.player, 'road');
  },

  buildSettlement: (draft, action) => {
    const err = buildPrecheck(draft, action.player, 'settlement');
    if (err) return fail(err);
    if (!isBoardVertex(topologyOf(draft), action.vertex)) return fail('invalid vertex');
    if (!canPlaceSettlement(draft, action.player, action.vertex, { requireRoad: true })) {
      return fail('settlement must be on an open vertex touching your road');
    }
    if (nextToDamagedRoad(draft, action.player, action.vertex)) {
      return fail('no settlement next to your damaged road');
    }
    draft.pieces.buildings[action.vertex] = { owner: action.player, kind: 'settlement' };
    return built(draft, action.player, 'settlement');
  },

  buildCity: (draft, action) => {
    const err = buildPrecheck(draft, action.player, 'city');
    if (err) return fail(err);
    if (!isBoardVertex(topologyOf(draft), action.vertex)) return fail('invalid vertex');
    if (!canPlaceCity(draft, action.player, action.vertex)) {
      return fail('a city must replace one of your settlements');
    }
    draft.pieces.buildings[action.vertex] = { owner: action.player, kind: 'city' };
    return built(draft, action.player, 'city');
  },

  repairRoad: (draft, action) => {
    const err = canRepairRoad(draft, action.player);
    if (err) return fail(err);
    pay(draft, action.player, COSTS.road);
    const damaged = draft.damagedRoads ? [...draft.damagedRoads] : [];
    damaged[action.player] = null;
    draft.damagedRoads = damaged;
    log(draft, action.player, `${playerName(draft, action.player)} repaired their road`);
    return ok(draft);
  },
};

export const buildLegal: LegalGenerator = (state: GameState): Action[] => {
  if (!isBuildPhase(state)) return [];
  const player = state.turn.current;
  const out: Action[] = [];
  if (buildPrecheck(state, player, 'road') === null && !roadsBlocked(state, player)) {
    for (const edge of topologyOf(state).edges) {
      if (canPlaceRoad(state, player, edge)) out.push({ type: 'buildRoad', player, edge });
    }
  }
  if (canRepairRoad(state, player) === null) out.push({ type: 'repairRoad', player });
  if (buildPrecheck(state, player, 'settlement') === null) {
    for (const vertex of topologyOf(state).vertices) {
      if (settlementSpotOk(state, player, vertex)) {
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
