/** Every progress card (docs/rules/cities-knights.md §4.6, CK-53..CK-64): effect + edge cases. */
import { describe, expect, it } from 'vitest';
import { publicVictoryPoints } from '../../../engine/selectors';
import type { GameState } from '../../../engine/types';
import { ckPlayer, ckSlice, giveRatio, type CkPhase } from '.';
import {
  E,
  V,
  bad,
  build,
  ckMain,
  expectConserved,
  giveCards,
  knight,
  legalOf,
  ok,
  roads,
  setGoods,
  setLevel,
} from './testkit';

const phase = (s: GameState) => s.phase as unknown as CkPhase;
const play = (s: GameState, card: string, player = 0) =>
  ok(s, { type: 'ck/play', player, card } as never);
const hand = (s: GameState, p: number) => ckPlayer(s, p).progress;

const FOREST3 = V(-1, -1, 'S');

describe('progress cards: general rules', () => {
  it('only after the roll, on your own turn; the card goes under its stack', () => {
    const s = ckMain();
    giveCards(s, 0, 'warlord');
    knight(s, 0, V(0, 0, 'N'));
    s.phase = { kind: 'preRoll' };
    bad(s, { type: 'ck/play', player: 0, card: 'warlord' }, /after rolling/);
    s.phase = { kind: 'main' };
    const r = play(s, 'warlord');
    expect(hand(r, 0)).toEqual([]);
    expect(ckSlice(r).decks.politics[0]).toBe('warlord');
  });

  it('a card that cannot have any effect may not be played (CK-53)', () => {
    const s = ckMain();
    giveCards(s, 0, 'warlord', 'engineer');
    bad(s, { type: 'ck/play', player: 0, card: 'warlord' }, /no inactive knight/);
    bad(s, { type: 'ck/play', player: 0, card: 'engineer' }, /wall/);
    expect(legalOf(s, 'ck/play')).toEqual([]);
  });
});

describe('science', () => {
  it('Alchemist: before the roll, choose both dice; the event die is still rolled (CK-54)', () => {
    const s = ckMain();
    s.phase = { kind: 'preRoll' };
    giveCards(s, 0, 'alchemist');
    build(s, 0, FOREST3, 'city');
    expect(legalOf(s, 'ck/alchemist')).toHaveLength(36);
    const r = ok(s, { type: 'ck/alchemist', player: 0, yellow: 1, red: 2 });
    expect(r.dice).toEqual([1, 2]);
    expect(r.players[0]!.resources.lumber).toBe(1);
    expect(ckPlayer(r, 0).commodities.paper).toBe(1);
    expect(ckSlice(r).event).not.toBeNull();
    expect(hand(r, 0)).toEqual([]);
  });

  it('Alchemist can set a 7', () => {
    const s = ckMain();
    s.phase = { kind: 'preRoll' };
    giveCards(s, 0, 'alchemist');
    ckSlice(s).attacks = 1;
    const r = ok(s, { type: 'ck/alchemist', player: 0, yellow: 3, red: 4 });
    expect(['moveRobber', 'ck/pillage', 'ck/defender', 'ck/progressDiscard']).toContain(
      r.phase.kind,
    );
  });

  it('Crane: the next improvement this turn costs 1 less; level 1 becomes free (CK-56)', () => {
    const s = ckMain();
    build(s, 0, FOREST3, 'city');
    giveCards(s, 0, 'crane');
    let r = play(s, 'crane');
    r = ok(r, { type: 'ck/improve', player: 0, track: 'science' });
    expect(ckPlayer(r, 0).improvements.science).toBe(1);
    expect(ckSlice(r).turn.cranes).toBe(0);
    bad(r, { type: 'ck/improve', player: 0, track: 'science' }, /needs 2 paper/);
  });

  it('Engineer: a free city wall', () => {
    const s = ckMain();
    build(s, 0, FOREST3, 'city');
    giveCards(s, 0, 'engineer');
    const r = ok(play(s, 'engineer'), { type: 'ck/pickVertex', player: 0, vertex: FOREST3 });
    expect(ckSlice(r).walls[FOREST3]).toBe(0);
    expect(r.phase.kind).toBe('main');
  });

  it('Inventor: swap two tokens, never 2, 6, 8 or 12 (CK-59)', () => {
    const s = ckMain();
    giveCards(s, 0, 'inventor');
    let r = play(s, 'inventor');
    const hexes = legalOf(r, 'ck/pickHex').map((a) => (a as { hex: string }).hex);
    expect(hexes).not.toContain('h:0,-2'); // the 6
    expect(hexes).not.toContain('h:1,-2'); // the 2
    r = ok(
      r,
      { type: 'ck/pickHex', player: 0, hex: 'h:-1,-1' },
      { type: 'ck/pickHex', player: 0, hex: 'h:0,0' },
    );
    expect(r.board.hexes['h:-1,-1']?.token).toBe(11);
    expect(r.board.hexes['h:0,0']?.token).toBe(3);
    expect(s.board.hexes['h:0,0']?.token).toBe(11);
  });

  it('Irrigation / Mining: 2 grain (ore) per fields (mountains) hex next to your buildings', () => {
    const s = ckMain();
    build(s, 0, FOREST3); // grain 4
    build(s, 0, V(-1, 1, 'S')); // grain 5 + ore? (h:-1,1 S touches h:-1,1, h:-1,2, h:-2,2)
    giveCards(s, 0, 'irrigation', 'mining');
    const r = play(s, 'irrigation');
    // h:-1,0 (grain), h:-1,1 (grain), h:-2,2 (grain): 6 grain
    expect(r.players[0]!.resources.grain).toBe(6);
    bad(r, { type: 'ck/play', player: 0, card: 'mining' }, /mountains/);
    expectConserved(r);
  });

  it('Medicine: a city for 2 ore + 1 grain', () => {
    const s = ckMain();
    build(s, 0, FOREST3);
    setGoods(s, 0, { ore: 2, grain: 1 });
    giveCards(s, 0, 'medicine');
    const r = ok(play(s, 'medicine'), { type: 'ck/pickVertex', player: 0, vertex: FOREST3 });
    expect(r.pieces.buildings[FOREST3]?.kind).toBe('city');
    expect(r.players[0]!.resources).toMatchObject({ ore: 0, grain: 0 });
    expectConserved(r);
  });

  it('Road Building: 2 free roads', () => {
    const s = ckMain();
    build(s, 0, V(0, 0, 'N'));
    giveCards(s, 0, 'roadBuilding');
    let r = play(s, 'roadBuilding');
    expect(r.phase).toEqual({ kind: 'roadBuilding', remaining: 2, resume: 'main' });
    r = ok(r, { type: 'placeFreeRoad', player: 0, edge: E(0, 0, 'NE') });
    r = ok(r, { type: 'placeFreeRoad', player: 0, edge: E(0, 0, 'E') });
    expect(r.phase.kind).toBe('main');
  });

  it('Smith: promote up to 2 knights for free, each once (CK-60)', () => {
    const s = ckMain();
    knight(s, 0, V(0, 0, 'N'), 1, true);
    knight(s, 0, V(0, 0, 'S'), 2, false);
    setLevel(s, 0, 'politics', 3);
    giveCards(s, 0, 'smith');
    let r = play(s, 'smith');
    r = ok(r, { type: 'ck/pickVertex', player: 0, vertex: V(0, 0, 'N') });
    expect(phase(r)).toMatchObject({ kind: 'ck/card', card: 'smith', left: 1 });
    expect(legalOf(r, 'ck/pickVertex').map((a) => (a as { vertex: string }).vertex)).toEqual([
      V(0, 0, 'S'),
    ]);
    r = ok(r, { type: 'ck/pickVertex', player: 0, vertex: V(0, 0, 'S') });
    expect(ckSlice(r).knights[V(0, 0, 'N')]).toMatchObject({ level: 2, active: true });
    expect(ckSlice(r).knights[V(0, 0, 'S')]).toMatchObject({ level: 3, active: false });
    expect(r.phase.kind).toBe('main');
  });
});

describe('politics', () => {
  it('Bishop: only after the first attack; steals 1 card from each player at the hex (CK-55)', () => {
    const s = ckMain();
    giveCards(s, 0, 'bishop');
    bad(s, { type: 'ck/play', player: 0, card: 'bishop' }, /sleeps/);
    ckSlice(s).attacks = 1;
    build(s, 1, V(0, 0, 'N'));
    build(s, 1, V(0, 0, 'S'));
    build(s, 2, V(0, 0, 'NE'));
    setGoods(s, 1, { ore: 3 });
    setGoods(s, 2, { cloth: 1 });
    const r = ok(play(s, 'bishop'), { type: 'ck/pickHex', player: 0, hex: 'h:0,0' });
    expect(r.robber).toBe('h:0,0');
    expect(r.players[0]!.resources.ore).toBe(1);
    expect(ckPlayer(r, 0).commodities.cloth).toBe(1);
    expectConserved(r);
  });

  it('Constitution / Printer are never in hand: laid out as 1 VP', () => {
    const s = ckMain();
    ckPlayer(s, 0).vpCards.push('constitution');
    ckSlice(s).decks.politics.splice(ckSlice(s).decks.politics.indexOf('constitution'), 1);
    expect(publicVictoryPoints(s, 0)).toBe(1);
  });

  it('Deserter: the victim picks the knight; you place one of the same level (CK-57)', () => {
    const s = ckMain();
    build(s, 0, V(0, 0, 'SW'));
    roads(s, 0, E(0, 0, 'W'));
    knight(s, 1, V(0, 0, 'NE'), 2, true);
    knight(s, 1, V(1, 1, 'N'), 1, false);
    giveCards(s, 0, 'deserter');
    let r = play(s, 'deserter');
    r = ok(r, { type: 'ck/pickPlayer', player: 0, target: 1 });
    expect(legalOf(r, 'ck/pickVertex', 1)).toHaveLength(2);
    r = ok(r, { type: 'ck/pickVertex', player: 1, vertex: V(1, 1, 'N') });
    r = ok(r, { type: 'ck/pickVertex', player: 0, vertex: V(0, 0, 'NW') });
    expect(ckSlice(r).knights[V(0, 0, 'NW')]).toMatchObject({ owner: 0, level: 1, active: false });
    expect(ckSlice(r).knights[V(1, 1, 'N')]).toBeUndefined();
  });

  it('Diplomat: an opponent’s open road goes back to its owner; your own may be re-placed', () => {
    const s = ckMain();
    build(s, 1, V(0, 0, 'N'));
    roads(s, 1, E(0, 0, 'NE'), E(0, 0, 'E'));
    build(s, 0, V(-1, 0, 'S'));
    roads(s, 0, E(-1, 0, 'SE'));
    giveCards(s, 0, 'diplomat', 'diplomat');
    const open = legalOf(play(s, 'diplomat'), 'ck/pickEdge').map(
      (a) => (a as { edge: string }).edge,
    );
    expect(open.sort()).toEqual([E(-1, 0, 'SE'), E(0, 0, 'E')].sort());
    let r = ok(play(s, 'diplomat'), { type: 'ck/pickEdge', player: 0, edge: E(0, 0, 'E') });
    expect(r.pieces.roads[E(0, 0, 'E')]).toBeUndefined();
    r = ok(play(r, 'diplomat'), { type: 'ck/pickEdge', player: 0, edge: E(-1, 0, 'SE') });
    expect(r.pieces.roads[E(-1, 0, 'SE')]).toBe(0); // stays until re-placed
    r = ok(r, { type: 'ck/pickEdge', player: 0, edge: E(-1, 0, 'SW') });
    expect(r.pieces.roads[E(-1, 0, 'SE')]).toBeUndefined();
    expect(r.pieces.roads[E(-1, 0, 'SW')]).toBe(0);
  });

  it('Intrigue: displace an opponent’s knight on your road without a knight', () => {
    const s = ckMain();
    build(s, 0, V(0, 0, 'SW'));
    roads(s, 0, E(0, 0, 'W'));
    knight(s, 1, V(0, 0, 'NW'), 3, true);
    giveCards(s, 0, 'intrigue');
    const r = ok(play(s, 'intrigue'), { type: 'ck/pickVertex', player: 0, vertex: V(0, 0, 'NW') });
    expect(ckSlice(r).knights[V(0, 0, 'NW')]).toBeUndefined();
    expect(r.phase.kind).toBe('main'); // no road of player 1 to retreat along: removed
  });

  it('Saboteur: everyone with as many VP or more discards half (CK-61)', () => {
    const s = ckMain();
    build(s, 0, FOREST3);
    build(s, 1, V(0, 0, 'S'));
    build(s, 2, V(2, 0, 'S'), 'city');
    setGoods(s, 1, { ore: 5 });
    setGoods(s, 2, { coin: 4 });
    giveCards(s, 0, 'saboteur');
    let r = play(s, 'saboteur');
    expect(phase(r)).toEqual({ kind: 'ck/sabotage', pending: [0, 2, 2, 0] });
    r = ok(r, { type: 'ck/discard', player: 1, resources: { ore: 2 }, commodities: {} });
    r = ok(r, { type: 'ck/discard', player: 2, resources: {}, commodities: { coin: 2 } });
    expect(r.phase.kind).toBe('main');
    expectConserved(r);
  });

  it('Spy: look at a hand and take one card (not a VP card)', () => {
    const s = ckMain();
    giveCards(s, 0, 'spy');
    giveCards(s, 2, 'warlord', 'crane');
    let r = play(s, 'spy');
    expect(legalOf(r, 'ck/pickPlayer').map((a) => a['target' as keyof typeof a])).toEqual([2]);
    r = ok(r, { type: 'ck/pickPlayer', player: 0, target: 2 });
    r = ok(r, { type: 'ck/pickCard', player: 0, card: 'crane' });
    expect(hand(r, 0)).toEqual(['crane']);
    expect(hand(r, 2)).toEqual(['warlord']);
  });

  it('Warlord: activate all your knights for free (they cannot act this turn)', () => {
    const s = ckMain();
    knight(s, 0, V(0, 0, 'N'));
    knight(s, 0, V(0, 0, 'S'), 2);
    giveCards(s, 0, 'warlord');
    const r = play(s, 'warlord');
    expect(Object.values(ckSlice(r).knights).every((k) => k.active && k.activatedOn === 3)).toBe(
      true,
    );
  });

  it('Wedding: each richer player gives 2 cards of their choice', () => {
    const s = ckMain();
    build(s, 1, V(0, 0, 'S'));
    build(s, 2, V(2, 0, 'S'));
    setGoods(s, 1, { ore: 1 });
    setGoods(s, 2, { wool: 3, paper: 1 });
    giveCards(s, 0, 'wedding');
    let r = play(s, 'wedding');
    expect(phase(r)).toEqual({ kind: 'ck/wedding', pending: [0, 1, 2, 0], to: 0 });
    r = ok(r, { type: 'ck/discard', player: 2, resources: { wool: 1 }, commodities: { paper: 1 } });
    r = ok(r, { type: 'ck/discard', player: 1, resources: { ore: 1 }, commodities: {} });
    expect(r.players[0]!.resources).toMatchObject({ ore: 1, wool: 1 });
    expect(ckPlayer(r, 0).commodities.paper).toBe(1);
    expect(r.phase.kind).toBe('main');
    expectConserved(r);
  });
});

describe('trade', () => {
  it('Commercial Harbor: each opponent swaps a commodity of their choice for your resource (CK-63)', () => {
    const s = ckMain();
    setGoods(s, 0, { ore: 2 });
    setGoods(s, 1, { cloth: 1 });
    setGoods(s, 3, { coin: 2 });
    giveCards(s, 0, 'commercialHarbor');
    let r = play(s, 'commercialHarbor');
    expect(phase(r)).toMatchObject({ queue: [1, 3], offered: null });
    r = ok(r, { type: 'ck/pickGood', player: 0, good: 'ore' });
    r = ok(r, { type: 'ck/pickGood', player: 1, good: 'cloth' });
    r = ok(r, { type: 'ck/pickGood', player: 0, good: 'ore' });
    r = ok(r, { type: 'ck/pickGood', player: 3, good: 'coin' });
    expect(r.phase.kind).toBe('main');
    expect(ckPlayer(r, 0).commodities).toMatchObject({ cloth: 1, coin: 1 });
    expect(r.players[1]!.resources.ore).toBe(1);
    expectConserved(r);
  });

  it('Master Merchant: take 2 cards from a player with more VP', () => {
    const s = ckMain();
    build(s, 1, V(0, 0, 'S'));
    setGoods(s, 1, { ore: 1, coin: 1, wool: 1 });
    giveCards(s, 0, 'masterMerchant');
    let r = ok(play(s, 'masterMerchant'), { type: 'ck/pickPlayer', player: 0, target: 1 });
    r = ok(
      r,
      { type: 'ck/pickGood', player: 0, good: 'coin' },
      { type: 'ck/pickGood', player: 0, good: 'ore' },
    );
    expect(r.phase.kind).toBe('main');
    expect(r.players[0]!.resources.ore).toBe(1);
    expect(ckPlayer(r, 0).commodities.coin).toBe(1);
  });

  it('Merchant: 1 VP and 2:1 for the hex’s resource; a later Merchant moves it (CK-49)', () => {
    const s = ckMain();
    build(s, 0, FOREST3);
    build(s, 1, V(0, 0, 'S'));
    giveCards(s, 0, 'merchant');
    giveCards(s, 1, 'merchant');
    let r = ok(play(s, 'merchant'), { type: 'ck/pickHex', player: 0, hex: 'h:-1,-1' });
    expect(publicVictoryPoints(r, 0)).toBe(2);
    expect(giveRatio(r, 0, 'lumber')).toBe(2);
    expect(giveRatio(r, 1, 'lumber')).toBe(4);
    r.turn.current = 1;
    r = ok(play(r, 'merchant', 1), { type: 'ck/pickHex', player: 1, hex: 'h:0,0' });
    expect(publicVictoryPoints(r, 0)).toBe(1);
    expect(giveRatio(r, 1, 'brick')).toBe(2);
  });

  it('Merchant Fleet: one kind 2:1 for the rest of the turn (CK-62)', () => {
    const s = ckMain();
    giveCards(s, 0, 'merchantFleet');
    const r = ok(play(s, 'merchantFleet'), { type: 'ck/pickGood', player: 0, good: 'cloth' });
    expect(giveRatio(r, 0, 'cloth')).toBe(2);
    setGoods(r, 0, { cloth: 2 });
    const t = ok(r, { type: 'ck/bankTrade', player: 0, give: 'cloth', receive: 'grain' });
    expect(t.players[0]!.resources.grain).toBe(1);
    const next = structuredClone(r);
    next.turn.current = 1;
    next.phase = { kind: 'main' };
    ckSlice(next).turn.fleet = [];
    expect(giveRatio(next, 0, 'cloth')).toBe(4);
  });

  it('Resource Monopoly: 2 of a resource from each opponent; Trade Monopoly: 1 commodity', () => {
    const s = ckMain();
    setGoods(s, 1, { ore: 3, coin: 2 });
    setGoods(s, 2, { ore: 1 });
    giveCards(s, 0, 'resourceMonopoly', 'tradeMonopoly');
    let r = ok(play(s, 'resourceMonopoly'), { type: 'ck/pickGood', player: 0, good: 'ore' });
    expect(r.players[0]!.resources.ore).toBe(3);
    r = ok(play(r, 'tradeMonopoly'), { type: 'ck/pickGood', player: 0, good: 'coin' });
    expect(ckPlayer(r, 0).commodities.coin).toBe(1);
    expectConserved(r);
  });
});
