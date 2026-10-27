/**
 * Traders & Barbarians + Seafarers (the 2025 combination sheets, docs/rules/combos.md §3): each
 * T&B scenario on Heading for New Shores, composed from the two modules plus the rules only the
 * pair has. The scenarios name what they play as (`playsAs`): the T&B scenario switches T&B's
 * features on, New Shores Seafarers' rules; the maps are built on New Shores (`basedOn`, maps.ts).
 *
 * Composition order (`before`): tbsea, seafarers, tb. Where both hook the same first-wins point
 * this module decides:
 * - afterProduction: T&B's fish (a ground under the pirate pays nothing), then Seafarers' gold;
 * - roadLength (chained): the trade route over roads and ships, a camel counting its edge twice
 *   (Caravans), cut by a conquered settlement (Barbarian Attack, FAQ 6); T&B keeps no route.
 * The rest needs no decision: T&B's wagons, barbarians and camels use sea paths on a map with
 * open sea and take ships from `routeEdges` (tb/engine/paths.ts); no robber and no pirate in T&B
 * and Barbarian Attack (tb's robberless rule, the map's pirate start null).
 */
import { fail, isCurrent, log, ok, resumePhase } from '../../../engine/actions/common';
import type {
  ExpansionModule,
  ExtHandler,
  ExtWrap,
  ScenarioDef,
} from '../../../engine/expansions/types';
import { canPlaceRoad } from '../../../engine/rules/placement';
import { playerName } from '../../../engine/rules/text';
import { piecesLeft } from '../../../engine/selectors';
import { topologyOf } from '../../../engine/topology';
import { roadsBlocked } from '../../../engine/variants';
import type { Action, EdgeId, GameState, PlayerId, VertexId } from '../../../engine/types';
import { seafarersModule, seaSlice, type MoveShipPhase } from '../../seafarers/engine';
import { SEA_ACTIONS } from '../../seafarers/engine/actions';
import { graph } from '../../seafarers/engine/geometry';
import { OFF_BOARD } from '../../seafarers/engine/maps';
import { shipSpots, shipsLeft, shipsOf, tradeRouteLength } from '../../seafarers/engine/ships';
import { addGold, goldOf } from '../../tb/engine/common';
import { isConqueredBuilding } from '../../tb/engine/conquest';
import { fishBlocker, fishPayment, payFish } from '../../tb/engine/fish';
import { edgeOnRiver, isBridgeSite } from '../../tb/engine/rivers';
import { caravansOf, fishOf, fishTotal, has } from '../../tb/engine/state';
import { mapIdOf, PAIRS, SEA_PAIRS, seaMapIdOf, TBSEA, TBSEA_MAPS } from './maps';

export { TBSEA, PAIRS, SEA_PAIRS, pairOf, seaPairOf, shiftId, BASE_MAP } from './maps';

export const TBSEA_MODE = 'tb+seafarers';
export const TBSEA_SCENARIOS = [...PAIRS.map((p) => p.id), ...SEA_PAIRS.map((p) => p.id)];

// Nothing of another module is read at the top level of this file: when a Seafarers or T&B file
// is the first import, the registry loads this module while theirs is still half-evaluated
// (registry.test.ts). Module ids are literals; other modules' values are read on use.
const TB = 'tb';
const SEAFARERS = 'seafarers';

/** Fish for chasing the pirate off the board / for a free ship: T&B's 2 and 5 (tested). */
export const FISH_PIRATE = 2;
export const FISH_SHIP = 5;

export type TbseaAction =
  { type: 'tbsea/fishPirate'; player: PlayerId } | { type: 'tbsea/fishShip'; player: PlayerId };

const pn = (s: GameState, p: PlayerId) => playerName(s, p);
/** Seafarers actions that put a ship on `edge`. */
const shipBuilds = (): readonly string[] => [
  SEA_ACTIONS.buildShip,
  SEA_ACTIONS.freeShip,
  SEA_ACTIONS.setupShip,
];
const edgeOf = (a: { [k: string]: unknown }): EdgeId | null =>
  typeof a['edge'] === 'string' ? (a['edge'] as EdgeId) : null;
const movingFrom = (state: GameState): EdgeId | null =>
  state.phase.kind === SEA_ACTIONS.moveShip ? (state.phase as MoveShipPhase).from : null;

// ---------------------------------------------------------------------------------------------
// Fishing: 2 fish chase the pirate off the board, 5 fish build a free ship
// ---------------------------------------------------------------------------------------------

/** The common checks of a fish action (own turn, before or after the roll, enough fish). */
function fishTurnBlocker(state: GameState, p: PlayerId, cost: number): string | null {
  if (!has(state, 'fish')) return 'no fish in this game';
  const k = state.phase.kind;
  if (k !== 'preRoll' && k !== 'main') return 'fish are used on your own turn';
  if (!isCurrent(state, p) || state.turn.secondSettlerOf !== undefined) return 'not your turn';
  if (fishTotal(fishOf(state).hands[p] ?? []) < cost) return `needs ${cost} fish`;
  return null;
}

export function fishPirateBlocker(state: GameState, p: PlayerId): string | null {
  const err = fishTurnBlocker(state, p, FISH_PIRATE);
  if (err) return err;
  const sea = seaSlice(state);
  if (sea.pirate === null || sea.pirate === OFF_BOARD) return 'the pirate is not on the board';
  // Cloth for Catan: only with a route from one of your buildings to a village.
  if (sea.cloth && !Object.values(sea.cloth.links).some((l) => l.includes(p))) {
    return 'needs a route to a village';
  }
  return null;
}

/**
 * 5 fish for a free ship. T&B's 5-fish road already opens Road Building, where a ship may be
 * placed instead; this action is offered when no road fits but a ship does.
 */
export function fishShipBlocker(state: GameState, p: PlayerId): string | null {
  const err = fishTurnBlocker(state, p, FISH_SHIP);
  if (err) return err;
  if (fishBlocker(state, p, 'road') === null) return 'use the 5 fish for a road or ship';
  if (shipsLeft(state, p) <= 0 || shipSpots(state, p).length === 0) return 'no ship can be placed';
  return null;
}

/** Pay `cost` fish with the smallest overpayment (T&B's rule). */
function spendFish(draft: GameState, p: PlayerId, cost: number): number {
  const s = fishOf(draft);
  const hand = s.hands[p] ?? [];
  const pay = fishPayment(hand, cost) ?? [];
  for (const t of pay) hand.splice(hand.indexOf(t), 1);
  s.spent.push(...pay);
  return fishTotal(pay);
}

const fishPirate: ExtHandler = (draft, action) => {
  const err = fishPirateBlocker(draft, action.player);
  if (err) return fail(err);
  const paid = spendFish(draft, action.player, FISH_PIRATE);
  seaSlice(draft).pirate = OFF_BOARD;
  log(
    draft,
    action.player,
    `${pn(draft, action.player)} paid ${paid} fish to chase the pirate off the board`,
  );
  return ok(draft);
};

const fishShip: ExtHandler = (draft, action) => {
  const err = fishShipBlocker(draft, action.player);
  if (err) return fail(err);
  const resume = draft.phase.kind === 'preRoll' ? 'preRoll' : 'main';
  spendFish(draft, action.player, FISH_SHIP);
  draft.phase = { kind: 'roadBuilding', remaining: 1, resume };
  log(draft, action.player, `${pn(draft, action.player)} paid fish for a free ship`);
  return ok(draft);
};

// ---------------------------------------------------------------------------------------------
// Rivers: ships earn gold on river edges, pay to leave them, never lie on a bridge site
// ---------------------------------------------------------------------------------------------

function riverShipBlocker(state: GameState, p: PlayerId, type: string, e: EdgeId): string | null {
  if (!has(state, 'rivers')) return null;
  if (shipBuilds().includes(type) || type === SEA_ACTIONS.moveShip) {
    if (isBridgeSite(state, e)) return 'no ship on a bridge site';
  }
  if (type === SEA_ACTIONS.pickShip && edgeOnRiver(state, e) && goldOf(state, p) < 1) {
    return 'moving a ship away from a river costs 1 gold';
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Barbarian Attack: routes grow only from an unconquered building
// ---------------------------------------------------------------------------------------------

/**
 * The ship on `e` (built or moved there) joins `p`'s route to one of their unconquered buildings:
 * through their ships, never through another player's building or a conquered one.
 */
export function anchored(state: GameState, p: PlayerId, e: EdgeId, ignore?: EdgeId): boolean {
  const g = graph(state);
  const ships = seaSlice(state).ships;
  const seen = new Set<VertexId>();
  const stack = [...(g.ends.get(e) ?? [])];
  while (stack.length > 0) {
    const v = stack.pop() as VertexId;
    if (seen.has(v)) continue;
    seen.add(v);
    const b = state.pieces.buildings[v];
    if (b !== undefined) {
      if (b.owner === p && !isConqueredBuilding(state, v)) return true;
      continue;
    }
    for (const o of g.edgesAt.get(v) ?? []) {
      if (o === e || o === ignore || ships[o]?.owner !== p) continue;
      for (const w of g.ends.get(o) ?? []) if (!seen.has(w)) stack.push(w);
    }
  }
  return false;
}

function baShipBlocker(state: GameState, p: PlayerId, type: string, e: EdgeId): string | null {
  if (!has(state, 'ba') || type === SEA_ACTIONS.setupShip) return null;
  const from = movingFrom(state);
  const target = type === SEA_ACTIONS.moveShip ? anchored(state, p, e, from ?? undefined) : true;
  const build = shipBuilds().includes(type) ? anchored(state, p, e) : true;
  // Picking a ship up changes its route: it must hang on an unconquered building too.
  const pick = type === SEA_ACTIONS.pickShip ? anchored(state, p, e) : true;
  return target && build && pick
    ? null
    : 'the route must start at one of your unconquered buildings';
}

/** Why the pair forbids this Seafarers ship action (null = allowed). */
function shipBlocker(state: GameState, a: Action): string | null {
  const e = edgeOf(a as unknown as Record<string, unknown>);
  if (e === null) return null;
  return riverShipBlocker(state, a.player, a.type, e) ?? baShipBlocker(state, a.player, a.type, e);
}

// ---------------------------------------------------------------------------------------------
// Wraps of Seafarers' ship actions
// ---------------------------------------------------------------------------------------------

/** Rivers: a ship built on a river hex's edge earns 1 gold (a setup ship too, like a road). */
const riverGold: ExtWrap = (draft, action, next) => {
  const err = shipBlocker(draft, action as unknown as Action);
  if (err) return fail(err);
  const r = next(draft, action);
  const e = edgeOf(action);
  if (r.ok && e !== null && has(draft, 'rivers') && edgeOnRiver(draft, e)) {
    addGold(draft, action.player, 1);
    log(draft, action.player, `${pn(draft, action.player)} got 1 gold (ship on a river)`);
  }
  return r;
};

const guard: ExtWrap = (draft, action, next) => {
  const err = shipBlocker(draft, action as unknown as Action);
  return err ? fail(err) : next(draft, action);
};

let wrapsMemo: Record<`${string}/${string}`, ExtWrap> | null = null;
/** The wraps, keyed by Seafarers' action types (built on first use). */
const wraps = (): Record<`${string}/${string}`, ExtWrap> =>
  (wrapsMemo ??= {
    [SEA_ACTIONS.buildShip]: riverGold,
    [SEA_ACTIONS.freeShip]: riverGold,
    [SEA_ACTIONS.setupShip]: riverGold,
    [SEA_ACTIONS.pickShip]: guard,
    // Rivers: a ship leaving a river hex's edge costs 1 gold.
    [SEA_ACTIONS.moveShip]: (draft, action, next) => {
      const err = shipBlocker(draft, action as unknown as Action);
      if (err) return fail(err);
      const from = movingFrom(draft);
      const pays = from !== null && has(draft, 'rivers') && edgeOnRiver(draft, from);
      if (pays && goldOf(draft, action.player) < 1) {
        return fail('moving a ship away from a river costs 1 gold');
      }
      const r = next(draft, action);
      if (r.ok && pays) {
        addGold(draft, action.player, -1);
        log(draft, action.player, `${pn(draft, action.player)} paid 1 gold to sail off a river`);
      }
      return r;
    },
  });

// ---------------------------------------------------------------------------------------------
// Production and the trade route
// ---------------------------------------------------------------------------------------------

/** T&B's fish (the pirate blocks the fishing ground it lies on), then Seafarers' gold. */
const afterProduction: NonNullable<NonNullable<ExpansionModule['hooks']>['afterProduction']> = (
  draft,
  roll,
  paid,
) => {
  if (has(draft, 'fish')) {
    const pirate = seaSlice(draft).pirate;
    payFish(draft, roll, pirate === null ? [] : [pirate]);
  }
  return seafarersModule.hooks?.afterProduction?.(draft, roll, paid) ?? { kind: 'main' };
};

/**
 * The trade route (chained before Seafarers' and T&B's own): Caravans counts an edge under a
 * camel twice, roads and ships alike (a camel on a ship is an extra ship, FAQ 40); Barbarian
 * Attack cuts it at a conquered settlement, the player's own too (FAQ 6).
 */
function roadLength(state: GameState, p: PlayerId, base: number): number {
  if (has(state, 'caravans')) {
    const camels = new Set(caravansOf(state).camels.map((c) => c.edge));
    return Math.max(
      base,
      tradeRouteLength(state, p, (e) => (camels.has(e) ? 2 : 1)),
    );
  }
  if (has(state, 'ba')) return tradeRouteLength(state, p);
  return base;
}

// ---------------------------------------------------------------------------------------------
// The module
// ---------------------------------------------------------------------------------------------

function legal(state: GameState): Action[] {
  const p = state.turn.current;
  const out: Action[] = [];
  if (!has(state, 'fish')) return out;
  if (fishPirateBlocker(state, p) === null) {
    out.push({ type: 'tbsea/fishPirate', player: p } as unknown as Action);
  }
  if (fishShipBlocker(state, p) === null) {
    out.push({ type: 'tbsea/fishShip', player: p } as unknown as Action);
  }
  return out;
}

/** The pair limits ships (Rivers: bridge sites; Barbarian Attack: unconquered routes). */
const limitsShips = (state: GameState) => has(state, 'rivers') || has(state, 'ba');

/** Road Building could place a road, or a free ship the pair allows. */
function freePieceFits(state: GameState, p: PlayerId): boolean {
  if (piecesLeft(state, p).road > 0 && !roadsBlocked(state, p)) {
    if (topologyOf(state).edges.some((e) => canPlaceRoad(state, p, e))) return true;
  }
  if (shipsLeft(state, p) <= 0) return false;
  const free = (edge: EdgeId) =>
    ({ type: SEA_ACTIONS.freeShip, player: p, edge }) as unknown as Action;
  return shipSpots(state, p).some((e) => shipBlocker(state, free(e)) === null);
}

function filterLegal(state: GameState, actions: Action[]): Action[] {
  if (!limitsShips(state)) return actions;
  return actions.filter((a) => {
    // No Road Building card when only forbidden ship spots are left (it would place nothing).
    if (a.type === 'playRoadBuilding') return freePieceFits(state, a.player);
    return !a.type.startsWith(`${SEAFARERS}/`) || shipBlocker(state, a) === null;
  });
}

/** Road Building ends when nothing the pair allows fits any more (Seafarers counts every ship spot). */
function endRoadBuilding(draft: GameState): void {
  const phase = draft.phase;
  if (phase.kind !== 'roadBuilding' || !limitsShips(draft)) return;
  if (!freePieceFits(draft, draft.turn.current)) draft.phase = resumePhase(draft, phase.resume);
}

const scenarios: ScenarioDef[] = [
  ...PAIRS.map((pair) => ({
    id: pair.id,
    name: pair.name,
    blurb: pair.blurb,
    players: { min: 3, max: 4 },
    maps: [mapIdOf(pair)],
    mapFor: () => mapIdOf(pair),
    vpToWin: pair.vp,
    playsAs: { [TB]: [pair.tb], [SEAFARERS]: ['seafarers/newShores'] },
  })),
  // C3: the T&B scenarios on the other Seafarers scenarios (one map per player count).
  ...SEA_PAIRS.map((pair) => {
    const ids = pair.maps.map((m) => seaMapIdOf(pair, m));
    const forPlayers = (n: number) => {
      const i = pair.maps.findIndex((m) => n >= m.players[0] && n <= m.players[1]);
      return ids[Math.max(i, 0)] as `${string}/${string}`;
    };
    return {
      id: pair.id,
      name: pair.name,
      blurb: pair.blurb,
      players: { min: 3, max: 4 },
      maps: ids,
      mapFor: forPlayers,
      vpToWin: pair.vp,
      playsAs: { [TB]: [pair.tb], [SEAFARERS]: [pair.sea] },
    };
  }),
];

export const tbseaModule: ExpansionModule = {
  id: TBSEA,
  name: 'Traders & Barbarians + Seafarers',
  requires: [TB, SEAFARERS],
  before: [TB, SEAFARERS],
  players: { min: 3, max: 4 },
  maps: TBSEA_MAPS,
  scenarios,
  modes: [
    {
      id: TBSEA_MODE,
      name: 'Traders & Barbarians + Seafarers',
      blurb: 'T&B scenarios on the Seafarers maps: wagons, fish, rivers and camels at sea',
      status: 'ready',
      expansions: [TBSEA],
      scenarios: TBSEA_SCENARIOS,
      players: { min: 3, max: 4 },
      // The T&B island sits on the printed New Shores map: no variable set-up.
      hideOptions: [`${SEAFARERS}.layout`],
    },
  ],

  validate(settings) {
    if (!TBSEA_SCENARIOS.includes(settings.scenario ?? '')) {
      return 'Traders & Barbarians + Seafarers is played on its own scenarios';
    }
    if (settings.options[SEAFARERS]?.['layout'] === 'variable') {
      return 'The T&B island sits on the printed New Shores map: use the standard map';
    }
    return null;
  },

  actions: { 'tbsea/fishPirate': fishPirate, 'tbsea/fishShip': fishShip },
  // Barbarian Attack: a conquest (or a freed hex) changes the trade route (FAQ 6). Barbarians
  // land after a city too, Treason and Intrigue move them, the end of the turn expels them.
  changesRoads: ['buildCity', 'endTurn', 'tb/treasonHex', 'tb/intrigueHex'],
  get wraps() {
    return wraps();
  },
  legal,
  filterLegal,

  hooks: {
    afterProduction,
    roadLength,
    // Wagons travel on ships like on roads (T&B + Seafarers, FAQ 65).
    routeEdges: (state, p) => (has(state, 'traders') ? shipsOf(state, p) : []),
    // Barbarian Attack: a conquered settlement interrupts the trade route (FAQ 6).
    blocksRoute: (state, v) => has(state, 'ba') && isConqueredBuilding(state, v),
    afterAction: (draft) => endRoadBuilding(draft),
  },
};
