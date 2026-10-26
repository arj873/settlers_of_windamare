/**
 * What lies where on an Explorers & Pirates board (docs/rules/explorers-pirates.md §2.0, §4.3-4.4,
 * §4.11): sea routes for ships, the frame, face-down hexes, the coast, the Council's anchors and
 * where the pirate may go. Built on the shared sea graph (engine/expansions/seaGraph.ts).
 */
import { terrainKind } from '../../../engine/expansions/hooks';
import { seaGraph, type SeaGraph } from '../../../engine/expansions/seaGraph';
import { cornerVertex, parseHexId, SIDES, neighbor, hexId } from '../../../engine/hex';
import type { EdgeId, GameState, HexId, VertexId } from '../../../engine/types';
import { epBoard, T, type EpBoard } from './maps';

export const graph = (state: Pick<GameState, 'settings'>): SeaGraph => seaGraph(state);

interface Static {
  inside: ReadonlySet<HexId>;
  island: ReadonlySet<HexId>;
  /** Hexes next to the island (no pirate there, §4.7). */
  nearIsland: ReadonlySet<HexId>;
  spots: ReadonlySet<VertexId>;
}

const STATIC = new WeakMap<EpBoard, Static>();
export function staticOf(state: GameState): Static {
  const b = epBoard(state);
  let s = STATIC.get(b);
  if (!s) {
    const near = new Set<HexId>();
    for (const h of b.island) {
      const p = parseHexId(h);
      for (const side of SIDES) {
        const nb = neighbor(p.q, p.r, side);
        near.add(hexId(nb.q, nb.r));
      }
    }
    s = {
      inside: new Set(b.inside),
      island: new Set(b.island),
      nearIsland: near,
      spots: new Set(b.harborSpots),
    };
    STATIC.set(b, s);
  }
  return s;
}

export type HexKind = 'land' | 'sea' | 'fog' | 'frame';

/** A board hex's terrain kind, playable sea, or the frame (outside the board). */
export function hexKind(state: GameState, h: HexId): HexKind {
  const tile = state.board.hexes[h];
  if (tile) return terrainKind(tile.terrain);
  return staticOf(state).inside.has(h) ? 'sea' : 'frame';
}

const isWater = (k: HexKind) => k === 'sea' || k === 'frame';

/**
 * A sea route (§4.4): an edge of the board with water on at least one side (sea, fish shoal,
 * Council, or the frame). Edges between two land hexes, or between land and a face-down hex, are
 * not; edges inside the frame are not on the board.
 */
export function isShipEdge(state: GameState, e: EdgeId): boolean {
  return dynamicOf(state).shipEdges.has(e);
}

function computeShipEdge(state: GameState, e: EdgeId): boolean {
  const sides = graph(state).sides.get(e);
  if (!sides) return false;
  const inside = staticOf(state).inside;
  let water = false;
  let onBoard = false;
  for (const h of sides) {
    if (inside.has(h)) onBoard = true;
    if (isWater(hexKind(state, h))) water = true;
  }
  return water && onBoard;
}

interface Dynamic {
  shipEdges: ReadonlySet<EdgeId>;
  /** Vertices at a corner of a face-down hex. */
  fogVertices: ReadonlySet<VertexId>;
}

/**
 * Sea routes and face-down corners of a board, cached per `board.hexes` object (exploring
 * replaces it copy-on-write, so a new board gets new sets).
 */
const DYNAMIC = new WeakMap<object, Dynamic>();
function dynamicOf(state: GameState): Dynamic {
  let d = DYNAMIC.get(state.board.hexes);
  if (!d) {
    const g = graph(state);
    const shipEdges = new Set(g.edges.filter((e) => computeShipEdge(state, e)));
    const fogVertices = new Set<VertexId>();
    for (const [h, tile] of Object.entries(state.board.hexes) as [HexId, { terrain: string }][]) {
      if (terrainKind(tile.terrain as never) !== 'fog') continue;
      for (const v of g.hexVertices.get(h) ?? []) fogVertices.add(v);
    }
    d = { shipEdges, fogVertices };
    DYNAMIC.set(state.board.hexes, d);
  }
  return d;
}

/** Every sea route of the board. */
export const shipEdges = (state: GameState): ReadonlySet<EdgeId> => dynamicOf(state).shipEdges;

/** A ship with an end here must explore (an end at a face-down corner). */
export function touchesFog(state: GameState, e: EdgeId): boolean {
  const fog = dynamicOf(state).fogVertices;
  return (graph(state).ends.get(e) ?? []).some((v) => fog.has(v));
}

/** Face-down hexes at a vertex. */
export function fogAt(state: GameState, v: VertexId): HexId[] {
  return (graph(state).hexesAt.get(v) ?? []).filter((h) => hexKind(state, h) === 'fog');
}

/** Face-down hexes at either end of an edge (what a ship there explores). */
export function fogAtEnds(state: GameState, e: EdgeId): HexId[] {
  const out = new Set<HexId>();
  for (const v of graph(state).ends.get(e) ?? []) for (const h of fogAt(state, v)) out.add(h);
  return [...out].sort();
}

/** The edge is a side of a face-down hex (no ship may be built there, §4.3). */
export function bordersFog(state: GameState, e: EdgeId): boolean {
  return (graph(state).sides.get(e) ?? []).some((h) => hexKind(state, h) === 'fog');
}

/** The vertex touches water (sea, shoal, Council, frame): a harbor may stand there (§4.2). */
export function isCoastal(state: GameState, v: VertexId): boolean {
  return (graph(state).hexesAt.get(v) ?? []).some((h) => isWater(hexKind(state, h)));
}

/** The vertex is an end of the edge. */
export const isEndOf = (state: GameState, e: EdgeId, v: VertexId): boolean =>
  graph(state).ends.get(e)?.includes(v) ?? false;

/** An end of the edge is a corner of hex `h`. */
export function endTouchesHex(state: GameState, e: EdgeId, h: HexId): boolean {
  const corners = graph(state).hexVertices.get(h) ?? [];
  return (graph(state).ends.get(e) ?? []).some((v) => corners.includes(v));
}

/** The Council of Catan's two anchors: its north and south corners (§4.9). */
export function anchors(state: GameState): VertexId[] {
  const c = epBoard(state).council;
  if (!c) return [];
  const { q, r } = parseHexId(c);
  return [cornerVertex(q, r, 'N'), cornerVertex(q, r, 'S')];
}

/** A sea hex for the pirate (§4.7): sea or a fish shoal, on the board, not next to the island. */
export function isPirateHex(state: GameState, h: HexId): boolean {
  const st = staticOf(state);
  if (!st.inside.has(h) || st.nearIsland.has(h)) return false;
  const tile = state.board.hexes[h];
  if (!tile) return true;
  return tile.terrain === 'sea' || tile.terrain === T.fish;
}

/** Every hex the pirate could stand on. */
export function pirateHexes(state: GameState): HexId[] {
  return epBoard(state).inside.filter((h) => isPirateHex(state, h));
}

/** The six sides of a hex. */
export const sidesOf = (state: GameState, h: HexId): readonly EdgeId[] =>
  graph(state).hexEdges.get(h) ?? [];
