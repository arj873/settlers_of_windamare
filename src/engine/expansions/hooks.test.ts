/**
 * Every framework hook point, exercised with a throwaway module ('tst') registered for this file.
 * Each test installs only the hooks it needs (the hooks object is shared and reset after each test).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { COSTS, RESOURCES } from '../constants';
import { applyAction, legalActions } from '../engine';
import { composeOrder, createGame } from '../createGame';
import { midGame } from '../fixtures';
import { cornerVertex, sideEdge } from '../hex';
import { devDeckCounts, supplyOf } from '../mapLookup';
import { emptyResources } from '../resources';
import { actingPlayers, cardsInHand, piecesLeft, victoryPoints } from '../selectors';
import { continueRoll, discardAmounts } from '../actions/turn';
import { bankTradeRatio } from '../actions/trade';
import { canPlaceRoad, canPlaceSettlement, isVertexOpen } from '../rules/placement';
import { longestRoadLengths } from '../rules/longestRoad';
import { emptyBoardGame, expectFail, expectOk, rngForRoll, run, setHand } from '../actions/testkit';
import { cloneState } from '../clone';
import { EVENT_CARDS } from '../rules/events';
import { emptyStats, statsOf } from '../stats';
import type { Action, EventKind, GameState, VertexId } from '../types';
import { viewFor } from '../view';
import { hiddenFrom } from '../viewer';
import { costOf, extraRouteEdges, pieceLimit, terrainKind } from './hooks';
import { registerExpansion } from './registry';
import type { ExpansionHooks, ExpansionModule, ProductionContext } from './types';

const hooks: ExpansionHooks = {};
const mod: ExpansionModule = {
  id: 'tst',
  name: 'Test module',
  terrains: { 'tst/lake': { kind: 'sea', name: 'Lake' } },
  modes: [
    {
      id: 'tst',
      name: 'Test',
      blurb: '',
      status: 'wip',
      expansions: ['tst'],
      scenarios: [],
      players: { min: 3, max: 4 },
      vpToWin: 12,
    },
  ],
  options: [
    { key: 'harbor', label: 'Harbormaster', type: 'boolean', default: false, vpBonus: 1 },
    { key: 'level', label: 'Level', type: 'int', default: 2, min: 1, max: 3 },
  ],
  hooks,
};
let unregister: () => void = () => undefined;
beforeAll(() => {
  unregister = registerExpansion(mod);
});
afterAll(() => unregister());
afterEach(() => {
  for (const k of Object.keys(hooks)) delete hooks[k as keyof ExpansionHooks];
  delete mod.actions;
  delete mod.overrides;
  delete mod.wraps;
  delete mod.legal;
  delete mod.filterLegal;
  delete mod.actors;
  delete mod.changesRoads;
  delete mod.init;
  delete mod.validate;
});

/** The state with the test module active (a new settings object: the module cache is per settings). */
function withTst(s: GameState, slice: unknown = {}): GameState {
  return {
    ...s,
    settings: { ...s.settings, mode: 'tst', expansions: ['tst'] },
    ext: { tst: slice },
  };
}

const V = (q: number, r: number, c: 'N' | 'S') => cornerVertex(q, r, c);

describe('dispatch: actions, overrides, legal, filterLegal, actors', () => {
  it('routes a namespaced action to its active module only', () => {
    mod.actions = {
      'tst/ping': (d, a) => {
        d.log.push({ turn: d.turn.number, player: a.player, text: 'pong' });
        return { ok: true, state: d };
      },
    };
    const s = withTst(midGame());
    const after = expectOk(applyAction(s, { type: 'tst/ping', player: 1 }));
    expect(after.log.at(-1)?.text).toBe('pong');
    expectFail(applyAction(midGame(), { type: 'tst/ping', player: 1 }), /unknown action type/);
    expectFail(applyAction(s, { type: 'tst/nope', player: 1 }), /unknown action type/);
    expectFail(applyAction(s, { type: 'tst/ping', player: 9 }), /invalid player/);
  });

  it('overrides wrap the base handler and can delegate with next()', () => {
    mod.overrides = {
      endTurn: (d, a, next) =>
        d.turn.number === 12 ? { ok: false, error: 'not today' } : next(d, a),
    };
    const s = withTst(midGame());
    expectFail(applyAction(s, { type: 'endTurn', player: 1 }), 'not today');
    const later = { ...s, turn: { ...s.turn, number: 13 } };
    expect(applyAction(later, { type: 'endTurn', player: 1 }).ok).toBe(true);
  });

  it('wraps run around a module action (combination modules), innermost first', () => {
    mod.actions = {
      'tst/ping': (d, a) => {
        d.log.push({ turn: d.turn.number, player: a.player, text: 'pong' });
        return { ok: true, state: d };
      },
    };
    mod.wraps = {
      'tst/ping': (d, a, next) => (a.player === 2 ? { ok: false, error: 'no' } : next(d, a)),
    };
    const s = withTst(midGame());
    expectFail(applyAction(s, { type: 'tst/ping', player: 2 }), 'no');
    expect(expectOk(applyAction(s, { type: 'tst/ping', player: 1 })).log.at(-1)?.text).toBe('pong');
  });

  it("routeEdges collects every module's extra route edges", () => {
    hooks.routeEdges = (_state, p) => (p === 1 ? [sideEdge(0, 0, 'E')] : []);
    const s = withTst(midGame());
    expect(extraRouteEdges(s, 1)).toEqual([sideEdge(0, 0, 'E')]);
    expect(extraRouteEdges(s, 0)).toEqual([]);
    expect(extraRouteEdges(midGame(), 1)).toEqual([]);
  });

  it('legal adds actions; filterLegal removes them', () => {
    mod.legal = (state) => [{ type: 'tst/ping', player: state.turn.current }];
    mod.filterLegal = (_state, actions) => actions.filter((a) => a.type !== 'endTurn');
    const legal = legalActions(withTst(midGame()));
    expect(legal.some((a) => a.type === 'tst/ping')).toBe(true);
    expect(legal.some((a) => a.type === 'endTurn')).toBe(false);
    expect(legalActions(midGame()).some((a) => a.type === 'endTurn')).toBe(true);
  });

  it('actors decide who acts in a module phase', () => {
    mod.actors = (state) => (state.phase.kind === 'tst/vote' ? [0, 2] : undefined);
    const s = withTst(midGame());
    s.phase = { kind: 'tst/vote', votes: [] };
    expect(actingPlayers(s)).toEqual([0, 2]);
    expect(actingPlayers(withTst(midGame()))).toEqual([1]);
  });

  it('expansion phases and slices are deep-copied for drafts', () => {
    const s = withTst(midGame(), { list: [1, 2], nested: { a: 1 } });
    s.phase = { kind: 'tst/vote', votes: [[0]] };
    const d = cloneState(s);
    expect(d).toEqual(s);
    (d.ext.tst as { list: number[] }).list.push(3);
    (d.phase as unknown as { votes: number[][] }).votes[0]?.push(1);
    expect((s.ext.tst as { list: number[] }).list).toEqual([1, 2]);
    expect((s.phase as unknown as { votes: number[][] }).votes).toEqual([[0]]);
  });

  it('changesRoads makes Longest Road recompute after a module action', () => {
    // A module action that removes Red's roads (Red holds Longest Road in midGame).
    mod.actions = {
      'tst/flood': (d) => {
        for (const e of Object.keys(d.pieces.roads) as (keyof typeof d.pieces.roads)[]) {
          if (d.pieces.roads[e] === 0) delete d.pieces.roads[e];
        }
        return { ok: true, state: d };
      },
    };
    const s = withTst(midGame());
    expect(s.awards.longestRoad).toBe(0);
    const stale = expectOk(applyAction(s, { type: 'tst/flood', player: 1 }));
    expect(stale.awards.longestRoad).toBe(0); // not declared: not recomputed
    mod.changesRoads = ['tst/flood'];
    const fresh = expectOk(applyAction(s, { type: 'tst/flood', player: 1 }));
    expect(fresh.awards.longestRoad).toBeNull();
  });

  it('afterAction runs after every successful action', () => {
    hooks.afterAction = (d, a) => d.log.push({ turn: 0, player: null, text: `after ${a.type}` });
    const s = withTst(midGame());
    const after = expectOk(applyAction(s, { type: 'endTurn', player: 1 }));
    expect(after.log.some((l) => l.text === 'after endTurn')).toBe(true);
    expect(applyAction(s, { type: 'rollDice', player: 1 }).ok).toBe(false);
  });
});

describe('dice and production hooks', () => {
  const roller = (total: number) => {
    const s = withTst(emptyBoardGame());
    s.rng = rngForRoll(total);
    return s;
  };

  it('rollDice replaces the two dice', () => {
    hooks.rollDice = () => [6, 6];
    const after = run(roller(5), { type: 'rollDice', player: 0 });
    expect(after.dice).toEqual([6, 6]);
  });

  it('onRoll can interrupt the roll; continueRoll finishes it later', () => {
    hooks.onRoll = (_d, roll) => (roll === 5 ? { kind: 'tst/event' } : undefined);
    const s = roller(5);
    s.pieces.buildings[V(0, -2, 'N')] = { owner: 0, kind: 'city' };
    const after = run(s, { type: 'rollDice', player: 0 });
    expect(after.phase.kind).toBe('tst/event');
    const done = cloneState(after);
    continueRoll(done);
    expect(done.phase.kind).toBe('main');
  });

  it('onSeven replaces the discard / robber flow', () => {
    hooks.onSeven = (_d, pending) => ({ kind: 'tst/seven', pending: [...pending] });
    const after = run(roller(7), { type: 'rollDice', player: 0 });
    expect(after.phase).toEqual({ kind: 'tst/seven', pending: [0, 0, 0, 0] });
  });

  it('production changes what players are owed (bank-shortage rule still applies)', () => {
    hooks.production = (_s, _roll, owed) => {
      if (owed[1]) owed[1].wool += 2;
    };
    const s = roller(8);
    const after = run(s, { type: 'rollDice', player: 0 });
    expect(after.players[1]?.resources.wool).toBe(2);
    expect(after.bank.wool).toBe(supplyOf(after).bankPerResource - 2);
  });

  it('afterProduction enters a module phase instead of main', () => {
    hooks.afterProduction = (_d, roll) => (roll === 8 ? { kind: 'tst/after' } : undefined);
    expect(run(roller(8), { type: 'rollDice', player: 0 }).phase.kind).toBe('tst/after');
    expect(run(roller(6), { type: 'rollDice', player: 0 }).phase.kind).toBe('main');
  });

  it('handSize and discardLimit change who discards on a 7', () => {
    const s = withTst(midGame());
    const base = discardAmounts(s);
    hooks.handSize = (_s, p, n) => (p === 2 ? n + 10 : n); // White holds 2 cards + 10 module cards
    hooks.discardLimit = (_s, p, n) => (p === 1 ? 20 : n); // Blue's limit is raised
    expect(cardsInHand(s, 2)).toBe(12);
    expect(discardAmounts(s)).toEqual([base[0], 0, 6, base[3]]);
  });
});

describe('costs, pieces, placement, VP, trade, roads, supply', () => {
  it('cost and pieceLimit are chained over the base values', () => {
    const s = withTst(midGame());
    hooks.cost = (_s, item, base) =>
      item === 'road'
        ? { ...emptyResources(), lumber: 2 }
        : item === 'tst/ship'
          ? COSTS.road
          : base;
    hooks.pieceLimit = (_s, _p, kind, n) => (kind === 'road' ? 20 : kind === 'tst/ship' ? 15 : n);
    expect(costOf(s, 'road').lumber).toBe(2);
    expect(costOf(s, 'city')).toEqual(COSTS.city);
    expect(costOf(s, 'tst/ship')).toEqual(COSTS.road);
    expect(costOf(midGame(), 'tst/ship')).toBeUndefined();
    expect(pieceLimit(s, 0, 'tst/ship')).toBe(15);
    expect(piecesLeft(s, 0).road).toBe(piecesLeft(midGame(), 0).road + 5);
    setHand(s, 1, { brick: 1, lumber: 1 });
    expectFail(applyAction(s, { type: 'buildRoad', player: 1, edge: 'e:2,-1,NE' }), /afford/);
  });

  it('vertexBlocked / edgeBlocked / blocksRoute affect placement and Longest Road', () => {
    const s = withTst(emptyBoardGame());
    const v = V(0, 0, 'N');
    expect(isVertexOpen(s, v)).toBe(true);
    hooks.vertexBlocked = (_s, x) => x === v;
    expect(isVertexOpen(s, v)).toBe(false);

    // Red settles on h:0,0's S corner; the two hex sides at that corner are road spots.
    const home = V(0, 0, 'S');
    s.pieces.buildings[home] = { owner: 0, kind: 'settlement' };
    const [e1, e2] = [sideEdge(0, 0, 'SE'), sideEdge(0, 0, 'SW')];
    expect(canPlaceRoad(s, 0, e1)).toBe(true);
    hooks.edgeBlocked = (_s, x) => x === e1;
    expect(canPlaceRoad(s, 0, e1)).toBe(false);
    expect(canPlaceRoad(s, 0, e2)).toBe(true);

    // Red's 3-road chain N-NE-SE-S around h:0,0; a foreign piece on the NE corner cuts it.
    const t = withTst(emptyBoardGame());
    for (const side of ['NE', 'E', 'SE'] as const) t.pieces.roads[sideEdge(0, 0, side)] = 0;
    expect(longestRoadLengths(t)[0]).toBe(3);
    const cut: VertexId = cornerVertex(0, 0, 'NE');
    hooks.blocksRoute = (_s, x, p) => p === 0 && x === cut;
    expect(longestRoadLengths(t)[0]).toBe(2);
    // ...and Red may not extend a road through it: the E side now only connects via the SE corner.
    const u = withTst(emptyBoardGame());
    u.pieces.roads[sideEdge(0, 0, 'NE')] = 0;
    expect(canPlaceRoad(u, 0, sideEdge(0, 0, 'E'))).toBe(false);
  });

  it('a sea-kind module terrain makes its vertices unsettleable', () => {
    const s = withTst(emptyBoardGame());
    expect(terrainKind('tst/lake')).toBe('sea');
    expect(terrainKind('grain')).toBe('land');
    expect(terrainKind('fog')).toBe('fog');
    const v = V(0, -2, 'N'); // a coastal vertex touching only h:0,-2
    expect(canPlaceSettlement(s, 0, v, { requireRoad: false })).toBe(true);
    const tile = s.board.hexes['h:0,-2'];
    if (!tile) throw new Error('no hex');
    s.board = {
      ...s.board,
      hexes: { ...s.board.hexes, 'h:0,-2': { ...tile, terrain: 'tst/lake' } },
    };
    expect(canPlaceSettlement(s, 0, v, { requireRoad: false })).toBe(false);
  });

  it('victoryPoints adds public and hidden points; victory checks use them', () => {
    const s = withTst(midGame());
    const before = victoryPoints(s, 1);
    hooks.victoryPoints = (_s, p) => (p === 1 ? { public: 2, hidden: 1 } : { public: 0 });
    expect(victoryPoints(s, 1)).toBe(before + 3);
    const target = { ...s, settings: { ...s.settings, vpToWin: before + 4 } };
    // With 4 module points Blue reaches the target; any successful action on their turn wins.
    hooks.victoryPoints = (_s, p) => (p === 1 ? { public: 3, hidden: 1 } : { public: 0 });
    const won = expectOk(applyAction(target, { type: 'buyDevCard', player: 1 }));
    expect(won.winner).toBe(1);
  });

  it('deferVictory switches the core victory check off (the module declares winners)', () => {
    const s = withTst(midGame());
    const before = victoryPoints(s, 1);
    hooks.victoryPoints = (_s, p) => (p === 1 ? { public: 10 } : { public: 0 });
    const target = { ...s, settings: { ...s.settings, vpToWin: before + 4 } };
    hooks.deferVictory = () => true;
    const kept = expectOk(applyAction(target, { type: 'buyDevCard', player: 1 }));
    expect(kept.winner).toBeNull();
    expect(kept.phase.kind).toBe('main');
    hooks.deferVictory = () => false;
    expect(expectOk(applyAction(target, { type: 'buyDevCard', player: 1 })).winner).toBe(1);
  });

  it('bankTradeRatio and roadLength are chained', () => {
    const s = withTst(midGame());
    hooks.bankTradeRatio = (_s, _p, r, n) => (r === 'ore' ? 2 : n);
    expect(bankTradeRatio(s, 1, 'ore')).toBe(2);
    expect(bankTradeRatio(s, 1, 'wool')).toBe(bankTradeRatio(midGame(), 1, 'wool'));
    hooks.roadLength = (_s, p, n) => (p === 3 ? 9 : n);
    expect(longestRoadLengths(s)[3]).toBe(9);
  });

  it('supply changes the bank and the dev deck at createGame', () => {
    hooks.supply = (_s, base) => ({
      bankPerResource: 12,
      devDeck: { ...base.devDeck, knight: 0, victoryPoint: 0 },
    });
    const s = createGame({
      seed: 1,
      players: [
        { name: 'A', color: '#f00' },
        { name: 'B', color: '#0f0' },
        { name: 'C', color: '#00f' },
      ],
      mode: 'tst',
    });
    for (const r of RESOURCES) expect(s.bank[r]).toBe(12);
    expect(s.devDeck).not.toContain('knight');
    expect(s.devDeck).toHaveLength(6);
  });

  it('setupBuilding makes a setup step place a city', () => {
    hooks.setupBuilding = (_s, index) => (index >= 3 ? 'city' : undefined);
    const s = withTst(createGame({ seed: 2, players: players(3), startingPlayer: 0 }));
    let cur = s;
    for (let i = 0; i < 4; i++) {
      const [a] = legalActions(cur).filter((x) => x.type === 'placeSetupSettlement');
      cur = run(cur, a as Action);
      const [r] = legalActions(cur);
      cur = run(cur, r as Action);
    }
    const kinds = Object.values(cur.pieces.buildings).map((b) => b.kind);
    expect(kinds.filter((k) => k === 'city')).toHaveLength(1);
  });

  it('onEndTurn / onStartTurn run around a turn change', () => {
    const seen: string[] = [];
    hooks.onEndTurn = (_d, p) => void seen.push(`end ${p}`);
    hooks.onStartTurn = (_d, p) => void seen.push(`start ${p}`);
    run(withTst(midGame()), { type: 'endTurn', player: 1 });
    expect(seen).toEqual(['end 1', 'start 2']);
  });
});

function players(n: number) {
  return Array.from({ length: n }, (_, i) => ({ name: `P${i}`, color: `#00000${i}` }));
}

describe('createGame: modes, options, validation, init', () => {
  it('uses the mode VP target, option defaults and vpBonus', () => {
    const s = createGame({ seed: 1, players: players(3), mode: 'tst' });
    expect(s.settings).toMatchObject({
      mode: 'tst',
      expansions: ['tst'],
      scenario: null,
      vpToWin: 12,
      options: { tst: { harbor: false, level: 2 } },
    });
    const h = createGame({
      seed: 1,
      players: players(3),
      mode: 'tst',
      options: { tst: { harbor: true } },
    });
    expect(h.settings.vpToWin).toBe(13);
    expect(
      createGame({ seed: 1, players: players(3), mode: 'tst', vpToWin: 9 }).settings.vpToWin,
    ).toBe(9);
  });

  it('rejects bad options, unknown modes, wrong player counts and inactive options', () => {
    const p3 = players(3);
    expect(() => createGame({ seed: 1, players: p3, mode: 'moon' })).toThrow(/unknown mode/);
    expect(() =>
      createGame({ seed: 1, players: p3, mode: 'tst', options: { tst: { level: 9 } } }),
    ).toThrow(/invalid value/);
    expect(() =>
      createGame({ seed: 1, players: p3, mode: 'tst', options: { tst: { nope: 1 } } }),
    ).toThrow(/unknown option/);
    expect(() => createGame({ seed: 1, players: p3, options: { tst: { level: 1 } } })).toThrow(
      /inactive/,
    );
    expect(() => createGame({ seed: 1, players: players(5), mode: 'tst' })).toThrow(/3-4 players/);
    expect(() => createGame({ seed: 1, players: p3, expansions: ['tst'] })).toThrow(
      /not a variant/,
    );
  });

  it('validate can reject a combination of settings', () => {
    mod.validate = (s) => (s.balancedDice ? 'no balanced dice with event cards' : null);
    expect(() =>
      createGame({ seed: 1, players: players(3), mode: 'tst', balancedDice: true }),
    ).toThrow(/tst: no balanced dice/);
  });

  it('init creates the slice from the continuing game RNG; base games are unaffected', () => {
    mod.init = (d, rng) => {
      d.ext.tst = { roll: rng.die() };
    };
    const a = createGame({ seed: 5, players: players(3), mode: 'tst' });
    const b = createGame({ seed: 5, players: players(3), mode: 'tst' });
    expect(a.ext.tst).toEqual(b.ext.tst);
    expect(a.rng).not.toBe(createGame({ seed: 5, players: players(3) }).rng);
    expect(createGame({ seed: 5, players: players(3) }).ext).toEqual({});
  });
});

describe('V1/V2 variants through the hooks (main x expansions merge)', () => {
  /** A tst game whose next event card is the first card matching `number` and `event`. */
  const eventRoller = (number: number, event: EventKind): GameState => {
    const s = withTst(emptyBoardGame());
    const top = EVENT_CARDS.findIndex((c) => c.number === number && c.event === event);
    const filler = EVENT_CARDS.map((_, i) => i)
      .filter((i) => i !== top)
      .slice(0, 8);
    return {
      ...s,
      settings: { ...s.settings, eventCards: true },
      eventDeck: [...filler, top],
      lastEvent: null,
      damagedRoads: s.players.map((): null => null),
    };
  };

  it('event cards end in the afterProduction hook, like dice', () => {
    hooks.afterProduction = (_d, roll) => (roll === 8 ? { kind: 'tst/after' } : undefined);
    const after = run(eventRoller(8, 'none'), { type: 'rollDice', player: 0 });
    expect(after.lastEvent).toBe('none');
    expect(after.phase.kind).toBe('tst/after');
  });

  it('Robber Attacks goes through the onSeven hook', () => {
    hooks.onSeven = () => ({ kind: 'tst/seven' });
    const after = run(eventRoller(7, 'robberAttacks'), { type: 'rollDice', player: 0 });
    expect(after.phase.kind).toBe('tst/seven');
  });

  it('the production hook gets the city yield (Epidemic) and the blocked hex (no robber)', () => {
    const seen: ProductionContext[] = [];
    hooks.production = (_s, _roll, _owed, ctx) => {
      seen.push(ctx);
    };
    run(eventRoller(8, 'epidemic'), { type: 'rollDice', player: 0 });
    const dice = withTst(emptyBoardGame());
    dice.rng = rngForRoll(8);
    run(dice, { type: 'rollDice', player: 0 });
    const none = { ...dice, settings: { ...dice.settings, robberMode: 'none' as const } };
    run(none, { type: 'rollDice', player: 0 });
    expect(seen).toEqual([
      { cityYield: 1, blocked: dice.robber },
      { cityYield: 2, blocked: dice.robber },
      { cityYield: 2, blocked: null },
    ]);
  });

  it('onStartTurn runs for the first turn after setup and for Catanian 2 (Second Settler)', () => {
    const started: number[] = [];
    hooks.onStartTurn = (_d, p) => {
      started.push(p);
    };
    let s = createGame({ seed: 4, players: players(4), mode: 'tst', startingPlayer: 0 });
    while (s.phase.kind === 'setup') s = run(s, legalActions(s)[0] as Action);
    expect(started).toEqual([0]);
    const paired: GameState = {
      ...s,
      settings: { ...s.settings, secondSettler: true, specialBuildPhase: false },
      phase: { kind: 'main' },
    };
    run(paired, { type: 'endTurn', player: 0 });
    expect(started).toEqual([0, 3]);
  });

  it('a setupBuilding hook wins over settings.setupPlacement', () => {
    hooks.setupBuilding = (_s, index) => (index === 0 ? 'settlement' : undefined);
    const s = createGame({
      seed: 2,
      players: players(3),
      mode: 'tst',
      startingPlayer: 0,
      setupPlacement: {
        first: { building: 'city', restriction: 'normal' },
        second: { building: 'city', restriction: 'normal' },
      },
    });
    const first = run(s, legalActions(s)[0] as Action);
    expect(Object.values(first.pieces.buildings)).toEqual([{ owner: 0, kind: 'settlement' }]);
    const road = run(first, legalActions(first)[0] as Action);
    const second = run(road, legalActions(road)[0] as Action);
    expect(Object.values(second.pieces.buildings).map((b) => b.kind)).toEqual([
      'settlement',
      'city',
    ]);
  });

  it('createGame refuses a map veto with expansions; random picks a fitting scenario map', () => {
    expect(() =>
      createGame({ seed: 1, players: players(3), mode: 'tst', mapSelection: 'veto' }),
    ).toThrow(/veto/);
    for (let seed = 0; seed < 10; seed++) {
      const s = createGame({ seed, players: players(5), mode: 'oil', mapSelection: 'random' });
      expect(s.settings.map).toBe('oil/fixed30');
      expect(s.settings.mapSelection).toBe('random');
    }
  });

  it('stats count the base parts of an expansion action (a road it places)', () => {
    const e = sideEdge(0, -2, 'NE');
    mod.actions = {
      'tst/freeRoad': (d, a) => {
        d.pieces.roads[e] = a.player;
        return { ok: true, state: d };
      },
    };
    const s = { ...withTst(emptyBoardGame()), phase: { kind: 'main' as const } };
    const after = run({ ...s, stats: emptyStats(4) }, { type: 'tst/freeRoad', player: 0 });
    expect(statsOf(after).players[0]?.built.road).toBe(1);
  });
});

describe('extraDevCards (deck counter)', () => {
  it('adds module dev cards to devDeckCounts; base games count the deck alone', () => {
    const base = midGame();
    const supply = Object.values(supplyOf(base).devDeck).reduce((n, k) => n + k, 0);
    expect(devDeckCounts(base)).toEqual({ left: base.devDeck.length, total: supply });
    hooks.extraDevCards = () => ({ deck: 2, total: 3 });
    const s = withTst(base);
    expect(devDeckCounts(s)).toEqual({ left: base.devDeck.length + 2, total: supply + 3 });
    hooks.extraDevCards = () => undefined;
    expect(devDeckCounts(s)).toEqual(devDeckCounts(base));
  });
});

describe('maskFor (online views)', () => {
  type Slice = { hands: string[][]; deck: string[] };
  const slice: Slice = { hands: [['a1'], ['b1', 'b2'], [], []], deck: ['d1', 'd2', 'd3'] };

  it('viewFor chains it after the base masks; hiddenFrom decides per seat', () => {
    hooks.maskFor = (view, viewer, state) => {
      expect(view.rng).toBe(0); // base masks already applied
      expect(state.rng).not.toBe(0);
      const s = view.ext['tst'] as Slice;
      return {
        ...view,
        ext: {
          ...view.ext,
          tst: {
            hands: s.hands.map((h, p) => (hiddenFrom(state, viewer, p) ? h.map(() => '?') : h)),
            deck: s.deck.map(() => '?'),
          },
        },
      };
    };
    const state = { ...withTst(midGame()), rng: 42 };
    (state.ext as Record<string, unknown>)['tst'] = slice;
    const v1 = viewFor(state, 1).ext['tst'] as Slice;
    expect(v1).toEqual({ hands: [['?'], ['b1', 'b2'], [], []], deck: ['?', '?', '?'] });
    const spec = viewFor(state, 'spectator').ext['tst'] as Slice;
    expect(spec.hands).toEqual([['?'], ['?', '?'], [], []]);
    expect(state.ext['tst']).toBe(slice); // not mutated
    const over = viewFor({ ...state, phase: { kind: 'gameOver' } }, 'spectator');
    expect((over.ext['tst'] as Slice).hands).toEqual(slice.hands);
  });

  it('is not called in base games', () => {
    hooks.maskFor = () => {
      throw new Error('called');
    };
    expect(() => viewFor(midGame(), 0)).not.toThrow();
  });
});

describe('composition order (ExpansionModule.before)', () => {
  const m = (id: string, before?: string[]): ExpansionModule => ({
    id,
    name: id,
    ...(before ? { before } : {}),
  });

  it('keeps registry order without `before`', () => {
    expect(composeOrder([m('a'), m('b'), m('c')]).map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });

  it('moves a module in front of the first module it names', () => {
    const order = composeOrder([m('ck'), m('sea'), m('x'), m('combo', ['ck', 'sea'])]);
    expect(order.map((x) => x.id)).toEqual(['combo', 'ck', 'sea', 'x']);
    const late = composeOrder([m('a'), m('sea'), m('combo', ['sea'])]);
    expect(late.map((x) => x.id)).toEqual(['a', 'combo', 'sea']);
  });

  it('ignores names that are not active', () => {
    expect(composeOrder([m('a'), m('combo', ['zzz'])]).map((x) => x.id)).toEqual(['a', 'combo']);
  });
});
