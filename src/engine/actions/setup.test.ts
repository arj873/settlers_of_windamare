import { describe, expect, it } from 'vitest';
import { RESOURCES } from '../constants';
import { applyAction, legalActions } from '../engine';
import { cornerVertex } from '../hex';
import { freshGame, midGame, setupInProgressGame } from '../fixtures';
import { Rng } from '../rng';
import { emptyResources, isResource } from '../resources';
import { buildingsOf, roadsOf } from '../selectors';
import { TOPOLOGY, vertexEdges, vertexHexes, vertexNeighbors } from '../topology';
import type { GameState, PlayerId, ResourceCounts, VertexId } from '../types';
import { setupLegal } from './setup';
import { expectConserved, expectFail, expectOk, run } from './testkit';

/** Play the whole setup by picking random legal actions; returns the actors and expected gains. */
function playSetup(n: 3 | 4, seed: number) {
  let s: GameState = freshGame(n);
  const rng = new Rng(seed);
  const settlers: PlayerId[] = [];
  const expected: ResourceCounts[] = s.players.map(() => emptyResources());
  while (s.phase.kind === 'setup') {
    const phase = s.phase;
    const actions = legalActions(s);
    expect(actions.length).toBeGreaterThan(0);
    for (const a of actions) expect(a.player).toBe(s.turn.current);
    const action = rng.pick(actions);
    if (action.type === 'placeSetupSettlement') {
      settlers.push(action.player);
      if (phase.index >= n) {
        for (const h of vertexHexes(TOPOLOGY, action.vertex)) {
          const t = s.board.hexes[h]!.terrain;
          if (isResource(t)) expected[action.player]![t] += 1;
        }
      }
    }
    s = expectOk(applyAction(s, action));
  }
  return { s, settlers, expected };
}

describe('full setup round', () => {
  for (const n of [3, 4] as const) {
    it(`${n} players: snake order, 2 settlements + 2 roads each, round-2 resources`, () => {
      for (const seed of [1, 2, 3]) {
        const { s, settlers, expected } = playSetup(n, seed);
        const order = [...Array(n).keys()];
        expect(settlers).toEqual([...order, ...order.slice().reverse()]);
        expect(s.phase).toEqual({ kind: 'preRoll' });
        expect(s.turn).toEqual({ number: 1, current: 0, devCardPlayed: false, tradeOffers: 0 });
        expect(s.dice).toBeNull();
        expect(s.winner).toBeNull();
        for (const p of s.players) {
          expect(buildingsOf(s, p.id, 'settlement')).toHaveLength(2);
          expect(roadsOf(s, p.id)).toHaveLength(2);
          expect(p.resources).toEqual(expected[p.id]);
        }
        expectConserved(s);
        expect(s.log.at(-1)?.text).toBe('Setup complete');
      }
    });
  }

  it('turn 1 starts with player 0 rolling', () => {
    const { s } = playSetup(4, 9);
    expect(legalActions(s)).toEqual([{ type: 'rollDice', player: 0 }]);
  });
});

describe('placeSetupSettlement', () => {
  const v0 = cornerVertex(0, 0, 'N');

  it('places a settlement and moves to the road step', () => {
    const s = run(freshGame(), { type: 'placeSetupSettlement', player: 0, vertex: v0 });
    expect(s.pieces.buildings[v0]).toEqual({ owner: 0, kind: 'settlement' });
    expect(s.phase).toEqual({ kind: 'setup', index: 0, step: 'road', lastSettlement: v0 });
    expect(s.turn.current).toBe(0);
  });

  it('round 1 gives no resources', () => {
    const s = run(freshGame(), { type: 'placeSetupSettlement', player: 0, vertex: v0 });
    expect(s.players[0]!.resources).toEqual(emptyResources());
  });

  it('round 2 gives one card per adjacent non-desert hex', () => {
    const base = setupInProgressGame(); // index 5, player 2, round 2
    const desert = TOPOLOGY.landHexes.find((h) => base.board.hexes[h]!.terrain === 'desert')!;
    const v = TOPOLOGY.vertices.find(
      (x) =>
        vertexHexes(TOPOLOGY, x).includes(desert) &&
        vertexHexes(TOPOLOGY, x).length === 3 &&
        applyAction(base, { type: 'placeSetupSettlement', player: 2, vertex: x }).ok,
    )!;
    expect(v).toBeDefined();
    const before = { ...base.players[2]!.resources };
    const s = run(base, { type: 'placeSetupSettlement', player: 2, vertex: v });
    const gain = emptyResources();
    for (const h of vertexHexes(TOPOLOGY, v)) {
      const t = s.board.hexes[h]!.terrain;
      if (isResource(t)) gain[t] += 1;
    }
    expect(RESOURCES.reduce((sum, r) => sum + gain[r], 0)).toBe(2);
    for (const r of RESOURCES) expect(s.players[2]!.resources[r]).toBe(before[r] + gain[r]);
    expectConserved(s);
  });

  it('coastal round-2 settlement on one hex gives one card', () => {
    const base = setupInProgressGame();
    const v = TOPOLOGY.vertices.find(
      (x) =>
        vertexHexes(TOPOLOGY, x).length === 1 &&
        base.board.hexes[vertexHexes(TOPOLOGY, x)[0]!]!.terrain !== 'desert' &&
        applyAction(base, { type: 'placeSetupSettlement', player: 2, vertex: x }).ok,
    )!;
    const before = base.players[2]!.resources;
    const s = run(base, { type: 'placeSetupSettlement', player: 2, vertex: v });
    const total = (h: ResourceCounts) => RESOURCES.reduce((sum, r) => sum + h[r], 0);
    expect(total(s.players[2]!.resources) - total(before)).toBe(1);
  });

  it('needs no road (setup)', () => {
    const s = freshGame();
    expect(roadsOf(s, 0)).toHaveLength(0);
    expectOk(applyAction(s, { type: 'placeSetupSettlement', player: 0, vertex: v0 }));
  });

  it('enforces the distance rule', () => {
    const s = run(
      freshGame(),
      { type: 'placeSetupSettlement', player: 0, vertex: v0 },
      { type: 'placeSetupRoad', player: 0, edge: vertexEdges(TOPOLOGY, v0)[0]! },
    );
    for (const nb of vertexNeighbors(TOPOLOGY, v0)) {
      expectFail(applyAction(s, { type: 'placeSetupSettlement', player: 1, vertex: nb }), /close/);
    }
  });

  it('rejects an occupied vertex', () => {
    const s = run(
      freshGame(),
      { type: 'placeSetupSettlement', player: 0, vertex: v0 },
      { type: 'placeSetupRoad', player: 0, edge: vertexEdges(TOPOLOGY, v0)[0]! },
    );
    expectFail(applyAction(s, { type: 'placeSetupSettlement', player: 1, vertex: v0 }));
  });

  it('rejects invalid vertex ids', () => {
    for (const vertex of ['v:9,9,N', 'garbage', 'toString', undefined]) {
      expectFail(
        applyAction(freshGame(), {
          type: 'placeSetupSettlement',
          player: 0,
          vertex: vertex as VertexId,
        }),
        /invalid vertex/,
      );
    }
  });

  it('rejects the wrong player', () => {
    expectFail(
      applyAction(freshGame(), { type: 'placeSetupSettlement', player: 1, vertex: v0 }),
      /not your turn/,
    );
  });

  it('rejects a second settlement before the road', () => {
    const s = run(freshGame(), { type: 'placeSetupSettlement', player: 0, vertex: v0 });
    expectFail(
      applyAction(s, {
        type: 'placeSetupSettlement',
        player: 0,
        vertex: cornerVertex(-2, 2, 'S'),
      }),
      /not placing/,
    );
  });

  it('is rejected outside setup', () => {
    expectFail(
      applyAction(midGame(), {
        type: 'placeSetupSettlement',
        player: 1,
        vertex: cornerVertex(0, 1, 'S'),
      }),
      /not placing/,
    );
  });
});

describe('placeSetupRoad', () => {
  const v0 = cornerVertex(0, 0, 'N');
  const afterSettlement = () =>
    run(freshGame(), { type: 'placeSetupSettlement', player: 0, vertex: v0 });

  it('places a road touching the settlement and passes to the next player', () => {
    const e = vertexEdges(TOPOLOGY, v0)[1]!;
    const s = run(afterSettlement(), { type: 'placeSetupRoad', player: 0, edge: e });
    expect(s.pieces.roads[e]).toBe(0);
    expect(s.phase).toEqual({ kind: 'setup', index: 1, step: 'settlement', lastSettlement: null });
    expect(s.turn.current).toBe(1);
    expect(s.turn.number).toBe(0);
  });

  it('the last player of round 1 places again (snake)', () => {
    let s = freshGame(3);
    for (let i = 0; i < 3; i++) {
      const [a] = setupLegal(s);
      s = run(s, a!);
      const [b] = setupLegal(s);
      s = run(s, b!);
    }
    expect(s.turn.current).toBe(2);
    expect(s.phase).toMatchObject({ kind: 'setup', index: 3, step: 'settlement' });
  });

  it('rejects an edge not touching the settlement', () => {
    expectFail(
      applyAction(afterSettlement(), {
        type: 'placeSetupRoad',
        player: 0,
        edge: TOPOLOGY.edges.find((e) => !vertexEdges(TOPOLOGY, v0).includes(e))!,
      }),
      /touching/,
    );
  });

  it('round 2: must touch the NEW settlement, not the first one', () => {
    const base = setupInProgressGame(); // player 2's first settlement at (-2,0,N)
    const first = cornerVertex(-2, 0, 'N');
    const second = cornerVertex(1, 1, 'S');
    const s = run(base, { type: 'placeSetupSettlement', player: 2, vertex: second });
    const freeAtFirst = vertexEdges(TOPOLOGY, first).find((e) => s.pieces.roads[e] === undefined)!;
    expectFail(applyAction(s, { type: 'placeSetupRoad', player: 2, edge: freeAtFirst }));
    expectOk(
      applyAction(s, {
        type: 'placeSetupRoad',
        player: 2,
        edge: vertexEdges(TOPOLOGY, second)[0]!,
      }),
    );
  });

  it('rejects an occupied edge', () => {
    // Unreachable through legal play (distance rule), so plant an opponent road directly.
    const s = afterSettlement();
    const e = vertexEdges(TOPOLOGY, v0)[0]!;
    s.pieces.roads[e] = 1;
    expectFail(applyAction(s, { type: 'placeSetupRoad', player: 0, edge: e }), /empty edge/);
    expect(setupLegal(s).map((a) => (a.type === 'placeSetupRoad' ? a.edge : null))).not.toContain(
      e,
    );
  });

  it('rejects invalid edges, wrong player, wrong step', () => {
    const s = afterSettlement();
    expectFail(
      applyAction(s, { type: 'placeSetupRoad', player: 0, edge: 'e:9,9,NE' }),
      /invalid edge/,
    );
    expectFail(
      applyAction(s, { type: 'placeSetupRoad', player: 1, edge: vertexEdges(TOPOLOGY, v0)[0]! }),
      /not your turn/,
    );
    expectFail(
      applyAction(freshGame(), {
        type: 'placeSetupRoad',
        player: 0,
        edge: vertexEdges(TOPOLOGY, v0)[0]!,
      }),
      /not placing/,
    );
  });
});

describe('setupLegal', () => {
  it('offers all 54 vertices on an empty board', () => {
    expect(setupLegal(freshGame())).toHaveLength(54);
  });

  it('excludes taken vertices and their neighbors', () => {
    const v0 = cornerVertex(0, 0, 'N');
    const s = run(
      freshGame(),
      { type: 'placeSetupSettlement', player: 0, vertex: v0 },
      { type: 'placeSetupRoad', player: 0, edge: vertexEdges(TOPOLOGY, v0)[0]! },
    );
    const vs = setupLegal(s).map((a) => (a.type === 'placeSetupSettlement' ? a.vertex : null));
    expect(vs).toHaveLength(54 - 1 - vertexNeighbors(TOPOLOGY, v0).length);
    expect(vs).not.toContain(v0);
    for (const nb of vertexNeighbors(TOPOLOGY, v0)) expect(vs).not.toContain(nb);
  });

  it('road step offers exactly the free edges at the new settlement', () => {
    const v0 = cornerVertex(0, 0, 'N');
    const s = run(freshGame(), { type: 'placeSetupSettlement', player: 0, vertex: v0 });
    const edges = setupLegal(s).map((a) => (a.type === 'placeSetupRoad' ? a.edge : null));
    expect(edges.sort()).toEqual([...vertexEdges(TOPOLOGY, v0)].sort());
  });

  it('is empty outside setup', () => {
    expect(setupLegal(midGame())).toEqual([]);
  });
});
