/** Demo expansion rules (F1). Template for an expansion's rule tests: one test per rule. */
import { describe, expect, it } from 'vitest';
import { RESOURCES } from '../../../engine/constants';
import { applyAction, legalActions } from '../../../engine/engine';
import { createGame } from '../../../engine/createGame';
import { cloneState } from '../../../engine/clone';
import { publicVictoryPoints, victoryPoints } from '../../../engine/selectors';
import { hexVertices, topologyOf } from '../../../engine/topology';
import {
  expectConserved,
  expectFail,
  expectOk,
  rngForRoll,
  run,
  setHand,
} from '../../../engine/actions/testkit';
import type { Action, GameState, HexId, VertexId } from '../../../engine/types';
import { DEMO, OASIS, demoSlice, friendlyRobberHexes, oasisHex, wellsOf } from '.';

const players = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ name: `P${i}`, color: `#10101${i}` }));

function demoGame(seed = 1, friendlyRobber = true): GameState {
  return createGame({
    seed,
    players: players(4),
    mode: DEMO,
    startingPlayer: 0,
    options: { demo: { friendlyRobber } },
  });
}

/** A demo game in main phase, player 0 to act, with a settlement of P0 on `v`. */
function mainWith(v?: VertexId): { s: GameState; v: VertexId } {
  const s = demoGame();
  const t = topologyOf(s);
  const at = v ?? (t.vertices[10] as VertexId);
  s.pieces.buildings[at] = { owner: 0, kind: 'settlement' };
  s.turn = { number: 3, current: 0, devCardPlayed: false, tradeOffers: 0 };
  s.phase = { kind: 'main' };
  return { s, v: at };
}

describe('demo setup', () => {
  it('creates the Oasis map: desert replaced by the oasis, robber on it, empty slice', () => {
    const s = demoGame();
    expect(s.settings).toMatchObject({
      mode: 'demo',
      expansions: ['demo'],
      scenario: 'demo/oasis',
      map: 'demo/oasis19',
      options: { demo: { friendlyRobber: true } },
      vpToWin: 10,
    });
    const oasis = oasisHex(s);
    expect(oasis).toBe(s.robber);
    expect(s.board.hexes[oasis as HexId]).toMatchObject({ terrain: OASIS, token: null });
    expect(Object.values(s.board.hexes).some((h) => h.terrain === 'desert')).toBe(false);
    expect(demoSlice(s)).toEqual({ v: 1, wells: {} });
    expect(s.log[0]?.text).toMatch(/Oasis \(demo\): Oasis, seed 1/);
  });

  it('is deterministic and JSON-safe', () => {
    expect(demoGame(9)).toEqual(demoGame(9));
    const s = demoGame(9);
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });

  it('rejects 5 players (mode range 3-4)', () => {
    expect(() => createGame({ seed: 1, players: players(5), mode: DEMO })).toThrow(/3-4/);
  });
});

describe('wells', () => {
  it('cost 1 brick + 1 grain, go on your own building, and are logged', () => {
    const { s, v } = mainWith();
    setHand(s, 0, { brick: 1, grain: 1 });
    const after = expectOk(applyAction(s, { type: 'demo/buildWell', player: 0, vertex: v }));
    expect(demoSlice(after).wells[v]).toBe(0);
    expect(after.players[0]?.resources).toMatchObject({ brick: 0, grain: 0 });
    expect(after.log.at(-1)?.text).toBe('P0 dug a well');
    expectConserved(after);
    expect(demoSlice(s).wells).toEqual({}); // input untouched
  });

  it('are rejected without resources, off your buildings, twice, off turn or out of phase', () => {
    const { s, v } = mainWith();
    expectFail(applyAction(s, { type: 'demo/buildWell', player: 0, vertex: v }), /afford/);
    setHand(s, 0, { brick: 2, grain: 2 });
    const other = topologyOf(s).vertices[30] as VertexId;
    expectFail(
      applyAction(s, { type: 'demo/buildWell', player: 0, vertex: other }),
      /own building/,
    );
    expectFail(applyAction(s, { type: 'demo/buildWell', player: 1, vertex: v }), /not your turn/);
    const once = run(s, { type: 'demo/buildWell', player: 0, vertex: v });
    expectFail(applyAction(once, { type: 'demo/buildWell', player: 0, vertex: v }), /already/);
    const pre = { ...s, phase: { kind: 'preRoll' as const } };
    expectFail(applyAction(pre, { type: 'demo/buildWell', player: 0, vertex: v }), /main phase/);
    expectFail(
      applyAction(s, { type: 'demo/buildWell', player: 0 } as unknown as Action),
      /invalid vertex/,
    );
  });

  it('are limited to 3 per player', () => {
    const { s } = mainWith();
    const t = topologyOf(s);
    const spots = [0, 15, 30, 45].map((i) => t.vertices[i] as VertexId);
    for (const v of spots) s.pieces.buildings[v] = { owner: 0, kind: 'settlement' };
    setHand(s, 0, { brick: 4, grain: 4 });
    let cur = s;
    for (const v of spots.slice(0, 3))
      cur = run(cur, { type: 'demo/buildWell', player: 0, vertex: v });
    expect(wellsOf(cur, 0)).toHaveLength(3);
    expectFail(
      applyAction(cur, { type: 'demo/buildWell', player: 0, vertex: spots[3] as VertexId }),
      /no wells left/,
    );
  });

  it('add 1 card when a hex next to them produces', () => {
    const s = demoGame();
    const t = topologyOf(s);
    const hex = (Object.keys(s.board.hexes) as HexId[]).find((h) => s.board.hexes[h]?.token === 8);
    if (!hex) throw new Error('no 8');
    const terrain = s.board.hexes[hex]?.terrain as (typeof RESOURCES)[number];
    const v = hexVertices(t, hex)[0] as VertexId;
    s.pieces.buildings[v] = { owner: 2, kind: 'city' };
    (s.ext.demo as { wells: Record<VertexId, number> }).wells[v] = 2;
    s.turn = { number: 3, current: 0, devCardPlayed: false, tradeOffers: 0 };
    s.phase = { kind: 'preRoll' };
    s.robber = oasisHex(s) as HexId;
    s.rng = rngForRoll(8);
    const after = run(s, { type: 'rollDice', player: 0 });
    expect(after.players[2]?.resources[terrain]).toBe(3); // city 2 + well 1
    expectConserved(after);
  });

  it('give 1 public VP per 2 wells', () => {
    const { s } = mainWith();
    const base = publicVictoryPoints(s, 0);
    const t = topologyOf(s);
    const slice = s.ext.demo as { wells: Record<VertexId, number> };
    slice.wells[t.vertices[10] as VertexId] = 0;
    expect(publicVictoryPoints(s, 0)).toBe(base);
    slice.wells[t.vertices[20] as VertexId] = 0;
    s.pieces.buildings[t.vertices[20] as VertexId] = { owner: 0, kind: 'settlement' };
    expect(publicVictoryPoints(s, 0)).toBe(base + 2); // +1 settlement, +1 for 2 wells
    expect(victoryPoints(s, 0)).toBe(publicVictoryPoints(s, 0));
  });
});

describe('bloom', () => {
  function rolled(total: number) {
    const s = demoGame();
    s.turn = { number: 3, current: 1, devCardPlayed: false, tradeOffers: 0 };
    s.phase = { kind: 'preRoll' };
    s.rng = rngForRoll(total);
    return run(s, { type: 'rollDice', player: 1 });
  }

  it('a 2 or 12 enters the bloom phase; other rolls do not', () => {
    expect(rolled(2).phase.kind).toBe('demo/bloom');
    expect(rolled(12).phase.kind).toBe('demo/bloom');
    expect(rolled(8).phase.kind).toBe('main');
  });

  it('the roller picks exactly one resource from the bank, then main', () => {
    const s = rolled(12);
    const legal = legalActions(s);
    expect(legal.map((a) => a.type)).toEqual(RESOURCES.map(() => 'demo/pickBloom'));
    expect(legal.every((a) => a.player === 1)).toBe(true);
    const after = run(s, { type: 'demo/pickBloom', player: 1, resource: 'ore' });
    expect(after.phase.kind).toBe('main');
    expect(after.players[1]?.resources.ore).toBe(s.players[1]!.resources.ore + 1);
    expectConserved(after);
    expectFail(applyAction(s, { type: 'demo/pickBloom', player: 0, resource: 'ore' }), /not your/);
    expectFail(applyAction(s, { type: 'demo/pickBloom', player: 1, resource: 'gold' }), /invalid/);
    expectFail(
      applyAction(after, { type: 'demo/pickBloom', player: 1, resource: 'ore' }),
      /nothing/,
    );
  });

  it('no endTurn or building is legal until the pick is made', () => {
    const legal = legalActions(rolled(2));
    expect(legal.some((a) => a.type === 'endTurn' || a.type.startsWith('build'))).toBe(false);
  });
});

describe('oasis income and the friendly robber', () => {
  it('a building on the oasis earns 1 wool at the end of its owner’s turn', () => {
    const s = demoGame();
    const v = hexVertices(topologyOf(s), oasisHex(s) as HexId)[0] as VertexId;
    s.pieces.buildings[v] = { owner: 0, kind: 'settlement' };
    s.turn = { number: 3, current: 0, devCardPlayed: false, tradeOffers: 0 };
    s.phase = { kind: 'main' };
    const after = run(s, { type: 'endTurn', player: 0 });
    expect(after.players[0]?.resources.wool).toBe(1);
    expect(after.log.some((l) => l.text === 'P0 received 1 sheep (oasis)')).toBe(true);
    // Not for the other players' turns.
    const other = { ...cloneState(s), turn: { ...s.turn, current: 1 } };
    expect(run(other, { type: 'endTurn', player: 1 }).players[0]?.resources.wool).toBe(0);
  });

  it('the robber spares hexes next to players with 2 or fewer points (legal + handler agree)', () => {
    const s = demoGame();
    const t = topologyOf(s);
    // P1 has 3 VP; P2 has 1 VP next to `poor`.
    const rich = (Object.keys(s.board.hexes) as HexId[]).filter((h) => h !== s.robber);
    const [poorHex, richHex] = [rich[0] as HexId, rich[10] as HexId];
    s.pieces.buildings[hexVertices(t, poorHex)[0] as VertexId] = { owner: 2, kind: 'settlement' };
    s.pieces.buildings[hexVertices(t, richHex)[0] as VertexId] = { owner: 1, kind: 'city' };
    s.pieces.buildings[hexVertices(t, richHex)[3] as VertexId] = { owner: 1, kind: 'settlement' };
    s.turn = { number: 3, current: 0, devCardPlayed: false, tradeOffers: 0 };
    s.phase = { kind: 'moveRobber', resume: 'main' };
    const allowed = friendlyRobberHexes(s);
    expect(allowed).not.toContain(poorHex);
    expect(allowed).toContain(richHex);
    const legal = legalActions(s).filter((a) => a.type === 'moveRobber');
    expect(legal.map((a) => ('hex' in a ? a.hex : null)).sort()).toEqual([...allowed].sort());
    expectFail(applyAction(s, { type: 'moveRobber', player: 0, hex: poorHex }), /friendly/);
    expect(applyAction(s, { type: 'moveRobber', player: 0, hex: richHex }).ok).toBe(true);
    // Option off: the base rule.
    const off = { ...s, settings: { ...s.settings, options: { demo: { friendlyRobber: false } } } };
    expect(applyAction(off, { type: 'moveRobber', player: 0, hex: poorHex }).ok).toBe(true);
  });
});

describe('soundness', () => {
  it('every legal action is accepted, for 3000 random steps over 3 seeds', () => {
    for (const seed of [1, 2, 3]) {
      let s = demoGame(seed, seed !== 2);
      let pick = seed * 7919;
      for (let step = 0; step < 1000 && s.phase.kind !== 'gameOver'; step++) {
        const legal = legalActions(s);
        expect(legal.length).toBeGreaterThan(0);
        for (const a of legal.slice(0, 40))
          expect(applyAction(s, a).ok, JSON.stringify(a)).toBe(true);
        // Prefer progress over ending the turn, deterministically.
        pick = (pick * 1103515245 + 12345) >>> 0;
        const progress = legal.filter((a) => a.type !== 'endTurn');
        const from = progress.length > 0 && pick % 3 !== 0 ? progress : legal;
        s = expectOk(applyAction(s, from[pick % from.length] as Action));
      }
    }
  });
});
