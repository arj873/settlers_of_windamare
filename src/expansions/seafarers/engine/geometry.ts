/**
 * Board geometry over land AND sea: every vertex and edge of the topology (land-touching and
 * sea-only), and what lies on each side of an edge in a given game (land / sea / fog / frame).
 */
import { terrainKind } from '../../../engine/expansions/hooks';
import { topologyOf, type Topology } from '../../../engine/topology';
import type { EdgeId, GameState, HexId, VertexId } from '../../../engine/types';
import { seaBoard, type SeaBoard } from './maps';

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

export function graph(state: Pick<GameState, 'settings'>): SeaGraph {
  return graphOf(topologyOf(state));
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
