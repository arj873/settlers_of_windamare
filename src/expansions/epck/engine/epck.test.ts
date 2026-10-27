/**
 * Explorers & Pirates + Cities & Knights (2025 sheet, docs/rules/combos.md §7): one test per
 * combined rule, the composition order, and soundness. Board: the full game, 4 players; doubled
 * coordinates as in ep/engine/testkit.ts.
 */
import { describe, expect, it } from 'vitest';
import { applyAction, legalActions } from '../../../engine/engine';
import { bankTradeRatio } from '../../../engine/actions/trade';
import { createGame } from '../../../engine/createGame';
import { pieceLimit } from '../../../engine/expansions/hooks';
import { piecesLeft } from '../../../engine/selectors';
import { RESOURCES } from '../../../engine/constants';
import { Rng } from '../../../engine/rng';
import type { Action, GameState, HexId, PlayerId } from '../../../engine/types';
import {
  barbarianStrength,
  canPlaceKnightAt,
  ckSlice,
  isRobberActive,
  moveTargets,
} from '../../ck/engine';
import { giveCards, knight, roll, setGoods, setLevel } from '../../ck/engine/testkit';
import { epSlice, freshTurn } from '../../ep/engine';
import { sidesOf } from '../../ep/engine/geometry';
import { E, H, players, V } from '../../ep/engine/testkit';
import { EPCK, EPCK_MODE, epckSlice } from '.';

// A coastal corner of the island (SE of (5,0)) and an inland one (S of (3,0)).
const COAST = V(5, 0, 'SE');
const INLAND = V(3, 0, 'S');

function game(scenario = 'ep/full', n = 4, extra: Record<string, unknown> = {}): GameState {
  return createGame({
    seed: 1,
    players: players(n),
    mode: EPCK_MODE,
    scenario,
    startingPlayer: 0,
    ...extra,
  });
}

/** Player 0 in the Action phase of turn 3: no pieces, empty hands, no gold. */
function main(scenario = 'ep/full'): GameState {
  const s = game(scenario);
  s.pieces = { buildings: {}, roads: {} };
  for (const p of s.players) setGoods(s, p.id, {});
  const e = epSlice(s);
  e.harbors = {};
  e.ships = [];
  e.gold = s.players.map(() => 0);
  e.turn = freshTurn();
  s.turn = { number: 3, current: 0, devCardPlayed: false, tradeOffers: 0 };
  s.phase = { kind: 'main' };
  delete s.stats;
  return s;
}

const run = (s: GameState, ...actions: Action[]): GameState =>
  actions.reduce((st, a) => {
    const r = applyAction(st, a);
    if (!r.ok) throw new Error(`${JSON.stringify(a)}: ${r.error}`);
    return r.state;
  }, s);
const a = (type: string, player: PlayerId, payload: object = {}) =>
  ({ type, player, ...payload }) as unknown as Action;
const fails = (s: GameState, x: Action, match?: RegExp) => {
  const r = applyAction(s, x);
  expect(r.ok, JSON.stringify(x)).toBe(false);
  if (!r.ok && match) expect(r.error).toMatch(match);
};
const legalOf = (s: GameState, type: string, p?: PlayerId) =>
  legalActions(s, p).filter((x) => x.type === type);
const gold = (s: GameState, p: PlayerId) => epSlice(s).gold[p] ?? 0;
const islandCount = (s: GameState, t: string) =>
  Object.values(s.board.hexes).filter((h) => h.terrain === t).length;

describe('the mode', () => {
  it('composes epck, ck, ep in this order', () => {
    expect(game().settings.expansions).toEqual([EPCK, 'ck', 'ep']);
  });

  it('wins at 5 VP more than the E&P scenario (the rule; the sheet’s Spices example says 19)', () => {
    expect(game('ep/pirateLairs').settings.vpToWin).toBe(17);
    expect(game('ep/fish').settings.vpToWin).toBe(20);
    expect(game('ep/spices').settings.vpToWin).toBe(20);
    expect(game('ep/full').settings.vpToWin).toBe(22);
  });

  it('offers only the variable-setup scenarios at 3-4 players', () => {
    expect(() => game('ep/landHo')).toThrow();
    expect(() => game('ep/full', 5)).toThrow();
    expect(game('ep/full', 3).players.length).toBe(3);
  });

  it('returns 1 field and 1 forest instead of 2 fields: the island has 3 forests and 3 fields', () => {
    for (const sc of ['ep/full', 'ep/pirateLairs']) {
      const s = game(sc);
      expect(islandCount(s, 'lumber'), sc).toBe(3);
      expect(islandCount(s, 'grain'), sc).toBe(3);
    }
  });
});

describe('setup: city first, harbor settlement second', () => {
  it('round 1 places a city anywhere on the island and it pays; round 2 a harbor on a mark', () => {
    let s = game();
    const cityStep = legalOf(s, 'placeSetupSettlement');
    // Any island corner (not only the marked harbor corners).
    expect(cityStep.some((x) => (x as { vertex: string }).vertex === INLAND)).toBe(true);
    s = run(s, a('placeSetupSettlement', 0, { vertex: INLAND }));
    expect(s.pieces.buildings[INLAND]).toEqual({ owner: 0, kind: 'city' });
    const hand = s.players[0]?.resources;
    expect(RESOURCES.reduce((n, r) => n + (hand?.[r] ?? 0), 0)).toBe(3);
    expect(epSlice(s).harbors[INLAND]).toBeUndefined();
    for (let i = 1; i < 4; i++) s = run(s, legalOf(s, 'placeSetupSettlement')[0] as Action);
    // Round 2: only the marked coastal corners, and it becomes a harbor settlement.
    const marks = legalOf(s, 'placeSetupSettlement').map((x) => (x as { vertex: string }).vertex);
    expect(marks.length).toBeGreaterThan(0);
    expect(marks).not.toContain(INLAND);
    const before = { ...s.players[3]?.resources };
    s = run(s, legalOf(s, 'placeSetupSettlement')[0] as Action);
    const v = Object.keys(epSlice(s).harbors)[0] as keyof GameState['pieces']['buildings'];
    expect(s.pieces.buildings[v]?.kind).toBe('settlement');
    expect(s.players[3]?.resources).toEqual(before);
  });

  it('when the cities leave no marked corner free, the harbor goes on any free coast (ours)', () => {
    let s = game();
    for (let i = 0; i < 4; i++) s = run(s, legalOf(s, 'placeSetupSettlement')[0] as Action);
    // Take every free marked corner (a stand-in for cities placed there).
    for (const x of legalOf(s, 'placeSetupSettlement')) {
      const v = (x as unknown as { vertex: keyof GameState['pieces']['buildings'] }).vertex;
      s.pieces.buildings[v] ??= { owner: 3, kind: 'city' };
    }
    const coast = legalOf(s, 'placeSetupSettlement');
    expect(coast.length).toBeGreaterThan(0);
    s = run(s, coast[0] as Action);
    expect(Object.keys(epSlice(s).harbors)).toHaveLength(1);
  });

  it('then each player places a road at the city and a ship with a settler at the harbor', () => {
    let s = game();
    for (let i = 0; i < 100 && s.turn.number === 0; i++) {
      s = run(s, legalActions(s)[0] as Action);
    }
    expect(s.phase.kind).toBe('preRoll');
    for (const p of [0, 1, 2, 3]) {
      const mine = Object.entries(s.pieces.buildings).filter(([, b]) => b.owner === p);
      expect(mine.map(([, b]) => b.kind).sort()).toEqual(['city', 'settlement']);
      expect(epSlice(s).ships.filter((x) => x.owner === p)).toHaveLength(1);
      expect(Object.values(s.pieces.roads).filter((o) => o === p)).toHaveLength(1);
    }
  });
});

describe('cities and harbor settlements', () => {
  it('a settlement becomes a city or a harbor settlement; never city <-> harbor', () => {
    let s = main();
    s.pieces.buildings[COAST] = { owner: 0, kind: 'settlement' };
    setGoods(s, 0, { grain: 4, ore: 5 });
    expect(legalOf(s, 'buildCity').length).toBe(1);
    expect(legalOf(s, 'ep/buildHarbor').length).toBe(1);
    // A harbor settlement cannot become a city.
    const h = structuredClone(s);
    h.pieces.buildings[COAST] = { owner: 0, kind: 'settlement' };
    epSlice(h).harbors[COAST] = [];
    expect(legalOf(h, 'buildCity')).toHaveLength(0);
    fails(h, a('buildCity', 0, { vertex: COAST }), /harbor/);
    // A city cannot become a harbor settlement.
    s = run(s, a('buildCity', 0, { vertex: COAST }));
    expect(s.pieces.buildings[COAST]?.kind).toBe('city');
    expect(legalOf(s, 'ep/buildHarbor')).toHaveLength(0);
    fails(s, a('ep/buildHarbor', 0, { vertex: COAST }));
  });

  it('pieces: harbors are no settlement pieces; a pillaged city on its side costs a city piece', () => {
    const s = main();
    const spots = [V(3, 0, 'S'), V(1, 2, 'S'), V(2, 5, 'S'), V(4, 5, 'S'), V(3, 4, 'N')];
    s.pieces.buildings[COAST] = { owner: 0, kind: 'settlement' };
    epSlice(s).harbors[COAST] = [];
    for (const v of spots) s.pieces.buildings[v] = { owner: 0, kind: 'settlement' };
    // 5 plain settlements + 1 harbor: no settlement piece left, all 4 cities.
    expect(piecesLeft(s, 0).settlement).toBe(0);
    expect(pieceLimit(s, 0, 'city')).toBe(4);
    // A 6th plain settlement (a pillaged city lying on its side) takes a city piece.
    s.pieces.buildings[V(1, 4, 'S')] = { owner: 0, kind: 'settlement' };
    expect(piecesLeft(s, 0).settlement).toBe(0);
    expect(pieceLimit(s, 0, 'city')).toBe(3);
  });

  it('barbarians count cities (metropolis included), not harbor settlements', () => {
    const s = main();
    s.pieces.buildings[COAST] = { owner: 0, kind: 'settlement' };
    epSlice(s).harbors[COAST] = [];
    s.pieces.buildings[INLAND] = { owner: 1, kind: 'city' };
    expect(barbarianStrength(s)).toBe(1);
  });

  it('a city on a mountain yields 1 ore + 1 coin; a player paid nothing gets 1 gold', () => {
    const s0 = main('ep/pirateLairs');
    // Pirate Lairs (fixed island): (3,2) is a mountain numbered 10.
    expect(s0.board.hexes[H(3, 2)]?.terrain).toBe('ore');
    s0.pieces.buildings[V(3, 2, 'N')] = { owner: 0, kind: 'city' };
    const s = roll(s0, 4, 6, 'trade');
    expect(s.players[0]?.resources.ore).toBe(1);
    expect(ckSlice(s).players[0]?.commodities.coin).toBe(1);
    expect(gold(s, 0)).toBe(0);
    expect(gold(s, 1)).toBe(1);
  });
});

describe('knights', () => {
  it('are never recruited or moved next to an unexplored hex', () => {
    const s = main();
    const X = V(3, 0, 'SE'); // (3,0) | (5,0) | (4,1)
    s.pieces.buildings[INLAND] = { owner: 0, kind: 'settlement' };
    s.pieces.roads[E(3, 0, 'SE')] = 0; // INLAND - X
    expect(canPlaceKnightAt(s, 0, X)).toBe(true);
    const tile = s.board.hexes[H(5, 0)];
    if (!tile) throw new Error('no hex');
    s.board = {
      ...s.board,
      hexes: { ...s.board.hexes, [H(5, 0)]: { ...tile, terrain: 'ep/parrot' } },
    };
    expect(canPlaceKnightAt(s, 0, X)).toBe(false);
    knight(s, 0, INLAND, 1, true, 1);
    delete s.pieces.buildings[INLAND];
    expect(moveTargets(s, 0, INLAND)).not.toContain(X);
  });

  it('count for the defense; crews do not', () => {
    const s = main();
    knight(s, 0, INLAND, 2, true);
    epSlice(s).ships.push({ id: 9, owner: 0, edge: E(5, 0, 'E'), cargo: ['crew', 'crew'] });
    let def = 0;
    for (const k of Object.values(ckSlice(s).knights)) def += k.active ? k.level : 0;
    expect(def).toBe(2);
  });

  it('C&K actions belong to the Action phase: none in the Movement phase', () => {
    const s = main();
    s.pieces.buildings[INLAND] = { owner: 0, kind: 'settlement' };
    s.pieces.roads[E(3, 0, 'SE')] = 0;
    setGoods(s, 0, { wool: 1, ore: 1 });
    expect(legalOf(s, 'ck/buildKnight').length).toBeGreaterThan(0);
    epSlice(s).turn.movement = true;
    expect(legalOf(s, 'ck/buildKnight')).toHaveLength(0);
    fails(s, a('ck/buildKnight', 0, { vertex: V(3, 0, 'SE') }), /Movement/);
  });
});

describe('the 7: the pirate, the Aqueduct', () => {
  it('the pirate is activated on the first 7, before any barbarian attack', () => {
    const s = roll(main(), 3, 4, 'trade');
    expect(isRobberActive(s)).toBe(false);
    expect(s.phase.kind).toBe('ep/pirate');
  });

  it('Aqueduct on a 7: 1 gold at once, 1 resource of choice after the pirate', () => {
    const s0 = main();
    setLevel(s0, 1, 'science', 3);
    let s = roll(s0, 3, 4, 'trade');
    expect(gold(s, 1)).toBe(1);
    expect(s.phase.kind).toBe('ep/pirate');
    const place = legalOf(s, 'ep/placePirate')[0] as Action;
    s = run(s, place);
    if (s.phase.kind === 'ep/pirateSteal') s = run(s, legalActions(s)[0] as Action);
    expect(s.phase.kind).toBe('ck/aqueduct');
    s = run(s, legalActions(s, 1)[0] as Action);
    expect(s.phase.kind).toBe('main');
    expect(RESOURCES.reduce((n, r) => n + (s.players[1]?.resources[r] ?? 0), 0)).toBe(1);
    expect(epckSlice(s).aqueduct).toEqual([]);
  });

  it('after the discards of a 7 the pirate moves', () => {
    const s0 = main();
    setGoods(s0, 2, { brick: 4, lumber: 4 });
    let s = roll(s0, 3, 4, 'trade');
    expect(s.phase.kind).toBe('discard');
    s = run(s, legalActions(s, 2)[0] as Action);
    expect(s.phase.kind).toBe('ep/pirate');
  });

  it('the pirate robs commodities too (a player holding only commodities is a victim)', () => {
    let s = roll(main(), 3, 4, 'trade');
    const h = (legalOf(s, 'ep/placePirate')[0] as unknown as { hex: HexId }).hex;
    epSlice(s).ships.push({ id: 7, owner: 1, edge: sidesOf(s, h)[0] as never, cargo: [] });
    setGoods(s, 1, { cloth: 1 });
    s = run(s, a('ep/placePirate', 0, { hex: h }));
    expect(s.phase.kind).toBe('ep/pirateSteal');
    s = run(s, a('ep/pirateSteal', 0, { victim: 1 }));
    expect(ckSlice(s).players[0]?.commodities.cloth).toBe(1);
    expect(s.phase.kind).toBe('main');
  });
});

describe('trading', () => {
  it('Fast Gold takes a commodity card too', () => {
    let s = main();
    epSlice(s).spice[H(13, 0)] = { kind: 'fast', sacks: [], crews: [0] };
    setGoods(s, 0, { paper: 1 });
    expect(legalOf(s, 'epck/fastGold')).toHaveLength(1);
    s = run(s, a('epck/fastGold', 0, { commodity: 'paper' }));
    expect(gold(s, 0)).toBe(1);
    expect(ckSlice(s).players[0]?.commodities.paper).toBe(0);
    fails(s, a('epck/fastGold', 0, { commodity: 'paper' }), /Fast Gold/);
  });

  it('gold never buys commodities from the supply', () => {
    const s = main();
    epSlice(s).gold[0] = 4;
    fails(s, a('ep/buyWithGold', 0, { resource: 'paper' }));
    expect(legalOf(s, 'ck/bankTrade').some((x) => JSON.stringify(x).includes('gold'))).toBe(false);
  });

  it('the merchant’s 2:1 survives E&P’s 3:1', () => {
    const s = main();
    const wool = (Object.keys(s.board.hexes) as HexId[]).find(
      (h) => s.board.hexes[h]?.terrain === 'wool',
    ) as HexId;
    ckSlice(s).merchant = { hex: wool, owner: 0 };
    expect(bankTradeRatio(s, 0, 'wool')).toBe(2);
    expect(bankTradeRatio(s, 0, 'ore')).toBe(3);
  });

  it('one offer may carry resources, commodities and gold', () => {
    let s = main();
    setGoods(s, 0, { paper: 1 });
    epSlice(s).gold[1] = 1;
    s = run(s, a('epck/offerTrade', 0, { give: { paper: 1 }, want: { gold: 1 }, to: [1] }));
    expect(s.log.at(-1)?.text).toMatch(/ offers 1 paper for 1 gold$/);
    expect(legalOf(s, 'acceptTrade', 1)).toHaveLength(1);
    s = run(s, a('acceptTrade', 1), a('confirmTrade', 0, { partner: 1 }));
    // Each module adds its own part to the base line.
    expect(s.log.at(-1)?.text).toMatch(/ traded 1 paper to .+ for 1 gold$/);
    expect(gold(s, 0)).toBe(1);
    expect(gold(s, 1)).toBe(0);
    expect(ckSlice(s).players[1]?.commodities.paper).toBe(1);
  });

  it('offers need a commodity or gold, both sides, what you hold', () => {
    const s = main();
    setGoods(s, 0, { wool: 1, coin: 1 });
    const offer = (give: object, want: object) =>
      applyAction(s, a('epck/offerTrade', 0, { give, want, to: [1, 2, 3] })).ok;
    expect(offer({ wool: 1 }, { ore: 1 })).toBe(false);
    expect(offer({ coin: 1 }, {})).toBe(false);
    expect(offer({ coin: 2 }, { gold: 1 })).toBe(false);
    expect(offer({ gold: 1 }, { coin: 1 })).toBe(false);
    expect(offer({ coin: 1 }, { coin: 1 })).toBe(false);
    expect(offer({ coin: 1, wool: 1 }, { gold: 1, ore: 1 })).toBe(true);
    // One combined form: the modules' own offers are not offered here.
    expect(legalOf(s, 'ck/offerTrade')).toHaveLength(0);
    expect(legalOf(s, 'ep/offerTrade')).toHaveLength(0);
  });
});

describe('progress cards', () => {
  it('Medicine: a city for 1 grain + 2 ore', () => {
    let s = main();
    s.pieces.buildings[INLAND] = { owner: 0, kind: 'settlement' };
    setGoods(s, 0, { grain: 1, ore: 2 });
    giveCards(s, 0, 'medicine');
    s = run(s, a('ck/play', 0, { card: 'medicine' }));
    s = run(s, a('ck/pickVertex', 0, { vertex: INLAND }));
    expect(s.pieces.buildings[INLAND]?.kind).toBe('city');
    expect(s.players[0]?.resources.ore).toBe(0);
  });

  it('Medicine: or a harbor settlement for 1 wheat + 1 ore', () => {
    let s = main();
    s.pieces.buildings[COAST] = { owner: 0, kind: 'settlement' };
    setGoods(s, 0, { grain: 1, ore: 1 });
    giveCards(s, 0, 'medicine');
    expect(legalOf(s, 'ck/play').some((x) => JSON.stringify(x).includes('medicine'))).toBe(true);
    s = run(s, a('ck/play', 0, { card: 'medicine' }));
    expect(legalOf(s, 'ck/pickVertex')).toHaveLength(0);
    fails(s, a('ck/pickVertex', 0, { vertex: COAST }), /wheat/);
    expect(legalOf(s, 'epck/medicineHarbor')).toHaveLength(1);
    s = run(s, a('epck/medicineHarbor', 0, { vertex: COAST }));
    expect(epSlice(s).harbors[COAST]).toEqual([]);
    expect(s.players[0]?.resources).toEqual({ brick: 0, lumber: 0, wool: 0, grain: 0, ore: 0 });
    expect(s.phase.kind).toBe('main');
  });

  it('Medicine never upgrades a harbor settlement, and is unplayable without a target', () => {
    const s = main();
    s.pieces.buildings[COAST] = { owner: 0, kind: 'settlement' };
    epSlice(s).harbors[COAST] = [];
    setGoods(s, 0, { grain: 2, ore: 2 });
    giveCards(s, 0, 'medicine');
    expect(legalOf(s, 'ck/play')).toHaveLength(0);
    fails(s, a('ck/play', 0, { card: 'medicine' }));
  });

  it('Taxation activates the pirate ship instead of moving the robber', () => {
    let s = main();
    giveCards(s, 0, 'bishop');
    expect(legalOf(s, 'ck/play').length).toBe(1);
    s = run(s, a('ck/play', 0, { card: 'bishop' }));
    expect(s.phase.kind).toBe('ep/pirate');
    s = run(s, legalOf(s, 'ep/placePirate')[0] as Action);
    expect(epSlice(s).pirate?.owner).toBe(0);
  });

  it('Road Building builds roads only, no ships', () => {
    let s = main();
    s.pieces.buildings[COAST] = { owner: 0, kind: 'settlement' };
    epSlice(s).harbors[COAST] = [];
    setGoods(s, 0, { lumber: 2, wool: 2 });
    giveCards(s, 0, 'roadBuilding');
    s = run(s, a('ck/play', 0, { card: 'roadBuilding' }));
    expect(s.phase.kind).toBe('roadBuilding');
    const types = new Set(legalActions(s).map((x) => x.type));
    expect(types.has('ep/buildShip')).toBe(false);
    expect(types.has('placeFreeRoad')).toBe(true);
  });

  it('progress cards wait for the Action phase', () => {
    const s = main();
    giveCards(s, 0, 'bishop');
    epSlice(s).turn.movement = true;
    expect(legalOf(s, 'ck/play')).toHaveLength(0);
    fails(s, a('ck/play', 0, { card: 'bishop' }), /Action phase/);
  });
});

describe('soundness', () => {
  it('every legal action applies during a random game', () => {
    let s = game('ep/full', 4, { seed: 7 });
    const rng = new Rng(11);
    for (let step = 0; step < 1500 && s.winner === null; step++) {
      const acts = legalActions(s);
      expect(acts.length, `step ${step} ${s.phase.kind}`).toBeGreaterThan(0);
      if (step % 50 === 0) {
        for (const x of acts) {
          const r = applyAction(s, x);
          expect(r.ok, `${JSON.stringify(x)} ${r.ok ? '' : r.error}`).toBe(true);
        }
      }
      const pick = acts.filter((x) => x.type !== 'endTurn' || acts.length === 1);
      const x = rng.pick(pick.length > 0 && rng.float() < 0.8 ? pick : acts);
      s = run(s, x);
    }
  });
});
