/**
 * Cities & Knights core rules (docs/rules/cities-knights.md, CK-n): setup, production,
 * commodities, the 7, barbarians, knights, improvements, metropolises, walls, trading, victory.
 * Progress cards: cards.test.ts. Soundness / sims: sound.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { legalActions } from '../../../engine/engine';
import { createGame } from '../../../engine/createGame';
import { longestRoadLength } from '../../../engine/rules/longestRoad';
import { piecesLeft, publicVictoryPoints, victoryPoints } from '../../../engine/selectors';
import { statsOf } from '../../../engine/stats';
import { supplyOf } from '../../../engine/mapLookup';
import type { GameState } from '../../../engine/types';
import { BARBARIAN_STEPS, CK, ckPlayer, ckSlice, giveRatio, type CkPhase } from '.';
import {
  E,
  V,
  bad,
  build,
  ckGame,
  ckMain,
  expectConserved,
  giveCards,
  knight,
  legalOf,
  ok,
  players,
  roads,
  roll,
  setGoods,
  setLevel,
} from './testkit';

const phase = (s: GameState) => s.phase as unknown as CkPhase;
const cards = (s: GameState, p: number) => ckPlayer(s, p).commodities;

// Starter board: h:-1,-1 lumber 3, h:-1,0 grain 4, h:-2,0 lumber 8, h:0,0 brick 11,
// h:0,-1 ore 9, h:1,0 wool 3, h:1,-1 desert (robber), h:0,1 ore 6.
const FOREST3 = V(-1, -1, 'S'); // lumber 3 + grain 4 + lumber 8

describe('setup (CK-1, CK-2)', () => {
  it('the second setup building is a city; it pays one resource per hex and no commodity', () => {
    let s = ckGame(3);
    // Round 1: three settlements + roads (first legal spots).
    for (let i = 0; i < 3; i++) {
      const v = legalOf(s, 'placeSetupSettlement')[0]!;
      s = ok(s, v);
      s = ok(s, legalOf(s, 'placeSetupRoad')[0]!);
    }
    expect(Object.values(s.pieces.buildings).every((b) => b.kind === 'settlement')).toBe(true);
    s = ok(s, { type: 'placeSetupSettlement', player: 2, vertex: FOREST3 });
    expect(s.pieces.buildings[FOREST3]).toEqual({ owner: 2, kind: 'city' });
    expect(s.players[2]!.resources).toMatchObject({ lumber: 2, grain: 1 });
    expect(cards(s, 2)).toEqual({ paper: 0, cloth: 0, coin: 0 });
  });

  it('starts with no development cards, a sleeping robber and the barbarians at the start', () => {
    const s = ckGame();
    expect(s.devDeck).toEqual([]);
    expect(supplyOf(s).devDeck.knight).toBe(0);
    expect(ckSlice(s).barbarian).toBe(0);
    expect(ckSlice(s).attacks).toBe(0);
    expect(s.board.hexes[s.robber]?.terrain).toBe('desert');
    expect(s.settings.vpToWin).toBe(13);
    expect(ckSlice(s).bank).toEqual({ paper: 12, cloth: 12, coin: 12 });
    expect(Object.values(ckSlice(s).decks).map((d) => d.length)).toEqual([18, 18, 18]);
  });

  it('the starter board has the rulebook layout (§2.2)', () => {
    const s = ckGame();
    const t = (h: string) => s.board.hexes[h as keyof typeof s.board.hexes];
    expect(t('h:0,-2')).toMatchObject({ terrain: 'brick', token: 6 });
    expect(t('h:1,-1')).toMatchObject({ terrain: 'desert', token: null });
    expect(t('h:0,2')).toMatchObject({ terrain: 'lumber', token: 11 });
    const terr = Object.values(s.board.hexes).map((h) => h.terrain);
    const count = (x: string) => terr.filter((y) => y === x).length;
    expect([count('lumber'), count('wool'), count('grain'), count('brick'), count('ore')]).toEqual([
      4, 4, 4, 3, 3,
    ]);
  });

  it('5-6 players: base 5-6 board, 18 commodities each, special build phase on', () => {
    const s = ckGame(5);
    expect(s.settings.map).toBe('base56');
    expect(ckSlice(s).bank).toEqual({ paper: 18, cloth: 18, coin: 18 });
    expect(s.settings.specialBuildPhase).toBe(true);
  });
});

describe('production (§1.5, CK-46)', () => {
  it('a city on a forest yields 1 lumber + 1 paper; a settlement 1 lumber', () => {
    const s = ckMain();
    build(s, 0, FOREST3, 'city');
    build(s, 1, V(-1, -1, 'N'));
    const r = roll(s, 1, 2, 'ship');
    expect(r.players[0]!.resources.lumber).toBe(1);
    expect(cards(r, 0).paper).toBe(1);
    expect(r.players[1]!.resources.lumber).toBe(1);
    expect(cards(r, 1).paper).toBe(0);
    expectConserved(r);
  });

  it('a city on fields or hills yields 2 resources, no commodity', () => {
    const s = ckMain();
    build(s, 0, FOREST3, 'city');
    const r = roll(s, 1, 3, 'ship');
    expect(r.players[0]!.resources.grain).toBe(2);
    expect(cards(r, 0)).toEqual({ paper: 0, cloth: 0, coin: 0 });
  });

  it('commodity shortage: two players owed and too few cards -> nobody; one player -> the rest', () => {
    const s = ckMain();
    build(s, 0, FOREST3, 'city');
    build(s, 1, V(-1, -1, 'N'), 'city');
    ckSlice(s).bank.paper = 1;
    ckSlice(s).players[2]!.commodities.paper = 11;
    const both = roll(s, 1, 2, 'ship');
    expect([cards(both, 0).paper, cards(both, 1).paper]).toEqual([0, 0]);
    Reflect.deleteProperty(s.pieces.buildings, V(-1, -1, 'N'));
    const one = roll(s, 1, 2, 'ship');
    expect(cards(one, 0).paper).toBe(1);
    expectConserved(one);
  });

  it('the robber blocks commodities too', () => {
    const s = ckMain();
    build(s, 0, FOREST3, 'city');
    s.robber = 'h:-1,-1';
    const r = roll(s, 1, 2, 'ship');
    expect(r.players[0]!.resources.lumber).toBe(0);
    expect(cards(r, 0).paper).toBe(0);
  });
});

describe('the 7 and the robber (§3.6, CK-30)', () => {
  it('before the first attack: hands over the limit discard (commodities count), the robber stays', () => {
    const s = ckMain();
    build(s, 0, FOREST3);
    build(s, 1, V(0, 0, 'S'));
    setGoods(s, 1, { brick: 3, ore: 2, paper: 2, coin: 2 }); // 9 cards
    const r = roll(s, 3, 4, 'ship');
    expect(r.phase).toEqual({ kind: 'discard', pending: [0, 4, 0, 0] });
    // Players holding commodities discard with ck/discard (base discard is not offered).
    expect(legalOf(r, 'discard', 1)).toEqual([]);
    const after = ok(r, {
      type: 'ck/discard',
      player: 1,
      resources: { brick: 2 },
      commodities: { coin: 2 },
    });
    expect(after.phase.kind).toBe('main');
    expect(after.robber).toBe(s.robber);
    expect(cards(after, 1)).toEqual({ paper: 2, cloth: 0, coin: 0 });
    expectConserved(after);
  });

  it('nobody over the limit before the first attack: straight back to main', () => {
    const r = roll(ckMain(), 3, 4, 'ship');
    expect(r.phase.kind).toBe('main');
  });

  it('each city wall raises the limit by 2 (CK-48)', () => {
    const s = ckMain();
    build(s, 1, V(0, 0, 'S'), 'city');
    build(s, 1, V(0, 0, 'N'), 'city');
    ckSlice(s).walls[V(0, 0, 'S')] = 1;
    ckSlice(s).walls[V(0, 0, 'N')] = 1;
    setGoods(s, 1, { brick: 5, ore: 4, cloth: 2 }); // 11 cards = 7 + 2 + 2
    expect(roll(s, 3, 4, 'ship').phase.kind).toBe('main');
    setGoods(s, 1, { brick: 5, ore: 5, cloth: 2 });
    expect(roll(s, 3, 4, 'ship').phase).toMatchObject({ kind: 'discard', pending: [0, 6, 0, 0] });
  });

  it('after the first attack the robber moves and may steal a commodity', () => {
    const s = ckMain();
    ckSlice(s).attacks = 1;
    build(s, 1, V(0, 0, 'S'));
    setGoods(s, 1, { coin: 1 });
    let r = roll(s, 3, 4, 'ship');
    expect(r.phase).toEqual({ kind: 'moveRobber', resume: 'main' });
    r = ok(r, { type: 'moveRobber', player: 0, hex: 'h:0,0' });
    r = ok(r, { type: 'steal', player: 0, victim: 1 });
    expect(cards(r, 0).coin).toBe(1);
    expect(cards(r, 1).coin).toBe(0);
  });
});

describe('the barbarians (§3.3, CK-10..CK-23)', () => {
  it('a ship face moves the ship one step; a gate face does not (CK-20, CK-21)', () => {
    const s = ckMain();
    expect(ckSlice(roll(s, 1, 1, 'ship')).barbarian).toBe(1);
    expect(ckSlice(roll(s, 1, 1, 'trade')).barbarian).toBe(0);
    expect(ckSlice(roll(s, 1, 1, 'trade')).event).toBe('trade');
  });

  it('the 7th ship lands: knights win ties, the strongest is Defender of Catan, all knights sleep', () => {
    const s = ckMain();
    ckSlice(s).barbarian = BARBARIAN_STEPS - 1;
    build(s, 0, FOREST3, 'city');
    build(s, 1, V(0, 0, 'S'), 'city');
    knight(s, 1, V(0, 0, 'N'), 2, true);
    const r = roll(s, 1, 1, 'ship');
    const c = ckSlice(r);
    expect(c.barbarian).toBe(0);
    expect(c.attacks).toBe(1);
    expect(ckPlayer(r, 1).defender).toBe(1);
    expect(c.knights[V(0, 0, 'N')]!.active).toBe(false);
    expect(publicVictoryPoints(r, 1)).toBe(3);
  });

  it('barbarians stronger: the weakest player with a city loses one; its wall goes too', () => {
    const s = ckMain();
    ckSlice(s).barbarian = BARBARIAN_STEPS - 1;
    build(s, 0, FOREST3, 'city');
    ckSlice(s).walls[FOREST3] = 0;
    build(s, 1, V(0, 0, 'S'), 'city');
    knight(s, 1, V(0, 0, 'N'), 1, true);
    const r = roll(s, 1, 1, 'ship');
    expect(r.pieces.buildings[FOREST3]).toEqual({ owner: 0, kind: 'settlement' });
    expect(ckSlice(r).walls[FOREST3]).toBeUndefined();
    expect(r.pieces.buildings[V(0, 0, 'S')]?.kind).toBe('city');
  });

  it('tied weakest players each lose a city, choosing which (CK-16, CK-18)', () => {
    const s = ckMain();
    ckSlice(s).barbarian = BARBARIAN_STEPS - 1;
    build(s, 0, FOREST3, 'city');
    build(s, 0, V(2, 0, 'S'), 'city');
    build(s, 1, V(0, 0, 'S'), 'city');
    let r = roll(s, 1, 1, 'ship');
    expect(r.pieces.buildings[V(0, 0, 'S')]?.kind).toBe('settlement');
    expect(phase(r)).toEqual({ kind: 'ck/pillage', queue: [0] });
    expect(legalOf(r, 'ck/pickVertex', 0)).toHaveLength(2);
    r = ok(r, { type: 'ck/pickVertex', player: 0, vertex: V(2, 0, 'S') });
    expect(r.pieces.buildings[V(2, 0, 'S')]?.kind).toBe('settlement');
    expect(r.phase.kind).toBe('main');
  });

  it('metropolis-only and city-less players are skipped; the next weakest loses (CK-17)', () => {
    const s = ckMain();
    ckSlice(s).barbarian = BARBARIAN_STEPS - 1;
    build(s, 0, FOREST3, 'city');
    ckSlice(s).metropolis.science = { owner: 0, vertex: FOREST3 };
    setLevel(s, 0, 'science', 4);
    build(s, 1, V(0, 0, 'S'), 'city');
    knight(s, 1, V(0, 0, 'N'), 1, true);
    const r = roll(s, 1, 1, 'ship');
    expect(r.pieces.buildings[FOREST3]?.kind).toBe('city');
    expect(r.pieces.buildings[V(0, 0, 'S')]?.kind).toBe('settlement');
  });

  it('a pillaged city with no settlement left lies on its side (FAQ Q15)', () => {
    const s = ckMain();
    ckSlice(s).barbarian = BARBARIAN_STEPS - 1;
    build(s, 0, FOREST3, 'city');
    for (const h of ['h:2,-2', 'h:2,-1', 'h:1,1', 'h:-1,2', 'h:-2,2'] as const) {
      const [q, r2] = h.slice(2).split(',').map(Number) as [number, number];
      build(s, 0, V(q, r2, 'S'));
    }
    const r = roll(s, 1, 1, 'ship');
    expect(r.pieces.buildings[FOREST3]?.kind).toBe('settlement');
    expect(piecesLeft(r, 0)).toMatchObject({ settlement: 0, city: 3 });
    expect(victoryPoints(r, 0)).toBe(6);
  });

  it('defenders tied: no VP; each draws from a stack of their choice, roller first (CK-23)', () => {
    const s = ckMain();
    ckSlice(s).barbarian = BARBARIAN_STEPS - 1;
    build(s, 2, FOREST3, 'city');
    knight(s, 1, V(0, 0, 'N'), 1, true);
    knight(s, 2, V(0, 0, 'S'), 1, true);
    let r = roll(s, 1, 1, 'ship');
    expect(phase(r)).toEqual({ kind: 'ck/defender', queue: [1, 2] });
    r = ok(r, { type: 'ck/pickTrack', player: 1, track: 'politics' });
    r = ok(r, { type: 'ck/pickTrack', player: 2, track: 'trade' });
    expect(ckPlayer(r, 1).progress.length + ckPlayer(r, 1).vpCards.length).toBe(1);
    expect(ckPlayer(r, 2).progress.length + ckPlayer(r, 2).vpCards.length).toBe(1);
    expect(ckPlayer(r, 1).defender + ckPlayer(r, 2).defender).toBe(0);
    expect(r.phase.kind).toBe('main');
  });

  it('nobody defending and no city: no Defender, no draws (CK-33)', () => {
    const s = ckMain();
    ckSlice(s).barbarian = BARBARIAN_STEPS - 1;
    const r = roll(s, 1, 1, 'ship');
    expect(r.phase.kind).toBe('main');
    expect(ckSlice(r).players.every((p) => p.defender === 0)).toBe(true);
    expect(ckSlice(r).attacks).toBe(1);
  });

  it('the attack resolves before production: a pillaged city produces as a settlement (CK-5)', () => {
    const s = ckMain();
    ckSlice(s).barbarian = BARBARIAN_STEPS - 1;
    build(s, 0, FOREST3, 'city');
    const r = roll(s, 1, 2, 'ship');
    expect(r.players[0]!.resources.lumber).toBe(1);
    expect(cards(r, 0).paper).toBe(0);
  });
});

describe('progress draws (§3.2)', () => {
  it('a gate draws for every player whose track shows the red die, roller first', () => {
    const s = ckMain();
    setLevel(s, 1, 'politics', 1); // red 1-2
    setLevel(s, 2, 'politics', 2); // red 1-3
    const r = roll(s, 4, 3, 'politics');
    const got = (p: number) => ckPlayer(r, p).progress.length + ckPlayer(r, p).vpCards.length;
    expect([got(0), got(1), got(2)]).toEqual([0, 0, 1]);
    const r2 = roll(s, 4, 2, 'politics');
    expect(
      [0, 1, 2].map((p) => ckPlayer(r2, p).progress.length + ckPlayer(r2, p).vpCards.length),
    ).toEqual([0, 1, 1]);
  });

  it('level 0 never draws; a track of another colour does not count', () => {
    const s = ckMain();
    setLevel(s, 1, 'trade', 5);
    const r = roll(s, 4, 1, 'science');
    expect(ckPlayer(r, 1).progress).toEqual([]);
  });

  it('a 5th card out of turn is discarded at once (CK-51); VP cards are laid out instead', () => {
    const s = ckMain();
    setLevel(s, 1, 'trade', 1);
    giveCards(s, 1, 'spy', 'spy', 'warlord', 'wedding');
    const r = roll(s, 4, 1, 'trade');
    expect(phase(r)).toEqual({ kind: 'ck/progressDiscard', queue: [1], then: 'roll' });
    const after = ok(r, { type: 'ck/pickCard', player: 1, card: 'spy' });
    expect(ckPlayer(after, 1).progress).toHaveLength(4);
    expect(after.phase.kind).toBe('main');
  });

  it('on your own turn you may hold 5 until the end of the turn', () => {
    const s = ckMain();
    giveCards(s, 0, 'spy', 'spy', 'warlord', 'wedding', 'saboteur');
    expect(legalOf(s, 'endTurn')).toEqual([]);
    bad(s, { type: 'endTurn', player: 0 }, /down to 4/);
    const r = ok(s, { type: 'ck/discardProgress', player: 0, card: 'saboteur' });
    expect(legalOf(r, 'endTurn')).toHaveLength(1);
    expect(ckSlice(r).decks.politics[0]).toBe('saboteur');
  });

  it('a drawn Printer is laid out: 1 VP, not in the hand', () => {
    const s = ckMain();
    setLevel(s, 0, 'science', 5);
    const deck = ckSlice(s).decks.science;
    deck.splice(deck.indexOf('printer'), 1);
    deck.push('printer');
    const r = roll(s, 1, 1, 'science');
    expect(ckPlayer(r, 0).vpCards).toEqual(['printer']);
    expect(ckPlayer(r, 0).progress).toEqual([]);
    expect(publicVictoryPoints(r, 0)).toBe(1);
  });
});

describe('knights (§4.2)', () => {
  const RING = [E(0, 0, 'NW'), E(0, 0, 'NE'), E(0, 0, 'E')];
  /** Player 0: settlement N of h:-1,0... a road chain around the north of h:0,0. */
  function knightBoard(): GameState {
    const s = ckMain();
    build(s, 0, V(0, 0, 'SW'));
    roads(s, 0, E(0, 0, 'W'), ...RING);
    return s;
  }

  it('recruit: 1 wool + 1 ore, an empty spot on your road, inactive, no distance rule', () => {
    const s = knightBoard();
    setGoods(s, 0, { wool: 1, ore: 1 });
    const spots = legalOf(s, 'ck/buildKnight', 0).map((a) => (a as { vertex: string }).vertex);
    expect(spots).toContain(V(0, 0, 'NW'));
    expect(spots).toContain(V(0, 0, 'N')); // next to nothing, on the road
    expect(spots).not.toContain(V(0, 0, 'SW')); // own settlement
    const r = ok(s, { type: 'ck/buildKnight', player: 0, vertex: V(0, 0, 'NW') });
    expect(ckSlice(r).knights[V(0, 0, 'NW')]).toMatchObject({ owner: 0, level: 1, active: false });
    expect(r.players[0]!.resources).toMatchObject({ wool: 0, ore: 0 });
    expect(statsOf(r).players[0]!.lost.build.wool).toBe(1);
  });

  it('at most 2 basic knights; promote to free a basic', () => {
    const s = knightBoard();
    knight(s, 0, V(0, 0, 'NW'));
    knight(s, 0, V(0, 0, 'N'));
    setGoods(s, 0, { wool: 1, ore: 1 });
    bad(s, { type: 'ck/buildKnight', player: 0, vertex: V(0, 0, 'NE') }, /no basic knights/);
  });

  it('activate for 1 grain; a knight activated this turn cannot act (FAQ Q45)', () => {
    const s = knightBoard();
    knight(s, 0, V(0, 0, 'NW'));
    setGoods(s, 0, { grain: 1 });
    const r = ok(s, { type: 'ck/activateKnight', player: 0, vertex: V(0, 0, 'NW') });
    expect(ckSlice(r).knights[V(0, 0, 'NW')]!.active).toBe(true);
    bad(r, { type: 'ck/selectKnight', player: 0, vertex: V(0, 0, 'NW') }, /nothing to do/);
    const later = structuredClone(r);
    later.turn.number += 1;
    expect(legalOf(later, 'ck/selectKnight', 0)).toHaveLength(1);
  });

  it('promote: 1 wool + 1 ore, once per turn, status kept; mighty needs the Fortress', () => {
    const s = knightBoard();
    knight(s, 0, V(0, 0, 'NW'), 1, true, 1);
    setGoods(s, 0, { wool: 2, ore: 2 });
    let r = ok(s, { type: 'ck/promoteKnight', player: 0, vertex: V(0, 0, 'NW') });
    expect(ckSlice(r).knights[V(0, 0, 'NW')]).toMatchObject({ level: 2, active: true });
    bad(r, { type: 'ck/promoteKnight', player: 0, vertex: V(0, 0, 'NW') }, /Fortress/);
    setLevel(r, 0, 'politics', 3);
    bad(r, { type: 'ck/promoteKnight', player: 0, vertex: V(0, 0, 'NW') }, /already promoted/);
    r.turn.number += 1;
    r = ok(r, { type: 'ck/promoteKnight', player: 0, vertex: V(0, 0, 'NW') });
    expect(ckSlice(r).knights[V(0, 0, 'NW')]!.level).toBe(3);
  });

  it('move along your own route, over your own pieces, never past a foreign piece (Q51)', () => {
    const s = knightBoard();
    knight(s, 0, V(0, 0, 'NW'), 1, true, 1);
    knight(s, 0, V(0, 0, 'N'), 1, false);
    build(s, 1, V(0, 0, 'NE'));
    // W end is the own settlement, N holds an own knight, NE is foreign: nowhere to go.
    bad(s, { type: 'ck/selectKnight', player: 0, vertex: V(0, 0, 'NW') }, /nothing to do/);
    let r = structuredClone(s);
    Reflect.deleteProperty(r.pieces.buildings, V(0, 0, 'NE'));
    r = ok(r, { type: 'ck/selectKnight', player: 0, vertex: V(0, 0, 'NW') });
    const t2 = legalOf(r, 'ck/pickVertex', 0).map((a) => (a as { vertex: string }).vertex);
    expect(t2.sort()).toEqual([V(0, 0, 'NE'), V(0, 0, 'SE')].sort());
    r = ok(r, { type: 'ck/pickVertex', player: 0, vertex: V(0, 0, 'SE') });
    expect(ckSlice(r).knights[V(0, 0, 'SE')]).toMatchObject({ owner: 0, active: false });
    expect(ckSlice(r).knights[V(0, 0, 'NW')]).toBeUndefined();
  });

  it('displace a weaker knight; it retreats along its owner’s roads, or is removed (CK-26)', () => {
    const s = knightBoard();
    knight(s, 0, V(0, 0, 'NW'), 2, true, 1);
    knight(s, 1, V(0, 0, 'NE'), 1, true);
    roads(s, 1, E(1, -1, 'SE'));
    build(s, 1, V(1, 0, 'N'));
    let r = ok(s, { type: 'ck/selectKnight', player: 0, vertex: V(0, 0, 'NW') });
    r = ok(r, { type: 'ck/pickVertex', player: 0, vertex: V(0, 0, 'NE') });
    // Player 1's road from NE leads only to their own settlement: nowhere to stand.
    expect(ckSlice(r).knights[V(0, 0, 'NE')]).toMatchObject({ owner: 0, level: 2, active: false });
    expect(Object.values(ckSlice(r).knights).filter((k) => k.owner === 1)).toEqual([]);
  });

  it('a basic knight cannot displace; equal strength cannot either', () => {
    const s = knightBoard();
    knight(s, 0, V(0, 0, 'NW'), 1, true, 1);
    knight(s, 1, V(0, 0, 'NE'), 1, true);
    const r = ok(s, { type: 'ck/selectKnight', player: 0, vertex: V(0, 0, 'NW') });
    expect(legalOf(r, 'ck/pickVertex', 0).map((a) => (a as { vertex: string }).vertex)).toEqual([
      V(0, 0, 'N'),
    ]);
  });

  it('chase the robber: any strength, adjacent, only after the first attack', () => {
    const s = knightBoard();
    knight(s, 0, V(0, 0, 'NE'), 1, true, 1);
    s.robber = 'h:0,0';
    expect(
      legalOf(
        ok(s, { type: 'ck/selectKnight', player: 0, vertex: V(0, 0, 'NE') }),
        'ck/chaseRobber',
      ),
    ).toEqual([]);
    ckSlice(s).attacks = 1;
    let r = ok(s, { type: 'ck/selectKnight', player: 0, vertex: V(0, 0, 'NE') });
    r = ok(r, { type: 'ck/chaseRobber', player: 0 });
    expect(r.phase).toEqual({ kind: 'moveRobber', resume: 'main' });
    expect(ckSlice(r).knights[V(0, 0, 'NE')]!.active).toBe(false);
    r = ok(r, { type: 'moveRobber', player: 0, hex: 'h:-1,0' });
    expect(r.phase.kind).toBe('main');
  });

  it('knights block opponents’ roads and settlements and break their Longest Road (CK-29)', () => {
    const s = ckMain();
    build(s, 1, V(-1, 0, 'S'));
    roads(s, 1, E(-1, 0, 'SE'), E(-1, 0, 'E'), E(-1, 0, 'NE'), E(-1, 0, 'NW'), E(-1, 0, 'W'));
    expect(longestRoadLength(s, 1)).toBe(5);
    knight(s, 0, V(-1, 0, 'N'));
    expect(longestRoadLength(s, 1)).toBe(3);
    setGoods(s, 1, { brick: 1, lumber: 1, wool: 1, grain: 1 });
    s.turn.current = 1;
    expect(
      legalOf(s, 'buildSettlement', 1).map((a) => (a as { vertex: string }).vertex),
    ).not.toContain(V(-1, 0, 'N'));
    expect(legalOf(s, 'buildRoad', 1).map((a) => (a as { edge: string }).edge)).not.toContain(
      E(-1, -1, 'SE'),
    );
  });

  it('your own knight blocks your settlement on its spot (move it first)', () => {
    const s = knightBoard();
    roads(s, 0, E(0, -1, 'SE'));
    knight(s, 0, V(0, -1, 'S'));
    setGoods(s, 0, { brick: 1, lumber: 1, wool: 1, grain: 1 });
    expect(
      legalOf(s, 'buildSettlement', 0).map((a) => (a as { vertex: string }).vertex),
    ).not.toContain(V(0, -1, 'S'));
  });

  it('only active knights defend; every knight sleeps after an attack (CK-11)', () => {
    const s = ckMain();
    ckSlice(s).barbarian = BARBARIAN_STEPS - 1;
    build(s, 0, FOREST3, 'city');
    build(s, 1, V(0, 0, 'S'), 'city');
    knight(s, 1, V(0, 0, 'N'), 3, false);
    const r = roll(s, 1, 1, 'ship');
    expect(r.pieces.buildings[FOREST3]?.kind).toBe('settlement');
  });
});

describe('city walls (§4.1)', () => {
  it('2 brick, under your own city without a wall, at most 3', () => {
    const s = ckMain();
    build(s, 0, FOREST3, 'city');
    build(s, 0, V(0, 0, 'S'));
    setGoods(s, 0, { brick: 4 });
    const spots = legalOf(s, 'ck/buildWall', 0).map((a) => (a as { vertex: string }).vertex);
    expect(spots).toEqual([FOREST3]);
    const r = ok(s, { type: 'ck/buildWall', player: 0, vertex: FOREST3 });
    expect(ckSlice(r).walls[FOREST3]).toBe(0);
    bad(r, { type: 'ck/buildWall', player: 0, vertex: FOREST3 });
  });
});

describe('city improvements and metropolises (§4.3, §4.4, CK-40..CK-44)', () => {
  it('level n costs n of the track commodity, one level at a time; needs a city', () => {
    const s = ckMain();
    setGoods(s, 0, { cloth: 3 });
    bad(s, { type: 'ck/improve', player: 0, track: 'trade' }, /need a city/);
    build(s, 0, FOREST3, 'city');
    let r = ok(s, { type: 'ck/improve', player: 0, track: 'trade' });
    r = ok(r, { type: 'ck/improve', player: 0, track: 'trade' });
    expect(ckPlayer(r, 0).improvements.trade).toBe(2);
    expect(cards(r, 0).cloth).toBe(0);
    bad(r, { type: 'ck/improve', player: 0, track: 'trade' }, /needs 3 cloth/);
  });

  it('a player who lost every city keeps levels and abilities (CK-24)', () => {
    const s = ckMain();
    setLevel(s, 0, 'trade', 3);
    setGoods(s, 0, { cloth: 4, paper: 2 });
    expect(giveRatio(s, 0, 'paper')).toBe(2);
    bad(s, { type: 'ck/improve', player: 0, track: 'trade' }, /need a city/);
  });

  it('the first to level 4 takes the metropolis (2 VP); a later level 4 gets nothing', () => {
    const s = ckMain();
    build(s, 0, FOREST3, 'city');
    build(s, 1, V(0, 0, 'S'), 'city');
    setLevel(s, 0, 'science', 3);
    setLevel(s, 1, 'science', 3);
    setGoods(s, 0, { paper: 4 });
    setGoods(s, 1, { paper: 4 });
    let r = ok(s, { type: 'ck/improve', player: 0, track: 'science' });
    expect(ckSlice(r).metropolis.science).toEqual({ owner: 0, vertex: FOREST3 });
    expect(publicVictoryPoints(r, 0)).toBe(4);
    r.turn.current = 1;
    r = ok(r, { type: 'ck/improve', player: 1, track: 'science' });
    expect(ckSlice(r).metropolis.science?.owner).toBe(0);
  });

  it('level 5 takes the metropolis from a level-4 owner; a level-5 owner keeps it (Q22)', () => {
    const s = ckMain();
    build(s, 0, FOREST3, 'city');
    build(s, 1, V(0, 0, 'S'), 'city');
    ckSlice(s).metropolis.politics = { owner: 1, vertex: V(0, 0, 'S') };
    setLevel(s, 1, 'politics', 4);
    setLevel(s, 0, 'politics', 4);
    setGoods(s, 0, { coin: 5 });
    const r = ok(s, { type: 'ck/improve', player: 0, track: 'politics' });
    expect(ckSlice(r).metropolis.politics).toEqual({ owner: 0, vertex: FOREST3 });
    expect(publicVictoryPoints(r, 1)).toBe(2);
    setLevel(s, 1, 'politics', 5);
    const r2 = ok(s, { type: 'ck/improve', player: 0, track: 'politics' });
    expect(ckSlice(r2).metropolis.politics?.owner).toBe(1);
  });

  it('a level that would win a metropolis needs a city without one (CK-52)', () => {
    const s = ckMain();
    build(s, 0, FOREST3, 'city');
    ckSlice(s).metropolis.trade = { owner: 0, vertex: FOREST3 };
    setLevel(s, 0, 'trade', 4);
    setLevel(s, 0, 'science', 3);
    setGoods(s, 0, { paper: 4 });
    bad(s, { type: 'ck/improve', player: 0, track: 'science' }, /without a metropolis/);
  });

  it('with several free cities the owner chooses where the metropolis goes', () => {
    const s = ckMain();
    build(s, 0, FOREST3, 'city');
    build(s, 0, V(0, 0, 'S'), 'city');
    setLevel(s, 0, 'trade', 3);
    setGoods(s, 0, { cloth: 4 });
    let r = ok(s, { type: 'ck/improve', player: 0, track: 'trade' });
    expect(phase(r)).toMatchObject({ kind: 'ck/metropolis', track: 'trade', player: 0 });
    r = ok(r, { type: 'ck/pickVertex', player: 0, vertex: V(0, 0, 'S') });
    expect(ckSlice(r).metropolis.trade).toEqual({ owner: 0, vertex: V(0, 0, 'S') });
    expect(r.phase.kind).toBe('main');
  });

  it('Aqueduct: science 3 and no card from a roll -> 1 resource of choice (not on a 7)', () => {
    const s = ckMain();
    setLevel(s, 1, 'science', 3);
    let r = roll(s, 1, 1, 'ship');
    expect(phase(r)).toEqual({ kind: 'ck/aqueduct', queue: [1] });
    r = ok(r, { type: 'ck/pickGood', player: 1, good: 'ore' });
    expect(r.players[1]!.resources.ore).toBe(1);
    expect(r.phase.kind).toBe('main');
    expect(roll(s, 3, 4, 'ship').phase.kind).toBe('main');
    build(s, 1, FOREST3);
    expect(roll(s, 1, 2, 'ship').phase.kind).toBe('main');
  });
});

describe('trading (§3.7)', () => {
  it('commodities trade 4:1 with the bank, 3:1 at a generic harbor, 2:1 with Trade level 3', () => {
    const s = ckMain();
    setGoods(s, 0, { coin: 4 });
    expect(giveRatio(s, 0, 'coin')).toBe(4);
    const r = ok(s, { type: 'ck/bankTrade', player: 0, give: 'coin', receive: 'brick' });
    expect(r.players[0]!.resources.brick).toBe(1);
    expect(cards(r, 0).coin).toBe(0);
    setLevel(s, 0, 'trade', 3);
    expect(giveRatio(s, 0, 'coin')).toBe(2);
    expect(giveRatio(s, 0, 'ore')).toBe(4);
    const port = s.board.ports.find((p) => p.kind === 'generic')!;
    build(s, 0, port.vertices[0]);
    setLevel(s, 0, 'trade', 0);
    expect(giveRatio(s, 0, 'coin')).toBe(3);
    expectConserved(r);
  });

  it('resources buy commodities at the same ratio', () => {
    const s = ckMain();
    setGoods(s, 0, { ore: 4 });
    const r = ok(s, { type: 'ck/bankTrade', player: 0, give: 'ore', receive: 'paper' });
    expect(cards(r, 0).paper).toBe(1);
  });

  it('player trades may include commodities', () => {
    const s = ckMain();
    setGoods(s, 0, { coin: 1 });
    setGoods(s, 1, { brick: 1, paper: 1 });
    let r = ok(s, {
      type: 'ck/offerTrade',
      player: 0,
      give: { coin: 1 },
      want: { brick: 1, paper: 1 },
      to: [1],
    });
    expect(r.phase.kind).toBe('trade');
    r = ok(r, { type: 'acceptTrade', player: 1 }, { type: 'confirmTrade', player: 0, partner: 1 });
    expect(cards(r, 0)).toEqual({ paper: 1, cloth: 0, coin: 0 });
    expect(r.players[0]!.resources.brick).toBe(1);
    expect(cards(r, 1)).toEqual({ paper: 0, cloth: 0, coin: 1 });
    expect(ckSlice(r).trade).toBeNull();
    expectConserved(r);
  });

  it('a partner without the commodities cannot accept', () => {
    const s = ckMain();
    setGoods(s, 0, { brick: 1 });
    const r = ok(s, {
      type: 'ck/offerTrade',
      player: 0,
      give: { brick: 1 },
      want: { coin: 1 },
      to: [1],
    });
    expect(legalOf(r, 'acceptTrade')).toEqual([]);
    bad(r, { type: 'acceptTrade', player: 1 }, /commodities/);
  });
});

describe('special build phase, 5-6 players (§8.1)', () => {
  it('the builder may recruit / activate knights, but not play cards or move knights', () => {
    const s = ckMain(5);
    s.turn.current = 1;
    s.turn.specialOwner = 0;
    s.phase = { kind: 'specialBuild', builder: 1, owner: 0 };
    build(s, 1, V(0, 0, 'S'));
    roads(s, 1, E(0, 0, 'SE'));
    knight(s, 1, V(0, 0, 'N'), 1, true, 1);
    roads(s, 1, E(0, 0, 'NE'));
    build(s, 1, V(0, 0, 'NE'));
    giveCards(s, 1, 'warlord');
    setGoods(s, 1, { wool: 1, ore: 1, grain: 1 });
    const types = new Set(legalActions(s, 1).map((a) => a.type));
    expect(types.has('ck/buildKnight')).toBe(true);
    expect(types.has('ck/play')).toBe(false);
    // The knight command offers promoting, but no move / displace / chase in the step.
    const r = ok(s, { type: 'ck/selectKnight', player: 1, vertex: V(0, 0, 'N') });
    expect(r.phase).toMatchObject({ kind: 'ck/knight', resume: 'specialBuild' });
    const inPhase = new Set(legalActions(r, 1).map((a) => a.type));
    expect(inPhase.has('ck/promoteKnight')).toBe(true);
    expect(inPhase.has('ck/pickVertex')).toBe(false);
    expect(inPhase.has('ck/chaseRobber')).toBe(false);
    const done = ok(r, { type: 'ck/promoteKnight', player: 1, vertex: V(0, 0, 'N') });
    expect(done.phase).toEqual({ kind: 'specialBuild', builder: 1, owner: 0 });
  });
});

describe('victory (§5)', () => {
  it('13 VP on your own turn; a Defender card won on your roll counts at once', () => {
    const s = ckMain();
    ckSlice(s).barbarian = BARBARIAN_STEPS - 1;
    for (const v of [FOREST3, V(0, 0, 'S'), V(2, 0, 'S'), V(-1, 2, 'N')]) build(s, 0, v, 'city');
    build(s, 0, V(1, 1, 'S'));
    build(s, 0, V(-2, 2, 'S'));
    ckPlayer(s, 0).defender = 2;
    knight(s, 0, V(1, -1, 'N'), 3, true);
    knight(s, 0, V(2, -2, 'S'), 1, true);
    // 8 + 2 + 2 = 12; the Defender card makes 13.
    expect(victoryPoints(s, 0)).toBe(12);
    const r = roll(s, 1, 1, 'ship');
    expect(r.phase.kind).toBe('gameOver');
    expect(r.winner).toBe(0);
  });

  it('there is no Largest Army', () => {
    const s = ckMain();
    expect(s.awards.largestArmy).toBeNull();
    expect(supplyOf(s).devDeck).toMatchObject({ knight: 0, victoryPoint: 0 });
  });
});

describe('variants', () => {
  it('Rush mode is refused (the Alchemist needs a step before the roll)', () => {
    expect(() => createGame({ seed: 1, players: players(4), mode: CK, rushMode: true })).toThrow(
      /Rush/,
    );
  });

  it('Event Cards: the card is the roll, the event die is still rolled before it resolves', () => {
    const s = ckMain(4, { eventCards: true });
    s.phase = { kind: 'preRoll' };
    const r = ok(s, { type: 'rollDice', player: 0 });
    expect(ckSlice(r).event).not.toBeNull();
    expect(r.lastEvent).not.toBeUndefined();
  });

  it('the friendly robber and balanced dice combine', () => {
    const s = createGame({
      seed: 3,
      players: players(4),
      mode: CK,
      robberMode: 'friendly',
      balancedDice: true,
    });
    expect(s.settings.robberMode).toBe('friendly');
  });
});

describe('optional rules (§2.5)', () => {
  it('Easy start: no event die and no 7 in a player’s first two turns, normal from the third', () => {
    const s = ckMain(4, { options: { ck: { easyStart: true } } });
    ckSlice(s).turns[0] = 1;
    const r = roll(s, 3, 4, 'ship');
    expect(ckSlice(r).event).toBeNull();
    expect(ckSlice(r).barbarian).toBe(0);
    expect(r.dice![0] + r.dice![1]).not.toBe(7);
    expect(r.phase.kind).toBe('main');
    ckSlice(s).turns[0] = 3;
    const later = roll(s, 3, 4, 'ship');
    expect(ckSlice(later).barbarian).toBe(1);
    expect(later.dice).toEqual([3, 4]);
  });

  it('Easy start counts own turns (turn start), and cannot combine with Event Cards', () => {
    const s = ckMain(4, { options: { ck: { easyStart: true } } });
    const r = ok(s, { type: 'endTurn', player: 0 });
    expect(ckSlice(r).turns[1]).toBe(1);
    expect(() => ckGame(4, { options: { ck: { easyStart: true } }, eventCards: true })).toThrow(
      /Easy start/,
    );
  });

  it('Knight-errant: an active knight next to the robber may chase it before the roll', () => {
    const plain = ckMain();
    plain.phase = { kind: 'preRoll' };
    ckSlice(plain).attacks = 1;
    plain.robber = 'h:0,0';
    knight(plain, 0, V(0, 0, 'N'), 1, true, 1);
    expect(legalOf(plain, 'ck/selectKnight')).toEqual([]);
    const s = ckMain(4, { options: { ck: { knightErrant: true } } });
    s.phase = { kind: 'preRoll' };
    ckSlice(s).attacks = 1;
    s.robber = 'h:0,0';
    knight(s, 0, V(0, 0, 'N'), 1, true, 1);
    let r = ok(s, { type: 'ck/selectKnight', player: 0, vertex: V(0, 0, 'N') });
    expect(legalOf(r, 'ck/pickVertex')).toEqual([]);
    expect(legalOf(r, 'ck/activateKnight')).toEqual([]);
    r = ok(r, { type: 'ck/chaseRobber', player: 0 });
    expect(r.phase).toEqual({ kind: 'moveRobber', resume: 'preRoll' });
    r = ok(r, { type: 'moveRobber', player: 0, hex: 'h:-1,0' });
    expect(r.phase.kind).toBe('preRoll');
  });
});
