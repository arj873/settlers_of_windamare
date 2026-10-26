/**
 * Pure board-view math (no Pixi, no DOM): view transform, fitting, zoom, and hit-testing.
 *
 * Two coordinate spaces:
 *   unit   engine units (hex size 1, y down) — what TOPOLOGY uses
 *   screen CSS pixels relative to the canvas
 * A `ViewTransform` maps unit -> screen: `screen = (x, y) + unit * scale` (scale = px per unit).
 */
import {
  CORNERS,
  TOPOLOGY,
  cornerPoint,
  edgeInfo,
  isLandHex,
  isWaterHex,
  vertexInfo,
  type EdgeId,
  type HexId,
  type Point,
  type Topology,
  type VertexId,
} from '../engine';

/** Design size (px per unit) the Pixi scene graph is drawn at. The world container is scaled from it. */
export const HEX_SIZE = 100;

/** Radius (units) of the hexagonal sea backdrop behind the water ring. */
export const BACKDROP_RADIUS = 6.7;

/** Wooden frame thickness (units) around the sea, including its outline. */
export const FRAME_WIDTH = 0.35;

export interface ViewTransform {
  x: number;
  y: number;
  /** Pixels per unit. */
  scale: number;
}

export interface Rect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Radius (units) of the flat-top hexagonal sea backdrop around `topo.center`: BACKDROP_RADIUS on
 * the 19-hex board, otherwise just big enough to hold every water hex plus a small margin.
 */
export function backdropRadius(topo: Topology = TOPOLOGY): number {
  if (topo.frame === TOPOLOGY.frame) return BACKDROP_RADIUS;
  let r = 0;
  for (const id of topo.waterHexes) {
    const w = topo.water[id];
    if (!w) continue;
    for (const c of CORNERS) {
      const p = cornerPoint(w.q, w.r, c);
      const dx = Math.abs(p.x - topo.center.x);
      const dy = Math.abs(p.y - topo.center.y);
      // Smallest flat-top hexagon radius containing (dx, dy).
      r = Math.max(r, (2 * dy) / Math.sqrt(3), dx + dy / Math.sqrt(3));
    }
  }
  return r + 0.4;
}

/** Bounds of the whole drawn board (sea backdrop included), in units. */
export function boardBounds(topo: Topology = TOPOLOGY): Rect {
  const r = backdropRadius(topo) + FRAME_WIDTH;
  const h = r * Math.sin(Math.PI / 3);
  const { x, y } = topo.center;
  return { minX: x - r, minY: y - h, maxX: x + r, maxY: y + h };
}

export function unitToScreen(view: ViewTransform, p: Point): Point {
  return { x: view.x + p.x * view.scale, y: view.y + p.y * view.scale };
}

export function screenToUnit(view: ViewTransform, p: Point): Point {
  return { x: (p.x - view.x) / view.scale, y: (p.y - view.y) / view.scale };
}

/** View that centers `bounds` in a `width` x `height` screen with `padding` px around. */
export function fitView(bounds: Rect, width: number, height: number, padding = 16): ViewTransform {
  const bw = bounds.maxX - bounds.minX;
  const bh = bounds.maxY - bounds.minY;
  const availW = Math.max(1, width - 2 * padding);
  const availH = Math.max(1, height - 2 * padding);
  const scale = Math.min(availW / bw, availH / bh);
  return {
    scale,
    x: width / 2 - ((bounds.minX + bounds.maxX) / 2) * scale,
    y: height / 2 - ((bounds.minY + bounds.maxY) / 2) * scale,
  };
}

/** Zoom by `factor` keeping the unit point under `anchor` (screen px) fixed. Scale is clamped. */
export function zoomAt(
  view: ViewTransform,
  factor: number,
  anchor: Point,
  minScale: number,
  maxScale: number,
): ViewTransform {
  const scale = Math.min(maxScale, Math.max(minScale, view.scale * factor));
  const ratio = scale / view.scale;
  return {
    scale,
    x: anchor.x - (anchor.x - view.x) * ratio,
    y: anchor.y - (anchor.y - view.y) * ratio,
  };
}

/** Keep the center of `bounds` on screen so the board can never be panned out of reach. */
export function clampView(
  view: ViewTransform,
  bounds: Rect,
  width: number,
  height: number,
): ViewTransform {
  const c = unitToScreen(view, {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
  });
  const dx = Math.min(width, Math.max(0, c.x)) - c.x;
  const dy = Math.min(height, Math.max(0, c.y)) - c.y;
  return dx === 0 && dy === 0 ? view : { ...view, x: view.x + dx, y: view.y + dy };
}

// ---------------------------------------------------------------------------
// Hit-testing (unit space)
// ---------------------------------------------------------------------------

export type Hit =
  { kind: 'vertex'; id: VertexId } | { kind: 'edge'; id: EdgeId } | { kind: 'hex'; id: HexId };

/** Restrict hit-testing to these ids. A missing/empty list disables that kind. */
export interface PickCandidates {
  vertices?: readonly VertexId[];
  edges?: readonly EdgeId[];
  hexes?: readonly HexId[];
}

/** Hit radii in units: ~18 / 14 px worth, but never so large that neighbours (0.5 apart) overlap. */
export function pickRadii(pxPerUnit: number): { vertex: number; edge: number } {
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  return {
    vertex: clamp(18 / pxPerUnit, 0.16, 0.34),
    edge: clamp(14 / pxPerUnit, 0.1, 0.24),
  };
}

export function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** The land hex containing unit point `p`, or null (water / off board). */
export function hexAt(p: Point, topo: Topology = TOPOLOGY): HexId | null {
  const id = anyHexAt(p);
  return isLandHex(topo, id) ? id : null;
}

/** The water hex of the frame containing unit point `p`, or null. */
export function waterHexAt(p: Point, topo: Topology = TOPOLOGY): HexId | null {
  const id = anyHexAt(p);
  return isWaterHex(topo, id) ? id : null;
}

function anyHexAt(p: Point): HexId {
  // Pointy-top pixel -> fractional axial, then cube rounding.
  const fq = (Math.sqrt(3) / 3) * p.x - p.y / 3;
  const fr = (2 / 3) * p.y;
  const fs = -fq - fr;
  let q = Math.round(fq);
  let r = Math.round(fr);
  const s = Math.round(fs);
  const dq = Math.abs(q - fq);
  const dr = Math.abs(r - fr);
  const ds = Math.abs(s - fs);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  return `h:${q + 0},${r + 0}`; // `+ 0` turns -0 into 0
}

/**
 * Best hit for unit point `p`. Vertices and edges are scored by distance / radius so the closer one
 * wins; a hex only wins when nothing else is in reach. `cand` undefined = everything on the board.
 */
export function pick(
  p: Point,
  pxPerUnit: number,
  cand?: PickCandidates,
  topo: Topology = TOPOLOGY,
): Hit | null {
  const radii = pickRadii(pxPerUnit);
  let best: Hit | null = null;
  let bestScore = Infinity;

  // Candidates may be sea-only vertices/edges (ships, docs/EXPANSIONS.md §7).
  const vertices = cand ? (cand.vertices ?? []) : topo.vertices;
  for (const id of vertices) {
    const v = vertexInfo(topo, id);
    if (!v) continue;
    const score = Math.hypot(p.x - v.x, p.y - v.y) / radii.vertex;
    if (score <= 1 && score < bestScore) {
      best = { kind: 'vertex', id };
      bestScore = score;
    }
  }

  const edges = cand ? (cand.edges ?? []) : topo.edges;
  for (const id of edges) {
    const e = edgeInfo(topo, id);
    const a = e && vertexInfo(topo, e.vertices[0]);
    const b = e && vertexInfo(topo, e.vertices[1]);
    if (!a || !b) continue;
    // Only the middle half of the edge counts, so near the ends the vertex wins.
    const near = { x: a.x + (b.x - a.x) * 0.25, y: a.y + (b.y - a.y) * 0.25 };
    const far = { x: a.x + (b.x - a.x) * 0.75, y: a.y + (b.y - a.y) * 0.75 };
    const score = distToSegment(p, near, far) / radii.edge;
    if (score <= 1 && score < bestScore) {
      best = { kind: 'edge', id };
      bestScore = score;
    }
  }

  if (best) return best;

  const hex = hexAt(p, topo);
  if (hex && (!cand || cand.hexes?.includes(hex))) return { kind: 'hex', id: hex };
  // A highlighted water hex (pirate moves) is clickable too.
  const water = cand?.hexes?.length ? waterHexAt(p, topo) : null;
  if (water && cand?.hexes?.includes(water)) return { kind: 'hex', id: water };
  return null;
}
