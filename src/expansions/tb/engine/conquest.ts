/**
 * Barbarian Attack conquest (docs/rules/traders-barbarians.md §4.8.2), read-only: used by the
 * production, VP, harbour and building rules of every feature.
 */
import { topologyOf } from '../../../engine/topology';
import type { GameState, HexId, VertexId } from '../../../engine/types';
import { CASTLE, has, tbSlice } from './state';

export const CONQUER_AT = 3;

/** A coastal hex holding 3 barbarians (it produces nothing). */
export function isConqueredHex(state: GameState, h: HexId): boolean {
  if (!has(state, 'ba')) return false;
  return (tbSlice(state).ba?.onHex[h] ?? 0) >= CONQUER_AT;
}

/**
 * A building is conquered when every land hex around it is conquered (castle and desert never
 * are, so buildings next to them are safe). It gives 0 VP and its harbour is unusable.
 */
export function isConqueredBuilding(state: GameState, v: VertexId): boolean {
  if (!has(state, 'ba') || state.pieces.buildings[v] === undefined) return false;
  const hexes = topologyOf(state).vertex[v]?.hexes ?? [];
  return (
    hexes.length > 0 &&
    hexes.every((h) => state.board.hexes[h]?.terrain !== CASTLE && isConqueredHex(state, h))
  );
}

/** A vertex / edge next to a conquered hex: no new settlement / road there. */
export function nextToConquered(state: GameState, hexes: readonly HexId[]): boolean {
  return hexes.some((h) => isConqueredHex(state, h));
}
