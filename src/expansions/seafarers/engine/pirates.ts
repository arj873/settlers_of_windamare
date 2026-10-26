/**
 * The Pirate Islands (docs/rules/seafarers.md §2.8, §4.10): one ship line per player from their
 * starting settlement through their beachhead to their fortress (shortest route, no branches),
 * warships, the pirate fleet that sails every roll, and fortress attacks at the end of a turn.
 */
import { RESOURCES } from '../../../engine/constants';
import type { Rng } from '../../../engine/rng';
import type {
  Board,
  EdgeId,
  GameState,
  HexId,
  PlayerId,
  Resource,
  VertexId,
} from '../../../engine/types';
import { cellEdge, cellHex, cellVertex, parseCell, type BookCorner } from './coords';
import { graph, isShipEdge } from './geometry';
import { mapKeyOf, type MapKey } from './maps';
import { seaSlice, type Fortress } from './state';

interface Slot {
  colour: string;
  fortress: string;
  beachhead: string;
  settlement: string;
  /** Book side of the settlement's cell the starting ship lies on. */
  ship: string;
}

interface PirateMap {
  /** Colour slots in seat order; `drop` is left out of the smaller player count. */
  slots: readonly Slot[];
  drop: string;
  path: readonly string[];
  /** Pirate Islands 5-6: the fleet attacks nobody when it stops here. */
  calm?: string;
}

const PIRATES34: PirateMap = {
  slots: [
    {
      colour: 'orange',
      fortress: '0,2 W',
      beachhead: '0,4 SW',
      settlement: '0,10 E',
      ship: '0,10 NE',
    },
    { colour: 'blue', fortress: '1,1 E', beachhead: '3,3 W', settlement: '3,9 W', ship: '3,9 NW' },
    { colour: 'white', fortress: '5,1 W', beachhead: '3,3 E', settlement: '3,9 E', ship: '3,9 NE' },
    {
      colour: 'red',
      fortress: '6,2 E',
      beachhead: '6,4 SE',
      settlement: '6,10 W',
      ship: '6,10 NW',
    },
  ],
  drop: 'white',
  // prettier-ignore
  path: ['0,8', '0,6', '1,5', '2,4', '3,5', '4,4', '5,5', '6,6', '6,8', '5,9', '4,8', '3,7', '2,8', '1,9'],
};

const PIRATES56: PirateMap = {
  slots: [
    {
      colour: 'brown',
      fortress: '0,2 NW',
      beachhead: '0,6 SW',
      settlement: '0,12 NW',
      ship: '0,12 N',
    },
    {
      colour: 'green',
      fortress: '0,2 E',
      beachhead: '0,6 E',
      settlement: '1,13 NW',
      ship: '1,13 N',
    },
    {
      colour: 'orange',
      fortress: '2,0 SE',
      beachhead: '2,4 SE',
      settlement: '2,12 NE',
      ship: '2,12 N',
    },
    {
      colour: 'blue',
      fortress: '4,0 SW',
      beachhead: '4,4 SW',
      settlement: '4,12 NW',
      ship: '4,12 N',
    },
    {
      colour: 'white',
      fortress: '6,2 W',
      beachhead: '6,6 W',
      settlement: '5,13 NE',
      ship: '5,13 N',
    },
    {
      colour: 'red',
      fortress: '6,2 NE',
      beachhead: '6,6 SE',
      settlement: '6,12 NE',
      ship: '6,12 N',
    },
  ],
  drop: 'brown',
  // prettier-ignore
  path: ['0,8', '1,7', '2,6', '3,5', '4,6', '5,7', '6,8', '6,10', '5,11', '4,10', '3,9', '2,10', '1,11', '0,10'],
  calm: '3,5',
};

export interface PirateSeat {
  colour: string;
  fortress: VertexId;
  beachhead: VertexId;
  settlement: VertexId;
  ship: EdgeId;
}

function vertexOf(s: string): VertexId {
  const [pos = '', corner = ''] = s.split(' ');
  return cellVertex(parseCell(pos), corner as BookCorner);
}

function pirateMap(key: MapKey): PirateMap | null {
  if (key === 'pirates3' || key === 'pirates4') return PIRATES34;
  if (key === 'pirates56') return PIRATES56;
  return null;
}

/** The colour slots of each seat (3 players: no white; 5 players: no brown). */
export function pirateSeats(key: MapKey, players: number): PirateSeat[] {
  const m = pirateMap(key);
  if (!m) return [];
  const slots = players < m.slots.length ? m.slots.filter((s) => s.colour !== m.drop) : m.slots;
  return slots.slice(0, players).map((s) => {
    const [pos = '', side = ''] = s.ship.split(' ');
    return {
      colour: s.colour,
      fortress: vertexOf(s.fortress),
      beachhead: vertexOf(s.beachhead),
      settlement: vertexOf(s.settlement),
      ship: cellEdge(parseCell(pos), side as Parameters<typeof cellEdge>[1]),
    };
  });
}

export function fleetPath(key: MapKey): HexId[] {
  return (pirateMap(key)?.path ?? []).map((s) => cellHex(parseCell(s)));
}

export function calmHex(key: MapKey): HexId | null {
  const c = pirateMap(key)?.calm;
  return c ? cellHex(parseCell(c)) : null;
}

const keyOf = (state: GameState): MapKey => mapKeyOf(state.settings.map) as MapKey;

export function seatOf(state: GameState, p: PlayerId): PirateSeat | undefined {
  return pirateSeats(keyOf(state), state.players.length)[p];
}

export function fortressOf(state: GameState, p: PlayerId): Fortress | undefined {
  return seaSlice(state).fleet?.fortresses.find((f) => f.owner === p);
}

export function fleetHex(state: GameState): HexId | null {
  const f = seaSlice(state).fleet;
  if (!f || f.gone) return null;
  return fleetPath(keyOf(state))[f.at] ?? null;
}

// ---------------------------------------------------------------------------------------------
// The ship line
// ---------------------------------------------------------------------------------------------

/** The player's line: its ships from the starting settlement outwards, and its far end. */
export function lineOf(state: GameState, p: PlayerId): { ships: EdgeId[]; head: VertexId } {
  const seat = seatOf(state, p);
  const g = graph(state);
  const ships = seaSlice(state).ships;
  const out: EdgeId[] = [];
  if (!seat) return { ships: out, head: 'v:0,0,N' };
  let v = seat.settlement;
  for (;;) {
    const next = (g.edgesAt.get(v) ?? []).find((e) => ships[e]?.owner === p && !out.includes(e));
    if (next === undefined) break;
    out.push(next);
    const [a, b] = g.ends.get(next) as readonly [VertexId, VertexId];
    v = a === v ? b : a;
  }
  return { ships: out, head: v };
}

const DIST = new WeakMap<Board, Map<VertexId, Map<VertexId, number>>>();

/** Ship-route distance (in edges) from every vertex to `target`. */
function distancesTo(state: GameState, target: VertexId): Map<VertexId, number> {
  let byTarget = DIST.get(state.board);
  if (!byTarget) {
    byTarget = new Map();
    DIST.set(state.board, byTarget);
  }
  let d = byTarget.get(target);
  if (d) return d;
  const g = graph(state);
  d = new Map([[target, 0]]);
  const queue = [target];
  while (queue.length > 0) {
    const v = queue.shift() as VertexId;
    const dv = d.get(v) as number;
    for (const e of g.edgesAt.get(v) ?? []) {
      if (!isShipEdge(state, e)) continue;
      const [a, b] = g.ends.get(e) as readonly [VertexId, VertexId];
      const n = a === v ? b : a;
      if (!d.has(n)) {
        d.set(n, dv + 1);
        queue.push(n);
      }
    }
  }
  byTarget.set(target, d);
  return d;
}

/** Has the line reached the beachhead / the fortress? */
export function lineReaches(state: GameState, p: PlayerId, v: VertexId): boolean {
  const g = graph(state);
  const ships = seaSlice(state).ships;
  return lineOf(state, p).ships.some((e) => g.ends.get(e)?.includes(v) && ships[e]?.owner === p);
}

/**
 * A new ship of `p` on `e` (§2.8): it extends the far end of their line one step along a
 * shortest route to the beachhead, then to the fortress; nothing beyond the fortress.
 */
export function pirateLineAllows(state: GameState, p: PlayerId, e: EdgeId): boolean {
  const seat = seatOf(state, p);
  if (!seat) return false;
  const { head } = lineOf(state, p);
  if (head === seat.fortress) return false;
  const ends = graph(state).ends.get(e);
  if (!ends?.includes(head)) return false;
  const next = ends[0] === head ? ends[1] : ends[0];
  const target = lineReaches(state, p, seat.beachhead) ? seat.fortress : seat.beachhead;
  const d = distancesTo(state, target);
  const dh = d.get(head);
  return dh !== undefined && d.get(next) === dh - 1;
}

/** The ship nearest the starting settlement that is not a warship yet. */
export function hindmostShip(state: GameState, p: PlayerId): EdgeId | null {
  const ships = seaSlice(state).ships;
  return lineOf(state, p).ships.find((e) => !ships[e]?.warship) ?? null;
}

export function warships(state: GameState, p: PlayerId): number {
  return Object.values(seaSlice(state).ships).filter((s) => s.owner === p && s.warship).length;
}

// ---------------------------------------------------------------------------------------------
// The fleet and the fortresses
// ---------------------------------------------------------------------------------------------

/** Take `n` random cards from `p`'s hand back to the bank (fewer if the hand is smaller). */
export function loseRandom(draft: GameState, p: PlayerId, n: number, rng: Rng): number {
  const pl = draft.players[p];
  if (!pl) return 0;
  let lost = 0;
  for (let i = 0; i < n; i++) {
    const cards: Resource[] = RESOURCES.flatMap((r) => Array<Resource>(pl.resources[r]).fill(r));
    if (cards.length === 0) break;
    const r = rng.pick(cards);
    pl.resources[r] -= 1;
    draft.bank[r] += 1;
    lost++;
  }
  return lost;
}

/** The players with a building on the fleet's hex, clockwise from `from`. */
export function fleetVictims(state: GameState, from: PlayerId): PlayerId[] {
  const hex = fleetHex(state);
  if (hex === null) return [];
  const owners = new Set<PlayerId>();
  for (const v of graph(state).hexVertices.get(hex) ?? []) {
    const b = state.pieces.buildings[v];
    if (b) owners.add(b.owner);
  }
  const n = state.players.length;
  return state.players.map((_, i) => (from + i) % n).filter((p) => owners.has(p));
}

/** The line has reached the fortress and the fortress still stands: an attack is possible. */
export function canAttackFortress(state: GameState, p: PlayerId): boolean {
  const f = fortressOf(state, p);
  return f !== undefined && f.chits > 0 && lineOf(state, p).head === f.vertex;
}
