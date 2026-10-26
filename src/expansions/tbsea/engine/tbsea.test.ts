/**
 * Traders & Barbarians + Seafarers (the 2025 sheets, docs/rules/combos.md §3): one test per
 * combined rule, plus the T&B FAQ items about Seafarers (6, 19, 20, 40, 53, 58, 65).
 */
import { describe, expect, it } from 'vitest';
import { legalActions } from '../../../engine/engine';
import { eventTasks } from '../../../engine/actions/events';
import { cloneState } from '../../../engine/clone';
import { NO_ROBBER } from '../../../engine/expansions/ext';
import { graphOf } from '../../../engine/expansions/seaGraph';
import { longestRoadLengths } from '../../../engine/rules/longestRoad';
import { topologyOf } from '../../../engine/topology';
import type { Action, EdgeId, GameState, PlayerId, VertexId } from '../../../engine/types';
import { pirateTargets } from '../../seafarers/engine/actions';
import { graph, isShipEdge } from '../../seafarers/engine/geometry';
import { OFF_BOARD } from '../../seafarers/engine/maps';
import { seaSlice } from '../../seafarers/engine/state';
import {
  baOf,
  camelOptions,
  caravansOf,
  fishOf,
  goldOf,
  stepCost,
  tbBoard,
  tbSlice,
  tradersOf,
  wagonSteps,
} from '../../tb/engine';
import { pathEdges, pathEnds } from '../../tb/engine/paths';
import { edgeOnRiver, isBridgeSite } from '../../tb/engine/rivers';
import { anchored, FISH_PIRATE, FISH_SHIP, tbseaModule } from '.';
import { act, fails, give, legalOf, main, players, run } from './testkit';
import { createGame } from '../../../engine/createGame';

const SHIP_COST = { lumber: 1, wool: 1 };
const ship = (s: GameState, e: EdgeId, owner: PlayerId) => (seaSlice(s).ships[e] = { owner });
const settle = (
  s: GameState,
  v: VertexId,
  owner: PlayerId,
  kind: 'settlement' | 'city' = 'settlement',
) => (s.pieces.buildings[v] = { owner, kind });
const seaOnly = (s: GameState, e: EdgeId) => topologyOf(s).seaEdge[e] !== undefined;
const otherEnd = (s: GameState, e: EdgeId, v: VertexId) =>
  (graph(s).ends.get(e) ?? []).find((x) => x !== v) as VertexId;

/** A simple path of `n` edges from `start`, each passing `ok` (depth-first, first found). */
function pathFrom(s: GameState, start: VertexId, n: number, ok: (e: EdgeId) => boolean): EdgeId[] {
  const g = graph(s);
  const seen = new Set<VertexId>([start]);
  const walk = (v: VertexId, acc: EdgeId[]): EdgeId[] | null => {
    if (acc.length === n) return acc;
    for (const e of g.edgesAt.get(v) ?? []) {
      const w = otherEnd(s, e, v);
      if (seen.has(w) || !ok(e)) continue;
      seen.add(w);
      const r = walk(w, [...acc, e]);
      if (r) return r;
      seen.delete(w);
    }
    return null;
  };
  const out = walk(start, []);
  if (!out) throw new Error(`no ${n}-edge path from ${start}`);
  return out;
}

const afterProduction = (s: GameState, roll: number): GameState => {
  const d = cloneState(s);
  d.phase = tbseaModule.hooks?.afterProduction?.(d, roll, []) ?? { kind: 'main' };
  return d;
};

// ---------------------------------------------------------------------------------------------

describe('Traders & Barbarians + Seafarers', () => {
  /** On the composed board: v:1,1,S is a coast corner of the main island (h:0,2 / h:1,2 / sea). */
  const COAST: VertexId = 'v:1,1,S';
  const COAST_EDGE: EdgeId = 'e:0,2,NE';

  it('a wagon crosses open sea at 2 MP per edge', () => {
    const s = main('tbsea/traders');
    const e = pathEdges(s).find((x) => seaOnly(s, x)) as EdgeId;
    const [a, b] = pathEnds(s, e) as [VertexId, VertexId];
    tradersOf(s).wagons[0] = a;
    expect(stepCost(s, 0, e)).toEqual({ mp: 2, toll: null });
    expect(wagonSteps(s, 0)).toContainEqual({ vertex: b, edge: e });
    // Edges of the frame (between two frame cells) are no paths, as they are no ship edges.
    const t = topologyOf(s);
    const frame = graphOf(t).edges.filter((x) =>
      (graphOf(t).sides.get(x) ?? []).every((h) => (t.water[h]?.neighbors.length ?? 6) < 6),
    );
    expect(frame.length).toBeGreaterThan(0);
    for (const x of frame) {
      expect(isShipEdge(s, x)).toBe(false);
      expect(pathEdges(s)).not.toContain(x);
    }
  });

  it('1 MP on your own ship; 1 MP + 1 gold to the owner on another player’s ship', () => {
    const s = main('tbsea/traders');
    tradersOf(s).wagons[0] = COAST;
    ship(s, COAST_EDGE, 0);
    expect(stepCost(s, 0, COAST_EDGE)).toEqual({ mp: 1, toll: null });
    ship(s, COAST_EDGE, 1);
    expect(stepCost(s, 0, COAST_EDGE)).toEqual({ mp: 1, toll: 1 });
    const gold = [goldOf(s, 0), goldOf(s, 1)];
    const to = otherEnd(s, COAST_EDGE, COAST);
    const t = run(s, act('tb/startWagon', 0, { vertex: to }));
    expect(tradersOf(t).wagons[0]).toBe(to);
    expect([goldOf(t, 0), goldOf(t, 1)]).toEqual([(gold[0] ?? 0) - 1, (gold[1] ?? 0) + 1]);
  });

  it('a wagon moves from a road onto a ship with no settlement between (FAQ 65)', () => {
    const s = main('tbsea/traders');
    const land = 'e:0,2,E' as EdgeId; // h:0,2 | h:1,2, ends at the coast corner COAST
    expect(pathEnds(s, land)).toContain(COAST);
    s.pieces.roads[land] = 0;
    ship(s, COAST_EDGE, 0);
    tradersOf(s).wagons[0] = otherEnd(s, land, COAST);
    const t = run(
      s,
      act('tb/startWagon', 0, { vertex: COAST }),
      act('tb/wagonStep', 0, { vertex: otherEnd(s, COAST_EDGE, COAST) }),
    );
    expect(tradersOf(t).move.mp).toBe(tradersOf(s).move.mp - 2);
  });

  it('a Knight or a 7 may put a barbarian on a sea edge; it robs the ship’s owner', () => {
    const s = main('tbsea/traders');
    const e = pathEdges(s).find((x) => seaOnly(s, x)) as EdgeId;
    s.phase = {
      kind: 'tb/barbarian',
      from: tradersOf(s).barbarians[0],
      steal: true,
      resume: 'main',
    } as unknown as GameState['phase'];
    expect(legalOf(s, 'tb/placeBarbarian').map((a) => (a as { edge?: string }).edge)).toContain(e);
    ship(s, e, 1);
    give(s, 1, { ore: 1 });
    const t = run(s, act('tb/placeBarbarian', 0, { edge: e }));
    expect(tradersOf(t).barbarians).toContain(e);
    expect(t.players[0]?.resources.ore).toBe(1);
    expect(t.players[1]?.resources.ore).toBe(0);
  });

  it('no robber, no pirate, no Longest Trade Route', () => {
    const s = main('tbsea/traders');
    expect(s.robber).toBe(NO_ROBBER);
    expect(seaSlice(s).pirate).toBeNull();
    settle(s, COAST, 0);
    for (const e of pathFrom(s, COAST, 6, (x) => isShipEdge(s, x))) ship(s, e, 0);
    expect(longestRoadLengths(s)).toEqual([0, 0, 0, 0]);
    s.phase = { kind: 'moveRobber', resume: 'main' };
    expect(legalOf(s, 'seafarers/movePirate')).toHaveLength(0);
  });

  it('ships carry wagons only in Traders & Barbarians (routeEdges)', () => {
    const f = main('tbsea/fishermen');
    ship(f, COAST_EDGE, 0);
    expect(tbseaModule.hooks?.routeEdges?.(f, 0)).toEqual([]);
    const s = main('tbsea/traders');
    ship(s, COAST_EDGE, 0);
    expect(tbseaModule.hooks?.routeEdges?.(s, 0)).toEqual([COAST_EDGE]);
  });
});

// ---------------------------------------------------------------------------------------------

describe('Fishermen + Seafarers', () => {
  it('2 fish chase the pirate off the board; it comes back with the next 7', () => {
    const s = main('tbsea/fishermen');
    fishOf(s).hands[0] = [2];
    expect(FISH_PIRATE).toBe(2);
    expect(legalOf(s, 'tbsea/fishPirate')).toHaveLength(1);
    const t = run(s, act('tbsea/fishPirate', 0));
    expect(seaSlice(t).pirate).toBe(OFF_BOARD);
    expect(fishOf(t).hands[0]).toEqual([]);
    expect(fishOf(t).spent).toContain(2);
    fishOf(t).hands[0] = [3];
    fails(t, act('tbsea/fishPirate', 0), /not on the board/);
    t.phase = { kind: 'moveRobber', resume: 'main' };
    expect(legalOf(t, 'seafarers/movePirate').length).toBeGreaterThan(0);
  });

  it('needs the fish, on your own turn', () => {
    const s = main('tbsea/fishermen');
    fishOf(s).hands[0] = [1];
    fails(s, act('tbsea/fishPirate', 0), /needs 2 fish/);
    fishOf(s).hands[1] = [3];
    fails(s, act('tbsea/fishPirate', 1), /not your turn/);
  });

  it('5 fish build a free ship when no road fits', () => {
    const s = main('tbsea/fishermen');
    const coast: VertexId = 'v:1,1,S';
    settle(s, coast, 0);
    // All 15 roads are on the board: the 5-fish road is impossible, a ship is not.
    const far = topologyOf(s)
      .edges.filter((e) => !pathEnds(s, e).includes(coast))
      .slice(0, 15);
    for (const e of far) s.pieces.roads[e] = 0;
    fishOf(s).hands[0] = [3, 2];
    expect(FISH_SHIP).toBe(5);
    expect(legalOf(s, 'tb/fish').filter((a) => (a as { use?: string }).use === 'road')).toEqual([]);
    expect(legalOf(s, 'tbsea/fishShip')).toHaveLength(1);
    const t = run(s, act('tbsea/fishShip', 0));
    expect(t.phase.kind).toBe('roadBuilding');
    const free = legalOf(t, 'seafarers/placeFreeShip')[0] as Action;
    expect(free).toBeDefined();
    const u = run(t, free);
    expect(u.phase.kind).toBe('main');
    expect(Object.values(seaSlice(u).ships).filter((x) => x.owner === 0)).toHaveLength(1);
  });

  it('with a road possible, the 5 fish open Road Building as in T&B (a ship may go there too)', () => {
    const s = main('tbsea/fishermen');
    settle(s, 'v:1,1,S', 0);
    fishOf(s).hands[0] = [3, 2];
    expect(legalOf(s, 'tbsea/fishShip')).toHaveLength(0);
    const t = run(s, act('tb/fish', 0, { use: 'road' }));
    expect(legalOf(t, 'seafarers/placeFreeShip').length).toBeGreaterThan(0);
  });

  it('the pirate may sit on a fishing ground and blocks it', () => {
    const s = main('tbsea/fishermen');
    const g = tbBoard(s).grounds?.[0];
    if (!g?.hex) throw new Error('no ground');
    settle(s, g.vertices[0] as VertexId, 1);
    seaSlice(s).pirate = g.hex;
    expect(fishOf(afterProduction(s, g.number)).hands[1]).toEqual([]);
    seaSlice(s).pirate = OFF_BOARD;
    expect(fishOf(afterProduction(s, g.number)).hands[1]).toHaveLength(1);
    // The pirate can be moved there.
    seaSlice(s).pirate = tbBoard(s).grounds?.[1]?.hex ?? null;
    expect(pirateTargets(s, 0)).toContain(g.hex);
  });

  it('ships do not catch fish', () => {
    const s = main('tbsea/fishermen');
    const g = tbBoard(s).grounds?.[0];
    if (!g) throw new Error('no ground');
    const tip = g.vertices[0] as VertexId;
    for (const e of graph(s).edgesAt.get(tip) ?? []) if (isShipEdge(s, e)) ship(s, e, 2);
    const t = afterProduction(s, g.number);
    expect(fishOf(t).hands[2]).toEqual([]);
  });

  it('a roll pays fish and lets gold-field owners pick, in one step', () => {
    const s = main('tbsea/fishermen');
    const g = tbBoard(s).grounds?.[0];
    if (!g) throw new Error('no ground');
    settle(s, g.vertices[0] as VertexId, 1);
    const goldHex = Object.values(s.board.hexes).find((h) => h.terrain === 'gold');
    if (!goldHex) throw new Error('no gold');
    goldHex.token = g.number;
    const gv = topologyOf(s).hex[goldHex.id]?.vertices[0] as VertexId;
    settle(s, gv, 2);
    seaSlice(s).pirate = OFF_BOARD;
    const t = afterProduction(s, g.number);
    expect(fishOf(t).hands[1]).toHaveLength(1);
    expect(t.phase.kind).toBe('seafarers/gold');
  });
});

// ---------------------------------------------------------------------------------------------

describe('Rivers + Seafarers', () => {
  const riverShipEdge = (s: GameState): EdgeId =>
    graph(s).edges.find(
      (e) => isShipEdge(s, e) && edgeOnRiver(s, e) && !isBridgeSite(s, e),
    ) as EdgeId;

  it('no ship on a bridge site (the 2025 sheet; FAQ 58 allowed it)', () => {
    const s = main('tbsea/rivers');
    const site = (tbBoard(s).bridgeSites ?? []).find((e) => isShipEdge(s, e)) as EdgeId;
    expect(site).toBeDefined();
    const v = graph(s).ends.get(site)?.[0] as VertexId;
    settle(s, v, 0);
    give(s, 0, SHIP_COST);
    const builds = legalOf(s, 'seafarers/buildShip').map((a) => (a as { edge?: string }).edge);
    expect(builds.length).toBeGreaterThan(0);
    expect(builds).not.toContain(site);
    fails(s, act('seafarers/buildShip', 0, { edge: site }), /bridge site/);
  });

  it('a ship built on a river hex’s edge earns 1 gold, elsewhere nothing', () => {
    const s = main('tbsea/rivers');
    const e = riverShipEdge(s);
    const v = graph(s).ends.get(e)?.[0] as VertexId;
    settle(s, v, 0);
    give(s, 0, { lumber: 2, wool: 2 });
    const t = run(s, act('seafarers/buildShip', 0, { edge: e }));
    expect(goldOf(t, 0)).toBe(1);
    const dry = legalOf(t, 'seafarers/buildShip').find(
      (a) => !edgeOnRiver(t, (a as unknown as { edge: EdgeId }).edge),
    ) as Action;
    expect(goldOf(run(t, dry), 0)).toBe(1);
  });

  it('a setup ship on a river hex’s edge earns 1 gold, like a setup road', () => {
    let s = createGame({
      seed: 3,
      players: players(3),
      mode: 'tb+seafarers',
      scenario: 'tbsea/rivers',
      startingPlayer: 0,
    });
    const e = riverShipEdge(s);
    const v = (graph(s).ends.get(e) ?? []).find((x) =>
      legalActions(s).some((a) => a.type === 'placeSetupSettlement' && a.vertex === x),
    ) as VertexId;
    expect(v).toBeDefined();
    const before = goldOf(s, 0);
    s = run(s, { type: 'placeSetupSettlement', player: 0, vertex: v });
    const mid = goldOf(s, 0);
    s = run(s, act('seafarers/placeSetupShip', 0, { edge: e }));
    expect(goldOf(s, 0)).toBe(mid + 1);
    expect(mid).toBeGreaterThanOrEqual(before);
  });

  it('regression (sim seed 55): Road Building ends when only bridge sites are left for ships', () => {
    const s = main('tbsea/rivers');
    const site = (tbBoard(s).bridgeSites ?? []).find((e) => isShipEdge(s, e)) as EdgeId;
    const v = graph(s).ends.get(site)?.[0] as VertexId;
    settle(s, v, 0);
    // No road left to place; every other ship spot at the settlement is taken by player 1.
    const far = topologyOf(s)
      .edges.filter((e) => !pathEnds(s, e).includes(v))
      .slice(0, 15);
    for (const e of far) s.pieces.roads[e] = 0;
    for (const e of graph(s).edgesAt.get(v) ?? [])
      if (e !== site && isShipEdge(s, e)) ship(s, e, 1);
    s.players[0]!.devCards.roadBuilding = 1;
    expect(legalOf(s, 'playRoadBuilding')).toHaveLength(0);
    s.phase = { kind: 'roadBuilding', remaining: 1, resume: 'main' };
    expect(legalActions(s)).toHaveLength(0);
    const d = cloneState(s);
    tbseaModule.hooks?.afterAction?.(d, act('seafarers/placeFreeShip', 0));
    expect(d.phase.kind).toBe('main');
  });

  it('moving a ship away from a river hex’s edge costs 1 gold', () => {
    const s = main('tbsea/rivers');
    const e = riverShipEdge(s);
    const [v] = graph(s).ends.get(e) as [VertexId, VertexId];
    settle(s, v, 0);
    ship(s, e, 0);
    expect(legalOf(s, 'seafarers/pickShip')).toHaveLength(0);
    fails(s, act('seafarers/pickShip', 0, { edge: e }), /costs 1 gold/);
    tbSlice(s).gold[0] = 1;
    const t = run(s, act('seafarers/pickShip', 0, { edge: e }));
    const to = legalOf(t, 'seafarers/moveShip').find(
      (a) => (a as unknown as { edge: EdgeId }).edge !== e,
    ) as Action;
    const u = run(t, to);
    expect(goldOf(u, 0)).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------

describe('Caravans + Seafarers', () => {
  it('a camel may go on a sea edge, with a ship on it or not', () => {
    const s = main('tbsea/caravans');
    const e = pathEdges(s).find((x) => seaOnly(s, x)) as EdgeId;
    const [a] = pathEnds(s, e) as [VertexId];
    caravansOf(s).heads[0] = a;
    expect(camelOptions(s).map((c) => c.edge)).toContain(e);
    ship(s, e, 2);
    expect(camelOptions(s).map((c) => c.edge)).toContain(e);
  });

  it('a camel on a ship counts it as one more ship for the trade route (FAQ 40)', () => {
    const s = main('tbsea/caravans');
    const coast: VertexId = 'v:1,1,S';
    settle(s, coast, 0);
    const ships = pathFrom(s, coast, 3, (e) => isShipEdge(s, e));
    for (const e of ships) ship(s, e, 0);
    expect(longestRoadLengths(s)[0]).toBe(3);
    caravansOf(s).camels.push({ edge: ships[1] as EdgeId, head: coast, caravan: 0 });
    expect(longestRoadLengths(s)[0]).toBe(4);
  });
});

// ---------------------------------------------------------------------------------------------

describe('Barbarian Attack + Seafarers', () => {
  /** Conquer the coast hex `h` (3 barbarians). */
  const conquer = (s: GameState, h: string) => (baOf(s).onHex[h as never] = 3);

  /** A coast hex of the main island and its outer corner (only that hex is land there). */
  function outerCorner(s: GameState): { hex: string; corner: VertexId } {
    const t = topologyOf(s);
    for (const h of tbBoard(s).coast ?? []) {
      const v = t.hex[h]?.vertices.find((x) => t.vertex[x]?.hexes.length === 1);
      if (v) return { hex: h, corner: v };
    }
    throw new Error('no outer corner');
  }

  it('no robber and no pirate', () => {
    const s = main('tbsea/barbarianAttack');
    expect(s.robber).toBe(NO_ROBBER);
    expect(seaSlice(s).pirate).toBeNull();
  });

  it('ships may be built on the edges of conquered hexes (roads may not)', () => {
    const s = main('tbsea/barbarianAttack');
    const t = topologyOf(s);
    // A coast corner touching a conquered hex and an unconquered one.
    const h = tbBoard(s).coast?.[0] as string;
    conquer(s, h);
    const v = t.hex[h as never]?.vertices.find(
      (x) => t.vertex[x]?.hexes.length === 2 && t.vertex[x]?.coastal,
    ) as VertexId;
    settle(s, v, 0);
    give(s, 0, { ...SHIP_COST, brick: 1, lumber: 2 });
    const side = (graph(s).edgesAt.get(v) ?? []).find(
      (e) => isShipEdge(s, e) && (graph(s).sides.get(e) ?? []).includes(h as never),
    ) as EdgeId;
    expect(legalOf(s, 'seafarers/buildShip').map((a) => (a as { edge?: string }).edge)).toContain(
      side,
    );
    expect(legalOf(s, 'buildRoad').map((a) => (a as { edge?: string }).edge)).not.toContain(side);
    run(s, act('seafarers/buildShip', 0, { edge: side }));
  });

  it('a route may only grow from an unconquered building', () => {
    const s = main('tbsea/barbarianAttack');
    const { hex, corner } = outerCorner(s);
    settle(s, corner, 0);
    give(s, 0, SHIP_COST);
    const sea = (graph(s).edgesAt.get(corner) ?? []).find((e) => seaOnly(s, e)) as EdgeId;
    expect(anchored(s, 0, sea)).toBe(true);
    conquer(s, hex);
    expect(anchored(s, 0, sea)).toBe(false);
    expect(legalOf(s, 'seafarers/buildShip')).toHaveLength(0);
    fails(s, act('seafarers/buildShip', 0, { edge: sea }), /unconquered/);
    // An existing ship there may not be moved either.
    ship(s, sea, 0);
    const far = otherEnd(s, sea, corner);
    const next = (graph(s).edgesAt.get(far) ?? []).find(
      (e) => e !== sea && seaOnly(s, e),
    ) as EdgeId;
    ship(s, next, 0);
    fails(s, act('seafarers/pickShip', 0, { edge: next }), /unconquered/);
  });

  it('a conquered settlement interrupts the trade route (FAQ 6)', () => {
    const s = main('tbsea/barbarianAttack');
    const { hex, corner } = outerCorner(s);
    settle(s, corner, 0);
    const t = topologyOf(s);
    const roads = pathFrom(s, corner, 3, (e) => t.hex[hex as never]?.edges.includes(e) ?? false);
    for (const e of roads) s.pieces.roads[e] = 0;
    const ships = pathFrom(s, corner, 3, (e) => seaOnly(s, e));
    for (const e of ships) ship(s, e, 0);
    expect(longestRoadLengths(s)[0]).toBe(6);
    conquer(s, hex);
    expect(longestRoadLengths(s)[0]).toBe(3);
  });

  it('regression (sim seed 55): a conquest by Treason moves the Longest Trade Route at once', () => {
    const s = main('tbsea/barbarianAttack');
    const { hex, corner } = outerCorner(s);
    settle(s, corner, 0);
    const t = topologyOf(s);
    for (const e of pathFrom(s, corner, 3, (e) => t.hex[hex as never]?.edges.includes(e) ?? false))
      s.pieces.roads[e] = 0;
    for (const e of pathFrom(s, corner, 3, (e) => seaOnly(s, e))) ship(s, e, 0);
    // Player 1: a 5-ship route from a settlement on another coast corner.
    const other = (tbBoard(s).coast ?? [])
      .flatMap((h) => t.hex[h as never]?.vertices ?? [])
      .find((v) => t.vertex[v]?.hexes.length === 1 && !t.hex[hex as never]?.vertices.includes(v));
    settle(s, other as VertexId, 1);
    for (const e of pathFrom(
      s,
      other as VertexId,
      5,
      (e) => seaOnly(s, e) && !seaSlice(s).ships[e],
    ))
      ship(s, e, 1);
    s.awards.longestRoad = 0;
    baOf(s).onHex[hex as never] = 2;
    s.phase = {
      kind: 'tb/treason',
      left: 1,
      from: 'supply',
      sources: [],
      dests: [],
      resume: 'main',
    } as unknown as GameState['phase'];
    const u = run(s, act('tb/treasonHex', 0, { hex }));
    expect(longestRoadLengths(u).slice(0, 2)).toEqual([3, 5]);
    expect(u.awards.longestRoad).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------

describe('T&B variants with Seafarers (FAQ 19, 20, 53)', () => {
  const sea = (extra: Record<string, unknown> = {}): GameState => {
    const s = createGame({
      seed: 3,
      players: players(4),
      mode: 'seafarers',
      scenario: 'seafarers/newShores',
      startingPlayer: 0,
      ...extra,
    });
    s.pieces.buildings = {};
    s.pieces.roads = {};
    s.turn = { number: 3, current: 0, devCardPlayed: false, tradeOffers: 0 };
    s.phase = { kind: 'main' };
    return s;
  };

  it('the friendly robber makes the pirate friendly too (FAQ 53)', () => {
    const s = sea({ robberMode: 'friendly' });
    const water = topologyOf(s).waterHexes.find((h) => topologyOf(s).water[h]?.playable);
    if (!water) throw new Error('no sea');
    const e = topologyOf(s).water[water]?.edges.find((x) => isShipEdge(s, x)) as EdgeId;
    ship(s, e, 1);
    expect(pirateTargets(s, 0)).not.toContain(water);
    // Player 1 at 3+ points: the pirate may go there again; the mover's own ships never stop it.
    const land = Object.keys(topologyOf(s).vertex).slice(0, 2) as VertexId[];
    for (const v of land) settle(s, v, 1, 'city');
    expect(pirateTargets(s, 0)).toContain(water);
    const plain = sea();
    ship(plain, e, 1);
    expect(pirateTargets(plain, 0)).toContain(water);
    ship(plain, e, 0);
    const friendly = sea({ robberMode: 'friendly' });
    ship(friendly, e, 0);
    expect(pirateTargets(friendly, 0)).toContain(water);
  });

  it('a damaged road (Earthquake) stops roads, not ships (FAQ 19)', () => {
    const s = sea({ eventCards: true });
    const coast: VertexId = 'v:1,1,S';
    settle(s, coast, 0);
    const road = (topologyOf(s).vertex[coast]?.edges ?? []).find(
      (e) => !isShipEdge(s, e),
    ) as EdgeId;
    s.pieces.roads[road] = 0;
    s.damagedRoads = [road, null, null, null];
    give(s, 0, { ...SHIP_COST, brick: 1, lumber: 1 });
    expect(legalOf(s, 'buildRoad')).toHaveLength(0);
    expect(legalOf(s, 'seafarers/buildShip').length).toBeGreaterThan(0);
  });

  it('an Earthquake never damages a ship (FAQ 20)', () => {
    const s = sea({ eventCards: true });
    settle(s, 'v:1,1,S', 0);
    ship(s, 'e:0,2,NE', 0);
    expect(eventTasks(s, 'earthquake').map((t) => t.player)).not.toContain(0);
    s.pieces.roads['e:0,2,E'] = 0;
    expect(eventTasks(s, 'earthquake').map((t) => t.player)).toContain(0);
  });
});
