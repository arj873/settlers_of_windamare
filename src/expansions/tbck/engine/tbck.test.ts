/**
 * Traders & Barbarians + Cities & Knights (docs/rules/scenarios-and-combos.md C4): one test per
 * combined rule, the composition order, soundness.
 */
import { describe, expect, it } from 'vitest';
import { applyAction, legalActions } from '../../../engine/engine';
import { cloneState } from '../../../engine/clone';
import { createGame } from '../../../engine/createGame';
import { isCentreVertex } from '../../../engine/hex';
import { topologyOf } from '../../../engine/topology';
import type { Action, EdgeId, GameState, HexId, PlayerId, VertexId } from '../../../engine/types';
import { ckSlice, type ProgressCard } from '../../ck/engine';
import { giveCards, knight, rngFor, setGoods } from '../../ck/engine/testkit';
import { TB_MAPS, bridgesOf, goldOf, tbBoard, tbSlice } from '../../tb/engine';
import { fishOf, tradersOf } from '../../tb/engine/state';
import { edgeOnRiver, vertexOnRiver } from '../../tb/engine/rivers';
import { TBCK, TBCK_MODE, TBCK_VP } from '.';

const players = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ name: `P${i}`, color: `#20202${i}` }));

function game(scenario: string, n = 4, extra: Record<string, unknown> = {}): GameState {
  return createGame({
    seed: 3,
    players: players(n),
    mode: TBCK_MODE,
    scenario,
    startingPlayer: 0,
    ...extra,
  });
}

/** Player 0 in the main phase of turn 3, nothing on the board. */
function main(scenario: string): GameState {
  const s = game(scenario);
  s.pieces.buildings = {};
  s.pieces.roads = {};
  s.turn = { number: 3, current: 0, devCardPlayed: false, tradeOffers: 0 };
  s.phase = { kind: 'main' };
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
const commodities = (s: GameState, p: PlayerId) => {
  const c = ckSlice(s).players[p]!.commodities;
  return c.paper + c.cloth + c.coin;
};

describe('the mode', () => {
  it('composes tbck, ck and tb in that order', () => {
    expect(game('tb/fishermen').settings.expansions).toEqual([TBCK, 'ck', 'tb']);
  });

  it('offers the scenarios with an official C&K combination at their VP targets (C4)', () => {
    for (const [scenario, vp] of Object.entries(TBCK_VP)) {
      expect(game(scenario).settings.vpToWin, scenario).toBe(vp);
    }
    expect(game('tb/fishermen').settings.vpToWin).toBe(13);
    expect(game('tb/caravans').settings.vpToWin).toBe(15);
    expect(game('tb/traders').settings.vpToWin).toBe(15);
    expect(() => game('tb/barbarianAttack')).toThrow(/no scenario/);
    expect(() => game('tb/fishermen', 2)).toThrow(/players/);
  });

  it('has no development cards; T&B cards are not drawn either', () => {
    const s = main('tb/traders');
    expect(s.devDeck).toHaveLength(0);
    s.players[0]!.resources = { brick: 0, lumber: 0, wool: 1, grain: 1, ore: 1 };
    expect(legalOf(s, 'buyDevCard')).toHaveLength(0);
    fails(s, { type: 'buyDevCard', player: 0 }, /development cards/);
  });
});

describe('Fishermen + C&K', () => {
  function fisher(fish: number[]): GameState {
    const s = main('tb/fishermen');
    const f = fishOf(s);
    for (const t of fish) {
      const i = f.pool.indexOf(t);
      f.pool.splice(i, 1);
      f.hands[0]!.push(t);
    }
    return s;
  }

  it('3 fish steal a resource or a commodity (C4)', () => {
    const s = fisher([3]);
    setGoods(s, 1, { coin: 1 });
    expect(legalOf(s, 'tb/fish').some((a) => (a as { victim?: number }).victim === 1)).toBe(true);
    const t = run(s, { type: 'tb/fish', player: 0, use: 'steal', victim: 1 } as Action);
    expect(ckSlice(t).players[0]!.commodities.coin).toBe(1);
    expect(fishOf(t).hands[0]).toEqual([]);
  });

  it('7 fish take a progress card of your choice, not a development card (C4)', () => {
    const s = fisher([3, 3, 1]);
    const cards = legalOf(s, 'tbck/fishProgress').map((a) => (a as { card?: string }).card);
    expect(cards).toContain('alchemist');
    expect(cards).toContain('bishop');
    expect(new Set(cards).size).toBe(cards.length);
    expect(legalOf(s, 'tb/fish').some((a) => (a as { use?: string }).use === 'devCard')).toBe(
      false,
    );
    fails(s, { type: 'tb/fish', player: 0, use: 'devCard' } as Action);
    const t = run(s, { type: 'tbck/fishProgress', player: 0, card: 'alchemist' } as Action);
    expect(ckSlice(t).players[0]!.progress).toEqual(['alchemist']);
    expect(ckSlice(t).decks.science.length).toBe(ckSlice(s).decks.science.length - 1);
    expect(fishOf(t).hands[0]).toEqual([]);
    // A VP card is laid out at once.
    const u = run(fisher([3, 3, 1]), {
      type: 'tbck/fishProgress',
      player: 0,
      card: 'printer',
    } as Action);
    expect(ckSlice(u).players[0]!.vpCards).toEqual(['printer']);
  });

  it('fish are no cards: a player catching only fish still gets the Aqueduct (FAQ 43)', () => {
    const s = main('tb/fishermen');
    const ground = tbBoard(s).grounds?.[0];
    expect(ground).toBeDefined();
    const v = ground!.vertices[0] as VertexId;
    s.pieces.buildings[v] = { owner: 1, kind: 'settlement' };
    ckSlice(s).players[1]!.improvements.science = 3;
    // Roll the ground's number with nothing else of player 1 producing.
    const roll = ground!.number;
    s.robber = 'h:999,999' as HexId;
    for (const h of topologyOf(s).vertex[v]?.hexes ?? []) {
      const tile = s.board.hexes[h];
      if (tile && tile.token === roll) s.board.hexes[h] = { ...tile, token: roll === 5 ? 9 : 5 };
    }
    s.phase = { kind: 'preRoll' };
    const yellow = Math.max(1, roll - 6);
    s.rng = rngFor(yellow, roll - yellow, 'trade');
    const t = run(s, { type: 'rollDice', player: 0 });
    expect(fishOf(t).hands[1]!.length).toBeGreaterThan(0);
    expect(t.phase.kind).toBe('ck/aqueduct');
  });
});

describe('Rivers + C&K', () => {
  it('a setup city on a river intersection pays 1 gold (T&B already pays it, once)', () => {
    const t = main('tb/rivers');
    const v = topologyOf(t).vertices.find((x) => vertexOnRiver(t, x)) as VertexId;
    // Step 7 of the snake order is player 0's second building: a city in C&K.
    t.phase = { kind: 'setup', index: 7, step: 'settlement', lastSettlement: null };
    const before = goldOf(t, 0);
    const after = run(t, { type: 'placeSetupSettlement', player: 0, vertex: v });
    expect(after.pieces.buildings[v]?.kind).toBe('city');
    expect(goldOf(after, 0)).toBe(before + 1);
  });

  it('commodities sell for gold at the normal rate (C4)', () => {
    const s = main('tb/rivers');
    setGoods(s, 0, { paper: 4 });
    const gold = goldOf(s, 0);
    expect(legalOf(s, 'tbck/sellCommodity')).toHaveLength(1);
    const t = run(s, { type: 'tbck/sellCommodity', player: 0, commodity: 'paper' } as Action);
    expect(goldOf(t, 0)).toBe(gold + 1);
    expect(commodities(t, 0)).toBe(0);
    setGoods(s, 0, { paper: 3 });
    fails(s, { type: 'tbck/sellCommodity', player: 0, commodity: 'paper' } as Action, /needs 4/);
  });

  function diplomat(edge: EdgeId, owner: PlayerId, gold: number): GameState {
    const s = main('tb/rivers');
    s.pieces.roads[edge] = owner;
    // An ordinary open road far away, so the Diplomat has something to take.
    const t = topologyOf(s);
    const near = new Set(t.edge[edge]?.edges ?? []);
    const plain = t.edges.find(
      (e) =>
        e !== edge &&
        !near.has(e) &&
        !edgeOnRiver(s, e) &&
        !(tbBoard(s).bridgeSites ?? []).includes(e),
    ) as EdgeId;
    s.pieces.roads[plain] = 2;
    tbSlice(s).gold[0] = gold;
    giveCards(s, 0, 'diplomat' as ProgressCard);
    return run(s, { type: 'ck/play', player: 0, card: 'diplomat' } as Action);
  }

  it('the Diplomat never removes a bridge', () => {
    const site = (tbBoard(main('tb/rivers')).bridgeSites ?? [])[0] as EdgeId;
    const s = diplomat(site, 1, 5);
    bridgesOf(s)[site] = 1;
    expect(legalOf(s, 'ck/pickEdge').some((a) => (a as { edge?: EdgeId }).edge === site)).toBe(
      false,
    );
    fails(s, { type: 'ck/pickEdge', player: 0, edge: site } as Action, /bridge/);
  });

  it('removing a road at a river costs the Diplomat 1 gold', () => {
    const s0 = main('tb/rivers');
    const sites = new Set(tbBoard(s0).bridgeSites ?? []);
    const t = topologyOf(s0);
    const river = new Set(tbBoard(s0).rivers ?? []);
    const edge = t.edges.find(
      (e) => !sites.has(e) && (t.edge[e]?.hexes ?? []).some((h) => river.has(h)),
    ) as EdgeId;
    // Without gold and with only that road open, the Diplomat cannot even be played.
    const poor = main('tb/rivers');
    poor.pieces.roads[edge] = 1;
    tbSlice(poor).gold[0] = 0;
    giveCards(poor, 0, 'diplomat' as ProgressCard);
    expect(legalOf(poor, 'ck/play').some((a) => (a as { card?: string }).card === 'diplomat')).toBe(
      false,
    );
    fails(poor, { type: 'ck/play', player: 0, card: 'diplomat' } as Action, /Diplomat/);
    const rich = diplomat(edge, 1, 2);
    const after = run(rich, { type: 'ck/pickEdge', player: 0, edge } as Action);
    expect(after.pieces.roads[edge]).toBeUndefined();
    expect(goldOf(after, 0)).toBe(1);
  });
});

describe('Rivers + C&K: keeping a city for 5 gold', () => {
  /** Player 1 has one city (and a wall); the barbarians land on player 0's roll, unopposed. */
  function attack(gold: number): GameState {
    const s = main('tb/rivers');
    const t = topologyOf(s);
    const v = t.vertices.find((x) => (t.vertex[x]?.hexes.length ?? 0) === 3) as VertexId;
    s.pieces.buildings[v] = { owner: 1, kind: 'city' };
    ckSlice(s).walls[v] = 1;
    ckSlice(s).barbarian = 6;
    tbSlice(s).gold[1] = gold;
    s.phase = { kind: 'preRoll' };
    s.rng = rngFor(2, 1, 'ship');
    return run(s, { type: 'rollDice', player: 0 });
  }
  const cityAt = (s: GameState) =>
    (Object.entries(s.pieces.buildings) as [VertexId, { owner: number; kind: string }][]).find(
      ([, b]) => b.owner === 1,
    );

  it('the owner of a pillaged city with 5 gold may pay to keep it (with its wall)', () => {
    const s = attack(6);
    expect(s.phase.kind).toBe('tbck/ransom');
    expect(legalActions(s).map((a) => (a as { pay?: boolean }).pay)).toEqual([false, true]);
    const kept = run(s, { type: 'tbck/ransom', player: 1, pay: true } as Action);
    const [v, b] = cityAt(kept)!;
    expect(b.kind).toBe('city');
    expect(ckSlice(kept).walls[v]).toBe(1);
    expect(goldOf(kept, 1)).toBe(1);
    expect(kept.phase.kind).toBe('main');
    const lost = run(s, { type: 'tbck/ransom', player: 1, pay: false } as Action);
    expect(cityAt(lost)![1].kind).toBe('settlement');
    expect(goldOf(lost, 1)).toBe(6);
  });

  it('without 5 gold the city is simply pillaged', () => {
    const s = attack(4);
    expect(s.phase.kind).toBe('main');
    expect(cityAt(s)![1].kind).toBe('settlement');
  });
});

describe('Caravans + C&K', () => {
  function vote(): GameState {
    const s = main('tb/caravans');
    s.phase = {
      kind: 'tb/vote',
      ender: 0,
      order: [0, 1, 2, 3],
      bids: [0, 0, 0, 0],
      camels: 1,
      placer: null,
      then: 'endTurn',
    } as unknown as GameState['phase'];
    s.players[0]!.resources = { brick: 2, lumber: 1, wool: 2, grain: 2, ore: 0 };
    return s;
  }

  it('the vote is bid with brick and lumber, not wool and grain (C4)', () => {
    const s = vote();
    const bids = legalOf(s, 'tb/bid') as unknown as Record<string, number>[];
    expect(bids.some((b) => (b['wool'] ?? 0) + (b['grain'] ?? 0) > 0)).toBe(false);
    expect(bids.some((b) => b['brick'] === 2 && b['lumber'] === 1)).toBe(true);
    fails(s, { type: 'tb/bid', player: 0, wool: 1, grain: 0 } as Action, /brick and lumber/);
    const t = run(s, { type: 'tb/bid', player: 0, brick: 2, lumber: 1 } as Action);
    expect(t.players[0]!.resources.brick).toBe(0);
    expect((t.phase as unknown as { bids: number[] }).bids[0]).toBe(3);
  });

  it('the Bishop never puts the robber on the oasis', () => {
    const s = main('tb/caravans');
    ckSlice(s).attacks = 1;
    s.robber = (Object.keys(s.board.hexes) as HexId[]).find(
      (h) => s.board.hexes[h]?.terrain === 'grain',
    ) as HexId;
    giveCards(s, 0, 'bishop' as ProgressCard);
    const t = run(s, { type: 'ck/play', player: 0, card: 'bishop' } as Action);
    const oasis = (Object.keys(t.board.hexes) as HexId[]).find(
      (h) => t.board.hexes[h]?.terrain === 'tb/oasis',
    ) as HexId;
    expect(legalOf(t, 'ck/pickHex').some((a) => (a as { hex?: HexId }).hex === oasis)).toBe(false);
    fails(t, { type: 'ck/pickHex', player: 0, hex: oasis } as Action, /oasis/);
  });
});

describe('Traders & Barbarians + C&K', () => {
  it('the board has one forest fewer and one field more than T&B alone (C4)', () => {
    const count = (s: GameState, t: string) =>
      Object.values(s.board.hexes).filter((x) => x.terrain === t).length;
    const combo = game('tb/traders');
    const alone = createGame({
      seed: 3,
      players: players(4),
      mode: 'tb',
      scenario: 'tb/traders',
      startingPlayer: 0,
    });
    expect(count(combo, 'lumber')).toBe(count(alone, 'lumber') - 1);
    expect(count(combo, 'grain')).toBe(count(alone, 'grain') + 1);
    expect(TB_MAPS.some((m) => m.id === combo.settings.map)).toBe(true);
  });

  /** An active knight of player 0 at an end of the first barbarian's path. */
  function chase(): { s: GameState; edge: EdgeId; v: VertexId } {
    const s = main('tb/traders');
    const edge = tradersOf(s).barbarians[0] as EdgeId;
    const v = topologyOf(s).edge[edge]!.vertices.find((x) => !isCentreVertex(x)) as VertexId;
    knight(s, 0, v, 1, true);
    s.phase = { kind: 'ck/knight', vertex: v, resume: 'main' } as unknown as GameState['phase'];
    return { s, edge, v };
  }

  it('an active knight next to a barbarian chases it to a free path and is deactivated', () => {
    const { s, edge, v } = chase();
    expect(legalOf(s, 'tbck/chaseBarbarian')).toEqual([
      { type: 'tbck/chaseBarbarian', player: 0, edge },
    ]);
    const t = run(s, { type: 'tbck/chaseBarbarian', player: 0, edge } as Action);
    expect(ckSlice(t).knights[v]?.active).toBe(false);
    expect(t.phase.kind).toBe('tb/barbarian');
    const dest = legalOf(t, 'tb/placeBarbarian')[0] as unknown as { edge: EdgeId };
    const u = run(t, { type: 'tb/placeBarbarian', player: 0, edge: dest.edge } as Action);
    expect(tradersOf(u).barbarians).toContain(dest.edge);
    expect(tradersOf(u).barbarians).not.toContain(edge);
    expect(u.phase.kind).toBe('main');
  });

  it('a chased barbarian robs a resource or a commodity from the road owner', () => {
    const { s, edge } = chase();
    const t = run(s, { type: 'tbck/chaseBarbarian', player: 0, edge } as Action);
    const target = topologyOf(t).edges.find(
      (e) => !tradersOf(t).barbarians.includes(e) && legalOf(t, 'tb/placeBarbarian').length > 0,
    ) as EdgeId;
    t.pieces.roads[target] = 1;
    setGoods(t, 1, { cloth: 1 });
    const u = run(t, { type: 'tb/placeBarbarian', player: 0, edge: target } as Action);
    expect(ckSlice(u).players[0]!.commodities.cloth).toBe(1);
    expect(commodities(u, 1)).toBe(0);
  });

  it('an inactive knight cannot chase a barbarian', () => {
    const { s, edge, v } = chase();
    ckSlice(s).knights[v]!.active = false;
    expect(legalOf(s, 'tbck/chaseBarbarian')).toHaveLength(0);
    fails(s, { type: 'tbck/chaseBarbarian', player: 0, edge } as Action, /active/);
  });

  it('a knight never stands on a trade hex plaza', () => {
    const s = main('tb/traders');
    const plaza = topologyOf(s).vertices.find((v) => isCentreVertex(v)) as VertexId;
    fails(s, { type: 'ck/buildKnight', player: 0, vertex: plaza } as Action, /trade hex/);
  });

  it('the Alchemist cannot set a 2 or a 12 (re-rolled in this scenario)', () => {
    const s = main('tb/traders');
    s.phase = { kind: 'preRoll' };
    giveCards(s, 0, 'alchemist' as ProgressCard);
    const sums = legalOf(s, 'ck/alchemist').map((a) => {
      const x = a as unknown as { yellow: number; red: number };
      return x.yellow + x.red;
    });
    expect(sums.length).toBeGreaterThan(0);
    expect(sums).not.toContain(2);
    expect(sums).not.toContain(12);
    fails(s, { type: 'ck/alchemist', player: 0, yellow: 6, red: 6 } as Action, /12/);
  });

  it('a 7 before the first barbarian attack moves no barbarian', () => {
    const s = main('tb/traders');
    s.phase = { kind: 'preRoll' };
    s.rng = rngFor(3, 4, 'trade');
    const t = run(s, { type: 'rollDice', player: 0 });
    expect(t.phase.kind).toBe('main');
    expect(tradersOf(t).barbarians).toEqual(tradersOf(s).barbarians);
  });

  it('the wagon move waits until the progress hand is down to 4', () => {
    const s = main('tb/traders');
    giveCards(s, 0, 'crane', 'crane', 'engineer', 'inventor', 'irrigation');
    expect(legalOf(s, 'tb/startWagon')).toHaveLength(0);
    expect(legalOf(s, 'endTurn')).toHaveLength(0);
    fails(s, { type: 'endTurn', player: 0 }, /progress/);
  });
});

describe('soundness', { timeout: 180_000 }, () => {
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

  it.each(Object.keys(TBCK_VP))('%s: every legal action is accepted', (scenario) => {
    walk(game(scenario, 4, { seed: 11 }), 11, 1500, (s) => {
      for (const a of legalActions(s).slice(0, 25)) {
        const r = applyAction(s, a);
        expect(r.ok, `${JSON.stringify(a)}: ${r.ok ? '' : r.error}`).toBe(true);
      }
      if (s.turn.number % 40 === 0) {
        expect(JSON.parse(JSON.stringify(s))).toEqual(s);
        expect(cloneState(s)).toEqual(s);
      }
    });
  });
});
