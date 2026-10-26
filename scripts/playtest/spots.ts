/** Board-target descriptions for the playtest CLI: "what is at this spot", in words. */
import {
  edgeVertices,
  tokenPips,
  topologyOf,
  vertexHexes,
  type Action,
  type EdgeId,
  type GameState,
  type HexId,
  type PlayerId,
  type VertexId,
} from '../../src/engine';
import { locationOf } from '../../src/game/logic';

export interface Spot {
  /** 1-based number the agent types: `click-spot 3`. */
  n: number;
  id: string;
  kind: 'vertex' | 'edge' | 'hex';
  text: string;
}

/** What a board click does for each action type. */
export const SPOT_VERB: Partial<Record<Action['type'], string>> = {
  placeSetupSettlement: 'place your setup settlement',
  placeSetupRoad: 'place your setup road',
  buildRoad: 'build a road',
  buildSettlement: 'build a settlement',
  buildCity: 'upgrade a settlement to a city',
  moveRobber: 'move the robber',
  placeFreeRoad: 'place a free road (Road Building)',
};

/** "brick 8" / "desert" (+ " [robber]"). */
export function hexLabel(state: GameState, id: HexId): string {
  const hex = state.board.hexes[id];
  if (!hex) return 'sea';
  const base = hex.token === null ? hex.terrain : `${hex.terrain} ${hex.token}`;
  return state.robber === id ? `${base} [robber]` : base;
}

function harborAt(state: GameState, v: VertexId): string | null {
  const port = state.board.ports.find((p) => p.vertices.includes(v));
  if (!port) return null;
  return port.kind === 'generic' ? 'harbor 3:1 any' : `harbor 2:1 ${port.kind}`;
}

function owner(state: GameState, p: PlayerId, viewer: PlayerId): string {
  return p === viewer ? 'your' : `${state.players[p]?.name ?? `P${p}`}'s`;
}

/** "brick 8 + wool 3 + coast (pips 7), harbor 3:1 any, your settlement". */
export function describeVertex(state: GameState, v: VertexId, viewer: PlayerId): string {
  const hexes = vertexHexes(topologyOf(state), v);
  const parts = hexes.map((h) => hexLabel(state, h));
  if (hexes.length < 3) parts.push('coast');
  const extra = [harborAt(state, v)];
  const b = state.pieces.buildings[v];
  if (b) extra.push(`${owner(state, b.owner, viewer)} ${b.kind}`);
  return [`${parts.join(' + ')} (pips ${vertexPips(state, v)})`, ...extra.filter(Boolean)].join(
    ', ',
  );
}

/** Production pips around a vertex (dots on the adjacent number tokens; desert/robber ignored). */
export function vertexPips(state: GameState, v: VertexId): number {
  return vertexHexes(topologyOf(state), v).reduce((n, h) => {
    const t = state.board.hexes[h]?.token;
    return n + (t ? tokenPips(t) : 0);
  }, 0);
}

function endpoint(state: GameState, v: VertexId, viewer: PlayerId): string {
  const b = state.pieces.buildings[v];
  const ownRoad = topologyOf(state).vertex[v]?.edges.some((e) => state.pieces.roads[e] === viewer);
  const what = b ? `${owner(state, b.owner, viewer)} ${b.kind}` : ownRoad ? 'your road' : 'open';
  return `${v} (${what})`;
}

/** "between brick 8 | wool 3; ends v:… (your settlement), v:… (open)". */
export function describeEdge(state: GameState, e: EdgeId, viewer: PlayerId): string {
  const hexes = topologyOf(state).edge[e]?.hexes ?? [];
  const sides = hexes.map((h) => hexLabel(state, h));
  if (hexes.length < 2) sides.push('sea');
  const ends = edgeVertices(topologyOf(state), e).map((v) => endpoint(state, v, viewer));
  return `between ${sides.join(' | ')}; ends ${ends.join(', ')}`;
}

/** "lumber 6; buildings: Seat2 settlement, your city" (robber targets). */
export function describeHex(state: GameState, h: HexId, viewer: PlayerId): string {
  const info = topologyOf(state).hex[h];
  const who = (info?.vertices ?? []).flatMap((v) => {
    const b = state.pieces.buildings[v];
    return b ? [`${owner(state, b.owner, viewer)} ${b.kind}`] : [];
  });
  return `${hexLabel(state, h)}; buildings: ${who.length > 0 ? who.join(', ') : 'none'}`;
}

/**
 * Board actions (from `__catanDebug.boardTargets()`) as numbered, described spots.
 * Vertex spots come best-first (most pips), so short lists of good options lead.
 */
export function listSpots(state: GameState, targets: readonly Action[], viewer: PlayerId): Spot[] {
  const pips = (a: Action) => {
    const at = locationOf(a);
    return at?.kind === 'vertex' ? vertexPips(state, at.id) : 0;
  };
  const ordered = [...targets].sort((a, b) => pips(b) - pips(a));
  const spots: Spot[] = [];
  for (const a of ordered) {
    const n = spots.length + 1;
    const at = locationOf(a);
    if (at?.kind === 'vertex') {
      spots.push({ n, id: at.id, kind: 'vertex', text: describeVertex(state, at.id, viewer) });
    } else if (at?.kind === 'edge') {
      spots.push({ n, id: at.id, kind: 'edge', text: describeEdge(state, at.id, viewer) });
    } else if (at?.kind === 'hex') {
      spots.push({ n, id: at.id, kind: 'hex', text: describeHex(state, at.id, viewer) });
    }
  }
  return spots;
}

/** Same description for any id (`click-board <id>`); null if the id is not on the board. */
export function describeId(state: GameState, id: string, viewer: PlayerId): string | null {
  const t = topologyOf(state);
  if (t.vertex[id as VertexId]) return describeVertex(state, id as VertexId, viewer);
  if (t.edge[id as EdgeId]) return describeEdge(state, id as EdgeId, viewer);
  if (t.hex[id as HexId]) return describeHex(state, id as HexId, viewer);
  return null;
}
