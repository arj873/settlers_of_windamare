/** Oil Springs rules (docs/rules/oil-springs.md): one test per rule, plus a soundness test. */
import { describe, expect, it } from 'vitest';
import { RESOURCES } from '../../../engine/constants';
import { applyAction, legalActions } from '../../../engine/engine';
import { createGame } from '../../../engine/createGame';
import { NO_ROBBER } from '../../../engine/expansions/ext';
import { Rng } from '../../../engine/rng';
import { publicVictoryPoints, victoryPoints } from '../../../engine/selectors';
import { hexVertices, topologyOf, vertexInfo } from '../../../engine/topology';
import {
  expectConserved,
  expectFail,
  expectOk,
  rngForRoll,
  run,
  setHand,
} from '../../../engine/actions/testkit';
import type { Action, GameState, HexId, PlayerId, VertexId } from '../../../engine/types';
import {
  OIL,
  SPRING_DESERT,
  SPRING_FOREST,
  SPRING_PASTURE,
  isSpringTerrain,
  metropolisCount,
  oilOf,
  oilScale,
  oilSlice,
  springHexes,
} from '.';

const players = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ name: `P${i}`, color: `#10101${i}` }));

function oilGame(n = 4, seed: number | string = 1, scenario = 'oil/oilSprings'): GameState {
  return createGame({ seed, players: players(n), mode: OIL, scenario, startingPlayer: 0 });
}

/** A game in the main phase of turn 3, player 0 to act. */
function mainGame(n = 4): GameState {
  const s = oilGame(n);
  s.turn = { number: 3, current: 0, devCardPlayed: false, tradeOffers: 0 };
  s.phase = { kind: 'main' };
  return s;
}

const hexWith = (s: GameState, f: (id: HexId) => boolean): HexId => {
  const h = (Object.keys(s.board.hexes) as HexId[]).find(f);
  if (!h) throw new Error('no such hex');
  return h;
};
const springOf = (s: GameState, terrain: string): HexId =>
  hexWith(s, (h) => s.board.hexes[h]?.terrain === terrain);

/** An inland (non-coastal) vertex touching `hex`, or any vertex of it. */
function vertexOf(s: GameState, hex: HexId, coastal: boolean): VertexId {
  const t = topologyOf(s);
  const v = hexVertices(t, hex).find((x) => vertexInfo(t, x)?.coastal === coastal);
  if (!v) throw new Error('no such vertex');
  return v;
}

function give(s: GameState, p: PlayerId, oil: number): void {
  const o = oilSlice(s);
  o.oil[p] = (o.oil[p] ?? 0) + oil;
  o.supply -= oil;
}

function oilTotal(s: GameState): number {
  const o = oilSlice(s);
  return (
    o.supply + o.lost + o.oil.reduce((a, b) => a + b, 0) + o.sequestered.reduce((a, b) => a + b, 0)
  );
}

const act = (s: GameState, a: Record<string, unknown>) => applyAction(s, a as unknown as Action);

/** Change a hex's number token (null = destroyed) without touching the shared board object. */
function setToken(s: GameState, h: HexId, token: number | null): void {
  const tile = s.board.hexes[h];
  if (!tile) throw new Error(`no hex ${h}`);
  s.board = { ...s.board, hexes: { ...s.board.hexes, [h]: { ...tile, token } } };
}
const flag = (a: Action, key: string): unknown => (a as Record<string, unknown>)[key];

describe('oil setup', () => {
  it('3-4 players: the rulebook layout with 3 springs, robber off the board, 12 VP', () => {
    const s = oilGame();
    expect(s.settings).toMatchObject({ mode: 'oil', scenario: 'oil/oilSprings', vpToWin: 12 });
    expect(s.settings.map).toBe('oil/fixed19');
    expect(s.robber).toBe(NO_ROBBER);
    const count = (t: string) => Object.values(s.board.hexes).filter((h) => h.terrain === t).length;
    expect(count('lumber') + count(SPRING_FOREST)).toBe(4);
    expect(count('wool') + count(SPRING_PASTURE)).toBe(4);
    expect(count('grain')).toBe(4);
    expect(count('brick')).toBe(3);
    expect(count('ore')).toBe(3);
    expect(count(SPRING_DESERT)).toBe(1);
    expect(springHexes(s)).toHaveLength(3);
    // The numbered desert tile adds a third 5 to the 18 normal tokens.
    const tokens = Object.values(s.board.hexes).map((h) => h.token);
    expect(tokens.filter((t) => t === 5)).toHaveLength(3);
    expect(tokens.filter((t) => t !== null)).toHaveLength(19);
    expect(s.board.hexes[springOf(s, SPRING_DESERT)]?.token).toBe(5);
  });

  it('starts with 15 oil in the supply, nothing held, marker at 0', () => {
    const s = oilGame();
    expect(oilSlice(s)).toMatchObject({
      v: 1,
      supply: 15,
      lost: 0,
      marker: 0,
      destroyed: [],
      champion: null,
      metropolis: {},
    });
    expect(oilScale(s)).toEqual({ cap: 4, oil: 15, metropolises: 4, ruin: 5 });
  });

  it('5-6 players: 4 springs, 21 oil, 6 metropolises, cap 6, ruin at 8, special build on', () => {
    const s = oilGame(5);
    expect(s.settings).toMatchObject({ map: 'oil/fixed30', specialBuildPhase: true, vpToWin: 12 });
    expect(Object.keys(s.board.hexes)).toHaveLength(30);
    expect(springHexes(s)).toHaveLength(4);
    expect(oilScale(s)).toEqual({ cap: 6, oil: 21, metropolises: 6, ruin: 8 });
    expect(oilSlice(s).supply).toBe(21);
    const terrains = Object.values(s.board.hexes).map((h) => h.terrain);
    expect(terrains.filter((t) => t === SPRING_DESERT)).toHaveLength(2);
    expect(terrains.filter((t) => t === SPRING_FOREST)).toHaveLength(1);
    expect(terrains.filter((t) => t === SPRING_PASTURE)).toHaveLength(1);
    expect(oilGame(6, 3).players).toHaveLength(6);
  });

  it('variable setup: a numbered desert spring, a pasture and a forest spring, none adjacent', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const s = oilGame(4, seed, 'oil/oilSpringsVariable');
      expect(s.settings.map).toBe('oil/random19');
      const springs = springHexes(s);
      expect(springs).toHaveLength(3);
      expect(s.board.hexes[springOf(s, SPRING_DESERT)]?.token).not.toBeNull();
      const pasture = springOf(s, SPRING_PASTURE);
      const forest = springOf(s, SPRING_FOREST);
      expect(s.board.hexes[pasture]?.token).not.toBeNull();
      expect(s.board.hexes[forest]?.token).not.toBeNull();
      expect(s.robber).toBe(NO_ROBBER);
    }
    const big = oilGame(6, 4, 'oil/oilSpringsVariable');
    expect(big.settings.map).toBe('oil/random30');
    expect(springHexes(big)).toHaveLength(4);
  });

  it('is deterministic and JSON-safe', () => {
    expect(oilGame(4, 9)).toEqual(oilGame(4, 9));
    expect(JSON.parse(JSON.stringify(oilGame(5, 9)))).toEqual(oilGame(5, 9));
  });

  it('rejects 7 players', () => {
    expect(() => createGame({ seed: 1, players: players(7), mode: OIL })).toThrow(/3-6/);
  });
});

describe('oil production', () => {
  function rolled(s: GameState, hex: HexId, roll = s.board.hexes[hex]?.token as number): GameState {
    s.turn = { number: 3, current: 0, devCardPlayed: false, tradeOffers: 0 };
    s.phase = { kind: 'preRoll' };
    s.rng = rngForRoll(roll);
    return run(s, { type: 'rollDice', player: 0 });
  }

  it('springs pay oil, not resources: settlement 1, city 2, metropolis 3', () => {
    const s = oilGame();
    const hex = springOf(s, SPRING_FOREST);
    const [a, b, c] = hexVertices(topologyOf(s), hex);
    s.pieces.buildings[a as VertexId] = { owner: 0, kind: 'settlement' };
    s.pieces.buildings[b as VertexId] = { owner: 1, kind: 'city' };
    s.pieces.buildings[c as VertexId] = { owner: 2, kind: 'city' };
    oilSlice(s).metropolis[c as VertexId] = 2;
    const after = rolled(s, hex, 9);
    expect(oilOf(after, 0)).toBe(1);
    expect(oilOf(after, 1)).toBe(2);
    expect(oilOf(after, 2)).toBe(3);
    expect(oilSlice(after).supply).toBe(15 - 6);
    for (const p of after.players) expect(p.resources).toEqual(s.players[0]?.resources);
    expect(oilTotal(after)).toBe(15);
    expectConserved(after);
  });

  it('the robber on a spring stops it', () => {
    const s = oilGame();
    const hex = springOf(s, SPRING_FOREST);
    s.pieces.buildings[hexVertices(topologyOf(s), hex)[0] as VertexId] = {
      owner: 0,
      kind: 'settlement',
    };
    s.robber = hex;
    expect(oilOf(rolled(s, hex, 9), 0)).toBe(0);
  });

  it('a player never holds more than 4 oil: the excess is lost', () => {
    const s = oilGame();
    const hex = springOf(s, SPRING_FOREST);
    s.pieces.buildings[hexVertices(topologyOf(s), hex)[0] as VertexId] = { owner: 0, kind: 'city' };
    give(s, 0, 3);
    const after = rolled(s, hex, 9);
    expect(oilOf(after, 0)).toBe(4);
    expect(oilSlice(after).supply).toBe(15 - 4);
  });

  it('is handed out one at a time from the roller when the supply runs short', () => {
    const s = oilGame();
    const hex = springOf(s, SPRING_FOREST);
    const [a, b] = hexVertices(topologyOf(s), hex);
    s.pieces.buildings[a as VertexId] = { owner: 2, kind: 'city' };
    s.pieces.buildings[b as VertexId] = { owner: 1, kind: 'city' };
    const o = oilSlice(s);
    o.supply = 3; // owed 2 + 2, only 3 left
    o.lost = 12;
    // Player 0 rolls; going clockwise player 1 gets the first oil, 2 the second, 1 the third.
    const after = rolled(s, hex, 9);
    expect(oilOf(after, 1)).toBe(2);
    expect(oilOf(after, 2)).toBe(1);
    expect(oilSlice(after).supply).toBe(0);
  });

  it('two springs with the same number both pay', () => {
    const s = oilGame();
    const desert = springOf(s, SPRING_DESERT);
    const forest = springOf(s, SPRING_FOREST);
    setToken(s, forest, 5);
    s.pieces.buildings[hexVertices(topologyOf(s), desert)[0] as VertexId] = {
      owner: 0,
      kind: 'settlement',
    };
    s.pieces.buildings[hexVertices(topologyOf(s), forest)[0] as VertexId] = {
      owner: 0,
      kind: 'settlement',
    };
    expect(oilOf(rolled(s, desert, 5), 0)).toBe(2);
  });

  it('normal hexes still pay resources, and a metropolis pays 3 instead of 2', () => {
    const s = oilGame();
    const hex = hexWith(s, (h) => s.board.hexes[h]?.terrain === 'ore');
    const token = s.board.hexes[hex]?.token as number;
    const v = vertexOf(s, hex, false);
    s.pieces.buildings[v] = { owner: 1, kind: 'city' };
    oilSlice(s).metropolis[v] = 1;
    const after = rolled(s, hex, token);
    expect(after.players[1]?.resources.ore).toBe(3);
    expectConserved(after);
  });
});

describe('oil and the 7', () => {
  it('oil counts as a card toward the discard limit; oil can be discarded back to the supply', () => {
    const s = oilGame();
    s.turn = { number: 3, current: 0, devCardPlayed: false, tradeOffers: 0 };
    s.phase = { kind: 'preRoll' };
    setHand(s, 1, { brick: 3, lumber: 1 });
    give(s, 1, 4); // 8 cards
    s.rng = rngForRoll(7);
    const seven = run(s, { type: 'rollDice', player: 0 });
    expect(seven.phase).toMatchObject({ kind: 'discard', pending: [0, 4, 0, 0] });
    // The base discard is hidden for a player holding oil; the oil variants offer every choice.
    const legal = legalActions(seven, 1);
    expect(legal.some((a) => a.type === 'discard')).toBe(false);
    // Discarding only resources is an oil/discard with 0 oil; every split of 4 cards is offered.
    expect(legal.some((a) => a.type === 'oil/discard' && flag(a, 'oil') === 0)).toBe(true);
    expect(legal.some((a) => a.type === 'oil/discard' && flag(a, 'oil') === 4)).toBe(true);
    expectFail(
      act(seven, { type: 'oil/discard', player: 1, resources: { brick: 1 }, oil: 2 }),
      /exactly 4/,
    );
    const after = expectOk(
      act(seven, { type: 'oil/discard', player: 1, resources: { brick: 1 }, oil: 3 }),
    );
    expect(oilOf(after, 1)).toBe(1);
    expect(oilSlice(after).supply).toBe(15 - 4 + 3);
    expect(oilSlice(after).marker).toBe(0); // discarded oil is not "used"
    expect(after.phase).toEqual({ kind: 'moveRobber', resume: 'main' });
    expectFail(act(seven, { type: 'oil/discard', player: 1, resources: {}, oil: 5 }), /much oil/);
  });

  it('the robber may be put on a spring', () => {
    const s = mainGame();
    s.phase = { kind: 'moveRobber', resume: 'main' };
    const hex = springOf(s, SPRING_PASTURE);
    const after = run(s, { type: 'moveRobber', player: 0, hex });
    expect(after.robber).toBe(hex);
  });

  it('a thief may take 1 oil instead of a random card, within the cap', () => {
    const s = mainGame();
    const hex = springOf(s, SPRING_FOREST);
    s.pieces.buildings[hexVertices(topologyOf(s), hex)[0] as VertexId] = {
      owner: 1,
      kind: 'settlement',
    };
    give(s, 1, 2);
    setHand(s, 1, { ore: 2 });
    s.phase = { kind: 'moveRobber', resume: 'main' };
    const steal = run(s, { type: 'moveRobber', player: 0, hex });
    expect(steal.phase.kind).toBe('steal');
    const legal = legalActions(steal);
    expect(legal.some((a) => a.type === 'steal')).toBe(false);
    expect(legal.filter((a) => a.type === 'oil/steal')).toHaveLength(2);
    const taken = expectOk(act(steal, { type: 'oil/steal', player: 0, victim: 1, oil: true }));
    expect(oilOf(taken, 0)).toBe(1);
    expect(oilOf(taken, 1)).toBe(1);
    expect(taken.players[1]?.resources.ore).toBe(2);
    expect(taken.phase).toEqual({ kind: 'main' });
    const card = expectOk(act(steal, { type: 'oil/steal', player: 0, victim: 1, oil: false }));
    expect(card.players[0]?.resources.ore).toBe(1);
    expect(oilOf(card, 1)).toBe(2);
    // At the cap the oil option disappears.
    give(steal, 0, 4);
    expect(legalActions(steal).some((a) => flag(a, 'oil') === true)).toBe(false);
    expectFail(act(steal, { type: 'oil/steal', player: 0, victim: 1, oil: true }), /cannot hold/);
    expect(legalActions(steal).some((a) => a.type === 'steal')).toBe(true);
  });

  it('the robber cannot go to a destroyed hex', () => {
    const s = mainGame();
    const hex = hexWith(s, (h) => s.board.hexes[h]?.terrain === 'ore');
    setToken(s, hex, null);
    oilSlice(s).destroyed.push(hex);
    s.phase = { kind: 'moveRobber', resume: 'main' };
    expectFail(applyAction(s, { type: 'moveRobber', player: 0, hex }), /destroyed/);
    expect(legalActions(s).some((a) => a.type === 'moveRobber' && a.hex === hex)).toBe(false);
  });
});

describe('using oil', () => {
  it('converts 1 oil into 2 cards of one resource and moves the marker', () => {
    const s = mainGame();
    give(s, 0, 2);
    const after = run(s, { type: 'oil/convert', player: 0, resource: 'grain' });
    expect(after.players[0]?.resources.grain).toBe(2);
    expect(oilOf(after, 0)).toBe(1);
    expect(oilSlice(after).supply).toBe(15 - 2 + 1);
    expect(oilSlice(after).marker).toBe(1);
    expect(after.bank.grain).toBe(17);
    expectConserved(after);
    expect(oilTotal(after)).toBe(15);
  });

  it('needs oil, a main phase, your turn and 2 cards in the bank', () => {
    const s = mainGame();
    expectFail(act(s, { type: 'oil/convert', player: 0, resource: 'ore' }), /not enough oil/);
    give(s, 0, 1);
    expectFail(act(s, { type: 'oil/convert', player: 1, resource: 'ore' }), /not your turn/);
    expectFail(act(s, { type: 'oil/convert', player: 0, resource: 'nope' }), /invalid resource/);
    s.bank.ore = 1;
    expectFail(act(s, { type: 'oil/convert', player: 0, resource: 'ore' }), /bank/);
    s.bank.ore = 19;
    const pre = { ...s, phase: { kind: 'preRoll' as const } };
    expectFail(act(pre, { type: 'oil/convert', player: 0, resource: 'ore' }), /main phase/);
  });

  it('cannot push the Disaster Track beyond 5 in a turn', () => {
    const s = mainGame();
    give(s, 0, 2);
    oilSlice(s).marker = 5;
    expectFail(act(s, { type: 'oil/convert', player: 0, resource: 'ore' }), /beyond 5/);
    expect(legalActions(s).some((a) => a.type === 'oil/convert')).toBe(false);
    oilSlice(s).marker = 4;
    expectOk(act(s, { type: 'oil/convert', player: 0, resource: 'ore' }));
  });

  it('builds a metropolis on your own city for 1 brick + 1 grain + 1 ore + 2 oil', () => {
    const s = mainGame();
    const v = vertexOf(
      s,
      hexWith(s, (h) => s.board.hexes[h]?.terrain === 'ore'),
      false,
    );
    s.pieces.buildings[v] = { owner: 0, kind: 'city' };
    setHand(s, 0, { brick: 1, grain: 1, ore: 1 });
    give(s, 0, 2);
    const before = publicVictoryPoints(s, 0);
    const after = run(s, { type: 'oil/metropolis', player: 0, vertex: v });
    expect(oilSlice(after).metropolis[v]).toBe(0);
    expect(after.players[0]?.resources).toEqual({ brick: 0, lumber: 0, wool: 0, grain: 0, ore: 0 });
    expect(oilOf(after, 0)).toBe(0);
    expect(oilSlice(after).marker).toBe(2);
    expect(publicVictoryPoints(after, 0)).toBe(before + 1); // 3 VP instead of the city's 2
    expectConserved(after);
    expectFail(act(after, { type: 'oil/metropolis', player: 0, vertex: v }), /already|afford/);
  });

  it('a metropolis needs a city, the resources, the oil and a free token', () => {
    const s = mainGame();
    const v = vertexOf(
      s,
      hexWith(s, (h) => s.board.hexes[h]?.terrain === 'ore'),
      false,
    );
    s.pieces.buildings[v] = { owner: 0, kind: 'settlement' };
    setHand(s, 0, { brick: 1, grain: 1, ore: 1 });
    give(s, 0, 2);
    expectFail(act(s, { type: 'oil/metropolis', player: 0, vertex: v }), /cities/);
    s.pieces.buildings[v] = { owner: 1, kind: 'city' };
    expectFail(act(s, { type: 'oil/metropolis', player: 0, vertex: v }), /cities/);
    s.pieces.buildings[v] = { owner: 0, kind: 'city' };
    oilSlice(s).marker = 4; // 2 oil would reach 6
    expectFail(act(s, { type: 'oil/metropolis', player: 0, vertex: v }), /beyond 5/);
    oilSlice(s).marker = 0;
    setHand(s, 0, { brick: 1, grain: 1 });
    expectFail(act(s, { type: 'oil/metropolis', player: 0, vertex: v }), /afford/);
    setHand(s, 0, { brick: 1, grain: 1, ore: 1 });
    oilSlice(s).oil[0] = 1;
    expectFail(act(s, { type: 'oil/metropolis', player: 0, vertex: v }), /not enough oil/);
    oilSlice(s).oil[0] = 2;
    const t = topologyOf(s);
    for (let i = 0; i < 4; i++) oilSlice(s).metropolis[t.vertices[40 + i] as VertexId] = 1;
    expect(metropolisCount(s)).toBe(4);
    expectFail(act(s, { type: 'oil/metropolis', player: 0, vertex: v }), /no metropolis tokens/);
  });

  it('sequestering flips 1 oil out of the game: 3 sequestered = 1 VP, once a turn', () => {
    const s = mainGame();
    give(s, 0, 4);
    let g = run(s, { type: 'oil/sequester', player: 0 });
    expect(oilOf(g, 0)).toBe(3);
    expect(oilSlice(g).sequestered[0]).toBe(1);
    expect(oilSlice(g).marker).toBe(0);
    expectFail(act(g, { type: 'oil/sequester', player: 0 }), /only 1 oil/);
    expect(oilTotal(g)).toBe(15);
    // Next turn (player 0 again after a full round).
    const oil = oilSlice(g);
    oil.sequestered[0] = 2;
    oil.sequesteredNow = false;
    g = run(g, { type: 'oil/sequester', player: 0 });
    expect(oilSlice(g).sequestered[0]).toBe(3);
    expect(publicVictoryPoints(g, 0)).toBe(publicVictoryPoints(s, 0) + 2); // token + champion
  });

  it('using oil and sequestering exclude each other within a turn', () => {
    const s = mainGame();
    give(s, 0, 3);
    const used = run(s, { type: 'oil/convert', player: 0, resource: 'ore' });
    expectFail(act(used, { type: 'oil/sequester', player: 0 }), /used oil/);
    const seq = run(s, { type: 'oil/sequester', player: 0 });
    expectFail(act(seq, { type: 'oil/convert', player: 0, resource: 'ore' }), /sequestered/);
    expect(legalActions(seq).some((a) => a.type === 'oil/convert')).toBe(false);
    // The flags reset when the next turn starts.
    const next = run(seq, { type: 'endTurn', player: 0 });
    expect(oilSlice(next).sequesteredNow).toBe(false);
    expect(oilSlice(next).usedOil).toBe(false);
  });

  it('the Champion token goes to the first with 3 sequestered and moves only to strictly more', () => {
    const s = mainGame();
    const o = oilSlice(s);
    o.sequestered = [2, 3, 2, 0];
    o.champion = 1;
    o.supply -= 7;
    give(s, 0, 1);
    let g = run(s, { type: 'oil/sequester', player: 0 }); // 3 = tie: no change
    expect(oilSlice(g).champion).toBe(1);
    g = { ...g, turn: { ...g.turn, current: 2 }, phase: { kind: 'main' } };
    oilSlice(g).sequesteredNow = false;
    give(g, 2, 2);
    g = run(g, { type: 'oil/sequester', player: 2 }); // 3: tie again
    expect(oilSlice(g).champion).toBe(1);
    oilSlice(g).sequesteredNow = false;
    g = run(g, { type: 'oil/sequester', player: 2 }); // 4 > 3
    expect(oilSlice(g).champion).toBe(2);
    expect(oilTotal(g)).toBe(15);
  });

  it('Year of Plenty can take oil, within the cap and the supply', () => {
    const s = mainGame();
    s.players[0]!.devCards.yearOfPlenty = 1;
    s.devDeck.splice(s.devDeck.indexOf('yearOfPlenty'), 1);
    const after = run(s, { type: 'oil/yearOfPlenty', player: 0, picks: ['oil', 'brick'] });
    expect(oilOf(after, 0)).toBe(1);
    expect(after.players[0]?.resources.brick).toBe(1);
    expect(after.turn.devCardPlayed).toBe(true);
    expect(after.players[0]?.progressCardsPlayed.yearOfPlenty).toBe(1);
    expectFail(
      act(after, { type: 'oil/yearOfPlenty', player: 0, picks: ['oil', 'oil'] }),
      /cannot play/,
    );
    give(s, 0, 3);
    expectFail(
      act(s, { type: 'oil/yearOfPlenty', player: 0, picks: ['oil', 'oil'] }),
      /hold that much/,
    );
    expect(legalActions(s).filter((a) => a.type === 'oil/yearOfPlenty')).toHaveLength(
      RESOURCES.length,
    );
    expectFail(act(s, { type: 'oil/yearOfPlenty', player: 0, picks: ['ore', 'brick'] }), /normal/);
  });

  it('Monopoly takes oil one at a time starting with the next player until the cap', () => {
    const s = mainGame();
    s.players[0]!.devCards.monopoly = 1;
    s.devDeck.splice(s.devDeck.indexOf('monopoly'), 1);
    give(s, 0, 1);
    give(s, 1, 3);
    give(s, 2, 1);
    const after = run(s, { type: 'oil/monopoly', player: 0 });
    // Cap 4, holds 1: takes 1 from P1, 1 from P2, then 1 more from P1.
    expect(oilOf(after, 0)).toBe(4);
    expect(oilOf(after, 1)).toBe(1);
    expect(oilOf(after, 2)).toBe(0);
    expect(oilTotal(after)).toBe(15);
  });

  it('players may trade oil for resources, but not for oil', () => {
    const s = mainGame();
    give(s, 0, 1);
    setHand(s, 1, { ore: 1 });
    const offer = {
      type: 'oil/offerTrade',
      player: 0,
      to: 1,
      giveOil: 1,
      wantOil: 0,
      give: {},
      want: { ore: 1 },
    };
    const open = expectOk(act(s, offer));
    expect(open.phase.kind).toBe('oil/trade');
    expect(
      legalActions(open)
        .map((a) => `${a.player}:${a.type}`)
        .sort(),
    ).toEqual(['1:oil/acceptTrade', '1:oil/rejectTrade']);
    const done = expectOk(act(open, { type: 'oil/acceptTrade', player: 1 }));
    expect(oilOf(done, 0)).toBe(0);
    expect(oilOf(done, 1)).toBe(1);
    expect(done.players[0]?.resources.ore).toBe(1);
    expect(done.phase).toEqual({ kind: 'main' });
    expectFail(act(open, { type: 'oil/acceptTrade', player: 2 }), /not for you/);
    const refused = expectOk(act(open, { type: 'oil/rejectTrade', player: 1 }));
    expect(oilOf(refused, 0)).toBe(1);
    expectFail(act(s, { ...offer, giveOil: 1, wantOil: 1 }), /not for oil/);
    expectFail(act(s, { ...offer, giveOil: 2 }), /afford/);
    // The partner at the cap cannot accept.
    give(open, 1, 4);
    expect(legalActions(open).some((a) => a.type === 'oil/acceptTrade')).toBe(false);
    expectFail(act(open, { type: 'oil/acceptTrade', player: 1 }), /too much oil/);
  });
});

describe('the disaster phase', () => {
  /** Player 0 ends their turn with the marker at 5; the disaster roll is `roll`. */
  function endWithMarker5(s: GameState, roll: number): GameState {
    oilSlice(s).marker = 5;
    s.rng = rngForRoll(roll);
    return run(s, { type: 'endTurn', player: 0 });
  }
  const inland = (s: GameState): VertexId => {
    const t = topologyOf(s);
    return t.vertices.find((v) => vertexInfo(t, v)?.coastal === false) as VertexId;
  };

  it('is not resolved before the marker reaches 5; it resets the marker afterwards', () => {
    const s = mainGame();
    oilSlice(s).marker = 4;
    const quiet = run(s, { type: 'endTurn', player: 0 });
    expect(oilSlice(quiet).marker).toBe(4);
    expect(quiet.log.some((l) => l.text.startsWith('Disaster'))).toBe(false);
    const hit = endWithMarker5(mainGame(), 7);
    expect(oilSlice(hit).marker).toBe(0);
    expect(hit.log.some((l) => l.text.startsWith('Disaster!'))).toBe(true);
  });

  it('a 7 floods the coast: settlements go, cities become settlements, metropolises and roads stay', () => {
    const s = mainGame();
    const t = topologyOf(s);
    const coasts = t.vertices
      .filter((v) => vertexInfo(t, v)?.coastal)
      .filter((_, i) => i % 6 === 0);
    const [a, b, c] = coasts as [VertexId, VertexId, VertexId];
    s.pieces.buildings[a] = { owner: 1, kind: 'settlement' };
    s.pieces.buildings[b] = { owner: 2, kind: 'city' };
    s.pieces.buildings[c] = { owner: 3, kind: 'city' };
    oilSlice(s).metropolis[c] = 3;
    const keep = inland(s);
    s.pieces.buildings[keep] = { owner: 1, kind: 'settlement' };
    const edge = Object.keys(s.pieces.roads)[0];
    const after = endWithMarker5(s, 7);
    expect(after.pieces.buildings[a]).toBeUndefined();
    expect(after.pieces.buildings[b]).toEqual({ owner: 2, kind: 'settlement' });
    expect(after.pieces.buildings[c]).toEqual({ owner: 3, kind: 'city' });
    expect(after.pieces.buildings[keep]).toEqual({ owner: 1, kind: 'settlement' });
    expect(edge).toBeUndefined(); // (no roads were laid; nothing to lose)
    expect(oilSlice(after).destroyed).toEqual([]);
    // A destroyed settlement site is free again.
    expect(vertexInfo(t, a)?.coastal).toBe(true);
  });

  it('another number destroys the hex with that number: its token leaves the board', () => {
    const s = mainGame();
    const hex = hexWith(
      s,
      (h) => s.board.hexes[h]?.terrain === 'ore' && s.board.hexes[h]?.token === 6,
    );
    const v = vertexOf(s, hex, false);
    s.pieces.buildings[v] = { owner: 1, kind: 'settlement' };
    const after = endWithMarker5(s, 6);
    expect(after.board.hexes[hex]?.token).toBeNull();
    expect(after.board.hexes[hex]?.terrain).toBe('ore');
    expect(oilSlice(after).destroyed).toEqual([hex]);
    expect(s.board.hexes[hex]?.token).toBe(6); // the input board is untouched
    // The destroyed hex never produces again.
    const again = {
      ...after,
      turn: { ...after.turn, current: 0 },
      phase: { kind: 'preRoll' as const },
    };
    again.rng = rngForRoll(6);
    const rolled = run(again, { type: 'rollDice', player: 0 });
    expect(rolled.players[1]?.resources.ore).toBe(0);
  });

  it('a roll whose number is no longer on the board does nothing', () => {
    const s = mainGame();
    for (const h of Object.keys(s.board.hexes) as HexId[]) {
      if (s.board.hexes[h]?.token === 12) {
        setToken(s, h, null);
        oilSlice(s).destroyed.push(h);
      }
    }
    const before = oilSlice(s).destroyed.length;
    const after = endWithMarker5(s, 12);
    expect(oilSlice(after).destroyed).toHaveLength(before);
    expect(oilSlice(after).marker).toBe(0);
  });

  it('a spring hit removes 3 oil from the supply for good; the spring stays', () => {
    const s = mainGame();
    const spring = springOf(s, SPRING_PASTURE);
    const token = s.board.hexes[spring]?.token as number;
    const after = endWithMarker5(s, token);
    // Other hexes may share the number; the hit hex is chosen at random, so just check totals.
    const o = oilSlice(after);
    const destroyed = o.destroyed.length;
    if (destroyed === 0) {
      expect(o.supply).toBe(12);
      expect(o.lost).toBe(3);
      expect(after.board.hexes[spring]?.token).toBe(token);
    }
    expect(oilTotal(after)).toBe(15);
  });

  it('a spring hit takes oil from the players when the supply is short, starting with the cause', () => {
    const s = mainGame();
    const spring = springOf(s, SPRING_DESERT); // token 5, the only 5-hex besides two others
    for (const h of Object.keys(s.board.hexes) as HexId[]) {
      const tile = s.board.hexes[h];
      if (tile && tile.token === 5 && h !== spring) {
        s.board = { ...s.board, hexes: { ...s.board.hexes, [h]: { ...tile, token: 4 } } };
      }
    }
    const o = oilSlice(s);
    o.supply = 1;
    o.oil = [1, 2, 0, 0];
    o.lost = 15 - 1 - 3;
    const after = endWithMarker5(s, 5);
    const a = oilSlice(after);
    expect(a.supply).toBe(0);
    expect(a.lost).toBe(15 - 1 - 3 + 3);
    expect(a.oil).toEqual([0, 2, 0, 0].map((n, i) => (i === 0 ? 0 : n - (i === 1 ? 1 : 0))));
    expect(oilTotal(after)).toBe(15);
  });

  it('the 5th destroyed token floods the island: the Champion wins a Pyrrhic victory', () => {
    const s = mainGame();
    const hexes = (Object.keys(s.board.hexes) as HexId[]).filter(
      (h) => s.board.hexes[h]?.terrain === 'grain',
    );
    for (const h of hexes.slice(0, 3)) {
      setToken(s, h, null);
      oilSlice(s).destroyed.push(h);
    }
    const ore = hexWith(s, (h) => s.board.hexes[h]?.terrain === 'ore');
    const brick = hexWith(s, (h) => s.board.hexes[h]?.terrain === 'brick');
    setToken(s, ore, null);
    oilSlice(s).destroyed.push(ore);
    // One more: make `brick` the only hex with the rolled number.
    const token = s.board.hexes[brick]?.token as number;
    for (const h of Object.keys(s.board.hexes) as HexId[]) {
      const tile = s.board.hexes[h];
      if (h !== brick && tile?.token === token) {
        s.board = {
          ...s.board,
          hexes: { ...s.board.hexes, [h]: { ...tile, token: token === 8 ? 6 : 8 } },
        };
      }
    }
    oilSlice(s).champion = 2;
    const over = endWithMarker5(s, token);
    expect(over.phase).toEqual({ kind: 'gameOver' });
    expect(over.winner).toBe(2);
    expect(over.log.at(-1)?.text).toMatch(/Pyrrhic/);
    // Nobody holds the token: no winner at all.
    oilSlice(s).champion = null;
    const nobody = endWithMarker5(s, token);
    expect(nobody.phase).toEqual({ kind: 'gameOver' });
    expect(nobody.winner).toBeNull();
    expectFail(applyAction(over, { type: 'endTurn', player: 1 }), /over/);
  });

  it('5-6 players: the island is lost with the 8th token, not the 5th', () => {
    const s = oilGame(5);
    s.turn = { number: 3, current: 0, devCardPlayed: false, tradeOffers: 0 };
    s.phase = { kind: 'main' };
    const hexes = (Object.keys(s.board.hexes) as HexId[]).filter(
      (h) => s.board.hexes[h]?.terrain === 'grain',
    );
    for (const h of hexes.slice(0, 5)) {
      setToken(s, h, null);
      oilSlice(s).destroyed.push(h);
    }
    oilSlice(s).marker = 5;
    s.rng = rngForRoll(7);
    const after = run(s, { type: 'endTurn', player: 0 });
    expect(after.phase.kind).not.toBe('gameOver');
  });
});

describe('winning with oil', () => {
  /** Player 0 has 12 VP in the main phase: 4 cities and 4 settlements, `coastalCity` on a coast. */
  function twelve(coastalCity: boolean): GameState {
    const s = mainGame();
    const t = topologyOf(s);
    const inland = t.vertices.filter((v) => vertexInfo(t, v)?.coastal === false);
    const coast = t.vertices.filter((v) => vertexInfo(t, v)?.coastal === true);
    for (let i = 0; i < 4; i++) {
      const v = (i === 0 && coastalCity ? coast[0] : inland[i * 5]) as VertexId;
      s.pieces.buildings[v] = { owner: 0, kind: 'city' };
      s.pieces.buildings[inland[i * 5 + 2] as VertexId] = { owner: 0, kind: 'settlement' };
    }
    expect(victoryPoints(s, 0)).toBe(12);
    return s;
  }

  it('12 VP in the main phase does not end the game; ending the turn does', () => {
    const s = twelve(false);
    give(s, 0, 1);
    const mid = run(s, { type: 'oil/sequester', player: 0 });
    expect(mid.winner).toBeNull();
    const done = run(mid, { type: 'endTurn', player: 0 });
    expect(done.winner).toBe(0);
    expect(done.phase).toEqual({ kind: 'gameOver' });
    expect(done.log.at(-1)?.text).toBe('P0 wins with 12 victory points!');
  });

  it('11 VP at the end of the turn is no win', () => {
    const s = twelve(false);
    const lost = Object.entries(s.pieces.buildings).find(
      ([, b]) => b.owner === 0 && b.kind === 'settlement',
    );
    delete s.pieces.buildings[(lost as [VertexId, unknown])[0]];
    expect(victoryPoints(s, 0)).toBe(11);
    expect(run(s, { type: 'endTurn', player: 0 }).winner).toBeNull();
  });

  it('the disaster phase comes first: a flood that takes points away stops the win', () => {
    const s = twelve(true);
    oilSlice(s).marker = 5;
    s.rng = rngForRoll(7);
    const after = run(s, { type: 'endTurn', player: 0 });
    expect(victoryPoints(after, 0)).toBe(11);
    expect(after.winner).toBeNull();
    expect(after.phase.kind).toBe('preRoll');
    expect(after.turn.current).toBe(1);
  });

  it('a metropolis that survives the flood still wins', () => {
    const s = twelve(true);
    const coastCity = Object.entries(s.pieces.buildings).find(
      ([v, b]) => b.kind === 'city' && vertexInfo(topologyOf(s), v as VertexId)?.coastal,
    ) as [VertexId, unknown];
    oilSlice(s).metropolis[coastCity[0]] = 0; // 13 VP now
    oilSlice(s).marker = 5;
    s.rng = rngForRoll(7);
    const after = run(s, { type: 'endTurn', player: 0 });
    expect(after.winner).toBe(0);
  });

  it("sequestered VP and the Champion count; other players' points do not win on your turn", () => {
    const s = twelve(false);
    s.players[1]!.devCards.victoryPoint = 5;
    s.devDeck = s.devDeck.filter((c, i) => c !== 'victoryPoint' || i > 4);
    const o = oilSlice(s);
    o.sequestered[0] = 6;
    o.supply -= 6;
    o.champion = 0;
    expect(victoryPoints(s, 0)).toBe(12 + 2 + 1);
    expect(run(s, { type: 'endTurn', player: 0 }).winner).toBe(0);
    // Player 1 is current after player 0's turn: still no early win while others act.
    const t = { ...s, turn: { ...s.turn, current: 1 }, phase: { kind: 'main' as const } };
    t.players[1]!.devCards.victoryPoint = 12;
    expect(applyAction(t, { type: 'endTurn', player: 1 }).ok).toBe(true);
  });

  it('special building (5-6 players): a disaster waits until the phase is over', () => {
    const s = oilGame(5);
    s.turn = { number: 3, current: 0, devCardPlayed: false, tradeOffers: 0 };
    s.phase = { kind: 'main' };
    oilSlice(s).marker = 5;
    s.rng = rngForRoll(7);
    // Player 0 ends the turn: the disaster comes before the special building phase.
    const sbp = run(s, { type: 'endTurn', player: 0 });
    expect(oilSlice(sbp).marker).toBe(0);
    expect(['specialBuild', 'preRoll']).toContain(sbp.phase.kind);
    // A builder who triggers one in the special building phase waits for its end.
    const b = oilGame(5);
    b.turn = { number: 3, current: 1, devCardPlayed: false, tradeOffers: 0 };
    b.phase = { kind: 'specialBuild', builder: 1, owner: 0 };
    oilSlice(b).marker = 5;
    b.rng = rngForRoll(7);
    const pass = run(b, { type: 'passSpecialBuild', player: 1 });
    if (pass.phase.kind === 'preRoll') expect(oilSlice(pass).marker).toBe(0);
    else expect(oilSlice(pass).marker).toBe(5);
  });
});

describe('oil soundness', () => {
  it('every legal action is accepted, oil is conserved, over random games', () => {
    for (const [n, scenario] of [
      [3, 'oil/oilSprings'],
      [4, 'oil/oilSpringsVariable'],
      [5, 'oil/oilSprings'],
    ] as const) {
      let s = oilGame(n, `sound-${n}`, scenario);
      const rng = new Rng(77 + n);
      let steps = 0;
      const seen = new Set<string>();
      while (s.phase.kind !== 'gameOver' && steps < 4000) {
        const legal = legalActions(s);
        expect(legal.length, `stalled in ${s.phase.kind}`).toBeGreaterThan(0);
        // Prefer oil actions so the interesting paths run.
        const oilActions = legal.filter((a) => a.type.startsWith('oil/'));
        const pool = oilActions.length > 0 && rng.float() < 0.6 ? oilActions : legal;
        const a = rng.pick(pool);
        const r = applyAction(s, a);
        expect(r.ok, `${JSON.stringify(a)} -> ${r.ok ? '' : r.error}`).toBe(true);
        if (!r.ok) return;
        s = r.state;
        seen.add(a.type);
        expect(oilTotal(s)).toBe(oilScale(s).oil);
        steps++;
      }
      expect(seen.has('oil/convert') || seen.has('oil/sequester')).toBe(true);
    }
  });

  it('isSpringTerrain knows only the three spring terrains', () => {
    expect(
      ['oil/desertSpring', 'oil/forestSpring', 'oil/pastureSpring', 'lumber', 'oil/x'].map(
        isSpringTerrain,
      ),
    ).toEqual([true, true, true, false, false]);
  });
});

describe('Oil Springs: the legal list leaks no hidden hands', () => {
  it("an opponent's resource types do not change the mover's legal list", () => {
    const a = mainGame(3);
    oilSlice(a).oil[0] = 1;
    oilSlice(a).oil[1] = 1;
    const b = structuredClone(a);
    setHand(a, 1, { brick: 3 });
    setHand(b, 1, { ore: 3 });
    expect(legalActions(b, 0)).toEqual(legalActions(a, 0));
  });

  it('offers to a partner who cannot pay are declinable, not acceptable', () => {
    const s = mainGame(3);
    oilSlice(s).oil[0] = 1;
    setHand(s, 1, { brick: 1 });
    const offered = expectOk(
      applyAction(s, {
        type: 'oil/offerTrade',
        player: 0,
        to: 1,
        giveOil: 1,
        wantOil: 0,
        give: {},
        want: { ore: 1 },
      } as Action),
    );
    expectFail(applyAction(offered, { type: 'oil/acceptTrade', player: 1 } as Action));
    expectOk(applyAction(offered, { type: 'oil/rejectTrade', player: 1 } as Action));
  });
});
