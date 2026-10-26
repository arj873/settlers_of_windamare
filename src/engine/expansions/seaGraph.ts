/**
 * Board graph over land AND sea for ship modules (Seafarers, Explorers & Pirates): every vertex
 * and edge of a topology (land-touching and sea-only), with the hexes on each side of an edge and
 * around a vertex (board hexes and water hexes of the frame). Built once per topology, cached.
 */
import { topologyOf, type Topology } from '../topology';
import type { EdgeId, GameState, HexId, VertexId } from '../types';

export interface SeaGraph {
  /** Every edge of the frame (road edges first, then sea-only ones). */
  edges: readonly EdgeId[];
  /** Every vertex of the frame. */
  vertices: readonly VertexId[];
  ends: ReadonlyMap<EdgeId, readonly [VertexId, VertexId]>;
  /** Incident edges of any vertex. */
  edgesAt: ReadonlyMap<VertexId, readonly EdgeId[]>;
  /** Vertices one edge away (over land or sea). */
  neighbors: ReadonlyMap<VertexId, readonly VertexId[]>;
  /** Hexes on either side of an edge (board hexes and water hexes of the frame). */
  sides: ReadonlyMap<EdgeId, readonly HexId[]>;
  /** Hexes around a vertex (board and water). */
  hexesAt: ReadonlyMap<VertexId, readonly HexId[]>;
  /** The 6 vertices / edges of any hex of the frame. */
  hexVertices: ReadonlyMap<HexId, readonly VertexId[]>;
  hexEdges: ReadonlyMap<HexId, readonly EdgeId[]>;
}

const GRAPHS = new WeakMap<Topology, SeaGraph>();

function push<K, V>(m: Map<K, V[]>, k: K, v: V) {
  const list = m.get(k);
  if (list) {
    if (!list.includes(v)) list.push(v);
  } else m.set(k, [v]);
}

export function graphOf(t: Topology): SeaGraph {
  let g = GRAPHS.get(t);
  if (g) return g;
  const edges = [...t.edges, ...t.seaEdges];
  const ends = new Map<EdgeId, readonly [VertexId, VertexId]>();
  const edgesAt = new Map<VertexId, EdgeId[]>();
  const neighbors = new Map<VertexId, VertexId[]>();
  const sides = new Map<EdgeId, HexId[]>();
  const hexesAt = new Map<VertexId, HexId[]>();
  for (const e of edges) {
    const info = t.edge[e] ?? t.seaEdge[e];
    if (!info) continue;
    const [a, b] = info.vertices;
    ends.set(e, [a, b]);
    push(edgesAt, a, e);
    push(edgesAt, b, e);
    push(neighbors, a, b);
    push(neighbors, b, a);
    sides.set(e, [...info.hexes, ...info.seas]);
  }
  const hexVertices = new Map<HexId, readonly VertexId[]>();
  const hexEdges = new Map<HexId, readonly EdgeId[]>();
  for (const h of Object.values(t.hex)) {
    hexVertices.set(h.id, h.vertices);
    hexEdges.set(h.id, h.edges);
    for (const v of h.vertices) push(hexesAt, v, h.id);
  }
  for (const w of Object.values(t.water)) {
    hexVertices.set(w.id, w.vertices);
    hexEdges.set(w.id, w.edges);
    for (const v of w.vertices) push(hexesAt, v, w.id);
  }
  g = {
    edges,
    vertices: [...t.vertices, ...t.seaVertices],
    ends,
    edgesAt,
    neighbors,
    sides,
    hexesAt,
    hexVertices,
    hexEdges,
  };
  GRAPHS.set(t, g);
  return g;
}

/** The sea graph of a game's board. */
export function seaGraph(state: Pick<GameState, 'settings'>): SeaGraph {
  return graphOf(topologyOf(state));
}
