/**
 * Catan for Two + Cities & Knights (2025 sheet, docs/rules/combos.md §11): one test per rule,
 * the composition order, soundness.
 */
import { describe, expect, it } from 'vitest';
import { applyAction, legalActions } from '../../../engine/engine';
import { createGame } from '../../../engine/createGame';
import { edgeVertices, topologyOf, vertexEdges } from '../../../engine/topology';
import type { Action, EdgeId, GameState, PlayerId, VertexId } from '../../../engine/types';
import { ckSlice, displaceTargets, type KnightLevel } from '../../ck/engine';
import { bad, giveCards, legalOf, ok, rngFor, setGoods } from '../../ck/engine/testkit';
import { SC_BASE, twoOf } from '../../tb/engine';
import { TWOCK, TWOCK_MODE, goodsTradePrice, neutralKnightSpots, neutralOwner } from '.';

const players = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ name: `P${i}`, color: `#20202${i}` }));

const game = (extra: Record<string, unknown> = {}): GameState =>
  createGame({
    seed: 3,
    players: players(2),
    mode: TWOCK_MODE,
    scenario: SC_BASE,
    startingPlayer: 0,
    ...extra,
  });

/** Player 0 in the main phase of turn 3 (after both rolls), no player pieces on the board. */
function main(): GameState {
  const s = game();
  s.pieces.buildings = {};
  s.pieces.roads = {};
  s.turn = { number: 3, current: 0, devCardPlayed: false, tradeOffers: 0 };
  s.phase = { kind: 'main' };
  twoOf(s).rolls = 2;
  return s;
}

const act = (a: Record<string, unknown>) => a as unknown as Action;
const other = (s: GameState, e: EdgeId, v: VertexId) =>
  edgeVertices(topologyOf(s), e).find((x) => x !== v) as VertexId;

function knight(
  s: GameState,
  owner: PlayerId,
  v: VertexId,
  level: KnightLevel = 1,
  active = false,
) {
  ckSlice(s).knights[v] = {
    owner,
    level,
    active,
    activatedOn: active ? 1 : null,
    promotedOn: null,
  };
}

/** A land vertex at least 3 steps from both neutral settlements. */
function farVertex(s: GameState): VertexId {
  const t = topologyOf(s);
  const near = new Set<VertexId>(twoOf(s).neutrals.flatMap((n) => n.settlements));
  for (let i = 0; i < 2; i++) {
    for (const v of [...near]) for (const w of t.vertex[v]?.vertices ?? []) near.add(w);
  }
  const v = t.vertices.find((x) => !near.has(x) && (t.vertex[x]?.hexes.length ?? 0) === 3);
  if (!v) throw new Error('no far vertex');
  return v;
}

/** Player 0: a settlement far from the neutrals, a road to its neighbour; returns the far end. */
function homestead(s: GameState): { home: VertexId; end: VertexId; road: EdgeId } {
  const home = farVertex(s);
  const road = vertexEdges(topologyOf(s), home)[0] as EdgeId;
  s.pieces.buildings[home] = { owner: 0, kind: 'settlement' };
  s.pieces.roads[road] = 0;
  return { home, end: other(s, road, home), road };
}

/** Neutral 0: a road out of its starting settlement; returns the road's far end. */
function neutralRoad(s: GameState): VertexId {
  const start = twoOf(s).neutrals[0].settlements[0] as VertexId;
  const e = vertexEdges(topologyOf(s), start)[0] as EdgeId;
  twoOf(s).neutrals[0].roads.push(e);
  return other(s, e, start);
}

describe('the mode', () => {
  it('composes twock, ck and tb; 2 players on the base board, 13 VP, neutrals and tokens', () => {
    const s = game();
    expect(s.settings.expansions).toEqual([TWOCK, 'ck', 'tb']);
    expect(s.settings.vpToWin).toBe(13);
    expect(() => game({ players: players(3) })).toThrow();
    expect(() => game({ scenario: 'tb/fishermen' })).toThrow();
    expect(twoOf(s).neutrals.map((n) => n.settlements.length)).toEqual([1, 1]);
    expect(twoOf(s).tokens).toEqual([5, 5]);
  });

  it('the second setup placement is a city (C&K)', () => {
    const s = game();
    s.phase = { kind: 'setup', index: 2, step: 'settlement', lastSettlement: null };
    s.turn.current = 1;
    const v = farVertex(s);
    const next = ok(s, { type: 'placeSetupSettlement', player: 1, vertex: v });
    expect(next.pieces.buildings[v]?.kind).toBe('city');
  });
});

describe('two Roll Dice and Production phases', () => {
  it('a second roll follows the first; its production dice differ; the event die rolls twice', () => {
    const s = main();
    s.phase = { kind: 'preRoll' };
    twoOf(s).rolls = 0;
    s.rng = rngFor(1, 2, 'trade');
    const first = ok(s, { type: 'rollDice', player: 0 });
    expect(first.phase.kind).toBe('preRoll');
    // The next draw would repeat 3 (1+2): T&B rolls the production dice again.
    first.rng = rngFor(1, 2, 'trade');
    const second = ok(first, { type: 'rollDice', player: 0 });
    expect(second.phase.kind).toBe('main');
    expect((second.dice?.[0] ?? 0) + (second.dice?.[1] ?? 0)).not.toBe(3);
    const faces = second.log.filter((l) => l.text.includes('The event die shows')).length;
    expect(faces).toBe(2);
  });

  it('Alchemy only before the first roll', () => {
    const s = main();
    giveCards(s, 0, 'alchemist');
    s.phase = { kind: 'preRoll' };
    twoOf(s).rolls = 0;
    expect(legalOf(s, 'ck/alchemist').length).toBeGreaterThan(0);
    twoOf(s).rolls = 1;
    expect(legalOf(s, 'ck/alchemist')).toHaveLength(0);
    bad(s, act({ type: 'ck/alchemist', player: 0, yellow: 2, red: 3 }), /first roll/);
  });
});

describe('neutral knights', () => {
  it('recruiting a knight recruits a free neutral knight on a neutral road', () => {
    const s = main();
    const { end } = homestead(s);
    const spot = neutralRoad(s);
    setGoods(s, 0, { wool: 1, ore: 1 });
    const next = ok(s, act({ type: 'ck/buildKnight', player: 0, vertex: end }));
    expect(next.phase.kind).toBe('twock/neutral');
    const options = legalActions(next);
    expect(options.every((a) => a.type === 'twock/neutralKnight')).toBe(true);
    expect(neutralKnightSpots(next, 0)).toContain(spot);
    const done = ok(
      next,
      act({ type: 'twock/neutralKnight', player: 0, vertex: spot, neutral: 0 }),
    );
    expect(ckSlice(done).knights[spot]).toMatchObject({
      owner: neutralOwner(done, 0),
      level: 1,
      active: false,
    });
    expect(done.phase.kind).toBe('main');
  });

  it('with no neutral knight spot, a neutral road instead', () => {
    const s = main();
    const { end } = homestead(s);
    setGoods(s, 0, { wool: 1, ore: 1 });
    const next = ok(s, act({ type: 'ck/buildKnight', player: 0, vertex: end }));
    expect(next.phase).toMatchObject({ kind: 'tb/neutral', piece: 'road' });
  });

  it('promoting to strong promotes a neutral knight; never to mighty', () => {
    const s = main();
    const { end } = homestead(s);
    const spot = neutralRoad(s);
    knight(s, 0, end, 1);
    knight(s, neutralOwner(s, 0), spot, 1);
    setGoods(s, 0, { wool: 2, ore: 2 });
    const up = ok(s, act({ type: 'ck/promoteKnight', player: 0, vertex: end }));
    expect(up.phase).toMatchObject({ kind: 'twock/neutral', step: 'promote' });
    const done = ok(up, act({ type: 'twock/neutralPromote', player: 0, vertex: spot }));
    expect(ckSlice(done).knights[spot]?.level).toBe(2);
    // Strong → mighty (Fortress): no neutral step.
    ckSlice(done).players[0]!.improvements.politics = 3;
    done.turn.number = 4;
    const mighty = ok(done, act({ type: 'ck/promoteKnight', player: 0, vertex: end }));
    expect(mighty.phase.kind).toBe('main');
  });

  it('neutral knights are another player’s knights: never activated, they block, a stronger knight displaces them', () => {
    const s = main();
    const { end, road } = homestead(s);
    const n = neutralOwner(s, 0);
    knight(s, n, end, 1);
    // Not one of the players' knights.
    bad(s, act({ type: 'ck/activateKnight', player: 0, vertex: end }));
    const home = other(s, road, end);
    delete s.pieces.buildings[home];
    knight(s, 0, home, 2, true);
    expect(displaceTargets(s, 0, home)).toContain(end);
  });

  it('the current player moves a displaced neutral knight (no seat to ask)', () => {
    const s = main();
    const t = topologyOf(s);
    const b = farVertex(s);
    const [eA, eC, eD] = vertexEdges(t, b) as EdgeId[];
    const a = other(s, eA!, b);
    s.pieces.roads[eA!] = 0;
    s.pieces.buildings[a] = { owner: 0, kind: 'settlement' };
    // P0's strong active knight next to its settlement, reaching b along its road.
    delete s.pieces.buildings[a];
    knight(s, 0, a, 2, true);
    const n = neutralOwner(s, 0);
    knight(s, n, b, 1);
    twoOf(s).neutrals[0].roads.push(eC!, eD!);
    const sel = ok(s, act({ type: 'ck/selectKnight', player: 0, vertex: a }));
    const moved = ok(sel, act({ type: 'ck/pickVertex', player: 0, vertex: b }));
    expect(moved.phase).toMatchObject({ kind: 'ck/relocate', player: n });
    const options = legalActions(moved);
    expect(options.length).toBeGreaterThan(1);
    expect(options.every((x) => x.type === 'twock/relocate' && x.player === 0)).toBe(true);
    const done = ok(moved, options[0]!);
    expect(Object.values(ckSlice(done).knights).some((x) => x.owner === n)).toBe(true);
    expect(done.phase.kind).toBe('main');
  });

  it('knights are never recruited on a neutral settlement', () => {
    const s = main();
    const start = twoOf(s).neutrals[0].settlements[0] as VertexId;
    const e = vertexEdges(topologyOf(s), start)[0] as EdgeId;
    const v = other(s, e, start);
    s.pieces.buildings[v] = { owner: 0, kind: 'settlement' };
    s.pieces.roads[e] = 0;
    setGoods(s, 0, { wool: 1, ore: 1 });
    expect(
      legalOf(s, 'ck/buildKnight').map((x) => (x as { vertex?: string }).vertex),
    ).not.toContain(start);
    bad(s, act({ type: 'ck/buildKnight', player: 0, vertex: start }));
  });
});

describe('trade tokens', () => {
  it.each([
    [1, 1],
    [2, 2],
    [3, 3],
  ] as const)('removing a level-%i knight gives %i tokens, once a turn', (level, tokens) => {
    const s = main();
    const { end } = homestead(s);
    knight(s, 0, end, level);
    const before = twoOf(s).tokens[0]!;
    const next = ok(s, act({ type: 'twock/knightForTokens', player: 0, vertex: end }));
    expect(twoOf(next).tokens[0]).toBe(before + tokens);
    expect(ckSlice(next).knights[end]).toBeUndefined();
    knight(next, 0, end, 1);
    bad(next, act({ type: 'twock/knightForTokens', player: 0, vertex: end }), /one knight a turn/);
  });

  it('an empty supply gives no tokens: spend some first', () => {
    const s = main();
    const { end } = homestead(s);
    knight(s, 0, end, 3);
    twoOf(s).tokens[1] = (twoOf(s).tokens[1] ?? 0) + twoOf(s).supply;
    twoOf(s).supply = 0;
    expect(legalOf(s, 'twock/knightForTokens')).toHaveLength(0);
  });

  it('Forced Trade (resources only) leaves the opponent’s commodities aside', () => {
    const s = main();
    for (const p of [0, 1]) setGoods(s, p, {});
    setGoods(s, 1, { paper: 2 });
    setGoods(s, 0, { brick: 2 });
    expect(legalOf(s, 'tb/forcedTrade')).toHaveLength(0);
    setGoods(s, 1, { paper: 2, ore: 1 });
    const next = ok(s, { type: 'tb/forcedTrade', player: 0 } as unknown as Action);
    expect(next.players[0]!.resources.ore).toBe(1);
    expect(ckSlice(next).players[0]!.commodities.paper).toBe(0);
  });

  it('Forced Trade (any cards) costs twice as much and takes and gives commodities', () => {
    const s = main();
    for (const p of [0, 1]) setGoods(s, p, {});
    setGoods(s, 1, { paper: 2 });
    setGoods(s, 0, { coin: 1, brick: 1 });
    const price = goodsTradePrice(s, 0);
    expect(price).toBe(2);
    const tokens = twoOf(s).tokens[0]!;
    const next = ok(s, act({ type: 'twock/forcedTrade', player: 0 }));
    expect(twoOf(next).tokens[0]).toBe(tokens - price);
    expect(ckSlice(next).players[0]!.commodities.paper).toBe(2);
    expect(next.phase).toMatchObject({ kind: 'twock/forcedGive', count: 2 });
    const done = ok(
      next,
      act({
        type: 'twock/forcedGive',
        player: 0,
        resources: { brick: 1 },
        commodities: { coin: 1 },
      }),
    );
    expect(ckSlice(done).players[1]!.commodities.coin).toBe(1);
    expect(done.players[1]!.resources.brick).toBe(1);
    expect(done.phase.kind).toBe('main');
  });
});

describe('progress cards', () => {
  it('Road Building: a neutral road after each of the 2 roads', () => {
    const s = main();
    homestead(s);
    neutralRoad(s);
    giveCards(s, 0, 'roadBuilding');
    let r = ok(s, act({ type: 'ck/play', player: 0, card: 'roadBuilding' }));
    const road = legalOf(r, 'placeFreeRoad')[0]!;
    r = ok(r, road);
    expect(r.phase).toMatchObject({ kind: 'tb/neutral', piece: 'road' });
  });

  it('Diplomacy: no neutral road when you take back and rebuild your own road', () => {
    const s = main();
    const { road } = homestead(s);
    giveCards(s, 0, 'diplomat');
    let r = ok(s, act({ type: 'ck/play', player: 0, card: 'diplomat' }));
    r = ok(r, act({ type: 'ck/pickEdge', player: 0, edge: road }));
    const again = legalOf(r, 'ck/pickEdge').find(
      (a) => (a as { edge?: string }).edge !== undefined,
    )!;
    r = ok(r, again);
    expect(r.phase.kind).toBe('main');
  });

  it('Treason against a neutral removes its weakest knight; your knight may take a spot, no neutral one follows', () => {
    const s = main();
    const { end } = homestead(s);
    const n = neutralOwner(s, 0);
    const spot = neutralRoad(s);
    knight(s, n, spot, 1);
    giveCards(s, 0, 'deserter');
    let r = ok(s, act({ type: 'ck/play', player: 0, card: 'deserter' }));
    expect(legalOf(r, 'twock/deserterNeutral').length).toBe(1);
    r = ok(r, act({ type: 'twock/deserterNeutral', player: 0, neutral: 0 }));
    expect(ckSlice(r).knights[spot]).toBeUndefined();
    r = ok(r, act({ type: 'ck/pickVertex', player: 0, vertex: end }));
    expect(ckSlice(r).knights[end]).toMatchObject({ owner: 0, level: 1 });
    expect(r.phase.kind).toBe('main');
  });
});

describe('soundness', { timeout: 300_000 }, () => {
  it('every legal action is accepted', () => {
    for (const seed of [1, 2, 3]) {
      let s = createGame({ seed, players: players(2), mode: TWOCK_MODE, scenario: SC_BASE });
      let pick = seed * 7919;
      for (let step = 0; step < 3000 && s.phase.kind !== 'gameOver'; step++) {
        const legal = legalActions(s);
        expect(legal.length, `no legal action in ${s.phase.kind}`).toBeGreaterThan(0);
        pick = (pick * 1103515245 + 12345) >>> 0;
        const progress = legal.filter((a) => a.type !== 'endTurn' && a.type !== 'ck/cancel');
        const from = progress.length > 0 && pick % 3 !== 0 ? progress : legal;
        const a = from[pick % from.length] as Action;
        const r = applyAction(s, a);
        if (!r.ok) throw new Error(`${JSON.stringify(a)}: ${r.error}`);
        s = r.state;
      }
    }
  });
});
