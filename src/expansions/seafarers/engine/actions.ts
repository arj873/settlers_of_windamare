/**
 * Seafarers actions (docs/rules/seafarers.md §3-§4): handlers, legal moves and the overrides of
 * base actions (settlements reached by ship, Road Building with ships, robber limits, the
 * Pirate Islands' knights).
 */
import { RESOURCES } from '../../../engine/constants';
import {
  fail,
  isCurrent,
  log,
  ok,
  resumePhase,
  type LegalGenerator,
} from '../../../engine/actions/common';
import { isBuildPhase } from '../../../engine/actions/build';
import { discardOptions } from '../../../engine/actions/robber';
import { advanceSetup } from '../../../engine/actions/setup';
import { continueRoll, turnHandlers } from '../../../engine/actions/turn';
import { costOf, terrainKind } from '../../../engine/expansions/hooks';
import type { Override } from '../../../engine/expansions/types';
import { Rng } from '../../../engine/rng';
import { hasResources, isValidBundle, totalResources } from '../../../engine/resources';
import { canPlaceRoad, canPlaceSettlement } from '../../../engine/rules/placement';
import { describeBundle, playerName } from '../../../engine/rules/text';
import { cardsInHand, getPlayer, piecesLeft, victoryPoints } from '../../../engine/selectors';
import { topologyOf } from '../../../engine/topology';
import type {
  Action,
  EdgeId,
  ExpansionAction,
  GameState,
  HexId,
  Phase,
  PlayerId,
  ResourceBundle,
  ResourceCounts,
  ResumePhase,
  VertexId,
} from '../../../engine/types';
import { isRobberProtected, nextToDamagedRoad, roadsBlocked } from '../../../engine/variants';
import {
  collectGift,
  discover,
  harborSpots,
  placeHarbor,
  promptHarbor,
  updateVillageLinks,
} from './effects';
import { wonderCards, WONDER_LEVELS, wonderMarks } from './features';
import { graph, isSeaHex } from './geometry';
import { mapKeyOf, seaBoard, type MapKey } from './maps';
import { canAttackFortress, fortressOf, hindmostShip, lineOf, seatOf, warships } from './pirates';
import {
  canMoveShip,
  canPlaceShip,
  markClosedRoutes,
  moveTargets,
  SHIP,
  shipSpots,
  shipsLeft,
  tradeRouteLength,
} from './ships';
import {
  rulesOf,
  scenarioKey,
  seaSlice,
  type ClothStealPhase,
  type GoldPhase,
  type HarborPhase,
  type MoveShipPhase,
} from './state';

const T = {
  buildShip: 'seafarers/buildShip',
  pickShip: 'seafarers/pickShip',
  moveShip: 'seafarers/moveShip',
  cancelMove: 'seafarers/cancelMove',
  setupShip: 'seafarers/placeSetupShip',
  freeShip: 'seafarers/placeFreeShip',
  movePirate: 'seafarers/movePirate',
  pickGold: 'seafarers/pickGold',
  stealCloth: 'seafarers/stealCloth',
  stealCard: 'seafarers/stealCard',
  placeHarbor: 'seafarers/placeHarbor',
  attackFortress: 'seafarers/attackFortress',
  startWonder: 'seafarers/startWonder',
  buildWonder: 'seafarers/buildWonder',
} as const;
export const SEA_ACTIONS = T;

const name = (s: GameState, p: PlayerId) => playerName(s, p);
const keyOf = (state: GameState) => mapKeyOf(state.settings.map) as MapKey;
const isEdge = (x: unknown): x is EdgeId => typeof x === 'string' && x.startsWith('e:');
const bankTotal = (s: GameState) => RESOURCES.reduce((n, r) => n + s.bank[r], 0);

function pay(draft: GameState, p: PlayerId, cost: ResourceCounts): void {
  const hand = draft.players[p]?.resources;
  if (!hand) return;
  for (const r of RESOURCES) {
    hand[r] -= cost[r];
    draft.bank[r] += cost[r];
  }
}

/** Everything a ship landing on `e` sets off (§4.2: moved ships count as placed there). */
export function shipLanded(draft: GameState, p: PlayerId, e: EdgeId): void {
  collectGift(draft, p, e);
  discover(draft, p, e);
  markClosedRoutes(draft);
  updateVillageLinks(draft);
}

// ---------------------------------------------------------------------------------------------
// Checks shared by handlers and legal moves
// ---------------------------------------------------------------------------------------------

/** Phase, turn, cost and supply of a new ship (main or special build phase). */
export function shipPrecheck(state: GameState, p: PlayerId): string | null {
  if (!isBuildPhase(state)) return 'can only build in the main or special building phase';
  if (!isCurrent(state, p)) return 'not your turn';
  const hand = state.players[p]?.resources;
  const cost = costOf(state, SHIP);
  if (!hand || !cost || !hasResources(hand, cost)) return 'cannot afford a ship';
  if (shipsLeft(state, p) <= 0) return 'no ships left';
  return null;
}

/** May `p` pick up a ship to move it now (main phase, once per turn; §4.2)? */
export function movePrecheck(state: GameState, p: PlayerId): string | null {
  if (state.phase.kind !== 'main') return 'ships move in the main phase';
  if (!isCurrent(state, p)) return 'not your turn';
  if (seaSlice(state).moved) return 'you already moved a ship this turn';
  if (scenarioKey(state) === 'pirateIslands') return 'ships of the pirate route do not move';
  return null;
}

function roadSpotExists(state: GameState, p: PlayerId): boolean {
  if (piecesLeft(state, p).road <= 0 || roadsBlocked(state, p)) return false;
  return topologyOf(state).edges.some((e) => canPlaceRoad(state, p, e));
}

function shipSpotExists(state: GameState, p: PlayerId): boolean {
  return shipsLeft(state, p) > 0 && shipSpots(state, p).length > 0;
}

/** Starting settlements must touch these regions (§2.x "starting settlements on ..."). */
export function setupVertexAllowed(state: GameState, v: VertexId): boolean {
  const regions = rulesOf(state).setupRegions;
  if (regions === null) return true;
  const region = seaBoard(state).region;
  return (graph(state).hexesAt.get(v) ?? []).some((h) => {
    const r = region[h];
    const t = state.board.hexes[h]?.terrain;
    return r !== undefined && regions.includes(r) && t !== undefined && terrainKind(t) === 'land';
  });
}

/** A vertex the mover's ship reaches: own ship on one of its edges. */
function touchesOwnShip(state: GameState, p: PlayerId, v: VertexId): boolean {
  const ships = seaSlice(state).ships;
  return (graph(state).edgesAt.get(v) ?? []).some((e) => ships[e]?.owner === p);
}

/**
 * Pirate Islands: settlements off the eastern island only on your own beachhead (vertexBlocked
 * leaves every beachhead open; this keeps the others' beachheads closed to you).
 */
function beachheadOk(state: GameState, p: PlayerId, v: VertexId): boolean {
  if (scenarioKey(state) !== 'pirateIslands') return true;
  const fortresses = seaSlice(state).fleet?.fortresses ?? [];
  const f = fortresses.find((x) => x.beachhead === v);
  return f === undefined || f.owner === p;
}

/** A settlement reached by ship (not by road), the base checks otherwise (§3.6). */
function shipSettlementOk(state: GameState, p: PlayerId, v: VertexId): boolean {
  return (
    canPlaceSettlement(state, p, v, { requireRoad: false }) &&
    touchesOwnShip(state, p, v) &&
    !nextToDamagedRoad(state, p, v) &&
    beachheadOk(state, p, v)
  );
}

function settlementPrecheck(state: GameState, p: PlayerId): boolean {
  if (!isBuildPhase(state) || !isCurrent(state, p)) return false;
  const hand = state.players[p]?.resources;
  return (
    !!hand && hasResources(hand, costOf(state, 'settlement')) && piecesLeft(state, p).settlement > 0
  );
}

/** May `p` move the pirate (§4.4; Cloth: only with a route to a village, §2.7)? */
export function pirateMovable(state: GameState, p: PlayerId): boolean {
  if (!rulesOf(state).pirate || seaSlice(state).pirate === null) return false;
  const cloth = seaSlice(state).cloth;
  return !cloth || Object.values(cloth.links).some((l) => l.includes(p));
}

export function pirateTargets(state: GameState, p: PlayerId): HexId[] {
  if (!pirateMovable(state, p)) return [];
  const t = topologyOf(state);
  const at = seaSlice(state).pirate;
  const hexes = [...t.waterHexes, ...t.landHexes];
  return hexes.filter((h) => h !== at && isSeaHex(state, h));
}

/** Players `p` may rob after moving the pirate to `hex`: a ship on one of its sides (FAQ #7). */
export function pirateVictims(state: GameState, p: PlayerId, hex: HexId): PlayerId[] {
  const g = graph(state);
  const ships = seaSlice(state).ships;
  const cloth = seaSlice(state).cloth;
  const owners = new Set<PlayerId>();
  for (const e of g.hexEdges.get(hex) ?? []) {
    const s = ships[e];
    if (s && s.owner !== p) owners.add(s.owner);
  }
  return [...owners]
    .filter((o) => {
      const has = cardsInHand(state, o) > 0 || (cloth?.held[o] ?? 0) > 0;
      return has && !isRobberProtected(state, o);
    })
    .sort((a, b) => a - b);
}

/** Robber targets the scenario forbids (§2.6, §2.7) and non-land hexes (fog, sea). */
export function robberAllowed(state: GameState, h: HexId): boolean {
  const tile = state.board.hexes[h];
  if (!tile || terrainKind(tile.terrain) !== 'land') return false;
  const region = seaBoard(state).region[h];
  return region === undefined || !rulesOf(state).robberBans.includes(region);
}

/** Every bundle of `count` cards the bank can give. */
function bankBundles(state: GameState, count: number): ResourceBundle[] {
  return discardOptions(state.bank, count);
}

export function goldOwed(state: GameState, p: PlayerId): number {
  if (state.phase.kind !== 'seafarers/gold') return 0;
  const n = (state.phase as GoldPhase).pending[p] ?? 0;
  return Math.min(n, bankTotal(state));
}

// ---------------------------------------------------------------------------------------------
// Wonders of Catan (§4.11)
// ---------------------------------------------------------------------------------------------

export function wonderOf(state: GameState, p: PlayerId): number | null {
  const w = seaSlice(state).wonders;
  if (!w) return null;
  const i = w.started.indexOf(p);
  return i < 0 ? null : i;
}

/** Why `p` cannot start wonder card `i` now, or null. */
export function wonderBlocker(state: GameState, p: PlayerId, i: number): string | null {
  const w = seaSlice(state).wonders;
  const card = wonderCards(keyOf(state))[i];
  if (!w || !card) return 'no such wonder';
  if (state.phase.kind !== 'main' || !isCurrent(state, p))
    return 'start a wonder in your main phase';
  if (wonderOf(state, p) !== null) return 'you already build a wonder';
  if (w.started[i] !== null && w.started[i] !== undefined) return 'someone else builds it';
  if (shipsLeft(state, p) <= 0) return 'you need a ship as the marker';
  const mine = Object.entries(state.pieces.buildings).filter(([, b]) => b.owner === p) as [
    VertexId,
    { kind: string },
  ][];
  const cities = mine.filter(([, b]) => b.kind === 'city');
  const marks = wonderMarks(keyOf(state));
  switch (card.id) {
    case 'cathedral':
      return cities.length >= 1 && victoryPoints(state, p) >= 6 ? null : 'needs 1 city and 6 VP';
    case 'theater':
      return cities.length >= 2 ? null : 'needs 2 cities';
    case 'greatBridge':
      return mine.some(([v]) => marks?.strait.includes(v))
        ? null
        : 'needs a building at the strait';
    case 'greatWall':
      return mine.some(([v]) => marks?.wasteland.includes(v))
        ? null
        : 'needs a building at the wasteland';
    case 'monument': {
      const harbors = new Set(state.board.ports.flatMap((x) => x.vertices));
      const ok = cities.some(([v]) => harbors.has(v)) && tradeRouteLength(state, p) >= 5;
      return ok ? null : 'needs a city at a harbor and a trade route of 5';
    }
  }
}

export function wonderLevelBlocker(state: GameState, p: PlayerId): string | null {
  const w = seaSlice(state).wonders;
  const i = wonderOf(state, p);
  if (!w || i === null) return 'start a wonder first';
  if (!isBuildPhase(state) || !isCurrent(state, p)) return 'not now';
  if ((w.level[p] ?? 0) >= WONDER_LEVELS) return 'your wonder is complete';
  const card = wonderCards(keyOf(state))[i];
  const hand = state.players[p]?.resources;
  if (!card || !hand || !hasResources(hand, card.cost)) return 'not enough resources';
  return null;
}

// ---------------------------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------------------------

type H = (draft: GameState, action: ExpansionAction) => ReturnType<typeof ok>;

const buildShip: H = (draft, a) => {
  const err = shipPrecheck(draft, a.player);
  if (err) return fail(err);
  if (!isEdge(a.edge) || !canPlaceShip(draft, a.player, a.edge)) {
    return fail('a ship needs an empty sea edge next to your building or ship');
  }
  pay(draft, a.player, costOf(draft, SHIP) as ResourceCounts);
  const s = seaSlice(draft);
  s.ships[a.edge] = { owner: a.player };
  s.built.push(a.edge);
  log(draft, a.player, `${name(draft, a.player)} built a ship`);
  shipLanded(draft, a.player, a.edge);
  return ok(draft);
};

const pickShip: H = (draft, a) => {
  const err = movePrecheck(draft, a.player);
  if (err) return fail(err);
  if (!isEdge(a.edge) || !canMoveShip(draft, a.player, a.edge))
    return fail('that ship cannot move');
  const phase: MoveShipPhase = { kind: 'seafarers/moveShip', from: a.edge };
  draft.phase = phase;
  return ok(draft);
};

const moveShip: H = (draft, a) => {
  if (draft.phase.kind !== 'seafarers/moveShip') return fail('pick up a ship first');
  if (!isCurrent(draft, a.player)) return fail('not your turn');
  const from = (draft.phase as MoveShipPhase).from;
  if (!isEdge(a.edge) || !moveTargets(draft, a.player, from).includes(a.edge)) {
    return fail('the ship cannot go there');
  }
  const s = seaSlice(draft);
  const ship = s.ships[from];
  if (!ship) return fail('no ship there');
  Reflect.deleteProperty(s.ships, from);
  s.ships[a.edge] = { owner: a.player };
  s.moved = true;
  draft.phase = { kind: 'main' };
  log(draft, a.player, `${name(draft, a.player)} moved a ship`);
  shipLanded(draft, a.player, a.edge);
  return ok(draft);
};

const cancelMove: H = (draft, a) => {
  if (draft.phase.kind !== 'seafarers/moveShip') return fail('not moving a ship');
  if (!isCurrent(draft, a.player)) return fail('not your turn');
  draft.phase = { kind: 'main' };
  return ok(draft);
};

/** A starting settlement on the coast may take a ship instead of a road (§2.1). */
export function setupShipOk(state: GameState, p: PlayerId, e: EdgeId): boolean {
  const phase = state.phase;
  if (phase.kind !== 'setup' || phase.step !== 'road' || phase.lastSettlement === null)
    return false;
  if (scenarioKey(state) === 'pirateIslands' || shipsLeft(state, p) <= 0) return false;
  return canPlaceShip(state, p, e, { from: phase.lastSettlement });
}

const setupShip: H = (draft, a) => {
  if (draft.phase.kind !== 'setup' || draft.phase.step !== 'road') {
    return fail('not placing a setup road now');
  }
  if (!isCurrent(draft, a.player)) return fail('not your turn');
  if (!isEdge(a.edge) || !setupShipOk(draft, a.player, a.edge)) {
    return fail('the ship must lie on a sea edge at the settlement just placed');
  }
  seaSlice(draft).ships[a.edge] = { owner: a.player };
  log(draft, a.player, `${name(draft, a.player)} placed a ship`);
  advanceSetup(draft);
  shipLanded(draft, a.player, a.edge);
  return ok(draft);
};

const freeShip: H = (draft, a) => {
  const phase = draft.phase;
  if (phase.kind !== 'roadBuilding') return fail('not placing free pieces');
  if (!isCurrent(draft, a.player)) return fail('not your turn');
  if (shipsLeft(draft, a.player) <= 0) return fail('no ships left');
  if (!isEdge(a.edge) || !canPlaceShip(draft, a.player, a.edge))
    return fail('cannot place a ship there');
  const s = seaSlice(draft);
  s.ships[a.edge] = { owner: a.player };
  s.built.push(a.edge);
  log(draft, a.player, `${name(draft, a.player)} placed a free ship`);
  const remaining = phase.remaining - 1;
  draft.phase =
    remaining > 0 && (roadSpotExists(draft, a.player) || shipSpotExists(draft, a.player))
      ? { kind: 'roadBuilding', remaining, resume: phase.resume }
      : resumePhase(draft, phase.resume);
  shipLanded(draft, a.player, a.edge);
  return ok(draft);
};

const movePirate: H = (draft, a) => {
  const phase = draft.phase;
  if (phase.kind !== 'moveRobber') return fail('cannot move the pirate now');
  if (!isCurrent(draft, a.player)) return fail('not your turn');
  const hex = a.hex;
  if (typeof hex !== 'string' || !pirateTargets(draft, a.player).includes(hex)) {
    return fail('the pirate goes to another sea hex');
  }
  const s = seaSlice(draft);
  s.pirate = hex;
  log(draft, a.player, `${name(draft, a.player)} moved the pirate`);
  const candidates = pirateVictims(draft, a.player, hex);
  if (candidates.length === 0) draft.phase = resumePhase(draft, phase.resume);
  else if (s.cloth) {
    // Cloth for Catan: a resource card or a cloth chit (§2.7).
    const steal: ClothStealPhase = {
      kind: 'seafarers/pirateSteal',
      candidates,
      resume: phase.resume,
    };
    draft.phase = steal;
  } else draft.phase = { kind: 'steal', candidates, resume: phase.resume };
  return ok(draft);
};

/** Leave a finished gold phase. */
function finishGold(draft: GameState, phase: GoldPhase): void {
  if ('roll' in phase.then) continueRoll(draft);
  else draft.phase = phase.then.phase;
}

const pickGold: H = (draft, a) => {
  if (draft.phase.kind !== 'seafarers/gold') return fail('nothing to pick');
  const phase = draft.phase as GoldPhase;
  const owed = goldOwed(draft, a.player);
  if (owed <= 0) return fail('you have nothing to pick');
  const res = a.resources;
  if (!isValidBundle(res)) return fail('invalid resources');
  if (totalResources(res) !== owed) return fail(`pick exactly ${owed}`);
  if (!hasResources(draft.bank, res)) return fail('the bank does not have those');
  const hand = getPlayer(draft, a.player).resources;
  for (const r of RESOURCES) {
    const n = res[r] ?? 0;
    hand[r] += n;
    draft.bank[r] -= n;
  }
  phase.pending[a.player] = 0;
  log(draft, a.player, `${name(draft, a.player)} took ${describeBundle(res)} (gold)`);
  if (bankTotal(draft) === 0) phase.pending = phase.pending.map(() => 0);
  if (phase.pending.every((n) => n === 0)) finishGold(draft, phase);
  return ok(draft);
};

/** The victim of a Cloth pirate steal, or an error. */
function clothVictim(draft: GameState, a: ExpansionAction): PlayerId | string {
  if (draft.phase.kind !== 'seafarers/pirateSteal') return 'cannot rob now';
  if (!isCurrent(draft, a.player)) return 'not your turn';
  const v = a.victim;
  const phase = draft.phase as ClothStealPhase;
  if (typeof v !== 'number' || !phase.candidates.includes(v)) return 'cannot rob that player';
  return v;
}

const stealCloth: H = (draft, a) => {
  const v = clothVictim(draft, a);
  if (typeof v === 'string') return fail(v);
  const cloth = seaSlice(draft).cloth;
  if (!cloth || (cloth.held[v] ?? 0) <= 0) return fail('they have no cloth');
  cloth.held[v] = (cloth.held[v] ?? 0) - 1;
  cloth.held[a.player] = (cloth.held[a.player] ?? 0) + 1;
  log(draft, a.player, `${name(draft, a.player)} took 1 cloth from ${name(draft, v)}`);
  draft.phase = resumePhase(draft, (draft.phase as ClothStealPhase).resume);
  return ok(draft);
};

const stealCard: H = (draft, a) => {
  const v = clothVictim(draft, a);
  if (typeof v === 'string') return fail(v);
  const victim = getPlayer(draft, v);
  const cards = RESOURCES.flatMap((r) => Array<typeof r>(victim.resources[r]).fill(r));
  if (cards.length === 0) return fail('they have no cards');
  const rng = new Rng(draft.rng);
  const card = rng.pick(cards);
  draft.rng = rng.state;
  victim.resources[card] -= 1;
  getPlayer(draft, a.player).resources[card] += 1;
  log(draft, a.player, `${name(draft, a.player)} stole from ${name(draft, v)}`);
  draft.phase = resumePhase(draft, (draft.phase as ClothStealPhase).resume);
  return ok(draft);
};

const placeHarborH: H = (draft, a) => {
  if (draft.phase.kind !== 'seafarers/placeHarbor') return fail('no harbor to place');
  const phase = draft.phase as HarborPhase;
  if (phase.player !== a.player) return fail('not your harbor');
  if (!isEdge(a.edge) || !harborSpots(draft, a.player).includes(a.edge)) {
    return fail('a harbor goes on a free coast edge at your building');
  }
  const kind = placeHarbor(draft, a.player, a.edge);
  log(
    draft,
    a.player,
    `${name(draft, a.player)} placed a ${kind === 'generic' ? '3:1' : `${kind} 2:1`} harbor`,
  );
  draft.phase = phase.resume;
  promptHarbor(draft, a.player);
  return ok(draft);
};

const attackFortress: H = (draft, a) => {
  if (draft.phase.kind !== 'main') return fail('attack at the end of your turn');
  if (!isCurrent(draft, a.player)) return fail('not your turn');
  if (!canAttackFortress(draft, a.player)) return fail('your ships have not reached your fortress');
  const f = fortressOf(draft, a.player);
  if (!f) return fail('no fortress');
  const rng = new Rng(draft.rng);
  const die = rng.die();
  draft.rng = rng.state;
  const mine = warships(draft, a.player);
  const s = seaSlice(draft);
  const who = name(draft, a.player);
  if (mine > die) {
    f.chits -= 1;
    if (f.chits === 0) {
      draft.pieces.buildings[f.vertex] = { owner: a.player, kind: 'settlement' };
      log(draft, a.player, `${who} captured their fortress (${mine} warships vs ${die})`);
      const fleet = s.fleet;
      if (fleet && fleet.fortresses.every((x) => x.chits === 0)) {
        fleet.gone = true;
        log(draft, null, 'Every fortress is free: the pirate fleet leaves');
      }
    } else log(draft, a.player, `${who} won a battle at their fortress (${mine} vs ${die})`);
  } else {
    // Lost: the 2 ships nearest the fortress; a tie: the one next to it.
    const line = lineOf(draft, a.player).ships;
    const lose = line.slice(mine < die ? -2 : -1);
    for (const e of lose) Reflect.deleteProperty(s.ships, e);
    log(
      draft,
      a.player,
      `${who} lost ${lose.length} ship${lose.length > 1 ? 's' : ''} at the fortress (${mine} vs ${die})`,
    );
  }
  // The attack ends the turn (§4.10).
  const end = turnHandlers.endTurn(draft, { type: 'endTurn', player: a.player });
  return end.ok ? ok(draft) : end;
};

const startWonder: H = (draft, a) => {
  const i = a.wonder;
  if (typeof i !== 'number' || !Number.isInteger(i)) return fail('invalid wonder');
  const err = wonderBlocker(draft, a.player, i);
  if (err) return fail(err);
  const w = seaSlice(draft).wonders;
  if (!w) return fail('no wonders in this scenario');
  w.started[i] = a.player;
  const card = wonderCards(keyOf(draft))[i];
  log(draft, a.player, `${name(draft, a.player)} started the ${card?.name ?? 'wonder'}`);
  return ok(draft);
};

const buildWonder: H = (draft, a) => {
  const err = wonderLevelBlocker(draft, a.player);
  if (err) return fail(err);
  const w = seaSlice(draft).wonders;
  const i = wonderOf(draft, a.player);
  const card = i === null ? undefined : wonderCards(keyOf(draft))[i];
  if (!w || !card) return fail('no wonder');
  pay(draft, a.player, card.cost);
  w.level[a.player] = (w.level[a.player] ?? 0) + 1;
  log(
    draft,
    a.player,
    `${name(draft, a.player)} built level ${w.level[a.player]} of the ${card.name}`,
  );
  return ok(draft);
};

export const HANDLERS: Record<string, H> = {
  [T.buildShip]: buildShip,
  [T.pickShip]: pickShip,
  [T.moveShip]: moveShip,
  [T.cancelMove]: cancelMove,
  [T.setupShip]: setupShip,
  [T.freeShip]: freeShip,
  [T.movePirate]: movePirate,
  [T.pickGold]: pickGold,
  [T.stealCloth]: stealCloth,
  [T.stealCard]: stealCard,
  [T.placeHarbor]: placeHarborH,
  [T.attackFortress]: attackFortress,
  [T.startWonder]: startWonder,
  [T.buildWonder]: buildWonder,
};

// ---------------------------------------------------------------------------------------------
// Legal moves
// ---------------------------------------------------------------------------------------------

/** Can `p` play Road Building (the base checks, minus "a road can be placed")? */
function canPlayRoadBuilding(state: GameState, p: PlayerId): boolean {
  const kind = state.phase.kind;
  if (kind !== 'preRoll' && kind !== 'main') return false;
  if (!isCurrent(state, p) || state.turn.devCardPlayed) return false;
  return getPlayer(state, p).devCards.roadBuilding >= 1;
}

export const seaLegal: LegalGenerator = (state) => {
  const p = state.turn.current;
  const out: Action[] = [];
  const add = (a: Omit<ExpansionAction, 'player'> & { player?: PlayerId }) =>
    out.push({ player: p, ...a } as Action);
  switch (state.phase.kind) {
    case 'setup':
      if (state.phase.step === 'road' && state.phase.lastSettlement !== null) {
        for (const edge of graph(state).edgesAt.get(state.phase.lastSettlement) ?? []) {
          if (setupShipOk(state, p, edge)) add({ type: T.setupShip, edge });
        }
      }
      break;
    case 'main':
    case 'specialBuild': {
      if (shipPrecheck(state, p) === null) {
        for (const edge of shipSpots(state, p)) add({ type: T.buildShip, edge });
      }
      if (movePrecheck(state, p) === null) {
        for (const edge of Object.keys(seaSlice(state).ships) as EdgeId[]) {
          if (canMoveShip(state, p, edge)) add({ type: T.pickShip, edge });
        }
      }
      // Settlements reached by ship (the base generator only knows roads).
      if (settlementPrecheck(state, p)) {
        const ships = seaSlice(state).ships;
        const g = graph(state);
        const seen = new Set<VertexId>();
        for (const [e, s] of Object.entries(ships) as [EdgeId, { owner: PlayerId }][]) {
          if (s.owner !== p) continue;
          for (const v of g.ends.get(e) ?? []) {
            if (seen.has(v)) continue;
            seen.add(v);
            if (shipSettlementOk(state, p, v))
              out.push({ type: 'buildSettlement', player: p, vertex: v });
          }
        }
      }
      if (state.phase.kind === 'main' && canAttackFortress(state, p))
        add({ type: T.attackFortress });
      const w = seaSlice(state).wonders;
      if (w) {
        w.started.forEach((_, wonder) => {
          if (wonderBlocker(state, p, wonder) === null) add({ type: T.startWonder, wonder });
        });
        if (wonderLevelBlocker(state, p) === null) add({ type: T.buildWonder });
      }
      break;
    }
    case 'preRoll':
      break;
    case 'roadBuilding':
      if (shipsLeft(state, p) > 0) {
        for (const edge of shipSpots(state, p)) add({ type: T.freeShip, edge });
      }
      break;
    case 'moveRobber':
      for (const hex of pirateTargets(state, p)) add({ type: T.movePirate, hex });
      break;
    case 'seafarers/pirateSteal': {
      const cloth = seaSlice(state).cloth;
      for (const victim of (state.phase as ClothStealPhase).candidates) {
        if ((cloth?.held[victim] ?? 0) > 0) add({ type: T.stealCloth, victim });
        if (cardsInHand(state, victim) > 0) add({ type: T.stealCard, victim });
      }
      break;
    }
    case 'seafarers/moveShip': {
      const from = (state.phase as MoveShipPhase).from;
      for (const edge of moveTargets(state, p, from)) add({ type: T.moveShip, edge });
      add({ type: T.cancelMove });
      break;
    }
    case 'seafarers/gold':
      state.players.forEach((pl) => {
        const n = goldOwed(state, pl.id);
        if (n <= 0) return;
        for (const resources of bankBundles(state, n)) {
          out.push({ type: T.pickGold, player: pl.id, resources });
        }
      });
      break;
    case 'seafarers/placeHarbor': {
      const owner = (state.phase as HarborPhase).player;
      for (const edge of harborSpots(state, owner)) {
        out.push({ type: T.placeHarbor, player: owner, edge });
      }
      break;
    }
  }
  // Road Building that can only place ships (the base needs a road spot).
  if (
    (state.phase.kind === 'preRoll' || state.phase.kind === 'main') &&
    canPlayRoadBuilding(state, p) &&
    !roadSpotExists(state, p) &&
    shipSpotExists(state, p)
  ) {
    out.push({ type: 'playRoadBuilding', player: p });
  }
  return out;
};

/** Drop base moves the scenario forbids (paired with the overrides below). */
export function seaFilterLegal(state: GameState, actions: Action[]): Action[] {
  const key = scenarioKey(state);
  return actions.filter((a) => {
    switch (a.type) {
      case 'placeSetupSettlement':
        return setupVertexAllowed(state, a.vertex);
      case 'placeSetupRoad':
        return true;
      case 'moveRobber':
        return key !== 'pirateIslands' && robberAllowed(state, a.hex);
      case 'buildSettlement':
        return beachheadOk(state, a.player, a.vertex);
      case 'playKnight':
        return key !== 'pirateIslands' || hindmostShip(state, a.player) !== null;
      default:
        return true;
    }
  });
}

// ---------------------------------------------------------------------------------------------
// Overrides of base actions
// ---------------------------------------------------------------------------------------------

export const OVERRIDES: {
  placeSetupSettlement: Override<'placeSetupSettlement'>;
  buildSettlement: Override<'buildSettlement'>;
  playRoadBuilding: Override<'playRoadBuilding'>;
  placeFreeRoad: Override<'placeFreeRoad'>;
  moveRobber: Override<'moveRobber'>;
  playKnight: Override<'playKnight'>;
} = {
  placeSetupSettlement: (draft, action, next) => {
    if (typeof action.vertex === 'string' && !setupVertexAllowed(draft, action.vertex)) {
      return fail('starting settlements go on the main island');
    }
    return next(draft, action);
  },

  buildSettlement: (draft, action, next) => {
    if (typeof action.vertex !== 'string') return fail('invalid vertex');
    if (!beachheadOk(draft, action.player, action.vertex))
      return fail('that is not your beachhead');
    const base = next(draft, action);
    if (base.ok) return base;
    // Reached by ship instead of road (§3.6).
    if (!settlementPrecheck(draft, action.player)) return base;
    if (!shipSettlementOk(draft, action.player, action.vertex)) return base;
    draft.pieces.buildings[action.vertex] = { owner: action.player, kind: 'settlement' };
    pay(draft, action.player, costOf(draft, 'settlement'));
    log(draft, action.player, `${name(draft, action.player)} built a settlement`);
    return ok(draft);
  },

  playRoadBuilding: (draft, action, next) => {
    const p = action.player;
    const free = (d: GameState) => Math.min(2, piecesLeft(d, p).road + shipsLeft(d, p));
    const resume: ResumePhase | null =
      draft.phase.kind === 'preRoll' || draft.phase.kind === 'main' ? draft.phase.kind : null;
    const base = next(draft, action);
    if (base.ok) {
      if (draft.phase.kind === 'roadBuilding') draft.phase.remaining = free(draft);
      return base;
    }
    // No road spot: Road Building may still place ships (§3.3).
    if (resume === null || !canPlayRoadBuilding(draft, p) || !shipSpotExists(draft, p)) return base;
    const pl = getPlayer(draft, p);
    pl.devCards.roadBuilding -= 1;
    pl.progressCardsPlayed.roadBuilding += 1;
    draft.turn.devCardPlayed = true;
    log(draft, p, `${pl.name} played Road Building`);
    draft.phase = { kind: 'roadBuilding', remaining: free(draft), resume };
    return ok(draft);
  },

  placeFreeRoad: (draft, action, next) => {
    const phase = draft.phase;
    const before: Phase = phase;
    const base = next(draft, action);
    if (!base.ok || before.kind !== 'roadBuilding') return base;
    // The base leaves Road Building when no road fits; ships may still fit.
    const remaining = before.remaining - 1;
    if (
      draft.phase.kind !== 'roadBuilding' &&
      remaining > 0 &&
      shipSpotExists(draft, action.player)
    ) {
      draft.phase = { kind: 'roadBuilding', remaining, resume: before.resume };
    }
    return base;
  },

  moveRobber: (draft, action, next) => {
    if (scenarioKey(draft) === 'pirateIslands') return fail('there is no robber');
    if (typeof action.hex === 'string' && !robberAllowed(draft, action.hex)) {
      return fail('the robber cannot go there');
    }
    return next(draft, action);
  },

  playKnight: (draft, action, next) => {
    if (scenarioKey(draft) !== 'pirateIslands') return next(draft, action);
    // Pirate Islands (§4.10): a Knight turns the hindmost ship of your route into a warship.
    const ship = hindmostShip(draft, action.player);
    if (ship === null) return fail('you have no ship to turn into a warship');
    const before = draft.phase.kind;
    const base = next(draft, action);
    if (!base.ok) return base;
    const s = seaSlice(draft);
    const cur = s.ships[ship];
    if (cur) s.ships[ship] = { ...cur, warship: true };
    log(draft, action.player, `${name(draft, action.player)} built a warship`);
    draft.phase = { kind: before === 'preRoll' ? 'preRoll' : 'main' };
    return base;
  },
};

export { seatOf };
