/**
 * Seafarers + Cities & Knights (docs/rules/scenarios-and-combos.md C2): one test per combined
 * rule, the composition order, and soundness. Board: Heading for New Shores, 4 players; (2,8) is
 * the main island's southern tip (sea to its S, SE and SW), as in seafarers/engine/ships.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { applyAction, legalActions } from '../../../engine/engine';
import { cloneState } from '../../../engine/clone';
import { createGame } from '../../../engine/createGame';
import { RESOURCES } from '../../../engine/constants';
import type { Action, EdgeId, GameState, HexId, PlayerId, VertexId } from '../../../engine/types';
import { ckSlice, merchantHexes, moveTargets, type ProgressCard } from '../../ck/engine';
import { giveCards, knight, rngFor, setGoods } from '../../ck/engine/testkit';
import { seaSlice } from '../../seafarers/engine';
import { graph, isShipEdge } from '../../seafarers/engine/geometry';
import { touchesLand } from '../../../engine/rules/placement';
import { tradeRouteLength } from '../../seafarers/engine/ships';
import { E, H, V, players, ship } from '../../seafarers/engine/testkit';
import { SEACK, SEACK_MODE, seackSlice } from '.';

const TIP = V(2, 8, 'SE'); // (2,8) | sea (3,9) | sea (2,10)
const TIP_W = V(2, 8, 'SW'); // (2,8) | sea (1,9) | sea (2,10)
const COAST_S = E(2, 8, 'S'); // land | sea, TIP_W - TIP
const SEA_SOUTH = H(2, 10);
const SEA_SE = H(3, 9);

function game(n = 4, extra: Record<string, unknown> = {}): GameState {
  return createGame({
    seed: 1,
    players: players(n),
    mode: SEACK_MODE,
    startingPlayer: 0,
    ...extra,
  });
}

/** Player 0 in the main phase of turn 3, nothing on the board, the pirate far away. */
function main(): GameState {
  const s = game();
  s.pieces.buildings = {};
  s.pieces.roads = {};
  s.turn = { number: 3, current: 0, devCardPlayed: false, tradeOffers: 0 };
  s.phase = { kind: 'main' };
  seaSlice(s).pirate = H(3, -1);
  return s;
}

const run = (s: GameState, ...actions: Action[]): GameState =>
  actions.reduce((st, a) => {
    const r = applyAction(st, a);
    if (!r.ok) throw new Error(`${JSON.stringify(a)}: ${r.error}`);
    return r.state;
  }, s);

const fails = (s: GameState, a: Action, match?: RegExp) => {
  const r = applyAction(s, a);
  expect(r.ok, JSON.stringify(a)).toBe(false);
  if (!r.ok && match) expect(r.error).toMatch(match);
};

const legalOf = (s: GameState, type: string) => legalActions(s).filter((a) => a.type === type);

/**
 * The nearest intersection touching no land, reached from TIP over ship edges: the edges of
 * that path and the vertex.
 */
function seaPath(s: GameState): { edges: EdgeId[]; end: VertexId } {
  const g = graph(s);
  const prev = new Map<VertexId, [VertexId, EdgeId]>();
  const queue: VertexId[] = [TIP];
  const seen = new Set<VertexId>([TIP, TIP_W]);
  while (queue.length > 0) {
    const v = queue.shift() as VertexId;
    if (v !== TIP && !touchesLand(s, v)) {
      const edges: EdgeId[] = [];
      for (let w = v; w !== TIP;) {
        const [from, e] = prev.get(w) as [VertexId, EdgeId];
        edges.unshift(e);
        w = from;
      }
      return { edges, end: v };
    }
    for (const e of g.edgesAt.get(v) ?? []) {
      if (!isShipEdge(s, e) || e === COAST_S) continue;
      const [a, b] = g.ends.get(e) as readonly [VertexId, VertexId];
      const w = a === v ? b : a;
      if (seen.has(w)) continue;
      seen.add(w);
      prev.set(w, [v, e]);
      queue.push(w);
    }
  }
  throw new Error('no open sea');
}

describe('the mode', () => {
  it('composes seack, ck and seafarers in that order (seack arbitrates first-wins hooks)', () => {
    const s = game();
    expect(s.settings.expansions).toEqual([SEACK, 'ck', 'seafarers']);
    expect(s.ext[SEACK]).toEqual({ v: 1, chase: null });
  });

  it('offers only the suitable scenarios, at their VP target + 2 (C2.1, C2.2)', () => {
    expect(game().settings.scenario).toBe('seafarers/newShores');
    expect(game().settings.vpToWin).toBe(16);
    const desert = game(4, { scenario: 'seafarers/throughTheDesert' });
    expect(desert.settings.vpToWin).toBe(16);
    expect(() => game(4, { scenario: 'seafarers/fogIslands' })).toThrow(/no scenario/);
    expect(() => game(4, { scenario: 'seafarers/fourIslands' })).toThrow(/no scenario/);
  });

  it('plays 3 to 6 players on the scenario maps, with the C&K supply', () => {
    for (const n of [3, 4, 5, 6]) {
      const s = game(n, n >= 5 ? { specialBuildPhase: true } : {});
      expect(s.players).toHaveLength(n);
      expect(s.devDeck).toHaveLength(0); // C&K: no development cards
      expect(ckSlice(s).bank.paper).toBe(n >= 5 ? 18 : 12);
    }
  });

  it('the second setup building is a city and a setup ship may replace the road', () => {
    const s = game();
    const actions = legalActions(s);
    expect(actions.some((a) => a.type === 'placeSetupSettlement')).toBe(true);
    // Play the setup out with the first legal choice; the second round places cities.
    let st = s;
    while (st.phase.kind === 'setup') st = run(st, legalActions(st)[0] as Action);
    const kinds = Object.values(st.pieces.buildings).map((b) => b.kind);
    expect(kinds.filter((k) => k === 'city')).toHaveLength(4);
  });
});

describe('production: commodities, gold, Aqueduct (C2.9)', () => {
  /** A city of player 0 on a vertex of `hex`, the dice rolling its number. */
  function rollOn(terrain: 'gold' | 'lumber', science = 0): GameState {
    const s = main();
    const hex = (Object.keys(s.board.hexes) as HexId[]).find(
      (h) => s.board.hexes[h]?.terrain === terrain && s.board.hexes[h]?.token !== null,
    ) as HexId;
    const tile = s.board.hexes[hex];
    const token = tile?.token as number;
    const v = graph(s).hexVertices.get(hex)?.[0] as VertexId;
    s.pieces.buildings[v] = { owner: 0, kind: 'city' };
    s.robber = 'h:999,999' as HexId;
    ckSlice(s).players[0]!.improvements.science = science;
    s.phase = { kind: 'preRoll' };
    const yellow = Math.max(1, token - 6);
    s.rng = rngFor(yellow, token - yellow, 'trade');
    return run(s, { type: 'rollDice', player: 0 });
  }

  it('a city on a gold field picks 2 resources and gets no commodity', () => {
    const s = rollOn('gold');
    expect(s.phase.kind).toBe('seafarers/gold');
    expect((s.phase as unknown as { pending: number[] }).pending[0]).toBe(2);
    const c = ckSlice(s).players[0]!.commodities;
    expect(c.paper + c.cloth + c.coin).toBe(0);
  });

  it('a city on forest still takes 1 lumber and 1 paper', () => {
    const s = rollOn('lumber');
    expect(s.players[0]!.resources.lumber).toBe(1);
    expect(ckSlice(s).players[0]!.commodities.paper).toBe(1);
    expect(s.phase.kind).toBe('main');
  });

  it('gold counts as cards for the Aqueduct; the Aqueduct follows the gold choice', () => {
    // Player 0 picks gold (no Aqueduct); player 1 (science 3, nothing) gets the Aqueduct after.
    const s = main();
    const gold = (Object.keys(s.board.hexes) as HexId[]).find(
      (h) => s.board.hexes[h]?.terrain === 'gold' && s.board.hexes[h]?.token !== null,
    ) as HexId;
    const token = s.board.hexes[gold]?.token as number;
    s.pieces.buildings[graph(s).hexVertices.get(gold)?.[0] as VertexId] = {
      owner: 0,
      kind: 'settlement',
    };
    // Player 1 on a land vertex where nothing produces on this number.
    const quiet = graph(s).vertices.find((v) => {
      const hexes = graph(s).hexesAt.get(v) ?? [];
      return (
        touchesLand(s, v) &&
        hexes.every((h) => s.board.hexes[h]?.token !== token && h !== gold) &&
        !(graph(s).neighbors.get(v) ?? []).some((w) => s.pieces.buildings[w])
      );
    }) as VertexId;
    s.pieces.buildings[quiet] = { owner: 1, kind: 'settlement' };
    for (const p of [0, 1]) ckSlice(s).players[p]!.improvements.science = 3;
    s.robber = 'h:999,999' as HexId;
    s.phase = { kind: 'preRoll' };
    const yellow = Math.max(1, token - 6);
    s.rng = rngFor(yellow, token - yellow, 'trade');
    let t = run(s, { type: 'rollDice', player: 0 });
    expect(t.phase.kind).toBe('seafarers/gold');
    t = run(t, {
      type: 'seafarers/pickGold',
      player: 0,
      resources: { ore: 1 },
    } as unknown as Action);
    expect(t.phase.kind).toBe('ck/aqueduct');
    expect((t.phase as unknown as { queue: PlayerId[] }).queue).toEqual([1]);
  });

  it('the merchant never goes on a gold field (C2.9)', () => {
    const s = main();
    const gold = (Object.keys(s.board.hexes) as HexId[]).find(
      (h) => s.board.hexes[h]?.terrain === 'gold',
    ) as HexId;
    s.pieces.buildings[graph(s).hexVertices.get(gold)?.[0] as VertexId] = {
      owner: 0,
      kind: 'settlement',
    };
    expect(merchantHexes(s, 0)).not.toContain(gold);
  });
});

describe('knights and ships (C2.3, C2.5-C2.7)', () => {
  /** Player 0: a settlement on TIP_W, ships on COAST_S and on to the open sea. */
  function fleet(): GameState {
    const s = main();
    s.pieces.buildings[TIP_W] = { owner: 0, kind: 'settlement' };
    ship(s, 0, COAST_S, ...seaPath(s).edges);
    return s;
  }
  const seaEnd = (s: GameState) => seaPath(s).end;
  const lastShip = (s: GameState) => seaPath(s).edges.at(-1) as EdgeId;

  it('a knight may be recruited where a ship touches the coast, never on the open sea', () => {
    const s = fleet();
    setGoods(s, 0, { wool: 1, ore: 1 });
    const spots = legalOf(s, 'ck/buildKnight').map((a) => (a as { vertex?: string }).vertex);
    expect(spots).toContain(TIP);
    expect(spots).not.toContain(seaEnd(s));
    fails(s, { type: 'ck/buildKnight', player: 0, vertex: seaEnd(s) } as Action);
    const t = run(s, { type: 'ck/buildKnight', player: 0, vertex: TIP } as Action);
    expect(ckSlice(t).knights[TIP]?.owner).toBe(0);
  });

  it('an active knight sails along its ships, onto a sea intersection', () => {
    const s = fleet();
    knight(s, 0, TIP, 1, true);
    expect(moveTargets(s, 0, TIP)).toContain(seaEnd(s));
    let t = run(s, { type: 'ck/selectKnight', player: 0, vertex: TIP } as Action);
    t = run(t, { type: 'ck/pickVertex', player: 0, vertex: seaEnd(s) } as Action);
    expect(ckSlice(t).knights[seaEnd(s)]?.owner).toBe(0);
    expect(ckSlice(t).knights[TIP]).toBeUndefined();
  });

  it('a knight without ships stays on land', () => {
    const s = main();
    s.pieces.buildings[TIP_W] = { owner: 0, kind: 'settlement' };
    s.pieces.roads[E(2, 8, 'SW')] = 0;
    knight(s, 0, TIP_W, 1, true);
    expect(moveTargets(s, 0, TIP_W).every((v) => graph(s).hexesAt.get(v) !== undefined)).toBe(true);
    expect(moveTargets(s, 0, TIP_W)).not.toContain(TIP);
  });

  it('a knight at the end of a ship route closes it: that ship cannot move', () => {
    const s = fleet();
    knight(s, 0, seaEnd(s), 1, true);
    expect(legalOf(s, 'seafarers/pickShip')).toHaveLength(0);
    fails(s, { type: 'seafarers/pickShip', player: 0, edge: lastShip(s) } as Action, /knight/);
    // Without the knight, the end ship moves.
    const t = fleet();
    expect(legalOf(t, 'seafarers/pickShip').length).toBeGreaterThan(0);
  });

  it('a ship next to a foreign knight cannot be moved to repair the route (C2.7)', () => {
    const s = fleet();
    knight(s, 1, seaEnd(s), 1, false);
    fails(s, { type: 'seafarers/pickShip', player: 0, edge: lastShip(s) } as Action);
    expect(
      legalOf(s, 'seafarers/pickShip').some((a) => (a as { edge?: EdgeId }).edge === lastShip(s)),
    ).toBe(false);
  });

  it('a foreign knight breaks the Longest Trade Route there (C2.7)', () => {
    const s = fleet();
    const n = 1 + seaPath(s).edges.length;
    const beyond = graph(s)
      .edgesAt.get(seaEnd(s))
      ?.find((e) => e !== lastShip(s)) as EdgeId;
    ship(s, 0, beyond);
    expect(tradeRouteLength(s, 0)).toBe(n + 1);
    knight(s, 1, seaEnd(s));
    expect(tradeRouteLength(s, 0)).toBe(n);
  });

  it('Road Building places ships as well as roads (C2.3)', () => {
    const s = fleet();
    giveCards(s, 0, 'roadBuilding' as ProgressCard);
    const t = run(s, { type: 'ck/play', player: 0, card: 'roadBuilding' } as Action);
    expect(t.phase.kind).toBe('roadBuilding');
    expect(legalOf(t, 'seafarers/placeFreeShip').length).toBeGreaterThan(0);
  });
});

describe('the robber and the pirate (C2.8, C2.10)', () => {
  /** An active knight of player 0 on TIP, the pirate on the sea hex south-east of it. */
  function chase(attacks = 1): GameState {
    const s = main();
    s.pieces.buildings[TIP_W] = { owner: 0, kind: 'settlement' };
    ship(s, 0, COAST_S, ...seaPath(s).edges);
    knight(s, 0, TIP, 1, true);
    seaSlice(s).pirate = SEA_SE;
    ckSlice(s).attacks = attacks;
    return s;
  }

  it('before the first attack neither the robber nor the pirate moves on a 7', () => {
    const s = main();
    s.pieces.buildings[TIP_W] = { owner: 0, kind: 'settlement' };
    s.phase = { kind: 'preRoll' };
    s.rng = rngFor(3, 4, 'trade');
    const t = run(s, { type: 'rollDice', player: 0 });
    expect(t.phase.kind).toBe('main');
  });

  it('the pirate cannot be chased before the first barbarian attack', () => {
    const s = run(chase(0), { type: 'ck/selectKnight', player: 0, vertex: TIP } as Action);
    expect(legalOf(s, 'seack/chasePirate')).toHaveLength(0);
    fails(s, { type: 'seack/chasePirate', player: 0 } as Action, /sleeps/);
  });

  it('an active knight next to the pirate chases it: deactivated, the pirate moves', () => {
    let s = run(chase(), { type: 'ck/selectKnight', player: 0, vertex: TIP } as Action);
    expect(legalOf(s, 'seack/chasePirate')).toHaveLength(1);
    s = run(s, { type: 'seack/chasePirate', player: 0 } as Action);
    expect(s.phase.kind).toBe('moveRobber');
    expect(ckSlice(s).knights[TIP]?.active).toBe(false);
    expect(seackSlice(s).chase).toBe('pirate');
    expect(legalOf(s, 'moveRobber')).toHaveLength(0);
    fails(s, { type: 'moveRobber', player: 0, hex: H(2, 8) }, /pirate/);
    s = run(s, { type: 'seafarers/movePirate', player: 0, hex: SEA_SOUTH } as Action);
    expect(seaSlice(s).pirate).toBe(SEA_SOUTH);
    expect(seackSlice(s).chase).toBeNull();
  });

  it('a knight not next to the pirate cannot chase it', () => {
    const s = chase();
    seaSlice(s).pirate = H(3, -1);
    const t = run(s, { type: 'ck/selectKnight', player: 0, vertex: TIP } as Action);
    fails(t, { type: 'seack/chasePirate', player: 0 } as Action, /next to the pirate/);
  });

  it('chasing the robber moves the robber only', () => {
    const s = chase();
    s.robber = H(2, 8);
    seaSlice(s).pirate = H(3, -1);
    let t = run(s, { type: 'ck/selectKnight', player: 0, vertex: TIP } as Action);
    t = run(t, { type: 'ck/chaseRobber', player: 0 } as Action);
    expect(seackSlice(t).chase).toBe('robber');
    expect(legalOf(t, 'seafarers/movePirate')).toHaveLength(0);
    fails(t, { type: 'seafarers/movePirate', player: 0, hex: SEA_SOUTH } as Action, /robber/);
    expect(legalOf(t, 'moveRobber').length).toBeGreaterThan(0);
  });

  it('after the first attack a 7 moves the robber or the pirate', () => {
    const s = chase();
    s.phase = { kind: 'moveRobber', resume: 'main' };
    expect(legalOf(s, 'moveRobber').length).toBeGreaterThan(0);
    expect(legalOf(s, 'seafarers/movePirate').length).toBeGreaterThan(0);
  });

  it('the Bishop moves the robber on land only', () => {
    const s = chase();
    giveCards(s, 0, 'bishop' as ProgressCard);
    const t = run(s, { type: 'ck/play', player: 0, card: 'bishop' } as Action);
    const hexes = legalOf(t, 'ck/pickHex').map((a) => (a as { hex?: HexId }).hex);
    expect(hexes.length).toBeGreaterThan(0);
    expect(hexes).not.toContain(SEA_SOUTH);
    for (const h of hexes) expect(t.board.hexes[h as HexId]?.terrain).not.toBe('sea');
    fails(t, { type: 'ck/pickHex', player: 0, hex: SEA_SOUTH } as Action);
  });
});

describe('soundness', { timeout: 120_000 }, () => {
  function walk(s0: GameState, seed: number, steps: number, check: (s: GameState) => void) {
    let s = s0;
    let pick = seed * 7919;
    for (let step = 0; step < steps && s.phase.kind !== 'gameOver'; step++) {
      const legal = legalActions(s);
      expect(legal.length, `no legal action in ${s.phase.kind}`).toBeGreaterThan(0);
      check(s);
      pick = (pick * 1103515245 + 12345) >>> 0;
      const progress = legal.filter((a) => a.type !== 'endTurn' && a.type !== 'ck/cancel');
      const from = progress.length > 0 && pick % 3 !== 0 ? progress : legal;
      const r = applyAction(s, from[pick % from.length] as Action);
      if (!r.ok) throw new Error(r.error);
      s = r.state;
    }
  }

  it('every legal action is accepted; states stay JSON-safe and cloneable', () => {
    for (const [seed, n, scenario] of [
      [1, 4, 'seafarers/newShores'],
      [2, 3, 'seafarers/throughTheDesert'],
      [3, 5, 'seafarers/newShores'],
    ] as const) {
      const s0 = game(n, { seed, scenario, ...(n >= 5 ? { specialBuildPhase: true } : {}) });
      walk(s0, seed, 2000, (s) => {
        for (const a of legalActions(s).slice(0, 25)) {
          const r = applyAction(s, a);
          expect(r.ok, `${JSON.stringify(a)}: ${r.ok ? '' : r.error}`).toBe(true);
        }
        if (s.turn.number % 50 === 0) {
          expect(JSON.parse(JSON.stringify(s))).toEqual(s);
          expect(cloneState(s)).toEqual(s);
        }
        expect(RESOURCES.every((r) => s.bank[r] >= 0)).toBe(true);
      });
    }
  });
});
