import { describe, expect, it } from 'vitest';
import { createGame } from '../../../engine/createGame';
import { legalActions } from '../../../engine/engine';
import { isVertexOpen } from '../../../engine/rules/placement';
import { victoryPoints } from '../../../engine/selectors';
import type { Action, GameState, VertexId } from '../../../engine/types';
import { A } from './actions';
import { graph, isCoastal, staticOf } from './geometry';
import { landHoPieces } from './index';
import { epSlice } from './state';
import { act, epGame, players, R, tryAct } from './testkit';

const settlementSpots = (s: GameState) =>
  legalActions(s)
    .filter(
      (a): a is Extract<Action, { type: 'placeSetupSettlement' }> =>
        a.type === 'placeSetupSettlement',
    )
    .map((a) => a.vertex);

describe('variable setup (§2.9)', () => {
  it('round 1: a harbor settlement on a marked coastal corner, no road', () => {
    const s = epGame('full');
    const spots = settlementSpots(s);
    expect(spots.length).toBeGreaterThan(0);
    expect(spots.every((v) => staticOf(s).spots.has(v))).toBe(true);
    // A corner of the island that is not marked is refused.
    const other = (graph(s).vertices as VertexId[]).find(
      (v) =>
        !staticOf(s).spots.has(v) &&
        isVertexOpen(s, v) &&
        (graph(s).hexesAt.get(v) ?? []).some((h) => staticOf(s).island.has(h)),
    ) as VertexId;
    expect(tryAct(s, 'placeSetupSettlement', 0, { vertex: other }).ok).toBe(false);
    const v = spots[0] as VertexId;
    const t = act(s, { type: 'placeSetupSettlement', player: 0, vertex: v });
    expect(epSlice(t).harbors[v]).toEqual([]);
    expect(t.phase).toMatchObject({ kind: 'setup', index: 1, step: 'settlement' });
    expect(t.turn.current).toBe(1);
    expect(Object.keys(t.pieces.roads)).toHaveLength(0);
    // No starting cards for the harbor settlement.
    expect(Object.values(t.players[0]?.resources ?? {}).reduce((a, b) => a + b, 0)).toBe(0);
  });

  it('round 2: a settlement anywhere on the island; it alone pays starting cards', () => {
    let s = epGame('full');
    for (let i = 0; i < 4; i++) s = act(s, legalActions(s)[0] as Action);
    expect(s.phase).toMatchObject({ kind: 'setup', index: 4 });
    expect(s.turn.current).toBe(3);
    const spots = settlementSpots(s);
    expect(spots.some((v) => !staticOf(s).spots.has(v))).toBe(true);
    const v = spots.find((x) => !staticOf(s).spots.has(x)) as VertexId;
    const t = act(s, { type: 'placeSetupSettlement', player: 3, vertex: v });
    expect(epSlice(t).harbors[v]).toBeUndefined();
    const hexes = (graph(t).hexesAt.get(v) ?? []).filter((h) => staticOf(t).island.has(h)).length;
    expect(Object.values(t.players[3]?.resources ?? {}).reduce((a, b) => a + b, 0)).toBe(hexes);
  });

  it('then each player, first player first, places a road at the settlement and a ship with a settler at the harbor', () => {
    let s = epGame('full');
    for (let i = 0; i < 8; i++) s = act(s, legalActions(s)[0] as Action);
    expect(s.phase).toEqual({ kind: 'ep/setupFleet', index: 0, step: 'road' });
    expect(s.turn.current).toBe(0);
    const roads = legalActions(s);
    expect(roads.every((a) => a.type === A.setupRoad)).toBe(true);
    s = act(s, roads[0] as Action);
    expect(s.phase).toMatchObject({ step: 'ship' });
    const ships = legalActions(s);
    expect(ships.every((a) => a.type === A.setupShip)).toBe(true);
    s = act(s, ships[0] as Action);
    expect(epSlice(s).ships).toEqual([expect.objectContaining({ owner: 0, cargo: ['settler'] })]);
    expect(s.turn.current).toBe(1);
    for (let i = 0; i < 6; i++) s = act(s, legalActions(s)[0] as Action);
    expect(s.phase.kind).toBe('preRoll');
    expect(s.turn).toMatchObject({ number: 1, current: 0 });
    // Each player: a settlement (1) and a harbor settlement (2).
    for (const p of [0, 1, 2, 3]) expect(victoryPoints(s, p)).toBe(3);
    expect(epSlice(s).gold).toEqual([2, 2, 2, 2]);
  });

  it('5-6 players: the paired players’ turn by default (no special building phase)', () => {
    const s = epGame('full', 6);
    expect(s.settings.secondSettler).toBe(true);
    expect(s.settings.specialBuildPhase).toBe(false);
    expect(s.settings.map).toBe('ep/full56');
    expect(staticOf(s).spots.size).toBe(18);
  });
});

describe('Land Ho! fixed start (§2.4)', () => {
  it('places the printed pieces and starts turn 1', () => {
    const s = epGame('landHo');
    expect(s.phase.kind).toBe('preRoll');
    expect(s.turn.number).toBe(1);
    const e = epSlice(s);
    expect(e.ships).toHaveLength(4);
    landHoPieces.forEach((x, p) => {
      expect(s.pieces.buildings[x.settlement]).toEqual({ owner: p, kind: 'settlement' });
      expect(s.pieces.buildings[x.harbor]).toEqual({ owner: p, kind: 'settlement' });
      expect(e.harbors[x.harbor]).toEqual([]);
      expect(s.pieces.roads[x.road]).toBe(p);
      expect(graph(s).ends.get(x.road)).toContain(x.settlement);
      expect(isCoastal(s, x.harbor)).toBe(true);
      expect(graph(s).ends.get(x.ship)).toContain(x.harbor);
      expect(e.ships[p]).toMatchObject({ owner: p, edge: x.ship, cargo: ['settler'] });
      expect(victoryPoints(s, p)).toBe(3);
    });
    // The distance rule holds between all eight buildings.
    const all = Object.keys(s.pieces.buildings) as VertexId[];
    for (const v of all) {
      for (const n of graph(s).neighbors.get(v) ?? [])
        expect(all.includes(n), `${v} ~ ${n}`).toBe(false);
    }
  });

  it('starting cards: one per hex at the settlement (Blue ore grain wool, Red lumber brick ore, ...)', () => {
    const s = epGame('landHo');
    expect(s.players[0]?.resources).toEqual(R({ ore: 1, grain: 1, wool: 1 }));
    expect(s.players[1]?.resources).toEqual(R({ lumber: 1, brick: 1, ore: 1 }));
    expect(s.players[2]?.resources).toEqual(R({ brick: 1, wool: 1 }));
    expect(s.players[3]?.resources).toEqual(R({ wool: 1, ore: 1, grain: 1 }));
    expect(s.stats?.players[0]?.gained.setup).toEqual(R({ ore: 1, grain: 1, wool: 1 }));
  });

  it('3 players: the fourth colour stays in the box; 8 VP to win', () => {
    const s = epGame('landHo', 3);
    expect(epSlice(s).ships).toHaveLength(3);
    expect(Object.keys(s.pieces.buildings)).toHaveLength(6);
    expect(s.settings.vpToWin).toBe(8);
  });

  it('Land Ho! is a 3-4 player scenario', () => {
    expect(() => epGame('landHo', 5)).toThrow();
  });
});

describe('settings and combinations', () => {
  const cfg = (extra: object) => ({
    seed: 1,
    players: players(4),
    mode: 'ep',
    scenario: 'ep/full',
    ...extra,
  });

  it('VP targets per scenario: 8 / 12 / 15 / 15 / 17', () => {
    const vp = (k: string) => createGame(cfg({ scenario: `ep/${k}` })).settings.vpToWin;
    expect(['landHo', 'pirateLairs', 'fish', 'spices', 'full'].map(vp)).toEqual([
      8, 12, 15, 15, 17,
    ]);
  });

  it('refuses setup variants, the special building phase, rules56 and map balance rules', () => {
    expect(() =>
      createGame(
        cfg({
          setupPlacement: {
            first: { building: 'city', restriction: 'normal' },
            second: { building: 'settlement', restriction: 'normal' },
          },
        }),
      ),
    ).toThrow(/own setup/);
    expect(() => createGame(cfg({ specialBuildPhase: true }))).toThrow(/paired/);
    expect(() => createGame(cfg({ secondSettler: true }))).toThrow(/5-6/);
    expect(() => createGame({ ...cfg({}), players: players(5), secondSettler: false })).toThrow(
      /paired/,
    );
    expect(() => createGame(cfg({ mapRules: { allowRedTouch: true } }))).toThrow(/balance/);
  });

  it('works with Event Cards, the friendly robber, balanced dice and the chess clock', () => {
    expect(() => createGame(cfg({ eventCards: true }))).not.toThrow();
    expect(() => createGame(cfg({ robberMode: 'friendly' }))).not.toThrow();
    expect(() => createGame(cfg({ balancedDice: true }))).not.toThrow();
    expect(() =>
      createGame(cfg({ timer: { preset: 'rapid', bankSec: 600, incrementSec: 10 } })),
    ).not.toThrow();
  });

  it('cannot be combined with Seafarers (no such mode; the modules conflict)', () => {
    expect(() => createGame(cfg({ expansions: ['seafarers'] }))).toThrow();
  });
});
