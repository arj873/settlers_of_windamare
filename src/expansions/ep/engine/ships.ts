/**
 * Ships, cargo and exploring (docs/rules/explorers-pirates.md §4.3-4.6): pieces in supply, where a
 * ship may be built, how far it sails (movement points, tribute to an opponent's pirate, exploring
 * stops it), and turning over face-down hexes.
 */
import { log } from '../../../engine/actions/common';
import { pieceLimit } from '../../../engine/expansions/hooks';
import { playerName } from '../../../engine/rules/text';
import { isResource } from '../../../engine/resources';
import type { EdgeId, GameState, HexId, PlayerId, Terrain, VertexId } from '../../../engine/types';
import {
  bordersFog,
  fogAtEnds,
  graph,
  isShipEdge,
  shipEdges,
  sidesOf,
  touchesFog,
} from './geometry';
import { epBoard, T } from './maps';
import {
  BASE_MP,
  EXTRA_MP,
  HOLD,
  ITEM,
  epSlice,
  load,
  shipTurn,
  shipTurnDraft,
  type Cargo,
  type EpSlice,
  type Ship,
} from './state';

const name = (s: GameState, p: PlayerId) => playerName(s, p);

// ---------------------------------------------------------------------------------------------
// Pieces in supply
// ---------------------------------------------------------------------------------------------

export const shipsOf = (s: EpSlice, p: PlayerId): Ship[] => s.ships.filter((x) => x.owner === p);
export const shipById = (s: EpSlice, id: number): Ship | undefined =>
  s.ships.find((x) => x.id === id);

/** Harbor settlement vertices of `p`. */
export function harborsOf(state: GameState, p: PlayerId): VertexId[] {
  const s = epSlice(state);
  return (Object.keys(s.harbors) as VertexId[]).filter(
    (v) => state.pieces.buildings[v]?.owner === p,
  );
}

export const isHarbor = (state: GameState, v: VertexId): boolean =>
  epSlice(state).harbors[v] !== undefined;

/** Pieces of a cargo kind `p` has on the board (basins, holds, lairs, spice farms). */
export function cargoOnBoard(state: GameState, p: PlayerId, kind: Cargo): number {
  const s = epSlice(state);
  let n = 0;
  for (const v of harborsOf(state, p)) n += (s.harbors[v] ?? []).filter((c) => c === kind).length;
  for (const ship of shipsOf(s, p)) n += ship.cargo.filter((c) => c === kind).length;
  if (kind === 'crew') {
    for (const l of Object.values(s.lairs)) n += l.crews.filter((o) => o === p).length;
    for (const f of Object.values(s.spice)) n += f.crews.filter((o) => o === p).length;
  }
  return n;
}

export function settlersLeft(state: GameState, p: PlayerId): number {
  return pieceLimit(state, p, ITEM.settler) - cargoOnBoard(state, p, 'settler');
}
export function crewsLeft(state: GameState, p: PlayerId): number {
  return pieceLimit(state, p, ITEM.crew) - cargoOnBoard(state, p, 'crew');
}
export function shipsLeft(state: GameState, p: PlayerId): number {
  return pieceLimit(state, p, ITEM.ship) - shipsOf(epSlice(state), p).length;
}
export function harborsLeft(state: GameState, p: PlayerId): number {
  return pieceLimit(state, p, ITEM.harbor) - harborsOf(state, p).length;
}

export const fits = (cargo: readonly Cargo[], add: Cargo): boolean => load([...cargo, add]) <= HOLD;

// ---------------------------------------------------------------------------------------------
// Building a ship (§4.4)
// ---------------------------------------------------------------------------------------------

export const shipsOn = (s: EpSlice, e: EdgeId): number =>
  s.ships.filter((x) => x.edge === e).length;

/** Own harbor vertices at the ends of `e`. */
export function ownHarborsAt(state: GameState, p: PlayerId, e: EdgeId): VertexId[] {
  return (graph(state).ends.get(e) ?? []).filter(
    (v) => isHarbor(state, v) && state.pieces.buildings[v]?.owner === p,
  );
}

/** Geometry of a new ship: a sea route at an own harbor, room for one more, no face-down side. */
export function canPlaceShip(state: GameState, p: PlayerId, e: EdgeId): boolean {
  if (!isShipEdge(state, e) || bordersFog(state, e)) return false;
  if (shipsOn(epSlice(state), e) >= 2) return false;
  return ownHarborsAt(state, p, e).length > 0;
}

export function shipSpots(state: GameState, p: PlayerId): EdgeId[] {
  const out = new Set<EdgeId>();
  const g = graph(state);
  for (const v of harborsOf(state, p)) {
    for (const e of g.edgesAt.get(v) ?? []) if (canPlaceShip(state, p, e)) out.add(e);
  }
  return [...out].sort();
}

// ---------------------------------------------------------------------------------------------
// Movement (§4.4, §4.7 tribute)
// ---------------------------------------------------------------------------------------------

/** Swift Voyage farms `p` has befriended: +1 MP each for all their ships (§4.12). */
export function swiftFarms(s: EpSlice, p: PlayerId): number {
  return Object.values(s.spice).filter((f) => f.kind === 'swift' && f.crews.includes(p)).length;
}

/** Movement points the ship has left this turn. */
export function mpLeft(state: GameState, ship: Ship): number {
  const s = epSlice(state);
  const t = shipTurn(s, ship.id);
  if (t.done) return 0;
  return Math.max(0, BASE_MP + swiftFarms(s, ship.owner) + (t.extra ? EXTRA_MP : 0) - t.used);
}

/** The opponent's pirate hex the ship would pay tribute to, or null (§4.7). */
export function tributeHex(state: GameState, ship: Ship): HexId | null {
  const s = epSlice(state);
  if (!s.pirate || s.pirate.owner === ship.owner) return null;
  if (shipTurn(s, ship.id).tribute) return null;
  return s.pirate.hex;
}

export interface Reach {
  /** Movement points to get there. */
  dist: number;
  /** The way there touches the pirate's hex: 1 gold tribute. */
  tribute: boolean;
}

/**
 * Where the ship can sail now: every sea route within its movement points, the cheapest way
 * (no tribute if possible, then fewest steps). A ship may pass any number of ships but not stop
 * on an edge with two; it may not sail on past a corner of a face-down hex (it explores there and
 * stops); a way past the pirate needs a gold for the tribute.
 */
export function reachable(state: GameState, ship: Ship): Map<EdgeId, Reach> {
  const s = epSlice(state);
  const mp = mpLeft(state, ship);
  const out = new Map<EdgeId, Reach>();
  if (mp <= 0) return out;
  const g = graph(state);
  const pirate = tributeHex(state, ship);
  const canPay = (s.gold[ship.owner] ?? 0) >= 1;
  const pirateSides = new Set(pirate ? sidesOf(state, pirate) : []);
  const stops = (e: EdgeId) => touchesFog(state, e);
  const routes = shipEdges(state);
  // BFS over (edge, paid): free paths first.
  const seen = new Map<string, number>();
  type Node = { e: EdgeId; paid: boolean; d: number };
  const start: Node = { e: ship.edge, paid: false, d: 0 };
  let frontier: Node[] = [start];
  seen.set(`${ship.edge}|0`, 0);
  while (frontier.length > 0) {
    const next: Node[] = [];
    for (const node of frontier) {
      if (node.d >= mp) continue;
      if (node.e !== ship.edge && stops(node.e)) continue;
      const ends = g.ends.get(node.e) ?? [];
      for (const v of ends) {
        for (const e of g.edgesAt.get(v) ?? []) {
          if (e === node.e || !routes.has(e)) continue;
          const paid = node.paid || pirateSides.has(node.e) || pirateSides.has(e);
          if (paid && !canPay) continue;
          const key = `${e}|${paid ? 1 : 0}`;
          if (seen.has(key)) continue;
          seen.set(key, node.d + 1);
          next.push({ e, paid, d: node.d + 1 });
        }
      }
    }
    frontier = next;
  }
  for (const [key, d] of seen) {
    const [e, paidFlag] = key.split('|') as [EdgeId, string];
    if (e === ship.edge) continue;
    // Room to stop: fewer than two ships (the moving ship is not there yet).
    if (shipsOn(s, e) >= 2) continue;
    const paid = paidFlag === '1';
    const prev = out.get(e);
    if (!prev || (prev.tribute && !paid) || (prev.tribute === paid && d < prev.dist)) {
      out.set(e, { dist: d, tribute: paid });
    }
  }
  return out;
}

/** Can the ship still sail somewhere this turn? */
export const canSail = (state: GameState, ship: Ship): boolean => reachable(state, ship).size > 0;

/** The ship stops sailing (another one moved, it explored, it rolled for fish...). */
export function finishShip(s: EpSlice, id: number): void {
  const t = shipTurn(s, id);
  if (t.used > 0 || t.extra) shipTurnDraft(s, id).done = true;
}

// ---------------------------------------------------------------------------------------------
// Exploring (§4.3)
// ---------------------------------------------------------------------------------------------

/**
 * Turn over every face-down hex at an end of `e` (rules doc §10 Q5: all of them), each paying the
 * explorer 1 card of its resource, or 2 gold for sea, gold fields, shoals and farms. A land hex
 * gets a number disc of its region; a gold field a lair token (lair scenarios); a spice farm one
 * sack per player. Returns the hexes turned over.
 */
export function explore(draft: GameState, p: PlayerId, e: EdgeId): HexId[] {
  const s = epSlice(draft);
  const hexes = fogAtEnds(draft, e);
  const region = epBoard(draft).region;
  for (const h of hexes) {
    const tile = draft.board.hexes[h];
    const hidden = s.hidden[h];
    if (!tile || !hidden) continue;
    Reflect.deleteProperty(s.hidden, h);
    let terrain: Terrain = hidden.terrain;
    let token: number | null = null;
    let what: string;
    if (isResource(terrain)) {
      const stack = region[h] === 'goose' ? s.discs.goose : s.discs.parrot;
      token = stack.pop() ?? null;
      what = `${terrain}${token === null ? '' : ` ${token}`}`;
    } else if (terrain === 'gold') {
      const t = s.lairTokens.pop();
      if (t !== undefined) s.lairs[h] = { token: t, crews: [], captured: false };
      what = t !== undefined ? 'a pirate lair on a gold field' : 'a gold field';
    } else if (hidden.shoal !== undefined) {
      terrain = T.fish;
      s.shoals[h] = hidden.shoal;
      what = `a fish shoal (${hidden.shoal})`;
    } else if (hidden.spice !== undefined) {
      terrain = T.spice;
      s.spice[h] = {
        kind: hidden.spice,
        ...(hidden.number === undefined ? {} : { number: hidden.number }),
        sacks: draft.players.map((pl) => pl.id),
        crews: [],
      };
      what = 'a spice farm';
    } else what = 'open sea';
    draft.board = {
      ...draft.board,
      hexes: { ...draft.board.hexes, [h]: { ...tile, terrain, token } },
    };
    const hand = draft.players[p]?.resources;
    if (isResource(terrain)) {
      // The bank may have run out of that resource: then the discovery pays nothing.
      const paid = hand !== undefined && draft.bank[terrain] > 0;
      if (paid) {
        hand[terrain] += 1;
        draft.bank[terrain] -= 1;
      }
      log(
        draft,
        p,
        `${name(draft, p)} discovered ${what}${paid ? ` and received 1 ${terrain}` : ''}`,
      );
    } else {
      s.gold[p] = (s.gold[p] ?? 0) + 2;
      log(draft, p, `${name(draft, p)} discovered ${what} and received 2 gold`);
    }
  }
  return hexes;
}
