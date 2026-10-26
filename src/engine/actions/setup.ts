/**
 * OWNER: T2 (rules-core).
 * Initial placement in snake order (see Phase 'setup' in types.ts).
 * Round-2 settlements (index >= n) produce one resource per adjacent non-desert hex.
 * After the last road: turn.number = 1, current = settings.startingPlayer, phase = preRoll.
 * Helpers: canPlaceSettlement(.., { requireRoad: false }), canPlaceRoad(.., { fromVertex }),
 * setupPlayerAt().
 * V1 variants: settings.setupPlacement picks each round's building (settlement / city) and
 * restriction (distance rule / any empty vertex); settings.turboMode pays in round 1 too.
 */
import { RESOURCES } from '../constants';
import { canPlaceRoad, canPlaceSettlement, touchesLand } from '../rules/placement';
import { describeBundle, playerName } from '../rules/text';
import { piecesLeft, setupPlayerAt } from '../selectors';
import { isBoardEdge, isBoardVertex, topologyOf, vertexEdges, vertexHexes } from '../topology';
import { setupBuildingKind, vertexBlocked } from '../expansions/hooks';
import { emptyResources, isResource } from '../resources';
import type { Action, EdgeId, GameState, PlayerId, SetupRound, VertexId } from '../types';
import { setupPlacementOf } from '../variants';
import { type HandlerMap, type LegalGenerator, fail, isCurrent, log, ok } from './common';
import { beginTurn } from './turn';

/**
 * The building and restriction of setup placement `index` (round 1: index < n). An expansion's
 * setupBuilding hook (C&K / E&P) decides the building over settings.setupPlacement.
 */
export function setupRoundAt(state: GameState, index: number): SetupRound {
  const p = setupPlacementOf(state.settings);
  const round = index < state.players.length ? p.first : p.second;
  const building = setupBuildingKind(state, index, round.building);
  return building === round.building ? round : { ...round, building };
}

function canSetupSettlement(
  state: GameState,
  player: PlayerId,
  v: VertexId,
  round: SetupRound,
): boolean {
  if (piecesLeft(state, player)[round.building] <= 0) return false;
  if (round.restriction === 'anyVertex') {
    return (
      isBoardVertex(topologyOf(state), v) &&
      state.pieces.buildings[v] === undefined &&
      !vertexBlocked(state, v) &&
      touchesLand(state, v)
    );
  }
  return canPlaceSettlement(state, player, v, { requireRoad: false });
}

function canSetupRoad(state: GameState, player: PlayerId, e: EdgeId, from: VertexId): boolean {
  return piecesLeft(state, player).road > 0 && canPlaceRoad(state, player, e, { fromVertex: from });
}

export const setupHandlers: HandlerMap<'placeSetupSettlement' | 'placeSetupRoad'> = {
  placeSetupSettlement: (draft, action) => {
    const phase = draft.phase;
    if (phase.kind !== 'setup' || phase.step !== 'settlement') {
      return fail('not placing a setup settlement now');
    }
    if (!isCurrent(draft, action.player)) return fail('not your turn');
    if (!isBoardVertex(topologyOf(draft), action.vertex)) return fail('invalid vertex');
    const round = setupRoundAt(draft, phase.index);
    if (!canSetupSettlement(draft, action.player, action.vertex, round)) {
      return fail('vertex is taken or too close to another building');
    }

    draft.pieces.buildings[action.vertex] = { owner: action.player, kind: round.building };
    let text = `${playerName(draft, action.player)} placed a ${round.building}`;
    // Round 2 pays starting resources (Turbo Mode: both rounds). A setup city pays like a
    // settlement, 1 per hex (C&K's second-placement city does the same).
    if (phase.index >= draft.players.length || draft.settings.turboMode) {
      const gain = emptyResources();
      for (const h of vertexHexes(topologyOf(draft), action.vertex)) {
        const terrain = draft.board.hexes[h]?.terrain;
        if (isResource(terrain) && draft.bank[terrain] > gain[terrain]) {
          gain[terrain] += 1;
        }
      }
      const hand = draft.players[action.player]?.resources;
      if (hand) {
        for (const r of RESOURCES) {
          hand[r] += gain[r];
          draft.bank[r] -= gain[r];
        }
      }
      text += ` and received ${describeBundle(gain)}`;
    }
    draft.phase = { ...phase, step: 'road', lastSettlement: action.vertex };
    log(draft, action.player, text);
    return ok(draft);
  },

  placeSetupRoad: (draft, action) => {
    const phase = draft.phase;
    if (phase.kind !== 'setup' || phase.step !== 'road' || phase.lastSettlement === null) {
      return fail('not placing a setup road now');
    }
    if (!isCurrent(draft, action.player)) return fail('not your turn');
    if (!isBoardEdge(topologyOf(draft), action.edge)) return fail('invalid edge');
    if (!canSetupRoad(draft, action.player, action.edge, phase.lastSettlement)) {
      return fail('road must be on an empty edge touching the settlement just placed');
    }

    draft.pieces.roads[action.edge] = action.player;
    log(draft, action.player, `${playerName(draft, action.player)} placed a road`);
    advanceSetup(draft);
    return ok(draft);
  },
};

/**
 * Finish the current setup step (after its road): next player's settlement, or the first turn.
 * Exported for expansions whose setup piece replaces the road (a Seafarers ship).
 */
export function advanceSetup(draft: GameState): void {
  const phase = draft.phase;
  if (phase.kind !== 'setup') return;
  const n = draft.players.length;
  const next = phase.index + 1;
  if (next >= 2 * n) {
    draft.turn.number = 1;
    draft.turn.current = draft.settings.startingPlayer;
    log(draft, null, 'Setup complete');
    beginTurn(draft);
  } else {
    draft.turn.current = setupPlayerAt(next, n, draft.settings.startingPlayer);
    draft.phase = { kind: 'setup', index: next, step: 'settlement', lastSettlement: null };
  }
}

export const setupLegal: LegalGenerator = (state: GameState): Action[] => {
  const phase = state.phase;
  if (phase.kind !== 'setup') return [];
  const player = state.turn.current;
  if (phase.step === 'settlement') {
    const round = setupRoundAt(state, phase.index);
    return topologyOf(state)
      .vertices.filter((v) => canSetupSettlement(state, player, v, round))
      .map((vertex) => ({ type: 'placeSetupSettlement', player, vertex }));
  }
  const from = phase.lastSettlement;
  if (from === null) return [];
  return vertexEdges(topologyOf(state), from)
    .filter((e) => canSetupRoad(state, player, e, from))
    .map((edge) => ({ type: 'placeSetupRoad', player, edge }));
};
