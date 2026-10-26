/**
 * Board geometry over land AND sea (the shared sea graph, engine/expansions/seaGraph.ts), and
 * what lies on each side of an edge in a given game (land / sea / fog / frame).
 */
import { terrainKind } from '../../../engine/expansions/hooks';
import { seaGraph, type SeaGraph } from '../../../engine/expansions/seaGraph';
import type { EdgeId, GameState, HexId } from '../../../engine/types';
import { seaBoard, type SeaBoard } from './maps';

export { graphOf, type SeaGraph } from '../../../engine/expansions/seaGraph';

export function graph(state: Pick<GameState, 'settings'>): SeaGraph {
  return seaGraph(state);
}

const INSIDE = new WeakMap<SeaBoard, ReadonlySet<HexId>>();
function insideSet(sb: SeaBoard): ReadonlySet<HexId> {
  let s = INSIDE.get(sb);
  if (!s) {
    s = new Set(sb.inside);
    INSIDE.set(sb, s);
  }
  return s;
}

export type SideKind = 'land' | 'sea' | 'fog' | 'frame';

/** What a hex is in this game: a board hex's terrain kind, playing-area sea, or the frame. */
export function hexKind(state: GameState, h: HexId): SideKind {
  const tile = state.board.hexes[h];
  if (tile) return terrainKind(tile.terrain);
  return insideSet(seaBoard(state)).has(h) ? 'sea' : 'frame';
}

/** A hex the pirate may stand on: playing-area sea, revealed sea, or the frame (FAQ #4). */
export function isSeaHex(state: GameState, h: HexId): boolean {
  const k = hexKind(state, h);
  return k === 'sea' || k === 'frame';
}

/**
 * A ship may lie on this edge (§3.2): not between two land hexes, with sea on one side, or
 * the inner edge of the frame (land | frame). Fog counts as neither: a ship next to fog sits on
 * the sea side of it, and the edge between land and fog is a road edge.
 */
export function isShipEdge(state: GameState, e: EdgeId): boolean {
  const sides = graph(state).sides.get(e);
  if (!sides) return false;
  let land = 0;
  let sea = 0;
  let frame = 0;
  for (const h of sides) {
    const k = hexKind(state, h);
    if (k === 'land') land++;
    else if (k === 'sea') sea++;
    else if (k === 'frame') frame++;
  }
  if (land >= 2) return false;
  return sea > 0 || (land === 1 && frame === 1);
}

/** Does the edge border the hex `h`? */
export function edgeTouchesHex(state: GameState, e: EdgeId, h: HexId): boolean {
  return graph(state).sides.get(e)?.includes(h) ?? false;
}
