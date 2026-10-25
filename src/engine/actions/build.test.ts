import { describe, expect, it } from 'vitest';
import { applyAction } from '../engine';
import { cornerVertex } from '../hex';
import { freshGame, midGame, moveRobberGame } from '../fixtures';
import { emptyResources } from '../resources';
import { piecesLeft } from '../selectors';
import { edgeVertices, TOPOLOGY, vertexEdges, vertexNeighbors } from '../topology';
import type { EdgeId, GameState, VertexId } from '../types';
import { buildLegal } from './build';
import {
  emptyBoardGame,
  expectConserved,
  expectFail,
  expectOk,
  place,
  road,
  setHand,
} from './testkit';

const RICH = { brick: 5, lumber: 5, wool: 5, grain: 5, ore: 5 };
const v0 = cornerVertex(0, 0, 'N');

const otherEnd = (e: EdgeId, v: VertexId) => edgeVertices(e).find((x) => x !== v)!;

/** A path of edges starting at `from`: returns [edges, vertices] with vertices[0] = from. */
function path(from: VertexId, length: number): [EdgeId[], VertexId[]] {
  const edges: EdgeId[] = [];
  const verts: VertexId[] = [from];
  for (let i = 0; i < length; i++) {
    const at = verts.at(-1)!;
    const e = vertexEdges(at).find((x) => !edges.includes(x) && !verts.includes(otherEnd(x, at)))!;
    edges.push(e);
    verts.push(otherEnd(e, at));
  }
  return [edges, verts];
}

/** Main phase, player 0 owns a settlement at v0 and is rich. */
function buildGame(): GameState {
  const s = emptyBoardGame();
  s.phase = { kind: 'main' };
  place(s, 0, v0);
  setHand(s, 0, RICH);
  return s;
}

describe('buildRoad', () => {
  it('builds next to an own settlement and pays brick + lumber to the bank', () => {
    const s = buildGame();
    const e = vertexEdges(v0)[0]!;
    const after = expectOk(applyAction(s, { type: 'buildRoad', player: 0, edge: e }));
    expect(after.pieces.roads[e]).toBe(0);
    expect(after.players[0]!.resources).toEqual({ ...RICH, brick: 4, lumber: 4 });
    expect(after.bank.brick).toBe(s.bank.brick + 1);
    expectConserved(after);
    expect(after.log.at(-1)?.text).toBe('Red built a road');
  });

  it('extends from an own road', () => {
    const s = buildGame();
    const [[e1, e2]] = path(v0, 2);
    road(s, 0, e1!);
    expectOk(applyAction(s, { type: 'buildRoad', player: 0, edge: e2! }));
  });

  it('rejects an unconnected edge', () => {
    const s = buildGame();
    const far = TOPOLOGY.edges.find(
      (e) => !edgeVertices(e).some((v) => v === v0 || vertexNeighbors(v0).includes(v)),
    )!;
    expectFail(applyAction(s, { type: 'buildRoad', player: 0, edge: far }), /connected/);
  });

  it("an opponent's building breaks continuation through that vertex", () => {
    const s = buildGame();
    const [[e1, e2, e3], [, v1, v2]] = path(v0, 3);
    road(s, 0, e1!, e2!);
    place(s, 1, v2!);
    expectFail(applyAction(s, { type: 'buildRoad', player: 0, edge: e3! }), /connected/);
    // The other branch at v1 is still fine.
    const branch = vertexEdges(v1!).find((e) => e !== e1 && e !== e2)!;
    expectOk(applyAction(s, { type: 'buildRoad', player: 0, edge: branch }));
  });

  it("an opponent's road does not block continuation", () => {
    const s = buildGame();
    const [[e1], [, v1]] = path(v0, 1);
    road(s, 0, e1!);
    const [opp, mine] = vertexEdges(v1!).filter((e) => e !== e1);
    road(s, 1, opp!);
    expectOk(applyAction(s, { type: 'buildRoad', player: 0, edge: mine! }));
  });

  it('own building at the far end still connects', () => {
    const s = buildGame();
    const [[e1, e2, e3], [, , v2]] = path(v0, 3);
    road(s, 0, e1!, e2!);
    place(s, 0, v2!);
    expectOk(applyAction(s, { type: 'buildRoad', player: 0, edge: e3! }));
  });

  it('rejects an occupied edge', () => {
    const s = buildGame();
    const e = vertexEdges(v0)[0]!;
    road(s, 1, e);
    expectFail(applyAction(s, { type: 'buildRoad', player: 0, edge: e }));
    road(s, 0, e);
    expectFail(applyAction(s, { type: 'buildRoad', player: 0, edge: e }));
  });

  it('rejects when unaffordable', () => {
    const s = buildGame();
    setHand(s, 0, { brick: 1, wool: 3 });
    expectFail(
      applyAction(s, { type: 'buildRoad', player: 0, edge: vertexEdges(v0)[0]! }),
      /afford/,
    );
  });

  it('rejects after 15 roads', () => {
    const s = buildGame();
    const target = vertexEdges(v0)[0]!;
    const spare = TOPOLOGY.edges.filter((e) => e !== target).slice(-15);
    road(s, 0, ...spare);
    expect(piecesLeft(s, 0).road).toBe(0);
    expectFail(applyAction(s, { type: 'buildRoad', player: 0, edge: target }), /no roads left/);
    expect(buildLegal(s).some((a) => a.type === 'buildRoad')).toBe(false);
  });

  it('rejects invalid edges, wrong player, wrong phase', () => {
    const s = buildGame();
    const e = vertexEdges(v0)[0]!;
    expectFail(applyAction(s, { type: 'buildRoad', player: 0, edge: 'e:5,5,E' }), /invalid edge/);
    expectFail(applyAction(s, { type: 'buildRoad', player: 1, edge: e }), /not your turn/);
    const pre = structuredClone(s);
    pre.phase = { kind: 'preRoll' };
    expectFail(applyAction(pre, { type: 'buildRoad', player: 0, edge: e }), /main phase/);
    expectFail(applyAction(freshGame(), { type: 'buildRoad', player: 0, edge: e }), /main phase/);
  });
});

describe('buildSettlement', () => {
  /** v0 settlement + 2 roads out; returns the vertex 2 steps away (legal spot). */
  function withRoads(): [GameState, VertexId] {
    const s = buildGame();
    const [[e1, e2], [, , v2]] = path(v0, 2);
    road(s, 0, e1!, e2!);
    return [s, v2!];
  }

  it('builds on an open vertex touching an own road and pays the cost', () => {
    const [s, v2] = withRoads();
    const after = expectOk(applyAction(s, { type: 'buildSettlement', player: 0, vertex: v2 }));
    expect(after.pieces.buildings[v2]).toEqual({ owner: 0, kind: 'settlement' });
    expect(after.players[0]!.resources).toEqual({
      brick: 4,
      lumber: 4,
      wool: 4,
      grain: 4,
      ore: 5,
    });
    expectConserved(after);
  });

  it('requires an own road', () => {
    const s = buildGame();
    const [[e1, e2], [, , v2]] = path(v0, 2);
    road(s, 1, e1!, e2!);
    expectFail(applyAction(s, { type: 'buildSettlement', player: 0, vertex: v2! }), /road/);
  });

  it('enforces the distance rule', () => {
    const [s, v2] = withRoads();
    const [, [, v1]] = path(v0, 2);
    // v1 is next to the own settlement at v0.
    expectFail(applyAction(s, { type: 'buildSettlement', player: 0, vertex: v1! }), /open vertex/);
    // v2 becomes illegal once any building sits next to it.
    place(
      s,
      1,
      vertexNeighbors(v2).find((x) => x !== v1)!,
    );
    expectFail(applyAction(s, { type: 'buildSettlement', player: 0, vertex: v2 }), /open vertex/);
  });

  it('rejects an occupied vertex', () => {
    const [s, v2] = withRoads();
    place(s, 1, v2);
    expectFail(applyAction(s, { type: 'buildSettlement', player: 0, vertex: v2 }));
  });

  it('rejects when unaffordable', () => {
    const [s, v2] = withRoads();
    setHand(s, 0, { brick: 1, lumber: 1, wool: 1, ore: 4 });
    expectFail(applyAction(s, { type: 'buildSettlement', player: 0, vertex: v2 }), /afford/);
  });

  it('rejects after 5 settlements', () => {
    const [s, v2] = withRoads();
    const far = TOPOLOGY.vertices.filter((v) => v !== v2 && !vertexNeighbors(v2).includes(v));
    for (const v of far.slice(-4)) place(s, 0, v);
    expect(piecesLeft(s, 0).settlement).toBe(0);
    expectFail(
      applyAction(s, { type: 'buildSettlement', player: 0, vertex: v2 }),
      /no settlements left/,
    );
  });

  it('rejects invalid vertex, wrong player, wrong phase', () => {
    const [s, v2] = withRoads();
    expectFail(
      applyAction(s, { type: 'buildSettlement', player: 0, vertex: 'v:7,7,S' }),
      /invalid vertex/,
    );
    expectFail(applyAction(s, { type: 'buildSettlement', player: 2, vertex: v2 }), /not your/);
    const rob = structuredClone(s);
    rob.phase = { kind: 'moveRobber', resume: 'main' };
    expectFail(applyAction(rob, { type: 'buildSettlement', player: 0, vertex: v2 }), /main/);
  });
});

describe('buildCity', () => {
  it('upgrades an own settlement, pays 2 grain + 3 ore, returns the settlement piece', () => {
    const s = buildGame();
    expect(piecesLeft(s, 0)).toEqual({ road: 15, settlement: 4, city: 4 });
    const after = expectOk(applyAction(s, { type: 'buildCity', player: 0, vertex: v0 }));
    expect(after.pieces.buildings[v0]).toEqual({ owner: 0, kind: 'city' });
    expect(after.players[0]!.resources).toEqual({ ...RICH, grain: 3, ore: 2 });
    expect(piecesLeft(after, 0)).toEqual({ road: 15, settlement: 5, city: 3 });
    expectConserved(after);
    expect(after.log.at(-1)?.text).toBe('Red built a city');
  });

  it('rejects an opponent settlement, an existing city, an empty vertex', () => {
    const s = buildGame();
    const other = cornerVertex(-2, 2, 'S');
    place(s, 1, other);
    expectFail(applyAction(s, { type: 'buildCity', player: 0, vertex: other }), /your settle/);
    const city = cornerVertex(2, -2, 'N');
    place(s, 0, city, 'city');
    expectFail(applyAction(s, { type: 'buildCity', player: 0, vertex: city }), /your settle/);
    expectFail(
      applyAction(s, { type: 'buildCity', player: 0, vertex: cornerVertex(0, 2, 'S') }),
      /your settle/,
    );
  });

  it('rejects when unaffordable', () => {
    const s = buildGame();
    setHand(s, 0, { grain: 2, ore: 2 });
    expectFail(applyAction(s, { type: 'buildCity', player: 0, vertex: v0 }), /afford/);
  });

  it('rejects after 4 cities', () => {
    const s = buildGame();
    const far = TOPOLOGY.vertices.filter((v) => v !== v0).slice(-4);
    for (const v of far) place(s, 0, v, 'city');
    expectFail(applyAction(s, { type: 'buildCity', player: 0, vertex: v0 }), /no cities left/);
  });

  it('rejects invalid vertex, wrong player, wrong phase', () => {
    const s = buildGame();
    expectFail(
      applyAction(s, { type: 'buildCity', player: 0, vertex: 'nope' as VertexId }),
      /invalid/,
    );
    expectFail(applyAction(s, { type: 'buildCity', player: 3, vertex: v0 }), /not your/);
    expectFail(
      applyAction(moveRobberGame(), {
        type: 'buildCity',
        player: 1,
        vertex: cornerVertex(2, -1, 'N'),
      }),
      /main/,
    );
  });
});

describe('buildLegal', () => {
  it('lists nothing when broke', () => {
    const s = buildGame();
    setHand(s, 0, emptyResources());
    expect(buildLegal(s)).toEqual([]);
  });

  it('lists roads at the settlement, cities at each own settlement', () => {
    const s = buildGame();
    const actions = buildLegal(s);
    const roads = actions.flatMap((a) => (a.type === 'buildRoad' ? [a.edge] : []));
    expect(roads.sort()).toEqual([...vertexEdges(v0)].sort());
    expect(actions.filter((a) => a.type === 'buildCity')).toEqual([
      { type: 'buildCity', player: 0, vertex: v0 },
    ]);
    expect(actions.some((a) => a.type === 'buildSettlement')).toBe(false);
  });

  it('every listed build is accepted (midGame with a rich Blue)', () => {
    const s = midGame();
    setHand(s, 1, RICH);
    const actions = buildLegal(s);
    expect(actions.length).toBeGreaterThan(3);
    for (const a of actions) expect(applyAction(s, a).ok, JSON.stringify(a)).toBe(true);
    expect(actions.filter((a) => a.type === 'buildCity')).toHaveLength(2);
  });

  it('is empty outside main', () => {
    expect(buildLegal(freshGame())).toEqual([]);
    expect(buildLegal(moveRobberGame())).toEqual([]);
  });
});
