/**
 * Ships (docs/rules/seafarers.md §3.2-§3.5, FAQ F1, F5-F7, F11-F18, E1-E4): building, moving,
 * closed routes, the Longest Trade Route, Road Building and starting ships. Board: Heading for
 * New Shores, 4 players; (2,8) is the main island's southern tip (sea to its S, SE and SW).
 */
import { describe, expect, it } from 'vitest';
import { applyAction, legalActions } from '../../../engine/engine';
import {
  expectConserved,
  expectFail,
  expectOk,
  run,
  setHand,
} from '../../../engine/actions/testkit';
import { isVertexOpen, touchesLand } from '../../../engine/rules/placement';
import { topologyOf } from '../../../engine/topology';
import type { Action, GameState } from '../../../engine/types';
import { graph } from './geometry';
import { canMoveShip, canPlaceShip, markClosedRoutes, shipsLeft, tradeRouteLength } from './ships';
import { seaSlice } from './state';
import { E, H, V, mainPhase, seaGame, ship } from './testkit';

const TIP = V(2, 8, 'SE'); // (2,8) | sea (3,9) | sea (2,10)
const TIP_W = V(2, 8, 'SW'); // (2,8) | sea (1,9) | sea (2,10)
const NECK = V(2, 8, 'E'); // (2,8) | (3,7) land | sea (3,9)
const COAST_S = E(2, 8, 'S'); // land | sea, TIP_W - TIP
const COAST_SE = E(2, 8, 'SE'); // land | sea, NECK - TIP
const OPEN_SEA = E(3, 9, 'SW'); // sea | sea, from TIP
const LAND = E(2, 8, 'NE'); // (2,8) | (3,7): land | land, at NECK

function game(): GameState {
  const s = mainPhase(seaGame('newShores', 4));
  seaSlice(s).pirate = H(3, -1);
  return s;
}

const build = (edge: string, player = 0): Action =>
  ({ type: 'seafarers/buildShip', player, edge }) as Action;

describe('where a ship may go (§3.2)', () => {
  it('coast and open-sea edges, but never between two land hexes (E1)', () => {
    const s = game();
    s.pieces.buildings[TIP] = { owner: 0, kind: 'settlement' };
    s.pieces.buildings[NECK] = { owner: 0, kind: 'settlement' };
    expect(canPlaceShip(s, 0, COAST_S)).toBe(true);
    expect(canPlaceShip(s, 0, OPEN_SEA)).toBe(true);
    expect(canPlaceShip(s, 0, LAND)).toBe(false);
  });

  it('a road and a ship never share a coast edge (F17, E2)', () => {
    const s = game();
    s.pieces.buildings[TIP] = { owner: 0, kind: 'settlement' };
    s.pieces.roads[COAST_S] = 0;
    expect(canPlaceShip(s, 0, COAST_S)).toBe(false);
    const t = game();
    t.pieces.buildings[TIP] = { owner: 0, kind: 'settlement' };
    ship(t, 0, COAST_S);
    setHand(t, 0, { brick: 1, lumber: 1 });
    expectFail(applyAction(t, { type: 'buildRoad', player: 0, edge: COAST_S }));
  });

  it('needs your building or the end of your ship; a road does not count (F16)', () => {
    const s = game();
    s.pieces.buildings[TIP_W] = { owner: 0, kind: 'settlement' };
    s.pieces.roads[COAST_S] = 0;
    expect(canPlaceShip(s, 0, OPEN_SEA)).toBe(false); // only a road reaches TIP
    s.pieces.buildings[TIP] = { owner: 0, kind: 'settlement' };
    expect(canPlaceShip(s, 0, OPEN_SEA)).toBe(true);
    const u = game();
    u.pieces.buildings[TIP_W] = { owner: 0, kind: 'settlement' };
    ship(u, 0, COAST_S);
    expect(canPlaceShip(u, 0, OPEN_SEA)).toBe(true); // from the ship's free end
  });

  it("an opponent's building cuts the route", () => {
    const s = game();
    s.pieces.buildings[TIP_W] = { owner: 0, kind: 'settlement' };
    ship(s, 0, COAST_S);
    s.pieces.buildings[TIP] = { owner: 1, kind: 'settlement' };
    expect(canPlaceShip(s, 0, OPEN_SEA)).toBe(false);
  });

  it('no ship on a side of the pirate hex; roads and settlements are fine (F6)', () => {
    const s = game();
    s.pieces.buildings[NECK] = { owner: 0, kind: 'settlement' };
    seaSlice(s).pirate = H(3, 9);
    expect(canPlaceShip(s, 0, COAST_SE)).toBe(false);
    setHand(s, 0, { brick: 1, lumber: 1 });
    expectOk(applyAction(s, { type: 'buildRoad', player: 0, edge: COAST_SE }));
  });

  it('a ship on the inner edge of the frame is fine, on the frame itself not (FAQ #15, Q4)', () => {
    const s = game();
    // (0,2) is on the west edge: its NW side faces the frame cell (-1,1).
    s.pieces.buildings[V(0, 2, 'NW')] = { owner: 0, kind: 'settlement' };
    expect(canPlaceShip(s, 0, E(0, 2, 'NW'))).toBe(true);
    // Between two frame cells (-1,1) and (-1,3): never.
    ship(s, 0, E(0, 2, 'NW'));
    expect(canPlaceShip(s, 0, E(-1, 1, 'S'))).toBe(false);
  });
});

describe('building ships', () => {
  it('costs 1 lumber + 1 wool; 15 per player', () => {
    const s = game();
    s.pieces.buildings[TIP] = { owner: 0, kind: 'settlement' };
    setHand(s, 0, { lumber: 1, wool: 1 });
    const t = expectOk(applyAction(s, build(OPEN_SEA)));
    expect(seaSlice(t).ships[OPEN_SEA]).toEqual({ owner: 0 });
    expect(t.players[0]?.resources.lumber).toBe(0);
    expectConserved(t);
    expect(shipsLeft(t, 0)).toBe(14);
    expectFail(applyAction(t, build(COAST_S)), /afford/);
  });

  it('is legal in the special build phase too', () => {
    const s = game();
    s.pieces.buildings[TIP] = { owner: 1, kind: 'settlement' };
    setHand(s, 1, { lumber: 1, wool: 1 });
    s.turn.current = 1;
    s.phase = { kind: 'specialBuild', builder: 1, owner: 0 };
    expect(legalActions(s, 1).some((a) => a.type === 'seafarers/buildShip')).toBe(true);
  });

  it('a ship reaching another coast lets you settle there (§3.6), distance rule across water (FAQ #11)', () => {
    const s = game();
    s.pieces.buildings[TIP_W] = { owner: 0, kind: 'settlement' };
    ship(s, 0, COAST_S);
    setHand(s, 0, { brick: 1, lumber: 1, wool: 1, grain: 1 });
    // TIP is next to TIP_W (distance rule).
    expectFail(applyAction(s, { type: 'buildSettlement', player: 0, vertex: TIP }));
    // Two shores one sea edge apart: a building on one closes the other.
    const t = game();
    const topo = topologyOf(t);
    const strait = topo.seaEdges.find((e) => {
      const [a, b] = graph(t).ends.get(e) ?? [];
      return a !== undefined && b !== undefined && touchesLand(t, a) && touchesLand(t, b);
    });
    const [a, b] = strait ? (graph(t).ends.get(strait) ?? []) : [];
    if (!a || !b) throw new Error('no strait on this map');
    expect(isVertexOpen(t, b)).toBe(true);
    t.pieces.buildings[a] = { owner: 1, kind: 'settlement' };
    expect(isVertexOpen(t, b)).toBe(false);
  });
});

describe('moving ships (§3.4, FAQ #12-#14, #18)', () => {
  function chain(): GameState {
    const s = game();
    s.pieces.buildings[TIP_W] = { owner: 0, kind: 'settlement' };
    ship(s, 0, COAST_S, OPEN_SEA);
    return s;
  }

  it('the open end ship moves once per turn, free, to any legal ship spot', () => {
    const s = chain();
    expect(canMoveShip(s, 0, OPEN_SEA)).toBe(true);
    expect(canMoveShip(s, 0, COAST_S)).toBe(false); // both ends touch your pieces
    const picked = expectOk(
      applyAction(s, { type: 'seafarers/pickShip', player: 0, edge: OPEN_SEA }),
    );
    expect(picked.phase.kind).toBe('seafarers/moveShip');
    const to = COAST_SE;
    const moved = expectOk(
      applyAction(picked, { type: 'seafarers/moveShip', player: 0, edge: to }),
    );
    expect(seaSlice(moved).ships[OPEN_SEA]).toBeUndefined();
    expect(seaSlice(moved).ships[to]).toEqual({ owner: 0 });
    expect(moved.phase.kind).toBe('main');
    expectFail(applyAction(moved, { type: 'seafarers/pickShip', player: 0, edge: to }), /already/);
  });

  it('a ship built this turn stays put', () => {
    const s = game();
    s.pieces.buildings[TIP_W] = { owner: 0, kind: 'settlement' };
    ship(s, 0, COAST_S);
    setHand(s, 0, { lumber: 1, wool: 1 });
    const t = expectOk(applyAction(s, build(OPEN_SEA)));
    expect(canMoveShip(t, 0, OPEN_SEA)).toBe(false);
  });

  it('cancel puts the ship back', () => {
    const s = chain();
    const picked = expectOk(
      applyAction(s, { type: 'seafarers/pickShip', player: 0, edge: OPEN_SEA }),
    );
    const back = expectOk(applyAction(picked, { type: 'seafarers/cancelMove', player: 0 }));
    expect(back.phase.kind).toBe('main');
    expect(seaSlice(back).moved).toBe(false);
  });

  it('a ship next to the pirate cannot move away', () => {
    const s = chain();
    seaSlice(s).pirate = H(3, 9);
    expect(canMoveShip(s, 0, OPEN_SEA)).toBe(false);
  });

  it('no ship moves in the special build phase', () => {
    const s = chain();
    s.phase = { kind: 'specialBuild', builder: 0, owner: 1 };
    expect(legalActions(s, 0).some((a) => a.type === 'seafarers/pickShip')).toBe(false);
  });

  it('closed: a route joining two of your buildings; it stays closed (FAQ #14, #18a)', () => {
    const s = chain();
    // Close the route at the far end of OPEN_SEA with a settlement (on the next island's coast
    // in a real game; here any vertex works for the route rule).
    const [a, b] = graph(s).ends.get(OPEN_SEA) ?? [];
    const far = a === TIP ? b : a;
    if (!far) throw new Error('no far end');
    s.pieces.buildings[far] = { owner: 0, kind: 'settlement' };
    markClosedRoutes(s);
    expect(seaSlice(s).ships[OPEN_SEA]?.closed).toBe(true);
    expect(seaSlice(s).ships[COAST_S]?.closed).toBe(true);
    // An opponent settles in the middle: the ships stay closed.
    delete s.pieces.buildings[far];
    s.pieces.buildings[TIP] = { owner: 1, kind: 'settlement' };
    markClosedRoutes(s);
    expect(seaSlice(s).ships[OPEN_SEA]?.closed).toBe(true);
    expect(canMoveShip(s, 0, OPEN_SEA)).toBe(false);
  });

  it('a dead-end branch and a route to one settlement stay open (FAQ #18b, Q6)', () => {
    const s = chain();
    markClosedRoutes(s);
    expect(seaSlice(s).ships[COAST_S]?.closed).toBeUndefined();
    expect(seaSlice(s).ships[OPEN_SEA]?.closed).toBeUndefined();
  });
});

describe('Longest Trade Route (§3.5, FAQ #12, #16)', () => {
  it('counts roads and ships joined at your own settlement', () => {
    const s = game();
    // Road along (2,8)'s west coast to TIP_W, settlement at TIP_W, ships beyond.
    s.pieces.buildings[TIP_W] = { owner: 0, kind: 'settlement' };
    s.pieces.roads[E(2, 8, 'SW')] = 0;
    ship(s, 0, COAST_S, OPEN_SEA);
    expect(tradeRouteLength(s, 0)).toBe(3);
    // Without the settlement the road and the ships do not join (F16).
    delete s.pieces.buildings[TIP_W];
    expect(tradeRouteLength(s, 0)).toBe(2);
  });

  it('a 5-long ship route takes the award (2 VP)', () => {
    let s = game();
    s.pieces.buildings[TIP_W] = { owner: 0, kind: 'settlement' };
    ship(s, 0, COAST_S, OPEN_SEA);
    setHand(s, 0, { lumber: 3, wool: 3 });
    // Extend the route three more times.
    for (let i = 0; i < 3; i++) {
      const next = legalActions(s, 0).find(
        (a) =>
          a.type === 'seafarers/buildShip' &&
          tradeRouteLength(expectOk(applyAction(s, a)), 0) === 3 + i,
      );
      if (!next) throw new Error('no extension');
      s = expectOk(applyAction(s, next));
    }
    expect(tradeRouteLength(s, 0)).toBe(5);
    expect(s.awards.longestRoad).toBe(0);
  });
});

describe('Road Building (§3.3, FAQ #1)', () => {
  it('two ships, or a road and a ship', () => {
    const s = game();
    s.pieces.buildings[TIP] = { owner: 0, kind: 'settlement' };
    s.players[0]!.devCards.roadBuilding = 1;
    let t = expectOk(applyAction(s, { type: 'playRoadBuilding', player: 0 }));
    expect(t.phase).toMatchObject({ kind: 'roadBuilding', remaining: 2 });
    t = expectOk(
      applyAction(t, { type: 'seafarers/placeFreeShip', player: 0, edge: OPEN_SEA } as Action),
    );
    expect(t.phase).toMatchObject({ kind: 'roadBuilding', remaining: 1 });
    t = expectOk(applyAction(t, { type: 'placeFreeRoad', player: 0, edge: E(2, 8, 'S') }));
    expect(t.phase.kind).toBe('main');
    expect(t.pieces.roads[COAST_S]).toBe(0);
  });

  it('playable with only ship spots left', () => {
    const s = game();
    s.pieces.buildings[TIP] = { owner: 0, kind: 'settlement' };
    // Block both road edges at TIP: one with an own ship, the other with an opponent's road.
    ship(s, 0, COAST_S);
    s.pieces.roads[COAST_SE] = 1;
    s.players[0]!.devCards.roadBuilding = 1;
    expect(legalActions(s, 0).some((a) => a.type === 'playRoadBuilding')).toBe(true);
    const t = expectOk(applyAction(s, { type: 'playRoadBuilding', player: 0 }));
    expect(t.phase).toMatchObject({ kind: 'roadBuilding', remaining: 2 });
  });
});

describe('starting with a ship (§2.1, FAQ #5)', () => {
  it('a coastal starting settlement may take a ship instead of a road', () => {
    let s = seaGame('newShores', 4);
    seaSlice(s).pirate = H(3, -1);
    s = run(s, { type: 'placeSetupSettlement', player: 0, vertex: TIP });
    const ships = legalActions(s, 0).filter((a) => a.type === 'seafarers/placeSetupShip');
    expect(ships.length).toBeGreaterThan(0);
    const t = expectOk(applyAction(s, ships[0] as Action));
    expect(Object.keys(seaSlice(t).ships)).toHaveLength(1);
    expect(t.phase).toMatchObject({ kind: 'setup', index: 1, step: 'settlement' });
  });

  it('never next to the pirate', () => {
    let s = seaGame('newShores', 4);
    seaSlice(s).pirate = H(3, 9);
    s = run(s, { type: 'placeSetupSettlement', player: 0, vertex: TIP });
    const ships = legalActions(s, 0).filter((a) => a.type === 'seafarers/placeSetupShip');
    expect(ships.map((a) => ('edge' in a ? a.edge : null))).toEqual([COAST_S]);
  });

  it('starting settlements go on the main island', () => {
    const s = seaGame('newShores', 4);
    const small = V(6, 2, 'NE'); // the ore 8 small island
    expectFail(
      applyAction(s, { type: 'placeSetupSettlement', player: 0, vertex: small }),
      /main island/,
    );
    expect(
      legalActions(s, 0).some((a) => a.type === 'placeSetupSettlement' && a.vertex === small),
    ).toBe(false);
  });
});
