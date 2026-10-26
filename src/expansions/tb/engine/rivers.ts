/**
 * The Rivers of Catan (docs/rules/traders-barbarians.md §2.3, §3.4, §4.6): roads may not cross a
 * river except as bridges (3 per player, 2 brick + 1 lumber, +3 gold); building next to a river
 * pays gold; the Wealthiest Settler gets +1 VP, every Poor Settler -2 VP.
 *
 * Bridges are road pieces (`pieces.roads`, so they count for Longest Road and settlement
 * connection) marked in the slice; `pieceLimit` adds them to the 15 roads.
 */
import { isCurrent } from '../../../engine/actions/common';
import { isBuildPhase } from '../../../engine/actions/build';
import { costOf } from '../../../engine/expansions/hooks';
import { hasResources } from '../../../engine/resources';
import { topologyOf } from '../../../engine/topology';
import { blocksRoute } from '../../../engine/expansions/hooks';
import type { Action, EdgeId, GameState, PlayerId, VertexId } from '../../../engine/types';
import { goldOf } from './common';
import {
  BRIDGES_PER_PLAYER,
  BRIDGE_ITEM,
  POOR_VP,
  WEALTHY_VP,
  bridgesOf,
  tbBoard,
  tbSlice,
} from './state';

export const isBridgeSite = (state: GameState, e: EdgeId): boolean =>
  (tbBoard(state).bridgeSites ?? []).includes(e);

const riverSet = (state: GameState) => new Set(tbBoard(state).rivers ?? []);

/** A vertex next to a river hex (a settlement there pays 1 gold). */
export function vertexOnRiver(state: GameState, v: VertexId): boolean {
  const rivers = riverSet(state);
  return (topologyOf(state).vertex[v]?.hexes ?? []).some((h) => rivers.has(h));
}

/** An edge next to a river hex (a road there pays 1 gold). */
export function edgeOnRiver(state: GameState, e: EdgeId): boolean {
  const rivers = riverSet(state);
  return (topologyOf(state).edge[e]?.hexes ?? []).some((h) => rivers.has(h));
}

export const bridgesBuilt = (state: GameState, p: PlayerId): number =>
  Object.values(bridgesOf(state)).filter((o) => o === p).length;

/** A bridge connects like a road: to a building of yours, or to your road not cut by a rival. */
function connected(state: GameState, p: PlayerId, e: EdgeId): boolean {
  const t = topologyOf(state);
  return (t.edge[e]?.vertices ?? []).some((v) => {
    const b = state.pieces.buildings[v];
    if (b !== undefined) return b.owner === p;
    if (blocksRoute(state, v, p)) return false;
    return (t.vertex[v]?.edges ?? []).some((o) => o !== e && state.pieces.roads[o] === p);
  });
}

export function bridgeBlocker(state: GameState, p: PlayerId, e: unknown): string | null {
  if (!isBuildPhase(state)) return 'build bridges in the main or special building phase';
  if (!isCurrent(state, p)) return 'not your turn';
  if (bridgesBuilt(state, p) >= BRIDGES_PER_PLAYER) return 'no bridges left';
  const hand = state.players[p]?.resources;
  const cost = costOf(state, BRIDGE_ITEM);
  if (!hand || !cost || !hasResources(hand, cost)) return 'cannot afford a bridge';
  if (typeof e !== 'string' || !isBridgeSite(state, e as EdgeId)) return 'not a bridge site';
  const neutral = tbSlice(state).two?.neutrals.some((nt) => nt.roads.includes(e as EdgeId));
  if (state.pieces.roads[e as EdgeId] !== undefined || neutral) return 'there is a bridge already';
  if (!connected(state, p, e as EdgeId)) return 'a bridge must connect to your road or building';
  return null;
}

export function riversLegal(state: GameState): Action[] {
  const p = state.turn.current;
  if (!isBuildPhase(state)) return [];
  return (tbBoard(state).bridgeSites ?? [])
    .filter((edge) => bridgeBlocker(state, p, edge) === null)
    .map((edge) => ({ type: 'tb/buildBridge', player: p, edge }) as unknown as Action);
}

/** Wealthiest Settler (+1, strictly the most gold) and Poor Settler (-2, tied for the least). */
export function riversVictoryParts(state: GameState, p: PlayerId): { label: string; vp: number }[] {
  const gold = state.players.map((x) => goldOf(state, x.id));
  const max = Math.max(...gold);
  const min = Math.min(...gold);
  const mine = gold[p] ?? 0;
  const out: { label: string; vp: number }[] = [];
  if (mine === max && gold.filter((g) => g === max).length === 1) {
    out.push({ label: 'Wealthiest Settler', vp: WEALTHY_VP });
  }
  if (mine === min) out.push({ label: 'Poor Settler', vp: POOR_VP });
  return out;
}
