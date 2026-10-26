/**
 * Axial hex math for POINTY-TOP hexes (a vertex points up).
 *
 *            N
 *      NW  /   \  NE        corners: N, NE, SE, S, SW, NW
 *         |     |           sides:   NE, E, SE, SW, W, NW
 *      SW  \   /  SE        neighbor directions (dq, dr):
 *            S                E(+1,0) W(-1,0) NE(+1,-1) NW(0,-1) SE(0,+1) SW(-1,+1)
 *
 * Canonical IDs (each vertex/edge has exactly one):
 *   - every vertex is the N corner or the S corner of exactly one hex  -> `v:q,r,N|S`
 *   - every edge is the NE, E or SE side of exactly one hex             -> `e:q,r,NE|E|SE`
 * Plazas (F2, T&B trade hexes; only on frames that declare them, maps.ts `plazas`):
 *   - the centre of hex (q, r) is a vertex                             -> `v:q,r,C`
 *   - a spoke from that centre to the hex's corner X is an edge        -> `e:q,r,CX` (X a Corner)
 * The owning hex may be a water hex or off-board; IDs are pure coordinates.
 *
 * Unit geometry: hex "size" (center to corner) = 1, y grows downward (screen coordinates).
 */
import type { EdgeId, HexId, VertexId } from './types';

export interface Axial {
  q: number;
  r: number;
}
export interface Point {
  x: number;
  y: number;
}

export type Corner = 'N' | 'NE' | 'SE' | 'S' | 'SW' | 'NW';
export type Side = 'NE' | 'E' | 'SE' | 'SW' | 'W' | 'NW';
/** The vertex part of a canonical vertex id: a corner, or 'C' = the hex centre (a plaza, F2). */
export type VertexKey = 'N' | 'S' | 'C';
/** A spoke edge from a hex centre to one of its corners (F2). */
export type SpokeKey = `C${Corner}`;
/** The edge part of a canonical edge id: a side, or a spoke (F2). */
export type EdgeKey = 'NE' | 'E' | 'SE' | SpokeKey;

/** Clockwise from N. */
export const CORNERS: readonly Corner[] = ['N', 'NE', 'SE', 'S', 'SW', 'NW'];
/** Clockwise from NE. Side i lies between CORNERS[i] and CORNERS[i+1]. */
export const SIDES: readonly Side[] = ['NE', 'E', 'SE', 'SW', 'W', 'NW'];

export const DIRECTIONS: Record<Side, Axial> = {
  NE: { q: 1, r: -1 },
  E: { q: 1, r: 0 },
  SE: { q: 0, r: 1 },
  SW: { q: -1, r: 1 },
  W: { q: -1, r: 0 },
  NW: { q: 0, r: -1 },
};

const SQRT3 = Math.sqrt(3);

// `${-0}` prints "0", so IDs never contain "-0".
export function hexId(q: number, r: number): HexId {
  return `h:${q},${r}`;
}

export function vertexId(q: number, r: number, corner: VertexKey): VertexId {
  return `v:${q},${r},${corner}`;
}

export function edgeId(q: number, r: number, side: EdgeKey): EdgeId {
  return `e:${q},${r},${side}`;
}

/** The centre vertex of hex (q, r): a trade-hex plaza (F2). */
export function centreVertex(q: number, r: number): VertexId {
  return vertexId(q, r, 'C');
}

/** The spoke edge from the centre of hex (q, r) to its `corner` (F2). */
export function spokeEdge(q: number, r: number, corner: Corner): EdgeId {
  return edgeId(q, r, `C${corner}`);
}

/** A plaza (hex-centre) vertex id. */
export function isCentreVertex(id: string): boolean {
  return id.endsWith(',C');
}

/** A spoke edge id (hex centre to corner). */
export function isSpokeEdge(id: string): boolean {
  return /,C[NSEW]+$/.test(id);
}

const HEX_RE = /^h:(-?\d+),(-?\d+)$/;
const VERTEX_RE = /^v:(-?\d+),(-?\d+),(N|S|C)$/;
const EDGE_RE = /^e:(-?\d+),(-?\d+),(NE|E|SE|C(?:N|NE|SE|S|SW|NW))$/;

export function parseHexId(id: HexId): Axial {
  const m = HEX_RE.exec(id);
  if (!m) throw new Error(`bad HexId ${id}`);
  return { q: Number(m[1]), r: Number(m[2]) };
}

export function parseVertexId(id: VertexId): Axial & { corner: VertexKey } {
  const m = VERTEX_RE.exec(id);
  if (!m) throw new Error(`bad VertexId ${id}`);
  return { q: Number(m[1]), r: Number(m[2]), corner: m[3] as VertexKey };
}

export function parseEdgeId(id: EdgeId): Axial & { side: EdgeKey } {
  const m = EDGE_RE.exec(id);
  if (!m) throw new Error(`bad EdgeId ${id}`);
  return { q: Number(m[1]), r: Number(m[2]), side: m[3] as EdgeKey };
}

export function neighbor(q: number, r: number, side: Side): Axial {
  const d = DIRECTIONS[side];
  return { q: q + d.q, r: r + d.r };
}

export function hexDistance(a: Axial, b: Axial): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

/** Canonical vertex ID for a corner of hex (q, r). */
export function cornerVertex(q: number, r: number, corner: Corner): VertexId {
  switch (corner) {
    case 'N':
      return vertexId(q, r, 'N');
    case 'S':
      return vertexId(q, r, 'S');
    case 'NE':
      return vertexId(q + 1, r - 1, 'S');
    case 'SE':
      return vertexId(q, r + 1, 'N');
    case 'SW':
      return vertexId(q - 1, r + 1, 'N');
    case 'NW':
      return vertexId(q, r - 1, 'S');
  }
}

/** Canonical edge ID for a side of hex (q, r). */
export function sideEdge(q: number, r: number, side: Side): EdgeId {
  switch (side) {
    case 'NE':
    case 'E':
    case 'SE':
      return edgeId(q, r, side);
    case 'SW':
      return edgeId(q - 1, r + 1, 'NE');
    case 'W':
      return edgeId(q - 1, r, 'E');
    case 'NW':
      return edgeId(q, r - 1, 'SE');
  }
}

/** The two endpoint vertices of an edge. */
export function edgeEndpoints(id: EdgeId): [VertexId, VertexId] {
  const { q, r, side } = parseEdgeId(id);
  if (side.startsWith('C'))
    return [centreVertex(q, r), cornerVertex(q, r, side.slice(1) as Corner)];
  const i = SIDES.indexOf(side as Side);
  return [
    cornerVertex(q, r, CORNERS[i] as Corner),
    cornerVertex(q, r, CORNERS[(i + 1) % 6] as Corner),
  ];
}

/** Center of hex (q, r) in unit coordinates. */
export function hexCenter(q: number, r: number): Point {
  return { x: SQRT3 * (q + r / 2), y: 1.5 * r };
}

const CORNER_OFFSET: Record<Corner, Point> = {
  N: { x: 0, y: -1 },
  NE: { x: SQRT3 / 2, y: -0.5 },
  SE: { x: SQRT3 / 2, y: 0.5 },
  S: { x: 0, y: 1 },
  SW: { x: -SQRT3 / 2, y: 0.5 },
  NW: { x: -SQRT3 / 2, y: -0.5 },
};

export function cornerPoint(q: number, r: number, corner: Corner): Point {
  const c = hexCenter(q, r);
  const o = CORNER_OFFSET[corner];
  return { x: c.x + o.x, y: c.y + o.y };
}

export function vertexPoint(id: VertexId): Point {
  const { q, r, corner } = parseVertexId(id);
  return corner === 'C' ? hexCenter(q, r) : cornerPoint(q, r, corner);
}

export function edgeMidpoint(id: EdgeId): Point {
  const [a, b] = edgeEndpoints(id).map(vertexPoint) as [Point, Point];
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
