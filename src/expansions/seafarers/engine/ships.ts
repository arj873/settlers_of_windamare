/**
 * Ships (docs/rules/seafarers.md §3.2-§3.5): where one may be built or moved, closed routes, and
 * the Longest Trade Route (roads and ships, joined only at the player's own buildings).
 */
import { blocksRoute, hasRouteBlockers, pieceLimit } from '../../../engine/expansions/hooks';
import type { RouteTrail } from '../../../engine/expansions/types';
import type { EdgeId, GameState, PlayerId, ResourceCounts, VertexId } from '../../../engine/types';
import { graph, isShipEdge } from './geometry';
import { pirateLineAllows } from './pirates';
import { seaSlice, scenarioKey } from './state';

export const SHIP = 'seafarers/ship';
export const SHIP_COST: ResourceCounts = { brick: 0, lumber: 1, wool: 1, grain: 0, ore: 0 };
export const SHIP_LIMIT = 15;

export function shipsOf(state: GameState, player: PlayerId): EdgeId[] {
  const ships = seaSlice(state).ships;
  return (Object.keys(ships) as EdgeId[]).filter((e) => ships[e]?.owner === player);
}

export function shipsLeft(state: GameState, player: PlayerId): number {
  return pieceLimit(state, player, SHIP) - shipsOf(state, player).length;
}

/**
 * An opponent's building (or a module piece that cuts routes) stands on `v`. A module may cut
 * the route at the player's own building too (T&B + Seafarers: a conquered settlement, FAQ 6).
 */
export function blockedFor(state: GameState, v: VertexId, player: PlayerId): boolean {
  const b = state.pieces.buildings[v];
  if (b !== undefined && b.owner !== player) return true;
  return hasRouteBlockers(state) && blocksRoute(state, v, player);
}

const ownBuilding = (state: GameState, v: VertexId, p: PlayerId) =>
  state.pieces.buildings[v]?.owner === p;

/** The edge borders the pirate's hex. */
export function nextToPirate(state: GameState, e: EdgeId): boolean {
  const pirate = seaSlice(state).pirate;
  return pirate !== null && (graph(state).sides.get(e)?.includes(pirate) ?? false);
}

export interface ShipSpotOptions {
  /** The ship being moved (does not count as part of the network). */
  ignore?: EdgeId;
  /** Setup: the ship must touch this settlement. */
  from?: VertexId;
}

/**
 * Geometry of a new ship (§3.2): a ship edge, empty (no ship, no road), not next to the pirate,
 * connected to the player's own building or to the free end of one of their ships, never through
 * an opponent's building. A road does not connect a ship (§3.3). No cost / phase / supply checks.
 */
export function canPlaceShip(
  state: GameState,
  player: PlayerId,
  e: EdgeId,
  opts: ShipSpotOptions = {},
): boolean {
  const g = graph(state);
  const ends = g.ends.get(e);
  if (!ends || e === opts.ignore) return false;
  const s = seaSlice(state);
  if (s.ships[e] !== undefined || state.pieces.roads[e] !== undefined) return false;
  if (!isShipEdge(state, e) || nextToPirate(state, e)) return false;
  if (opts.from !== undefined)
    return ends.includes(opts.from) && ownBuilding(state, opts.from, player);
  const connected = ends.some((v) => {
    if (ownBuilding(state, v, player)) return true;
    if (blockedFor(state, v, player)) return false;
    return (g.edgesAt.get(v) ?? []).some(
      (o) => o !== e && o !== opts.ignore && s.ships[o]?.owner === player,
    );
  });
  if (!connected) return false;
  return scenarioKey(state) !== 'pirateIslands' || pirateLineAllows(state, player, e);
}

/** Every edge where `player` could place a ship now (geometry only). */
export function shipSpots(
  state: GameState,
  player: PlayerId,
  opts: ShipSpotOptions = {},
): EdgeId[] {
  return graph(state).edges.filter((e) => canPlaceShip(state, player, e, opts));
}

/** No other piece of `player` (building, road, ship other than `e`) touches `v`. */
function freeEnd(state: GameState, player: PlayerId, e: EdgeId, v: VertexId): boolean {
  if (state.pieces.buildings[v]?.owner === player) return false;
  const s = seaSlice(state);
  return (graph(state).edgesAt.get(v) ?? []).every(
    (o) => o === e || (s.ships[o]?.owner !== player && state.pieces.roads[o] !== player),
  );
}

/**
 * A ship `player` may pick up to move (§3.4): theirs, not built this turn, not on a closed route,
 * one end free of their other pieces (5th edition: roads count), not next to the pirate, and with
 * somewhere to go. The once-per-turn and phase checks are the caller's.
 */
export function canMoveShip(state: GameState, player: PlayerId, e: EdgeId): boolean {
  const s = seaSlice(state);
  const ship = s.ships[e];
  if (!ship || ship.owner !== player || ship.closed || s.built.includes(e)) return false;
  if (nextToPirate(state, e)) return false;
  const ends = graph(state).ends.get(e);
  if (!ends || !ends.some((v) => freeEnd(state, player, e, v))) return false;
  return moveTargets(state, player, e).length > 0;
}

/** Where the ship on `from` may go: anywhere a new ship could be built without it (FAQ #13). */
export function moveTargets(state: GameState, player: PlayerId, from: EdgeId): EdgeId[] {
  return shipSpots(state, player, { ignore: from });
}

/**
 * Mark the ships that now lie on a route between two different buildings of their owner as
 * closed (§3.4, FAQ #18). Closed stays closed (an opponent's settlement on the route later does
 * not reopen it). A route through an opponent's building does not join the two ends.
 */
export function markClosedRoutes(draft: GameState): void {
  const s = seaSlice(draft);
  const g = graph(draft);
  const owners = new Set(Object.values(s.ships).map((x) => x.owner));
  // Cloth for Catan: a route from a building to a village is closed too (§4.9).
  const villages = new Set(Object.keys(s.cloth?.villages ?? {}));
  for (const p of owners) {
    const reach = (start: VertexId, without: EdgeId): Set<VertexId> => {
      const found = new Set<VertexId>();
      if (blockedFor(draft, start, p)) return found;
      const seen = new Set<VertexId>([start]);
      const stack = [start];
      while (stack.length > 0) {
        const v = stack.pop() as VertexId;
        if (ownBuilding(draft, v, p) || villages.has(v)) found.add(v);
        for (const o of g.edgesAt.get(v) ?? []) {
          if (o === without || s.ships[o]?.owner !== p) continue;
          const [a, b] = g.ends.get(o) as readonly [VertexId, VertexId];
          const next = a === v ? b : a;
          if (seen.has(next) || blockedFor(draft, next, p)) continue;
          seen.add(next);
          stack.push(next);
        }
      }
      return found;
    };
    for (const [e, ship] of Object.entries(s.ships) as [EdgeId, (typeof s.ships)[EdgeId]][]) {
      if (ship.owner !== p || ship.closed) continue;
      const [u, v] = g.ends.get(e) as readonly [VertexId, VertexId];
      const ru = reach(u, e);
      if (ru.size === 0) continue;
      const rv = reach(v, e);
      if ([...ru].some((a) => [...rv].some((b) => a !== b))) s.ships[e] = { ...ship, closed: true };
    }
  }
}

/**
 * Longest Trade Route of `player` (§3.5): the longest trail over their roads and ships (no edge
 * twice). Roads join roads and ships join ships anywhere, a road and a ship only at the player's
 * own settlement or city. An opponent's building ends the trail there. `weight` counts an edge
 * more than once (T&B + Seafarers: a camel on a road or ship counts it twice).
 */
export function tradeRouteLength(
  state: GameState,
  player: PlayerId,
  weight: (e: EdgeId) => number = () => 1,
): number {
  return tradeRoute(state, player, weight).length;
}

/** The Longest Trade Route of `player` (as `tradeRouteLength`) with its edges in order (#51). */
export function tradeRoute(
  state: GameState,
  player: PlayerId,
  weight: (e: EdgeId) => number = () => 1,
): RouteTrail {
  const g = graph(state);
  const ships = seaSlice(state).ships;
  const roads = state.pieces.roads;
  const kindOf = (e: EdgeId): 'road' | 'ship' | null =>
    roads[e] === player ? 'road' : ships[e]?.owner === player ? 'ship' : null;
  const mine: EdgeId[] = [];
  for (const e of Object.keys(roads) as EdgeId[]) if (roads[e] === player) mine.push(e);
  for (const e of Object.keys(ships) as EdgeId[]) if (ships[e]?.owner === player) mine.push(e);
  let best: RouteTrail = { length: 0, edges: [] };
  if (mine.length === 0) return best;
  const used = new Set<EdgeId>();
  const path: EdgeId[] = [];
  const walk = (v: VertexId, via: 'road' | 'ship' | null, len: number): void => {
    if (len > best.length) best = { length: len, edges: [...path] };
    const joint = via === null || ownBuilding(state, v, player);
    for (const e of g.edgesAt.get(v) ?? []) {
      if (used.has(e)) continue;
      const k = kindOf(e);
      if (k === null || (!joint && k !== via)) continue;
      const [a, b] = g.ends.get(e) as readonly [VertexId, VertexId];
      const next = a === v ? b : a;
      const w = weight(e);
      if (blockedFor(state, next, player)) {
        if (len + w > best.length) best = { length: len + w, edges: [...path, e] };
        continue;
      }
      used.add(e);
      path.push(e);
      walk(next, k, len + w);
      path.pop();
      used.delete(e);
    }
  };
  const starts = new Set<VertexId>();
  for (const e of mine) for (const v of g.ends.get(e) ?? []) starts.add(v);
  for (const v of starts) walk(v, null, 0);
  return best;
}

/** `base` or `route`, whichever counts more (mirrors `Math.max` in the roadLength hooks). */
export const longerRoute = (base: RouteTrail, route: RouteTrail): RouteTrail =>
  route.length > base.length ? route : base;
