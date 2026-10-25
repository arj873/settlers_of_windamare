/**
 * OWNER: T2 (rules-core).
 * Initial placement in snake order (see Phase 'setup' in types.ts).
 * Round-2 settlements (index >= n) produce one resource per adjacent non-desert hex.
 * After the last road: turn.number = 1, current = 0, phase = preRoll.
 * Helpers: canPlaceSettlement(.., { requireRoad: false }), canPlaceRoad(.., { fromVertex }),
 * setupPlayerAt().
 */
import { RESOURCES } from '../constants';
import { canPlaceRoad, canPlaceSettlement } from '../rules/placement';
import { describeBundle, playerName } from '../rules/text';
import { piecesLeft, setupPlayerAt } from '../selectors';
import { isBoardEdge, isBoardVertex, vertexEdges, vertexHexes, TOPOLOGY } from '../topology';
import { emptyResources } from '../resources';
import type { Action, EdgeId, GameState, PlayerId, VertexId } from '../types';
import { type HandlerMap, type LegalGenerator, fail, isCurrent, log, ok } from './common';

function canSetupSettlement(state: GameState, player: PlayerId, v: VertexId): boolean {
  return (
    piecesLeft(state, player).settlement > 0 &&
    canPlaceSettlement(state, player, v, { requireRoad: false })
  );
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
    if (!isBoardVertex(action.vertex)) return fail('invalid vertex');
    if (!canSetupSettlement(draft, action.player, action.vertex)) {
      return fail('vertex is taken or too close to another building');
    }

    draft.pieces.buildings[action.vertex] = { owner: action.player, kind: 'settlement' };
    let text = `${playerName(draft, action.player)} placed a settlement`;
    if (phase.index >= draft.players.length) {
      const gain = emptyResources();
      for (const h of vertexHexes(action.vertex)) {
        const terrain = draft.board.hexes[h]?.terrain;
        if (terrain && terrain !== 'desert' && draft.bank[terrain] > gain[terrain]) {
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
    if (!isBoardEdge(action.edge)) return fail('invalid edge');
    if (!canSetupRoad(draft, action.player, action.edge, phase.lastSettlement)) {
      return fail('road must be on an empty edge touching the settlement just placed');
    }

    draft.pieces.roads[action.edge] = action.player;
    log(draft, action.player, `${playerName(draft, action.player)} placed a road`);

    const n = draft.players.length;
    const next = phase.index + 1;
    if (next >= 2 * n) {
      draft.turn.number = 1;
      draft.turn.current = 0;
      draft.phase = { kind: 'preRoll' };
      log(draft, null, 'Setup complete');
    } else {
      draft.turn.current = setupPlayerAt(next, n);
      draft.phase = { kind: 'setup', index: next, step: 'settlement', lastSettlement: null };
    }
    return ok(draft);
  },
};

export const setupLegal: LegalGenerator = (state: GameState): Action[] => {
  const phase = state.phase;
  if (phase.kind !== 'setup') return [];
  const player = state.turn.current;
  if (phase.step === 'settlement') {
    return TOPOLOGY.vertices
      .filter((v) => canSetupSettlement(state, player, v))
      .map((vertex) => ({ type: 'placeSetupSettlement', player, vertex }));
  }
  const from = phase.lastSettlement;
  if (from === null) return [];
  return vertexEdges(from)
    .filter((e) => canSetupRoad(state, player, e, from))
    .map((edge) => ({ type: 'placeSetupRoad', player, edge }));
};
