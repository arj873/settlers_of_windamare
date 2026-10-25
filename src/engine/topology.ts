/**
 * Static topology of the standard 19-hex base-game board (radius 2) plus its water ring.
 * Computed once at import; identical for every game, so it is NOT stored in GameState.
 *
 * Counts: 19 land hexes, 18 water hexes, 54 vertices, 72 edges, 30 coastal edges, 9 port slots.
 * All adjacency lists only contain land hexes and on-board vertices/edges.
 */
import {
  CORNERS,
  DIRECTIONS,
  SIDES,
  cornerVertex,
  edgeEndpoints,
  edgeMidpoint,
  hexCenter,
  hexDistance,
  hexId,
  neighbor,
  sideEdge,
  vertexPoint,
  type Side,
} from './hex';
import type { EdgeId, HexId, VertexId } from './types';

export interface HexInfo {
  id: HexId;
  q: number;
  r: number;
  /** Center in unit coordinates (hex size 1, y down). */
  x: number;
  y: number;
  /** 6 corners, clockwise from N. */
  vertices: VertexId[];
  /** 6 sides, clockwise from NE (side i joins vertices[i] and vertices[i+1]). */
  edges: EdgeId[];
  /** Adjacent LAND hexes. */
  neighbors: HexId[];
}

export interface WaterHexInfo {
  id: HexId;
  q: number;
  r: number;
  x: number;
  y: number;
}

export interface VertexInfo {
  id: VertexId;
  x: number;
  y: number;
  /** Adjacent land hexes (1–3). */
  hexes: HexId[];
  /** Incident edges (2–3). */
  edges: EdgeId[];
  /** Vertices one edge away (2–3). Used for the distance rule. */
  vertices: VertexId[];
  coastal: boolean;
}

export interface EdgeInfo {
  id: EdgeId;
  /** Midpoint in unit coordinates. */
  x: number;
  y: number;
  vertices: [VertexId, VertexId];
  /** Edges sharing a vertex with this one (2–4). */
  edges: EdgeId[];
  /** Adjacent land hexes (1–2). */
  hexes: HexId[];
  coastal: boolean;
}

export interface PortSlot {
  /** 0..8, clockwise from the top-left water corner. */
  index: number;
  edge: EdgeId;
  vertices: [VertexId, VertexId];
  waterHex: HexId;
}

export interface Topology {
  radius: number;
  /** Row-major: top row first, left to right. Beginner/random layouts fill hexes in this order. */
  landHexes: readonly HexId[];
  /** Water ring, clockwise starting at the top-left corner h:0,-3. */
  waterHexes: readonly HexId[];
  vertices: readonly VertexId[];
  edges: readonly EdgeId[];
  /** 30 coastal edges, clockwise starting at port slot 0. */
  coastalEdges: readonly EdgeId[];
  portSlots: readonly PortSlot[];
  hex: Readonly<Record<HexId, HexInfo>>;
  water: Readonly<Record<HexId, WaterHexInfo>>;
  vertex: Readonly<Record<VertexId, VertexInfo>>;
  edge: Readonly<Record<EdgeId, EdgeInfo>>;
}

export const BOARD_RADIUS = 2;

function buildTopology(radius: number): Topology {
  const origin = { q: 0, r: 0 };

  // Land hexes, row-major.
  const landCoords: { q: number; r: number }[] = [];
  for (let r = -radius; r <= radius; r++) {
    for (let q = Math.max(-radius, -radius - r); q <= Math.min(radius, radius - r); q++) {
      landCoords.push({ q, r });
    }
  }
  const landSet = new Set(landCoords.map((c) => hexId(c.q, c.r)));
  const isLand = (q: number, r: number) => landSet.has(hexId(q, r));

  const hex: Record<HexId, HexInfo> = {};
  const vertex: Record<VertexId, VertexInfo> = {};
  const edge: Record<EdgeId, EdgeInfo> = {};
  const vertexOrder: VertexId[] = [];
  const edgeOrder: EdgeId[] = [];

  for (const { q, r } of landCoords) {
    const id = hexId(q, r);
    const c = hexCenter(q, r);
    const vertices = CORNERS.map((corner) => cornerVertex(q, r, corner));
    const edges = SIDES.map((side) => sideEdge(q, r, side));
    const neighbors = SIDES.map((s) => neighbor(q, r, s))
      .filter((n) => isLand(n.q, n.r))
      .map((n) => hexId(n.q, n.r));
    hex[id] = { id, q, r, x: c.x, y: c.y, vertices, edges, neighbors };

    for (const v of vertices) {
      if (!vertex[v]) {
        const p = vertexPoint(v);
        vertex[v] = { id: v, x: p.x, y: p.y, hexes: [], edges: [], vertices: [], coastal: false };
        vertexOrder.push(v);
      }
      vertex[v].hexes.push(id);
    }
    for (const e of edges) {
      if (!edge[e]) {
        const p = edgeMidpoint(e);
        const ends = edgeEndpoints(e);
        edge[e] = { id: e, x: p.x, y: p.y, vertices: ends, edges: [], hexes: [], coastal: false };
        edgeOrder.push(e);
      }
      edge[e].hexes.push(id);
    }
  }

  // Vertex <-> edge, vertex <-> vertex.
  for (const e of edgeOrder) {
    const info = edge[e] as EdgeInfo;
    info.coastal = info.hexes.length === 1;
    const [a, b] = info.vertices;
    const va = vertex[a] as VertexInfo;
    const vb = vertex[b] as VertexInfo;
    va.edges.push(e);
    vb.edges.push(e);
    va.vertices.push(b);
    vb.vertices.push(a);
  }
  for (const v of vertexOrder) {
    const info = vertex[v] as VertexInfo;
    info.coastal = info.hexes.length < 3;
  }
  // Edge <-> edge (share a vertex).
  for (const e of edgeOrder) {
    const info = edge[e] as EdgeInfo;
    const adj = new Set<EdgeId>();
    for (const v of info.vertices) {
      for (const other of (vertex[v] as VertexInfo).edges) if (other !== e) adj.add(other);
    }
    info.edges = [...adj];
  }

  // Water ring, clockwise from the top-left corner (0, -radius-1).
  const ringRadius = radius + 1;
  const walk: Side[] = ['E', 'SE', 'SW', 'W', 'NW', 'NE'];
  const waterCoords: { q: number; r: number }[] = [];
  let cur = { q: 0, r: -ringRadius };
  for (const side of walk) {
    for (let i = 0; i < ringRadius; i++) {
      waterCoords.push(cur);
      cur = { q: cur.q + DIRECTIONS[side].q, r: cur.r + DIRECTIONS[side].r };
    }
  }
  const water: Record<HexId, WaterHexInfo> = {};
  for (const { q, r } of waterCoords) {
    const c = hexCenter(q, r);
    water[hexId(q, r)] = { id: hexId(q, r), q, r, x: c.x, y: c.y };
  }

  // Port slots: every other water hex starting at index 0 (the standard frame alternates).
  // A water hex touching two land hexes needs one of its two coastal edges; we pick so the
  // 9 ports are spread 2,2,3 coastal edges apart with 3-fold symmetry (see ARCHITECTURE.md).
  const isRingCorner = (q: number, r: number) =>
    hexDistance({ q, r }, origin) === radius &&
    SIDES.filter((s) => {
      const n = neighbor(q, r, s);
      return isLand(n.q, n.r);
    }).length === 3;
  const portSlots: PortSlot[] = [];
  waterCoords.forEach((w, i) => {
    if (i % 2 !== 0) return;
    const shared = SIDES.map((s) => ({ s, n: neighbor(w.q, w.r, s) })).filter(({ n }) =>
      isLand(n.q, n.r),
    );
    let pick = shared[0];
    if (shared.length === 2) {
      const wantCorner = i % 6 === 4;
      pick = shared.find(({ n }) => isRingCorner(n.q, n.r) === wantCorner);
    }
    if (!pick) throw new Error('port slot construction failed');
    const e = sideEdge(w.q, w.r, pick.s);
    portSlots.push({
      index: portSlots.length,
      edge: e,
      vertices: edgeEndpoints(e),
      waterHex: hexId(w.q, w.r),
    });
  });

  // Coastal edges clockwise (screen coords, y down => increasing atan2 is clockwise),
  // rotated to start at port slot 0.
  const angle = (e: EdgeId) => {
    const p = edge[e] as EdgeInfo;
    return Math.atan2(p.y, p.x);
  };
  const coastal = edgeOrder.filter((e) => (edge[e] as EdgeInfo).coastal);
  coastal.sort((a, b) => angle(a) - angle(b));
  const start = coastal.indexOf((portSlots[0] as PortSlot).edge);
  const coastalEdges = [...coastal.slice(start), ...coastal.slice(0, start)];

  return {
    radius,
    landHexes: landCoords.map((c) => hexId(c.q, c.r)),
    waterHexes: waterCoords.map((c) => hexId(c.q, c.r)),
    vertices: vertexOrder,
    edges: edgeOrder,
    coastalEdges,
    portSlots,
    hex,
    water,
    vertex,
    edge,
  };
}

export const TOPOLOGY: Topology = buildTopology(BOARD_RADIUS);

// ---------------------------------------------------------------------------
// Convenience accessors. Unknown IDs return [] / false instead of throwing.
// ---------------------------------------------------------------------------

const NONE: readonly never[] = [];

export function isLandHex(id: string): id is HexId {
  return Object.hasOwn(TOPOLOGY.hex, id);
}
export function isBoardVertex(id: string): id is VertexId {
  return Object.hasOwn(TOPOLOGY.vertex, id);
}
export function isBoardEdge(id: string): id is EdgeId {
  return Object.hasOwn(TOPOLOGY.edge, id);
}

export function hexVertices(h: HexId): readonly VertexId[] {
  return TOPOLOGY.hex[h]?.vertices ?? NONE;
}
export function hexEdges(h: HexId): readonly EdgeId[] {
  return TOPOLOGY.hex[h]?.edges ?? NONE;
}
export function hexNeighbors(h: HexId): readonly HexId[] {
  return TOPOLOGY.hex[h]?.neighbors ?? NONE;
}
export function vertexHexes(v: VertexId): readonly HexId[] {
  return TOPOLOGY.vertex[v]?.hexes ?? NONE;
}
export function vertexEdges(v: VertexId): readonly EdgeId[] {
  return TOPOLOGY.vertex[v]?.edges ?? NONE;
}
export function vertexNeighbors(v: VertexId): readonly VertexId[] {
  return TOPOLOGY.vertex[v]?.vertices ?? NONE;
}
export function edgeVertices(e: EdgeId): readonly VertexId[] {
  return TOPOLOGY.edge[e]?.vertices ?? NONE;
}
export function edgeNeighbors(e: EdgeId): readonly EdgeId[] {
  return TOPOLOGY.edge[e]?.edges ?? NONE;
}
