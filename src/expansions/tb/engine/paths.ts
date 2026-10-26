/**
 * The paths wagons, camels and barbarians use. On a T&B board these are the road edges. On a map
 * with open sea (T&B + Seafarers, docs/rules/combos.md §3) the sea edges inside the frame are
 * paths too: wagons cross the sea, camels and barbarians may stand there. Pieces that carry a
 * wagon like a road (ships) come from the `routeEdges` hook, so this module needs no Seafarers
 * code.
 */
import { extraRouteEdges } from '../../../engine/expansions/hooks';
import { graphOf } from '../../../engine/expansions/seaGraph';
import { edgeTouchesLand } from '../../../engine/rules/placement';
import { edgeVertices, topologyOf, vertexEdges, type Topology } from '../../../engine/topology';
import type { EdgeId, GameState, HexId, PlayerId, VertexId } from '../../../engine/types';

interface SeaPaths {
  edges: readonly EdgeId[];
  at: ReadonlyMap<VertexId, readonly EdgeId[]>;
}

const PATHS = new WeakMap<Topology, SeaPaths | null>();

/**
 * The board's sea paths (null: no open sea): every edge touching a board hex or a sea hex inside
 * the frame (playable, all six neighbours on the map); edges between two frame cells are not
 * paths, as they are no ship edges in Seafarers.
 */
function seaPathsOf(t: Topology): SeaPaths | null {
  if (PATHS.has(t)) return PATHS.get(t) ?? null;
  let out: SeaPaths | null = null;
  const inside = (h: HexId) => {
    const w = t.water[h];
    return t.hex[h] !== undefined || (w?.playable === true && w.neighbors.length === 6);
  };
  if (Object.values(t.water).some((w) => w.playable)) {
    const g = graphOf(t);
    const edges = g.edges.filter((e) => (g.sides.get(e) ?? []).some(inside));
    const keep = new Set(edges);
    const at = new Map<VertexId, EdgeId[]>();
    for (const [v, list] of g.edgesAt) {
      at.set(
        v,
        list.filter((e) => keep.has(e)),
      );
    }
    out = { edges, at };
  }
  PATHS.set(t, out);
  return out;
}

/** The map has open sea (a Seafarers map): sea edges are paths. */
export const hasOpenSea = (state: Pick<GameState, 'settings'>): boolean =>
  seaPathsOf(topologyOf(state)) !== null;

/** Every path of the board. */
export function pathEdges(state: Pick<GameState, 'settings'>): readonly EdgeId[] {
  const t = topologyOf(state);
  return seaPathsOf(t)?.edges ?? t.edges;
}

/** The paths at vertex `v`. */
export function pathsAt(state: Pick<GameState, 'settings'>, v: VertexId): readonly EdgeId[] {
  const t = topologyOf(state);
  const sea = seaPathsOf(t);
  return sea ? (sea.at.get(v) ?? []) : vertexEdges(t, v);
}

/** The two ends of path `e`. */
export function pathEnds(state: Pick<GameState, 'settings'>, e: EdgeId): readonly VertexId[] {
  const t = topologyOf(state);
  return t.edge[e]?.vertices ?? t.seaEdge[e]?.vertices ?? edgeVertices(t, e);
}

/** The other end of path `e` from `v`. */
export const pathOther = (state: Pick<GameState, 'settings'>, e: EdgeId, v: VertexId): VertexId =>
  pathEnds(state, e).find((x) => x !== v) as VertexId;

/**
 * Who owns the piece on path `e`: a road, or a route piece of another module (a ship), or null.
 * Route pieces are looked up only on a map with open sea.
 */
export function routeOwner(state: GameState, e: EdgeId): PlayerId | null {
  const road = state.pieces.roads[e];
  if (road !== undefined) return road;
  if (!hasOpenSea(state)) return null;
  for (const p of state.players) if (extraRouteEdges(state, p.id).includes(e)) return p.id;
  return null;
}

/** A path on land (a knight may stand there): it touches a land hex. */
export const isLandPath = (state: GameState, e: EdgeId): boolean => edgeTouchesLand(state, e);
