/**
 * Explorers & Pirates actions (docs/rules/explorers-pirates.md §3-§4): handlers, legal moves and
 * the overrides / filters of base actions. Each rule has a `why*` check shared by its handler and
 * its legal generator (null = allowed), so the legal list is sound by construction.
 *
 * The turn: roll, the Action phase (`main`, trade and build), then the Movement phase (`main`
 * with `turn.movement`, entered by `ep/startMovement`: ships, cargo, missions; no trade, no
 * building). `endTurn` is legal in both; it first resolves the lairs captured this turn.
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
import { advanceSetup } from '../../../engine/actions/setup';
import { costOf } from '../../../engine/expansions/hooks';
import type { Override } from '../../../engine/expansions/types';
import { Rng } from '../../../engine/rng';
import { hasResources, isResource } from '../../../engine/resources';
import { canPlaceRoad, isVertexOpen, touchesLand } from '../../../engine/rules/placement';
import { checkVictory } from '../../../engine/rules/victory';
import { playerName } from '../../../engine/rules/text';
import { piecesLeft, setupOrderOf } from '../../../engine/selectors';
import type {
  Action,
  BaseActionType,
  EdgeId,
  ExpansionAction,
  GameState,
  HexId,
  PlayerId,
  Resource,
  ResourceCounts,
  VertexId,
} from '../../../engine/types';
import { isRobberProtected } from '../../../engine/variants';
import {
  anchors,
  endTouchesHex,
  graph,
  isCoastal,
  isEndOf,
  isPirateHex,
  pirateHexes,
  sidesOf,
  staticOf,
} from './geometry';
import { epBoard, T } from './maps';
import { advance, resolveLairs } from './missions';
import { goldOfferLegal, goldTradeAllowed, offerGoldTrade, tradeOverrides } from './trade';
import {
  canPlaceShip,
  canSail,
  crewsLeft,
  explore,
  finishShip,
  fits,
  harborsLeft,
  harborsOf,
  isHarbor,
  mpLeft,
  reachable,
  settlersLeft,
  shipById,
  shipSpots,
  shipsLeft,
  shipsOf,
} from './ships';
import {
  CARGO,
  EP,
  EXTRA_MP,
  GOLD_BUYS,
  GOLD_PER_BUY,
  HOLD,
  ITEM,
  LAIR_CREWS,
  citiesInPlay,
  epSlice,
  isHarborStep,
  isCargo,
  load,
  rulesOf,
  shipTurn,
  shipTurnDraft,
  type Cargo,
  type EpSlice,
  type PiratePhase,
  type PirateStealPhase,
  type SetupFleetPhase,
  type Ship,
} from './state';

export const A = {
  setupRoad: 'ep/setupRoad',
  setupShip: 'ep/setupShip',
  buildHarbor: 'ep/buildHarbor',
  buildShip: 'ep/buildShip',
  buildSettler: 'ep/buildSettler',
  buildCrew: 'ep/buildCrew',
  sellForGold: 'ep/sellForGold',
  buyWithGold: 'ep/buyWithGold',
  fastGold: 'ep/fastGold',
  dump: 'ep/dump',
  startMovement: 'ep/startMovement',
  selectShip: 'ep/selectShip',
  moveShip: 'ep/moveShip',
  extraMove: 'ep/extraMove',
  load: 'ep/load',
  unload: 'ep/unload',
  swap: 'ep/swap',
  land: 'ep/land',
  dropCrew: 'ep/dropCrew',
  pickCrew: 'ep/pickCrew',
  loadSpice: 'ep/loadSpice',
  catchFish: 'ep/catchFish',
  deliver: 'ep/deliver',
  rollFish: 'ep/rollFish',
  chase: 'ep/chase',
  placePirate: 'ep/placePirate',
  pirateSteal: 'ep/pirateSteal',
  offerTrade: 'ep/offerTrade',
} as const;
export type EpActionType = (typeof A)[keyof typeof A];

const name = (s: GameState, p: PlayerId) => playerName(s, p);
const isEdge = (x: unknown): x is EdgeId => typeof x === 'string' && x.startsWith('e:');
const isVertex = (x: unknown): x is VertexId => typeof x === 'string' && x.startsWith('v:');
const isHex = (x: unknown): x is HexId => typeof x === 'string' && x.startsWith('h:');
const isInt = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x);

type Why = string | null;

function pay(draft: GameState, p: PlayerId, cost: ResourceCounts): void {
  const hand = draft.players[p]?.resources;
  if (!hand) return;
  for (const r of RESOURCES) {
    hand[r] -= cost[r];
    draft.bank[r] += cost[r];
  }
}

const canAfford = (state: GameState, p: PlayerId, item: string): boolean => {
  const hand = state.players[p]?.resources;
  const cost = costOf(state, item);
  return hand !== undefined && cost !== undefined && hasResources(hand, cost);
};

const gold = (state: GameState, p: PlayerId) => epSlice(state).gold[p] ?? 0;

// ---------------------------------------------------------------------------------------------
// Turn phases
// ---------------------------------------------------------------------------------------------

/** The Action phase of `p` (trade and build). */
export function whyAction(state: GameState, p: PlayerId): Why {
  if (state.phase.kind !== 'main') return 'not now';
  if (!isCurrent(state, p)) return 'not your turn';
  if (epSlice(state).turn.movement) return 'no trading or building in the Movement phase';
  return null;
}

/** The Movement phase of `p`. */
export function whyMovement(state: GameState, p: PlayerId): Why {
  if (state.phase.kind !== 'main') return 'not now';
  if (!isCurrent(state, p)) return 'not your turn';
  if (!epSlice(state).turn.movement) return 'start the Movement phase first';
  return null;
}

export const inMovement = (state: GameState): boolean =>
  state.phase.kind === 'main' && epSlice(state).turn.movement;

// ---------------------------------------------------------------------------------------------
// Where roads and settlements may go (§3.3, §4.11)
// ---------------------------------------------------------------------------------------------

/** Spice farms at a vertex / beside an edge where `p` has no crew: closed to `p` (§4.10). */
function spiceClosed(state: GameState, p: PlayerId, hexes: readonly HexId[]): boolean {
  const farms = epSlice(state).spice;
  return hexes.some((h) => {
    const f = farms[h];
    return state.board.hexes[h]?.terrain === T.spice && !(f?.crews.includes(p) ?? false);
  });
}
export const vertexSpiceClosed = (state: GameState, p: PlayerId, v: VertexId) =>
  spiceClosed(state, p, graph(state).hexesAt.get(v) ?? []);
export const edgeSpiceClosed = (state: GameState, p: PlayerId, e: EdgeId) =>
  spiceClosed(state, p, graph(state).sides.get(e) ?? []);

/** Uncaptured lair hexes (no roads or settlements on them, §4.8). */
function lairOpen(state: GameState, h: HexId): boolean {
  const l = epSlice(state).lairs[h];
  return state.board.hexes[h]?.terrain === 'gold' && !(l?.captured ?? false);
}

/** vertexBlocked: a corner of a face-down hex or of a gold field whose lair is not captured. */
export function vertexClosed(state: GameState, v: VertexId): boolean {
  return (graph(state).hexesAt.get(v) ?? []).some((h) => {
    const t = state.board.hexes[h]?.terrain;
    return t === T.parrot || t === T.goose || lairOpen(state, h);
  });
}

/** edgeBlocked: a side of a face-down hex or of an uncaptured lair. */
export function edgeClosed(state: GameState, e: EdgeId): boolean {
  return (graph(state).sides.get(e) ?? []).some((h) => {
    const t = state.board.hexes[h]?.terrain;
    return t === T.parrot || t === T.goose || lairOpen(state, h);
  });
}

/** A settlement of `p` could stand on `v` (distance rule, explored land, farms). */
export function settlementSpot(state: GameState, p: PlayerId, v: VertexId): boolean {
  return isVertexOpen(state, v) && touchesLand(state, v) && !vertexSpiceClosed(state, p, v);
}

// ---------------------------------------------------------------------------------------------
// Setup (§2.9): harbor round, settlement round, then each player's road + ship with a settler
// ---------------------------------------------------------------------------------------------

/** The player's settlement that is not a harbor (setup road anchor). */
function homeSettlement(state: GameState, p: PlayerId): VertexId | null {
  for (const [v, b] of Object.entries(state.pieces.buildings) as [VertexId, { owner: number }][]) {
    if (b.owner === p && !isHarbor(state, v)) return v;
  }
  return null;
}

export const fleetOrder = (state: GameState, index: number): PlayerId =>
  (state.settings.startingPlayer + index) % state.players.length;

function whySetupRoad(state: GameState, p: PlayerId, e: EdgeId): Why {
  const ph = state.phase as SetupFleetPhase;
  if (ph.kind !== 'ep/setupFleet' || ph.step !== 'road') return 'not placing a setup road now';
  if (!isCurrent(state, p)) return 'not your turn';
  const home = homeSettlement(state, p);
  if (!home || !canPlaceRoad(state, p, e, { fromVertex: home })) {
    return 'the road must touch your settlement';
  }
  return null;
}

function whySetupShip(state: GameState, p: PlayerId, e: EdgeId): Why {
  const ph = state.phase as SetupFleetPhase;
  if (ph.kind !== 'ep/setupFleet' || ph.step !== 'ship') return 'not placing a setup ship now';
  if (!isCurrent(state, p)) return 'not your turn';
  if (!canPlaceShip(state, p, e)) return 'the ship must lie at your harbor settlement';
  return null;
}

function nextFleetStep(draft: GameState): void {
  const ph = draft.phase as SetupFleetPhase;
  if (ph.step === 'road') {
    draft.phase = { ...ph, step: 'ship' };
    return;
  }
  const next = ph.index + 1;
  if (next < draft.players.length) {
    draft.turn.current = fleetOrder(draft, next);
    draft.phase = { kind: 'ep/setupFleet', index: next, step: 'road' };
    return;
  }
  // Back to the core's last setup step, which then starts the first turn.
  const last = setupOrderOf(draft).order.length - 1;
  draft.phase = { kind: 'setup', index: last, step: 'road', lastSettlement: null };
  advanceSetup(draft);
}

/** After a core setup settlement: round 1 makes it a harbor; no road follows (§2.9). */
export function afterSetupSettlement(draft: GameState, v: VertexId): void {
  const ph = draft.phase;
  if (ph.kind !== 'setup') return;
  const s = epSlice(draft);
  if (isHarborStep(draft, ph.index)) {
    s.harbors[v] = [];
    log(draft, null, 'It is a harbor settlement');
  }
  if (ph.index + 1 < setupOrderOf(draft).order.length) {
    advanceSetup(draft);
    return;
  }
  draft.turn.current = fleetOrder(draft, 0);
  draft.phase = { kind: 'ep/setupFleet', index: 0, step: 'road' };
}

/**
 * The harbor round (round 1; with C&K round 2) places on the marked vertices only. With C&K the
 * cities come first and may leave no marked corner free: then any free coastal corner (ours).
 */
export const setupSpotAllowed = (state: GameState, v: VertexId): boolean => {
  const ph = state.phase;
  if (ph.kind !== 'setup' || !isHarborStep(state, ph.index)) return true;
  if (!isCoastal(state, v)) return false;
  const marks = staticOf(state).spots;
  return marks.has(v) || ![...marks].some((m) => settlementSpot(state, state.turn.current, m));
};

// ---------------------------------------------------------------------------------------------
// Building (§4.1-4.2)
// ---------------------------------------------------------------------------------------------

function whyHarbor(state: GameState, p: PlayerId, v: VertexId): Why {
  const w = whyAction(state, p);
  if (w) return w;
  const b = state.pieces.buildings[v];
  if (!b || b.owner !== p || b.kind !== 'settlement' || isHarbor(state, v)) {
    return 'upgrade one of your settlements';
  }
  if (!isCoastal(state, v)) return 'a harbor settlement must be on the coast';
  if (harborsLeft(state, p) <= 0) return 'no harbor settlements left';
  if (!canAfford(state, p, ITEM.harbor)) return 'cannot afford a harbor settlement';
  return null;
}

function whyShip(state: GameState, p: PlayerId, e: EdgeId, replace: number | undefined): Why {
  const w = whyAction(state, p);
  if (w) return w;
  if (!canAfford(state, p, ITEM.ship)) return 'cannot afford a ship';
  return whyShipSpot(state, p, e, replace);
}

/**
 * Where a new ship of `p` may go (next to an own harbor; with none left in the supply, replacing
 * the ship `replace`), whatever pays for it (a cost, or T&B fish in E&P + T&B).
 */
export function whyShipSpot(
  state: GameState,
  p: PlayerId,
  e: EdgeId,
  replace: number | undefined,
): Why {
  const s = epSlice(state);
  if (replace !== undefined) {
    const old = shipById(s, replace);
    if (!old || old.owner !== p) return 'not your ship';
    if (shipsLeft(state, p) > 0) return 'you still have ships in your supply';
    // The old ship leaves first: it may free a place on the edge.
    const without = {
      ...state,
      ext: { ...state.ext, [EP]: { ...s, ships: s.ships.filter((x) => x.id !== replace) } },
    };
    return canPlaceShip(without, p, e) ? null : 'a ship goes next to your harbor settlement';
  }
  if (shipsLeft(state, p) <= 0) return 'no ships left (return one to build a new one)';
  return canPlaceShip(state, p, e) ? null : 'a ship goes next to your harbor settlement';
}

/** Put a new ship of `p` on `e` (already validated and paid): replace, place, explore. */
export function placeShip(
  draft: GameState,
  p: PlayerId,
  e: EdgeId,
  replace: number | undefined,
): void {
  const s = epSlice(draft);
  if (replace !== undefined) {
    // Its cargo goes back to the supply too (E5): fish hauls can be caught again.
    const old = shipById(s, replace);
    s.haulSupply += old?.cargo.filter((c) => c === 'fish').length ?? 0;
    if (s.turn.active === replace) s.turn.active = null;
    if (s.turn.selected === replace) s.turn.selected = null;
    s.ships = s.ships.filter((x) => x.id !== replace);
    log(draft, p, `${name(draft, p)} returned a ship (and its cargo) to the supply`);
  }
  const id = s.nextShip++;
  s.ships.push({ id, owner: p, edge: e, cargo: [] });
  log(draft, p, `${name(draft, p)} built a ship`);
  if (explore(draft, p, e).length > 0) shipTurnDraft(s, id).done = true;
}

/** Ship spots of `p` for a new ship: [edge, replace][] (replace only with none in the supply). */
export function newShipSpots(state: GameState, p: PlayerId): [EdgeId, number | undefined][] {
  const free = shipsLeft(state, p) > 0;
  const replace = free ? [undefined] : shipsOf(epSlice(state), p).map((x) => x.id);
  const edges = new Set<EdgeId>();
  for (const v of harborsOf(state, p))
    for (const e of graph(state).edgesAt.get(v) ?? []) edges.add(e);
  const out: [EdgeId, number | undefined][] = [];
  for (const e of [...edges].sort()) {
    for (const r of replace) if (whyShipSpot(state, p, e, r) === null) out.push([e, r]);
  }
  return out;
}

/** Where a new settler / crew may go: an own basin or an own ship at an own harbor (§4.6). */
type Target = { vertex: VertexId } | { edge: EdgeId; ship: number };

function targetCargo(state: GameState, p: PlayerId, t: Target): Cargo[] | null {
  const s = epSlice(state);
  if ('vertex' in t) {
    if (!isVertex(t.vertex) || !isHarbor(state, t.vertex)) return null;
    if (state.pieces.buildings[t.vertex]?.owner !== p) return null;
    return s.harbors[t.vertex] ?? null;
  }
  const ship = isInt(t.ship) ? shipById(s, t.ship) : undefined;
  if (!ship || ship.owner !== p || ship.edge !== t.edge) return null;
  const atHarbor = (graph(state).ends.get(ship.edge) ?? []).some(
    (v) => isHarbor(state, v) && state.pieces.buildings[v]?.owner === p,
  );
  return atHarbor ? ship.cargo : null;
}

function whyPiece(state: GameState, p: PlayerId, kind: 'settler' | 'crew', t: Target): Why {
  const w = whyAction(state, p);
  if (w) return w;
  if (kind === 'crew' && !rulesOf(state).crews) return 'no crews in this scenario';
  const left = kind === 'settler' ? settlersLeft(state, p) : crewsLeft(state, p);
  if (left <= 0) return `no ${kind}s left`;
  if (!canAfford(state, p, kind === 'settler' ? ITEM.settler : ITEM.crew)) {
    return `cannot afford a ${kind}`;
  }
  const cargo = targetCargo(state, p, t);
  if (!cargo) return 'place it in your harbor or on your ship at your harbor';
  return fits(cargo, kind) ? null : 'no room there';
}

function targetsOf(state: GameState, p: PlayerId): Target[] {
  const out: Target[] = harborsOf(state, p).map((vertex) => ({ vertex }));
  for (const ship of shipsOf(epSlice(state), p)) out.push({ edge: ship.edge, ship: ship.id });
  return out;
}

function placeCargo(draft: GameState, t: Target, c: Cargo): void {
  const s = epSlice(draft);
  if ('vertex' in t) (s.harbors[t.vertex] ??= []).push(c);
  else shipById(s, t.ship)?.cargo.push(c);
}

function whyDump(state: GameState, p: PlayerId, from: number | VertexId, c: Cargo): Why {
  const w = whyAction(state, p);
  if (w) return w;
  if (c !== 'crew' && c !== 'settler') return 'only crews and settlers go back to your supply';
  const s = epSlice(state);
  const cargo =
    typeof from === 'number'
      ? (() => {
          const ship = shipById(s, from);
          return ship?.owner === p ? ship.cargo : null;
        })()
      : state.pieces.buildings[from]?.owner === p
        ? (s.harbors[from] ?? null)
        : null;
  return cargo?.includes(c) ? null : 'nothing like that there';
}

// ---------------------------------------------------------------------------------------------
// Trading with the supply (§3.3)
// ---------------------------------------------------------------------------------------------

/** Fast Gold farms `p` has befriended (§4.12): that many sales of 1 card for 1 gold per turn. */
export const fastFarms = (s: EpSlice, p: PlayerId) =>
  Object.values(s.spice).filter((f) => f.kind === 'fast' && f.crews.includes(p)).length;

function whySell(state: GameState, p: PlayerId, r: Resource, n: number): Why {
  const w = whyAction(state, p);
  if (w) return w;
  if ((state.players[p]?.resources[r] ?? 0) < n) return `you need ${n} ${r}`;
  return null;
}

function whyBuy(state: GameState, p: PlayerId, r: Resource): Why {
  const w = whyAction(state, p);
  if (w) return w;
  if (epSlice(state).turn.goldBuys >= GOLD_BUYS)
    return `at most ${GOLD_BUYS} gold purchases per turn`;
  if (gold(state, p) < GOLD_PER_BUY) return `you need ${GOLD_PER_BUY} gold`;
  if (state.bank[r] <= 0) return `the bank has no ${r}`;
  return null;
}

function whyFast(state: GameState, p: PlayerId, r: Resource): Why {
  const s = epSlice(state);
  if (s.turn.fastGold >= fastFarms(s, p)) return 'no Fast Gold left this turn';
  return whySell(state, p, r, 1);
}

// ---------------------------------------------------------------------------------------------
// Movement (§3.4, §4.4-4.10)
// ---------------------------------------------------------------------------------------------

function ownShip(state: GameState, p: PlayerId, id: unknown): Ship | null {
  if (!isInt(id)) return null;
  const ship = shipById(epSlice(state), id);
  return ship && ship.owner === p ? ship : null;
}

/** The ship whose moves are offered: the selected one, or the only one that can sail. */
export function selectedShip(state: GameState, p: PlayerId): Ship | null {
  const s = epSlice(state);
  const sel = s.turn.selected === null ? null : shipById(s, s.turn.selected);
  if (sel && sel.owner === p) return sel;
  const sailing = shipsOf(s, p).filter((x) => canSail(state, x));
  return sailing.length === 1 ? (sailing[0] as Ship) : null;
}

function whySelect(state: GameState, p: PlayerId, id: number, e: EdgeId): Why {
  const w = whyMovement(state, p);
  if (w) return w;
  const ship = ownShip(state, p, id);
  if (!ship || ship.edge !== e) return 'not your ship';
  if (selectedShip(state, p)?.id === id) return 'already selected';
  return canSail(state, ship) ? null : 'that ship cannot sail any more this turn';
}

function whyMove(state: GameState, p: PlayerId, id: number, e: EdgeId): Why {
  const w = whyMovement(state, p);
  if (w) return w;
  const ship = ownShip(state, p, id);
  if (!ship) return 'not your ship';
  if (selectedShip(state, p)?.id !== id) return 'select the ship first';
  return reachable(state, ship).has(e) ? null : 'the ship cannot sail there';
}

function whyExtra(state: GameState, p: PlayerId, id: number): Why {
  const w = whyMovement(state, p);
  if (w) return w;
  const ship = ownShip(state, p, id);
  if (!ship) return 'not your ship';
  const t = shipTurn(epSlice(state), id);
  if (t.extra) return 'once per ship per turn';
  if (t.done) return 'that ship has finished moving';
  return canAfford(state, p, ITEM.extraMove) ? null : 'you need 1 wool';
}

/** Cargo transfer between an own ship and an own harbor at one of its ends. */
function shipAndBasin(state: GameState, p: PlayerId, id: number, v: VertexId) {
  const ship = ownShip(state, p, id);
  if (!ship || !isVertex(v) || !isEndOf(state, ship.edge, v)) return null;
  if (!isHarbor(state, v) || state.pieces.buildings[v]?.owner !== p) return null;
  return { ship, basin: epSlice(state).harbors[v] ?? [] };
}

const without = (list: readonly Cargo[], c: Cargo): Cargo[] => {
  const i = list.indexOf(c);
  return i < 0 ? [...list] : [...list.slice(0, i), ...list.slice(i + 1)];
};

function whyTransfer(
  state: GameState,
  p: PlayerId,
  id: number,
  v: VertexId,
  toShip: Cargo | null,
  toBasin: Cargo | null,
): Why {
  const w = whyMovement(state, p);
  if (w) return w;
  const x = shipAndBasin(state, p, id, v);
  if (!x) return 'the ship must lie at your harbor settlement';
  if (toShip !== null && !x.basin.includes(toShip)) return `no ${toShip} in the harbor`;
  if (toBasin !== null && !x.ship.cargo.includes(toBasin)) return `no ${toBasin} on the ship`;
  const hold = toBasin === null ? x.ship.cargo : without(x.ship.cargo, toBasin);
  const basin = toShip === null ? x.basin : without(x.basin, toShip);
  if (toShip !== null && load([...hold, toShip]) > HOLD) return 'no room on the ship';
  if (toBasin !== null && load([...basin, toBasin]) > HOLD) return 'no room in the harbor';
  return null;
}

function whyLand(state: GameState, p: PlayerId, id: number, v: VertexId): Why {
  const w = whyMovement(state, p);
  if (w) return w;
  const ship = ownShip(state, p, id);
  if (!ship || !ship.cargo.includes('settler')) return 'no settler on that ship';
  if (!isVertex(v) || !isEndOf(state, ship.edge, v)) return 'land at an end of the ship';
  if (piecesLeft(state, p).settlement <= 0) return 'no settlements left';
  return settlementSpot(state, p, v) ? null : 'no settlement can stand there';
}

function whyDropCrew(state: GameState, p: PlayerId, id: number, h: HexId): Why {
  const w = whyMovement(state, p);
  if (w) return w;
  const ship = ownShip(state, p, id);
  if (!ship || !ship.cargo.includes('crew')) return 'no crew on that ship';
  if (!isHex(h) || !endTouchesHex(state, ship.edge, h)) return 'the ship must touch the hex';
  const s = epSlice(state);
  const lair = s.lairs[h];
  if (lair) {
    if (lair.captured) return 'that lair is already captured';
    if (lair.crews.length >= LAIR_CREWS) return 'three crews are already there';
    return null;
  }
  const farm = s.spice[h];
  if (farm) return farm.crews.includes(p) ? 'you already befriended that farm' : null;
  return 'no lair or spice farm there';
}

function whyPickCrew(state: GameState, p: PlayerId, id: number, h: HexId): Why {
  const w = whyMovement(state, p);
  if (w) return w;
  const ship = ownShip(state, p, id);
  if (!ship || !isHex(h) || !endTouchesHex(state, ship.edge, h))
    return 'the ship must touch the hex';
  const lair = epSlice(state).lairs[h];
  if (!lair?.captured || !lair.crews.includes(p)) return 'none of your crews to pick up there';
  return fits(ship.cargo, 'crew') ? null : 'no room on the ship';
}

function whyLoadSpice(state: GameState, p: PlayerId, id: number, h: HexId): Why {
  const w = whyMovement(state, p);
  if (w) return w;
  const ship = ownShip(state, p, id);
  if (!ship || !isHex(h) || !endTouchesHex(state, ship.edge, h))
    return 'the ship must touch the farm';
  const farm = epSlice(state).spice[h];
  if (!farm) return 'not a spice farm';
  if (!farm.crews.includes(p)) return 'befriend the farm with a crew first';
  if (!farm.sacks.includes(p)) return 'you already took your sack from this farm';
  return fits(ship.cargo, 'spice') ? null : 'no room on the ship';
}

function whyCatch(state: GameState, p: PlayerId, id: number, h: HexId): Why {
  const w = whyMovement(state, p);
  if (w) return w;
  const ship = ownShip(state, p, id);
  if (!ship || !isHex(h) || !endTouchesHex(state, ship.edge, h))
    return 'the ship must touch the shoal';
  if (!epSlice(state).hauls.includes(h)) return 'no fish haul there';
  return fits(ship.cargo, 'fish') ? null : 'a fish haul needs an empty hold';
}

function whyDeliver(state: GameState, p: PlayerId, id: number): Why {
  const w = whyMovement(state, p);
  if (w) return w;
  const ship = ownShip(state, p, id);
  if (!ship) return 'not your ship';
  if (!ship.cargo.some((c) => c === 'fish' || c === 'spice')) return 'nothing to deliver';
  const at = anchors(state);
  return (graph(state).ends.get(ship.edge) ?? []).some((v) => at.includes(v))
    ? null
    : 'sail to an anchor of the Council of Catan';
}

function whyRollFish(state: GameState, p: PlayerId): Why {
  const w = whyMovement(state, p);
  if (w) return w;
  if (!rulesOf(state).fish) return 'no fish in this scenario';
  return epSlice(state).turn.fishRolled ? 'once per turn' : null;
}

/** Numbers that chase the pirate for `p`: 6, and each befriended Pirate Bonus farm's (§4.12). */
export function chaseNumbers(s: EpSlice, p: PlayerId): number[] {
  const out = new Set([6]);
  for (const f of Object.values(s.spice)) {
    if (f.kind === 'bonus' && f.crews.includes(p) && f.number !== undefined) out.add(f.number);
  }
  return [...out].sort();
}

function whyChase(state: GameState, p: PlayerId, id: number): Why {
  const w = whyMovement(state, p);
  if (w) return w;
  const ship = ownShip(state, p, id);
  if (!ship) return 'not your ship';
  const s = epSlice(state);
  if (!s.pirate || s.pirate.owner === p) return 'no enemy pirate to chase';
  const t = shipTurn(s, id);
  if (t.used > 0 || t.done) return 'only ships that have not moved this turn';
  if (t.chased) return 'that ship already tried';
  return endTouchesHex(state, ship.edge, s.pirate.hex)
    ? null
    : 'the ship must touch the pirate’s hex';
}

// ---------------------------------------------------------------------------------------------
// The pirate (§4.7)
// ---------------------------------------------------------------------------------------------

/** Start activating the current player's pirate ship (after a 7 or a successful chase). */
export function startPirate(draft: GameState, resume: 'main' | 'preRoll'): void {
  draft.phase =
    pirateTargets(draft).length > 0
      ? ({ kind: 'ep/pirate', resume } satisfies PiratePhase)
      : resumePhase(draft, resume);
}

export function pirateTargets(state: GameState): HexId[] {
  const pirate = epSlice(state).pirate;
  return pirateHexes(state).filter((h) => h !== pirate?.hex);
}

function whyPlacePirate(state: GameState, p: PlayerId, h: HexId): Why {
  if (state.phase.kind !== 'ep/pirate') return 'not placing the pirate now';
  if (!isCurrent(state, p)) return 'not your turn';
  if (!isHex(h) || !isPirateHex(state, h))
    return 'the pirate sails on the open sea, away from the island';
  return epSlice(state).pirate?.hex === h ? 'move the pirate to a different hex' : null;
}

/** Players with a ship beside hex `h` who have something to lose. */
export function pirateVictims(state: GameState, p: PlayerId, h: HexId): PlayerId[] {
  const s = epSlice(state);
  const sides = new Set(sidesOf(state, h));
  const owners = new Set(s.ships.filter((x) => sides.has(x.edge)).map((x) => x.owner));
  return [...owners]
    .filter((o) => o !== p && !isRobberProtected(state, o))
    .filter((o) => {
      const hand = state.players[o]?.resources;
      return (hand !== undefined && RESOURCES.some((r) => hand[r] > 0)) || (s.gold[o] ?? 0) > 0;
    })
    .sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------------------------

type Act = ExpansionAction & Record<string, unknown>;
type H = (draft: GameState, a: Act) => ReturnType<typeof ok>;

const guard = (why: Why, run: () => void, draft: GameState) => {
  if (why) return fail(why);
  run();
  return ok(draft);
};

export const HANDLERS: Record<EpActionType, H> = {
  [A.setupRoad]: (draft, a) => {
    const e = a.edge;
    if (!isEdge(e)) return fail('invalid edge');
    return guard(
      whySetupRoad(draft, a.player, e),
      () => {
        draft.pieces.roads[e] = a.player;
        log(draft, a.player, `${name(draft, a.player)} placed a road`);
        nextFleetStep(draft);
      },
      draft,
    );
  },

  [A.setupShip]: (draft, a) => {
    const e = a.edge;
    if (!isEdge(e)) return fail('invalid edge');
    return guard(
      whySetupShip(draft, a.player, e),
      () => {
        const s = epSlice(draft);
        s.ships.push({ id: s.nextShip++, owner: a.player, edge: e, cargo: ['settler'] });
        log(draft, a.player, `${name(draft, a.player)} placed a ship with a settler`);
        nextFleetStep(draft);
      },
      draft,
    );
  },

  [A.buildHarbor]: (draft, a) => {
    const v = a.vertex;
    if (!isVertex(v)) return fail('invalid vertex');
    return guard(
      whyHarbor(draft, a.player, v),
      () => {
        pay(draft, a.player, costOf(draft, ITEM.harbor) as ResourceCounts);
        epSlice(draft).harbors[v] = [];
        log(draft, a.player, `${name(draft, a.player)} built a harbor settlement`);
      },
      draft,
    );
  },

  [A.buildShip]: (draft, a) => {
    const e = a.edge;
    const replace = a.replace === undefined ? undefined : a.replace;
    if (!isEdge(e)) return fail('invalid edge');
    if (replace !== undefined && !isInt(replace)) return fail('invalid ship');
    return guard(
      whyShip(draft, a.player, e, replace),
      () => {
        pay(draft, a.player, costOf(draft, ITEM.ship) as ResourceCounts);
        placeShip(draft, a.player, e, replace);
      },
      draft,
    );
  },

  [A.buildSettler]: (draft, a) => buildPiece(draft, a, 'settler'),
  [A.buildCrew]: (draft, a) => buildPiece(draft, a, 'crew'),

  [A.sellForGold]: (draft, a) => {
    const r = a.resource;
    if (!isResource(r)) return fail('invalid resource');
    return guard(
      whySell(draft, a.player, r, 3),
      () => {
        pay(draft, a.player, { ...ZERO, [r]: 3 });
        epSlice(draft).gold[a.player] = gold(draft, a.player) + 1;
        log(draft, a.player, `${name(draft, a.player)} traded 3 ${r} for 1 gold with the supply`);
      },
      draft,
    );
  },

  [A.buyWithGold]: (draft, a) => {
    const r = a.resource;
    if (!isResource(r)) return fail('invalid resource');
    return guard(
      whyBuy(draft, a.player, r),
      () => {
        const s = epSlice(draft);
        s.gold[a.player] = gold(draft, a.player) - GOLD_PER_BUY;
        s.turn.goldBuys += 1;
        const hand = draft.players[a.player]?.resources;
        if (hand) hand[r] += 1;
        draft.bank[r] -= 1;
        log(draft, a.player, `${name(draft, a.player)} bought 1 ${r} for ${GOLD_PER_BUY} gold`);
      },
      draft,
    );
  },

  [A.fastGold]: (draft, a) => {
    const r = a.resource;
    if (!isResource(r)) return fail('invalid resource');
    return guard(
      whyFast(draft, a.player, r),
      () => {
        const s = epSlice(draft);
        pay(draft, a.player, { ...ZERO, [r]: 1 });
        s.gold[a.player] = gold(draft, a.player) + 1;
        s.turn.fastGold += 1;
        log(draft, a.player, `${name(draft, a.player)} sold 1 ${r} for 1 gold (Fast Gold)`);
      },
      draft,
    );
  },

  [A.dump]: (draft, a) => {
    const c = a.cargo;
    const from = a.ship ?? a.vertex;
    if (!isCargo(c) || !(isInt(from) || isVertex(from))) return fail('invalid cargo');
    return guard(
      whyDump(draft, a.player, from, c),
      () => {
        const s = epSlice(draft);
        if (typeof from === 'number') {
          const ship = shipById(s, from);
          if (ship) ship.cargo = without(ship.cargo, c);
        } else s.harbors[from] = without(s.harbors[from] ?? [], c);
        log(draft, a.player, `${name(draft, a.player)} returned a ${c} to the supply`);
      },
      draft,
    );
  },

  [A.startMovement]: (draft, a) => {
    const w = whyAction(draft, a.player);
    if (w) return fail(w);
    epSlice(draft).turn.movement = true;
    log(draft, a.player, `${name(draft, a.player)} starts the Movement phase`);
    return ok(draft);
  },

  [A.selectShip]: (draft, a) => {
    const e = a.edge;
    if (!isInt(a.ship) || !isEdge(e)) return fail('invalid ship');
    const id = a.ship;
    return guard(
      whySelect(draft, a.player, id, e),
      () => (epSlice(draft).turn.selected = id),
      draft,
    );
  },

  [A.moveShip]: (draft, a) => {
    const e = a.edge;
    if (!isInt(a.ship) || !isEdge(e)) return fail('invalid move');
    const id = a.ship;
    return guard(
      whyMove(draft, a.player, id, e),
      () => {
        const s = epSlice(draft);
        const ship = shipById(s, id) as Ship;
        const step = reachable(draft, ship).get(e);
        if (!step) return;
        if (s.turn.active !== null && s.turn.active !== id) finishShip(s, s.turn.active);
        s.turn.active = id;
        s.turn.selected = id;
        const t = shipTurnDraft(s, id);
        t.used += step.dist;
        if (step.tribute) {
          t.tribute = true;
          s.gold[a.player] = gold(draft, a.player) - 1;
          const owner = s.pirate?.owner ?? 0;
          log(
            draft,
            a.player,
            `${name(draft, a.player)} paid 1 gold tribute to ${name(draft, owner)}’s pirate`,
          );
        }
        ship.edge = e;
        log(draft, a.player, `${name(draft, a.player)} sailed ${step.dist}`);
        if (explore(draft, a.player, e).length > 0) t.done = true;
      },
      draft,
    );
  },

  [A.extraMove]: (draft, a) => {
    if (!isInt(a.ship)) return fail('invalid ship');
    const id = a.ship;
    return guard(
      whyExtra(draft, a.player, id),
      () => {
        pay(draft, a.player, costOf(draft, ITEM.extraMove) as ResourceCounts);
        shipTurnDraft(epSlice(draft), id).extra = true;
        log(draft, a.player, `${name(draft, a.player)} bought ${EXTRA_MP} extra moves for a ship`);
      },
      draft,
    );
  },

  [A.load]: (draft, a) => transfer(draft, a, a.cargo, null),
  [A.unload]: (draft, a) => transfer(draft, a, null, a.cargo),
  [A.swap]: (draft, a) => transfer(draft, a, a.take, a.give),

  [A.land]: (draft, a) => {
    const v = a.vertex;
    if (!isInt(a.ship) || !isVertex(v)) return fail('invalid landing');
    const id = a.ship;
    return guard(
      whyLand(draft, a.player, id, v),
      () => {
        const s = epSlice(draft);
        s.ships = s.ships.filter((x) => x.id !== id);
        if (s.turn.active === id) s.turn.active = null;
        if (s.turn.selected === id) s.turn.selected = null;
        draft.pieces.buildings[v] = { owner: a.player, kind: 'settlement' };
        log(draft, a.player, `${name(draft, a.player)}’s settlers founded a settlement`);
      },
      draft,
    );
  },

  [A.dropCrew]: (draft, a) => {
    const h = a.hex;
    if (!isInt(a.ship) || !isHex(h)) return fail('invalid hex');
    const id = a.ship;
    return guard(
      whyDropCrew(draft, a.player, id, h),
      () => {
        const s = epSlice(draft);
        const ship = shipById(s, id) as Ship;
        ship.cargo = without(ship.cargo, 'crew');
        const lair = s.lairs[h];
        if (lair) {
          lair.crews.push(a.player);
          log(draft, a.player, `${name(draft, a.player)} landed a crew on the pirate lair`);
          if (lair.crews.length >= LAIR_CREWS) s.turn.captured.push(h);
          return;
        }
        const farm = s.spice[h];
        if (farm) {
          farm.crews.push(a.player);
          log(draft, a.player, `${name(draft, a.player)} befriended a spice farm`);
        }
      },
      draft,
    );
  },

  [A.pickCrew]: (draft, a) => {
    const h = a.hex;
    if (!isInt(a.ship) || !isHex(h)) return fail('invalid hex');
    const id = a.ship;
    return guard(
      whyPickCrew(draft, a.player, id, h),
      () => {
        const s = epSlice(draft);
        const lair = s.lairs[h];
        if (!lair) return;
        const i = lair.crews.indexOf(a.player);
        lair.crews.splice(i, 1);
        shipById(s, id)?.cargo.push('crew');
        log(draft, a.player, `${name(draft, a.player)} picked up a crew`);
      },
      draft,
    );
  },

  [A.loadSpice]: (draft, a) => {
    const h = a.hex;
    if (!isInt(a.ship) || !isHex(h)) return fail('invalid hex');
    const id = a.ship;
    return guard(
      whyLoadSpice(draft, a.player, id, h),
      () => {
        const s = epSlice(draft);
        const farm = s.spice[h];
        if (!farm) return;
        farm.sacks = farm.sacks.filter((o) => o !== a.player);
        shipById(s, id)?.cargo.push('spice');
        log(draft, a.player, `${name(draft, a.player)} loaded a spice sack`);
      },
      draft,
    );
  },

  [A.catchFish]: (draft, a) => {
    const h = a.hex;
    if (!isInt(a.ship) || !isHex(h)) return fail('invalid hex');
    const id = a.ship;
    return guard(
      whyCatch(draft, a.player, id, h),
      () => {
        const s = epSlice(draft);
        s.hauls = s.hauls.filter((x) => x !== h);
        shipById(s, id)?.cargo.push('fish');
        log(draft, a.player, `${name(draft, a.player)} caught a fish haul`);
      },
      draft,
    );
  },

  [A.deliver]: (draft, a) => {
    if (!isInt(a.ship)) return fail('invalid ship');
    const id = a.ship;
    return guard(
      whyDeliver(draft, a.player, id),
      () => {
        const s = epSlice(draft);
        const ship = shipById(s, id) as Ship;
        const fish = ship.cargo.filter((c) => c === 'fish').length;
        const spice = ship.cargo.filter((c) => c === 'spice').length;
        ship.cargo = ship.cargo.filter((c) => c !== 'fish' && c !== 'spice');
        s.haulSupply += fish;
        advance(s, 'fish', a.player, fish);
        advance(s, 'spice', a.player, spice);
        const what = [fish > 0 ? `${fish} fish` : '', spice > 0 ? `${spice} spice` : '']
          .filter(Boolean)
          .join(' and ');
        log(draft, a.player, `${name(draft, a.player)} delivered ${what} to the Council of Catan`);
      },
      draft,
    );
  },

  [A.rollFish]: (draft, a) => {
    const w = whyRollFish(draft, a.player);
    if (w) return fail(w);
    const s = epSlice(draft);
    if (s.turn.active !== null) finishShip(s, s.turn.active);
    s.turn.active = null;
    s.turn.fishRolled = true;
    const rng = new Rng(draft.rng);
    const die = rng.die();
    draft.rng = rng.state;
    const hex = (Object.keys(s.shoals) as HexId[]).find((h) => s.shoals[h] === die);
    const blocked = !hex || s.hauls.includes(hex) || s.pirate?.hex === hex || s.haulSupply <= 0;
    if (hex && !blocked) {
      s.hauls.push(hex);
      s.haulSupply -= 1;
    }
    log(
      draft,
      a.player,
      `${name(draft, a.player)} rolled ${die} for fish${hex && !blocked ? ': a haul appears' : ''}`,
    );
    return ok(draft);
  },

  [A.chase]: (draft, a) => {
    if (!isInt(a.ship)) return fail('invalid ship');
    const id = a.ship;
    const w = whyChase(draft, a.player, id);
    if (w) return fail(w);
    const s = epSlice(draft);
    shipTurnDraft(s, id).chased = true;
    const rng = new Rng(draft.rng);
    const die = rng.die();
    draft.rng = rng.state;
    const wins = chaseNumbers(s, a.player).includes(die);
    log(draft, a.player, `${name(draft, a.player)} rolled ${die} to chase the pirate`);
    if (wins && s.pirate) {
      log(draft, a.player, `${name(draft, s.pirate.owner)}’s pirate ship is chased away`);
      s.pirate = null;
      startPirate(draft, 'main');
    }
    return ok(draft);
  },

  [A.placePirate]: (draft, a) => {
    const h = a.hex;
    if (!isHex(h)) return fail('invalid hex');
    const w = whyPlacePirate(draft, a.player, h);
    if (w) return fail(w);
    const s = epSlice(draft);
    s.pirate = { owner: a.player, hex: h };
    if (s.hauls.includes(h)) {
      s.hauls = s.hauls.filter((x) => x !== h);
      s.haulSupply += 1;
      log(draft, null, 'The fish haul there is lost');
    }
    log(draft, a.player, `${name(draft, a.player)} placed their pirate ship`);
    const resume = (draft.phase as PiratePhase).resume;
    const candidates = pirateVictims(draft, a.player, h);
    draft.phase =
      candidates.length > 0
        ? ({ kind: 'ep/pirateSteal', candidates, resume } satisfies PirateStealPhase)
        : resumePhase(draft, resume);
    return ok(draft);
  },

  [A.pirateSteal]: (draft, a) => {
    const ph = draft.phase as PirateStealPhase;
    if (ph.kind !== 'ep/pirateSteal') return fail('nobody to rob now');
    if (!isCurrent(draft, a.player)) return fail('not your turn');
    const victim = a.victim;
    if (!isInt(victim) || !ph.candidates.includes(victim)) return fail('not a valid victim');
    const s = epSlice(draft);
    const hand = draft.players[victim]?.resources;
    const mine = draft.players[a.player]?.resources;
    const rng = new Rng(draft.rng);
    const cards = hand ? RESOURCES.flatMap((r) => Array<Resource>(hand[r]).fill(r)) : [];
    if (cards.length > 0 && hand && mine) {
      const r = rng.pick(cards);
      hand[r] -= 1;
      mine[r] += 1;
      log(draft, a.player, `${name(draft, a.player)}’s pirates robbed ${name(draft, victim)}`);
    } else if ((s.gold[victim] ?? 0) > 0) {
      s.gold[victim] = (s.gold[victim] ?? 0) - 1;
      s.gold[a.player] = gold(draft, a.player) + 1;
      log(
        draft,
        a.player,
        `${name(draft, a.player)}’s pirates took 1 gold from ${name(draft, victim)}`,
      );
    }
    draft.rng = rng.state;
    draft.phase = resumePhase(draft, ph.resume);
    return ok(draft);
  },

  [A.offerTrade]: (draft, a) => offerGoldTrade(draft, a),
};

const ZERO: ResourceCounts = { brick: 0, lumber: 0, wool: 0, grain: 0, ore: 0 };

function buildPiece(draft: GameState, a: Act, kind: 'settler' | 'crew') {
  const t: Target | null = isVertex(a.vertex)
    ? { vertex: a.vertex }
    : isEdge(a.edge) && isInt(a.ship)
      ? { edge: a.edge, ship: a.ship }
      : null;
  if (!t) return fail('invalid target');
  return guard(
    whyPiece(draft, a.player, kind, t),
    () => {
      pay(
        draft,
        a.player,
        costOf(draft, kind === 'settler' ? ITEM.settler : ITEM.crew) as ResourceCounts,
      );
      placeCargo(draft, t, kind);
      log(draft, a.player, `${name(draft, a.player)} built a ${kind}`);
    },
    draft,
  );
}

function transfer(draft: GameState, a: Act, toShip: unknown, toBasin: unknown) {
  const v = a.vertex;
  if (!isInt(a.ship) || !isVertex(v)) return fail('invalid transfer');
  if ((toShip !== null && !isCargo(toShip)) || (toBasin !== null && !isCargo(toBasin))) {
    return fail('invalid cargo');
  }
  const id = a.ship;
  return guard(
    whyTransfer(draft, a.player, id, v, toShip, toBasin),
    () => {
      const s = epSlice(draft);
      const ship = shipById(s, id) as Ship;
      let basin = s.harbors[v] ?? [];
      if (toBasin !== null) ship.cargo = without(ship.cargo, toBasin);
      if (toShip !== null) basin = without(basin, toShip);
      if (toBasin !== null) basin.push(toBasin);
      if (toShip !== null) ship.cargo.push(toShip);
      s.harbors[v] = basin;
      const what = [toShip && `loaded a ${toShip}`, toBasin && `unloaded a ${toBasin}`]
        .filter(Boolean)
        .join(' and ');
      log(draft, a.player, `${name(draft, a.player)} ${what}`);
    },
    draft,
  );
}

// ---------------------------------------------------------------------------------------------
// Legal moves
// ---------------------------------------------------------------------------------------------

const act = (type: EpActionType, player: PlayerId, extra: Record<string, unknown> = {}): Action =>
  ({ type, player, ...extra }) as Action;

function setupLegal(state: GameState): Action[] {
  const ph = state.phase;
  if (ph.kind !== 'ep/setupFleet') return [];
  const p = state.turn.current;
  const g = graph(state);
  if ((ph as SetupFleetPhase).step === 'road') {
    const home = homeSettlement(state, p);
    return (home ? (g.edgesAt.get(home) ?? []) : [])
      .filter((e) => whySetupRoad(state, p, e) === null)
      .map((edge) => act(A.setupRoad, p, { edge }));
  }
  return shipSpots(state, p)
    .filter((e) => whySetupShip(state, p, e) === null)
    .map((edge) => act(A.setupShip, p, { edge }));
}

function actionLegal(state: GameState, p: PlayerId): Action[] {
  const out: Action[] = [];
  const s = epSlice(state);
  for (const b of Object.keys(state.pieces.buildings) as VertexId[]) {
    if (whyHarbor(state, p, b) === null) out.push(act(A.buildHarbor, p, { vertex: b }));
  }
  if (canAfford(state, p, ITEM.ship)) {
    for (const [e, r] of newShipSpots(state, p)) {
      out.push(act(A.buildShip, p, r === undefined ? { edge: e } : { edge: e, replace: r }));
    }
  }
  for (const kind of ['settler', 'crew'] as const) {
    for (const t of targetsOf(state, p)) {
      if (whyPiece(state, p, kind, t) === null) {
        out.push(act(kind === 'settler' ? A.buildSettler : A.buildCrew, p, { ...t }));
      }
    }
  }
  for (const r of RESOURCES) {
    if (whySell(state, p, r, 3) === null) out.push(act(A.sellForGold, p, { resource: r }));
    if (whyBuy(state, p, r) === null) out.push(act(A.buyWithGold, p, { resource: r }));
    if (whyFast(state, p, r) === null) out.push(act(A.fastGold, p, { resource: r }));
  }
  for (const v of harborsOf(state, p)) {
    for (const c of new Set(s.harbors[v] ?? [])) {
      if (whyDump(state, p, v, c) === null) out.push(act(A.dump, p, { vertex: v, cargo: c }));
    }
  }
  for (const ship of shipsOf(s, p)) {
    for (const c of new Set(ship.cargo)) {
      if (whyDump(state, p, ship.id, c) === null)
        out.push(act(A.dump, p, { ship: ship.id, cargo: c }));
    }
  }
  out.push(...goldOfferLegal(state, p));
  out.push(act(A.startMovement, p));
  return out;
}

function movementLegal(state: GameState, p: PlayerId): Action[] {
  const out: Action[] = [];
  const s = epSlice(state);
  const g = graph(state);
  const sel = selectedShip(state, p);
  if (sel) {
    for (const e of [...reachable(state, sel).keys()].sort()) {
      out.push(act(A.moveShip, p, { ship: sel.id, edge: e }));
    }
  }
  for (const ship of shipsOf(s, p)) {
    if (whySelect(state, p, ship.id, ship.edge) === null) {
      out.push(act(A.selectShip, p, { ship: ship.id, edge: ship.edge }));
    }
    if (whyExtra(state, p, ship.id) === null && mpLeft(state, ship) > 0) {
      out.push(act(A.extraMove, p, { ship: ship.id }));
    }
    for (const v of g.ends.get(ship.edge) ?? []) {
      if (!isHarbor(state, v) || state.pieces.buildings[v]?.owner !== p) continue;
      const basin = s.harbors[v] ?? [];
      for (const c of new Set(basin)) {
        if (whyTransfer(state, p, ship.id, v, c, null) === null) {
          out.push(act(A.load, p, { ship: ship.id, vertex: v, cargo: c }));
        }
      }
      for (const c of new Set(ship.cargo)) {
        if (whyTransfer(state, p, ship.id, v, null, c) === null) {
          out.push(act(A.unload, p, { ship: ship.id, vertex: v, cargo: c }));
        }
        for (const t of new Set(basin)) {
          if (t === c) continue;
          if (
            whyTransfer(state, p, ship.id, v, t, null) !== null &&
            whyTransfer(state, p, ship.id, v, null, c) !== null &&
            whyTransfer(state, p, ship.id, v, t, c) === null
          ) {
            out.push(act(A.swap, p, { ship: ship.id, vertex: v, give: c, take: t }));
          }
        }
      }
    }
    if (ship.cargo.includes('settler')) {
      for (const v of g.ends.get(ship.edge) ?? []) {
        if (whyLand(state, p, ship.id, v) === null)
          out.push(act(A.land, p, { ship: ship.id, vertex: v }));
      }
    }
    const hexes = new Set<HexId>();
    for (const v of g.ends.get(ship.edge) ?? [])
      for (const h of g.hexesAt.get(v) ?? []) hexes.add(h);
    for (const h of [...hexes].sort()) {
      if (whyDropCrew(state, p, ship.id, h) === null)
        out.push(act(A.dropCrew, p, { ship: ship.id, hex: h }));
      if (whyPickCrew(state, p, ship.id, h) === null)
        out.push(act(A.pickCrew, p, { ship: ship.id, hex: h }));
      if (whyLoadSpice(state, p, ship.id, h) === null)
        out.push(act(A.loadSpice, p, { ship: ship.id, hex: h }));
      if (whyCatch(state, p, ship.id, h) === null)
        out.push(act(A.catchFish, p, { ship: ship.id, hex: h }));
    }
    if (whyDeliver(state, p, ship.id) === null) out.push(act(A.deliver, p, { ship: ship.id }));
    if (whyChase(state, p, ship.id) === null) out.push(act(A.chase, p, { ship: ship.id }));
  }
  if (whyRollFish(state, p) === null) out.push(act(A.rollFish, p));
  return out;
}

export const epLegal: LegalGenerator = (state) => {
  const ph = state.phase;
  const p = state.turn.current;
  switch (ph.kind) {
    case 'ep/setupFleet':
      return setupLegal(state);
    case 'ep/pirate':
      return pirateTargets(state).map((hex) => act(A.placePirate, p, { hex }));
    case 'ep/pirateSteal':
      return (ph as PirateStealPhase).candidates.map((victim) => act(A.pirateSteal, p, { victim }));
    case 'main':
      return epSlice(state).turn.movement ? movementLegal(state, p) : actionLegal(state, p);
    default:
      return [];
  }
};

/** Base actions with no place in the Movement phase. */
const ACTION_PHASE_ONLY = new Set<string>([
  'buildRoad',
  'buildSettlement',
  'buildCity',
  'bankTrade',
  'offerTrade',
  'buyDevCard',
  'repairRoad',
]);

/** Drop what the overrides reject. */
export function epFilterLegal(state: GameState, actions: Action[]): Action[] {
  const movement = inMovement(state);
  return actions.filter((a) => {
    if (a.type === 'buildCity' && !citiesInPlay(state)) return false;
    if (movement && ACTION_PHASE_ONLY.has(a.type)) return false;
    if (!goldTradeAllowed(state, a)) return false;
    if (a.type === 'placeSetupSettlement') return setupSpotAllowed(state, a.vertex);
    if (a.type === 'buildRoad' || a.type === 'placeFreeRoad') {
      return !edgeSpiceClosed(state, a.player, a.edge);
    }
    if (a.type === 'buildSettlement') return !vertexSpiceClosed(state, a.player, a.vertex);
    return true;
  });
}

function movementGuard<K extends BaseActionType>(): Override<K> {
  return (draft, action, next) =>
    inMovement(draft) ? fail('no trading or building in the Movement phase') : next(draft, action);
}

export const OVERRIDES: { readonly [K in BaseActionType]?: Override<K> } = {
  placeSetupSettlement: (draft, action, next) =>
    setupSpotAllowed(draft, action.vertex)
      ? next(draft, action)
      : fail('the first harbor settlement goes on a marked coastal corner of the island'),
  buildCity: (draft, action, next) => {
    if (!citiesInPlay(draft)) return fail('there are no cities in Explorers & Pirates');
    if (inMovement(draft)) return fail('no building in the Movement phase');
    return next(draft, action);
  },
  ...tradeOverrides,
  buildRoad: (draft, action, next) => {
    if (inMovement(draft)) return fail('no building in the Movement phase');
    if (edgeSpiceClosed(draft, action.player, action.edge)) {
      return fail('you need a crew on that spice farm first');
    }
    return next(draft, action);
  },
  // A free road (C&K Road Building, T&B fish in the combinations) obeys the farms too.
  placeFreeRoad: (draft, action, next) =>
    edgeSpiceClosed(draft, action.player, action.edge)
      ? fail('you need a crew on that spice farm first')
      : next(draft, action),
  buildSettlement: (draft, action, next) => {
    if (inMovement(draft)) return fail('no building in the Movement phase');
    if (vertexSpiceClosed(draft, action.player, action.vertex)) {
      return fail('you need a crew on that spice farm first');
    }
    return next(draft, action);
  },
  bankTrade: movementGuard<'bankTrade'>(),
  offerTrade: movementGuard<'offerTrade'>(),
  endTurn: (draft, action, next) => {
    if (draft.phase.kind !== 'main' || !isCurrent(draft, action.player)) return next(draft, action);
    // Lairs captured this turn are resolved after the Movement phase (§4.8); that may win.
    if (epSlice(draft).turn.captured.length > 0) {
      resolveLairs(draft);
      checkVictory(draft);
      if (draft.winner !== null) return ok(draft);
    }
    return next(draft, action);
  },
};

/** For tests / UI: every cargo kind. */
export { CARGO };
/** Static helpers the UI needs. */
export { epBoard };
