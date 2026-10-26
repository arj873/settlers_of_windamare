/**
 * Static topology of a board frame (land hexes plus the surrounding water ring), derived from the
 * map definition (maps.ts). Computed once per frame and cached; NOT stored in GameState. Get it
 * with `topologyOf(state)` or `topologyFor(mapId)`.
 *
 * Counts per frame (land / water / vertices / edges / coastal edges / harbor slots):
 *   std19 (base, baseRandom)  19 / 18 /  54 /  72 / 30 /  9
 *   std30 (base56)            30 / 22 /  80 / 109 / 38 / 11
 *   hex37 (base78)            37 / 24 /  96 / 132 / 42 / 12
 * All adjacency lists only contain land hexes and on-board vertices/edges.
 */
import {
  CORNERS,
  SIDES,
  cornerVertex,
  edgeEndpoints,
  edgeMidpoint,
  hexCenter,
  hexId,
  neighbor,
  sideEdge,
  vertexPoint,
  type Axial,
  type Point,
} from './hex';
import { MAPS, type FrameDef, type FrameId } from './maps';
import type { EdgeId, HexId, MapId, VertexId } from './types';

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
  /** 0..n-1, clockwise from the top-left of the water ring. */
  index: number;
  edge: EdgeId;
  vertices: [VertexId, VertexId];
  waterHex: HexId;
}

export interface Topology {
  frame: FrameId;
  /** Center of the board (unit coordinates); (0,0) for the standard 19-hex board. */
  center: Point;
  /** Row-major: top row first, left to right. Beginner/random layouts fill hexes in this order. */
  landHexes: readonly HexId[];
  /** Water ring, clockwise starting at its top-left hex (h:0,-3 on the base board). */
  waterHexes: readonly HexId[];
  vertices: readonly VertexId[];
  edges: readonly EdgeId[];
  /** Coastal edges, clockwise starting at port slot 0. */
  coastalEdges: readonly EdgeId[];
  portSlots: readonly PortSlot[];
  hex: Readonly<Record<HexId, HexInfo>>;
  water: Readonly<Record<HexId, WaterHexInfo>>;
  vertex: Readonly<Record<VertexId, VertexInfo>>;
  edge: Readonly<Record<EdgeId, EdgeInfo>>;
}

/**
 * Land hexes, row-major. Rows are centered on x = 0 (odd middle row) or on half a hex to the right
 * (even middle row), so the 19-hex board is exactly the radius-2 hexagon around h:0,0.
 */
function landCoordsOf(rows: readonly number[]): Axial[] {
  if (rows.length % 2 !== 1) throw new Error('frame needs an odd number of rows');
  const mid = (rows.length - 1) / 2;
  const xc = (rows[mid] ?? 1) % 2 === 1 ? 0 : 0.5;
  const out: Axial[] = [];
  rows.forEach((w, i) => {
    const r = i - mid;
    const q0 = xc - r / 2 - (w - 1) / 2;
    if (!Number.isInteger(q0)) throw new Error(`frame row ${i} cannot be centered`);
    for (let k = 0; k < w; k++) out.push({ q: q0 + k + 0, r: r + 0 }); // + 0: no -0
  });
  return out;
}

function buildTopology(frame: FrameDef): Topology {
  const landCoords = landCoordsOf(frame.rows);
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

  // Board center = mean of land hex centers (the frames are point-symmetric).
  const center = { x: 0, y: 0 };
  for (const id of landSet) {
    center.x += (hex[id] as HexInfo).x / landSet.size;
    center.y += (hex[id] as HexInfo).y / landSet.size;
  }
  // Screen coords (y down): increasing atan2 around the center is clockwise.
  const angle = (p: Point) => Math.atan2(p.y - center.y, p.x - center.x);

  // Water ring: non-land hexes touching land, clockwise from the top-left one (min r, then min q).
  const waterMap = new Map<HexId, Axial>();
  for (const { q, r } of landCoords) {
    for (const s of SIDES) {
      const n = neighbor(q, r, s);
      if (!isLand(n.q, n.r)) waterMap.set(hexId(n.q, n.r), n);
    }
  }
  const ring = [...waterMap.values()].sort(
    (a, b) => angle(hexCenter(a.q, a.r)) - angle(hexCenter(b.q, b.r)),
  );
  const topLeft = [...ring].sort((a, b) => a.r - b.r || a.q - b.q)[0];
  const startAt = ring.findIndex((c) => c === topLeft);
  const waterCoords = [...ring.slice(startAt), ...ring.slice(0, startAt)];
  const water: Record<HexId, WaterHexInfo> = {};
  for (const { q, r } of waterCoords) {
    const c = hexCenter(q, r);
    water[hexId(q, r)] = { id: hexId(q, r), q, r, x: c.x, y: c.y };
  }

  // Harbor slots (see FrameDef.harbors). Corner land hexes have exactly 3 land neighbors.
  const landNeighbors = (w: Axial) =>
    SIDES.map((s) => ({ s, n: neighbor(w.q, w.r, s) })).filter(({ n }) => isLand(n.q, n.r));
  const facing: [Axial, Axial][] =
    frame.harbors === 'alternate'
      ? waterCoords
          .filter((_, i) => i % 2 === 0)
          .map((w) => {
            const degree = (n: Axial) => (hex[hexId(n.q, n.r)] as HexInfo).neighbors.length;
            const wc = hexCenter(w.q, w.r);
            const clockwiseOf = (n: Axial) => {
              const nc = hexCenter(n.q, n.r);
              const cross =
                (wc.x - center.x) * (nc.y - center.y) - (wc.y - center.y) * (nc.x - center.x);
              return cross > 0 ? 1 : 0;
            };
            const [pick] = landNeighbors(w)
              .map(({ n }) => n)
              .sort((a, b) => degree(b) - degree(a) || clockwiseOf(b) - clockwiseOf(a));
            if (!pick) throw new Error('harbor slot without land');
            return [w, pick];
          })
      : frame.harbors.map(([wId, lId]) => {
          const w = waterMap.get(wId);
          const l = hex[lId];
          if (!w || !l) throw new Error(`bad harbor slot ${wId} -> ${lId}`);
          return [w, { q: l.q, r: l.r }];
        });
  const portSlots: PortSlot[] = facing.map(([w, l], index) => {
    const side = landNeighbors(w).find(({ n }) => n.q === l.q && n.r === l.r)?.s;
    if (!side) throw new Error(`harbor ${hexId(w.q, w.r)} does not touch ${hexId(l.q, l.r)}`);
    const e = sideEdge(w.q, w.r, side);
    return { index, edge: e, vertices: edgeEndpoints(e), waterHex: hexId(w.q, w.r) };
  });

  // Coastal edges clockwise, rotated to start at port slot 0.
  const coastal = edgeOrder.filter((e) => (edge[e] as EdgeInfo).coastal);
  coastal.sort((a, b) => angle(edge[a] as EdgeInfo) - angle(edge[b] as EdgeInfo));
  const start = coastal.indexOf((portSlots[0] as PortSlot).edge);
  const coastalEdges = [...coastal.slice(start), ...coastal.slice(0, start)];

  return {
    frame: frame.id,
    center,
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

const CACHE = new Map<FrameId, Topology>();

export function topologyOfFrame(frame: FrameDef): Topology {
  let t = CACHE.get(frame.id);
  if (!t) {
    t = buildTopology(frame);
    CACHE.set(frame.id, t);
  }
  return t;
}

/** Topology of a map (built on first use, then cached; maps sharing a frame share it). */
export function topologyFor(map: MapId): Topology {
  const def = MAPS[map];
  if (!def) throw new Error(`unknown map ${String(map)}`);
  return topologyOfFrame(def.frame);
}

/** Topology of the board a game is played on. */
export function topologyOf(state: { settings: { map: MapId } }): Topology {
  return topologyFor(state.settings.map);
}

/**
 * Topology of the standard 19-hex board ('base' / 'baseRandom').
 * @deprecated Only valid for base-map games; use `topologyOf(state)`. Kept for fixtures, tests
 * and UI code that only deals with the base board.
 */
export const TOPOLOGY: Topology = topologyFor('base');

// ---------------------------------------------------------------------------
// Convenience accessors. Unknown IDs return [] / false instead of throwing.
// ---------------------------------------------------------------------------

const NONE: readonly never[] = [];

export function isLandHex(t: Topology, id: string): id is HexId {
  return Object.hasOwn(t.hex, id);
}
export function isBoardVertex(t: Topology, id: string): id is VertexId {
  return Object.hasOwn(t.vertex, id);
}
export function isBoardEdge(t: Topology, id: string): id is EdgeId {
  return Object.hasOwn(t.edge, id);
}

export function hexVertices(t: Topology, h: HexId): readonly VertexId[] {
  return t.hex[h]?.vertices ?? NONE;
}
export function hexEdges(t: Topology, h: HexId): readonly EdgeId[] {
  return t.hex[h]?.edges ?? NONE;
}
export function hexNeighbors(t: Topology, h: HexId): readonly HexId[] {
  return t.hex[h]?.neighbors ?? NONE;
}
export function vertexHexes(t: Topology, v: VertexId): readonly HexId[] {
  return t.vertex[v]?.hexes ?? NONE;
}
export function vertexEdges(t: Topology, v: VertexId): readonly EdgeId[] {
  return t.vertex[v]?.edges ?? NONE;
}
export function vertexNeighbors(t: Topology, v: VertexId): readonly VertexId[] {
  return t.vertex[v]?.vertices ?? NONE;
}
export function edgeVertices(t: Topology, e: EdgeId): readonly VertexId[] {
  return t.edge[e]?.vertices ?? NONE;
}
export function edgeNeighbors(t: Topology, e: EdgeId): readonly EdgeId[] {
  return t.edge[e]?.edges ?? NONE;
}
