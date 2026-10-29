import { describe, expect, it } from 'vitest';
import { PLAYER_COLORS } from '../constants';
import { createGame } from '../createGame';
import { applyAction, legalActions } from '../engine';
import { discardGame, midGame, moveRobberGame } from '../fixtures';
import { emptyDevCards, emptyResources, toCounts, totalResources } from '../resources';
import { handSize } from '../selectors';
import { hexVertices, TOPOLOGY, vertexHexes } from '../topology';
import type { GameState, HexId, Resource } from '../types';
import {
  emptyBoardGame,
  expectConserved,
  expectFail,
  expectOk,
  place,
  rngForRoll,
  rollTotal,
  setHand,
} from './testkit';
import { discardAmounts, turnLegal } from './turn';

/** A token rolled by two land hexes of different terrain: [token, hexA, hexB]. */
function tokenPair(s: GameState): [number, HexId, HexId] {
  for (let t = 3; t <= 11; t++) {
    const hs = TOPOLOGY.landHexes.filter((h) => s.board.hexes[h]!.token === t);
    const [a, b] = hs;
    if (a && b && s.board.hexes[a]!.terrain !== s.board.hexes[b]!.terrain) return [t, a, b];
  }
  throw new Error('no token pair');
}

const terrainOf = (s: GameState, h: HexId) => s.board.hexes[h]!.terrain as Resource;
const N = (h: HexId) => hexVertices(TOPOLOGY, h)[0]!;
const S = (h: HexId) => hexVertices(TOPOLOGY, h)[3]!;

describe('rollDice', () => {
  it('rolls two dice from the seeded RNG and records them', () => {
    const s = emptyBoardGame();
    const a = expectOk(applyAction(s, { type: 'rollDice', player: 0 }));
    const b = expectOk(applyAction(s, { type: 'rollDice', player: 0 }));
    expect(a.dice).toEqual(b.dice); // deterministic
    expect(a.rng).not.toEqual(s.rng);
    const [d1, d2] = a.dice!;
    for (const d of [d1, d2]) {
      expect(Number.isInteger(d)).toBe(true);
      expect(d).toBeGreaterThanOrEqual(1);
      expect(d).toBeLessThanOrEqual(6);
    }
    // Both faces in the log (T14), e.g. "Red rolled 8 (3+5)".
    expect(a.log.at(-1)?.text).toBe(`Red rolled ${d1 + d2} (${d1}+${d2})`);
  });

  it('non-7 goes to main', () => {
    expect(rollTotal(emptyBoardGame(), 8).phase).toEqual({ kind: 'main' });
  });

  it('only in preRoll, only by the current player', () => {
    expectFail(applyAction(emptyBoardGame(), { type: 'rollDice', player: 1 }), /not your turn/);
    expectFail(applyAction(midGame(), { type: 'rollDice', player: 1 }), /cannot roll/);
    expectFail(applyAction(moveRobberGame(), { type: 'rollDice', player: 1 }), /cannot roll/);
  });

  it('over many rolls produces every total 2..12', () => {
    const seen = new Set<number>();
    let s = emptyBoardGame();
    for (let i = 0; i < 300; i++) {
      const r = expectOk(applyAction(s, { type: 'rollDice', player: 0 }));
      seen.add(r.dice![0] + r.dice![1]);
      s = { ...s, rng: r.rng };
    }
    expect([...seen].sort((a, b) => a - b)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });
});

describe('production', () => {
  it('settlement yields 1, city 2, from each hex with the rolled token', () => {
    const s = emptyBoardGame();
    const [t, a, b] = tokenPair(s);
    place(s, 0, N(a));
    place(s, 1, S(a), 'city');
    place(s, 2, N(b));
    const after = rollTotal(s, t);
    expect(after.players[0]!.resources[terrainOf(s, a)]).toBe(1);
    expect(after.players[1]!.resources[terrainOf(s, a)]).toBe(2);
    expect(after.players[2]!.resources[terrainOf(s, b)]).toBe(1);
    expect(after.players[3]!.resources).toEqual(emptyResources());
    expectConserved(after);
  });

  it('other tokens produce nothing', () => {
    const s = emptyBoardGame();
    const [, a] = tokenPair(s);
    place(s, 0, N(a));
    const nearby = vertexHexes(TOPOLOGY, N(a)).map((h) => s.board.hexes[h]!.token);
    const other = [2, 3, 4, 5, 6, 8, 9, 10, 11, 12].find((x) => !nearby.includes(x))!;
    expect(rollTotal(s, other).players[0]!.resources).toEqual(emptyResources());
  });

  it('the robber hex produces nothing', () => {
    const s = emptyBoardGame();
    const [t, a, b] = tokenPair(s);
    place(s, 0, N(a));
    place(s, 1, N(b));
    s.robber = a;
    const after = rollTotal(s, t);
    expect(after.players[0]!.resources).toEqual(emptyResources());
    expect(after.players[1]!.resources[terrainOf(s, b)]).toBe(1);
  });

  it('7 produces nothing', () => {
    const s = emptyBoardGame();
    for (const h of TOPOLOGY.landHexes) {
      for (const v of hexVertices(TOPOLOGY, h)) if (!s.pieces.buildings[v]) place(s, 0, v);
    }
    const after = rollTotal(s, 7);
    expect(after.players[0]!.resources).toEqual(emptyResources());
  });

  it('bank shortage with several players owed: nobody gets that resource', () => {
    const s = emptyBoardGame();
    const [t, a, b] = tokenPair(s);
    const r = terrainOf(s, a);
    place(s, 0, N(a));
    place(s, 1, S(a));
    place(s, 2, N(b));
    setHand(s, 3, { [r]: 18 }); // bank holds 1, 2 owed
    const after = rollTotal(s, t);
    expect(after.players[0]!.resources[r]).toBe(0);
    expect(after.players[1]!.resources[r]).toBe(0);
    expect(after.bank[r]).toBe(1);
    // A different resource on the same roll is paid normally.
    expect(after.players[2]!.resources[terrainOf(s, b)]).toBe(1);
    expectConserved(after);
  });

  it('bank shortage with one player owed: they get what is left', () => {
    const s = emptyBoardGame();
    const [t, a] = tokenPair(s);
    const r = terrainOf(s, a);
    place(s, 1, S(a), 'city');
    setHand(s, 3, { [r]: 18 });
    const after = rollTotal(s, t);
    expect(after.players[1]!.resources[r]).toBe(1);
    expect(after.bank[r]).toBe(0);
    expectConserved(after);
  });

  it('bank with exactly enough pays everyone', () => {
    const s = emptyBoardGame();
    const [t, a] = tokenPair(s);
    const r = terrainOf(s, a);
    place(s, 0, N(a));
    place(s, 1, S(a), 'city');
    setHand(s, 3, { [r]: 16 }); // bank 3, owed 3
    const after = rollTotal(s, t);
    expect(after.players[0]!.resources[r]).toBe(1);
    expect(after.players[1]!.resources[r]).toBe(2);
    expect(after.bank[r]).toBe(0);
  });

  it('empty bank and one owed: they get nothing', () => {
    const s = emptyBoardGame();
    const [t, a] = tokenPair(s);
    const r = terrainOf(s, a);
    place(s, 0, N(a));
    setHand(s, 3, { [r]: 19 });
    expect(rollTotal(s, t).players[0]!.resources[r]).toBe(0);
  });

  it('logs what each player received', () => {
    const s = emptyBoardGame();
    const [t, a] = tokenPair(s);
    place(s, 1, S(a), 'city');
    const after = rollTotal(s, t);
    expect(after.log.at(-1)).toEqual({
      turn: 1,
      player: 1,
      text: `Blue received 2 ${terrainOf(s, a)}`,
    });
  });
});

describe('rolling a 7', () => {
  it('nobody over 7 cards: straight to moveRobber (resume main)', () => {
    const s = emptyBoardGame();
    setHand(s, 1, { ore: 7 });
    expect(rollTotal(s, 7).phase).toEqual({ kind: 'moveRobber', resume: 'main' });
  });

  it('players with more than 7 discard half rounded down (incl. the roller)', () => {
    const s = emptyBoardGame();
    setHand(s, 0, { ore: 6, wool: 5 }); // 11 -> 5
    setHand(s, 1, { brick: 8 }); // 8 -> 4
    setHand(s, 2, { grain: 7 }); // 7 -> 0
    setHand(s, 3, { lumber: 4, grain: 5 }); // 9 -> 4
    const after = rollTotal(s, 7);
    expect(after.phase).toEqual({ kind: 'discard', pending: [5, 4, 0, 4] });
    expect(after.dice![0] + after.dice![1]).toBe(7);
  });

  it('settings.discardLimit replaces 7: only hands above the limit discard half', () => {
    const s = emptyBoardGame();
    s.settings = { ...s.settings, discardLimit: 9 };
    setHand(s, 0, { ore: 6, wool: 5 }); // 11 -> 5
    setHand(s, 1, { brick: 9 }); // 9 = limit -> 0
    setHand(s, 2, { grain: 10 }); // 10 -> 5
    setHand(s, 3, { lumber: 8 }); // 8 -> 0
    expect(rollTotal(s, 7).phase).toEqual({ kind: 'discard', pending: [5, 0, 5, 0] });
  });

  it('a lower discardLimit makes smaller hands discard; nobody above it skips discard', () => {
    const s = emptyBoardGame();
    s.settings = { ...s.settings, discardLimit: 5 };
    setHand(s, 1, { ore: 6 }); // 6 -> 3
    expect(rollTotal(s, 7).phase).toEqual({ kind: 'discard', pending: [0, 3, 0, 0] });
    setHand(s, 1, { ore: 5 });
    expect(rollTotal(s, 7).phase).toEqual({ kind: 'moveRobber', resume: 'main' });
  });

  // The limit comes from createGame's settings (range 5..20) and is only read by discardAmounts.
  for (const limit of [5, 20]) {
    it(`discardLimit ${limit} (range end): limit cards keep, limit+1 discard half, end to end`, () => {
      const created = createGame({
        seed: 3,
        players: PLAYER_COLORS.slice(0, 4),
        discardLimit: limit,
      });
      expect(created.settings.discardLimit).toBe(limit);
      const s = emptyBoardGame();
      s.settings = created.settings;
      // Split over two resources each so the 19-card bank can cover limit 20.
      const half = Math.floor(limit / 2);
      setHand(s, 0, { ore: half, brick: limit - half }); // at the limit: keeps
      setHand(s, 1, { grain: half + 1, lumber: limit - half }); // limit + 1: discards half
      setHand(s, 2, { wool: limit - 1 });
      const owed = Math.floor((limit + 1) / 2);
      const rolled = rollTotal(s, 7);
      expect(rolled.phase).toEqual({ kind: 'discard', pending: [0, owed, 0, 0] });
      expect(discardAmounts(s)).toEqual([0, owed, 0, 0]);
      const legal = legalActions(rolled);
      expect(legal.length).toBeGreaterThan(0);
      for (const a of legal) {
        expect(a).toMatchObject({ type: 'discard', player: 1 });
        if (a.type === 'discard') expect(totalResources(toCounts(a.resources))).toBe(owed);
      }
      expectFail(
        applyAction(rolled, { type: 'discard', player: 1, resources: { grain: owed - 1 } }),
        /exactly/,
      );
      const done = expectOk(applyAction(rolled, legal[0]!));
      expect(done.phase).toEqual({ kind: 'moveRobber', resume: 'main' });
      expect(handSize(done.players[1]!)).toBe(limit + 1 - owed);
      expectConserved(done);
    });
  }
});

describe('endTurn', () => {
  it('merges new dev cards, resets devCardPlayed + tradeOffers, advances the turn, keeps dice', () => {
    const s = midGame();
    s.turn.devCardPlayed = true;
    s.turn.tradeOffers = 3;
    const after = expectOk(applyAction(s, { type: 'endTurn', player: 1 }));
    expect(after.players[1]!.devCards.monopoly).toBe(1);
    expect(after.players[1]!.devCards.knight).toBe(1);
    expect(after.players[1]!.newDevCards).toEqual(emptyDevCards());
    expect(after.turn).toEqual({ number: 13, current: 2, devCardPlayed: false, tradeOffers: 0 });
    expect(after.phase).toEqual({ kind: 'preRoll' });
    expect(after.dice).toEqual(s.dice);
  });

  it('wraps from the last player to player 0', () => {
    const s = midGame();
    s.turn.current = 3;
    expect(expectOk(applyAction(s, { type: 'endTurn', player: 3 })).turn.current).toBe(0);
  });

  it('only in main, only by the current player', () => {
    expectFail(applyAction(midGame(), { type: 'endTurn', player: 0 }), /not your turn/);
    expectFail(applyAction(emptyBoardGame(), { type: 'endTurn', player: 0 }), /cannot end/);
    expectFail(applyAction(discardGame(), { type: 'endTurn', player: 1 }), /cannot end/);
    expectFail(applyAction(moveRobberGame(), { type: 'endTurn', player: 1 }), /cannot end/);
  });
});

describe('turnLegal', () => {
  it('preRoll -> rollDice; main -> endTurn; otherwise nothing', () => {
    expect(turnLegal(emptyBoardGame())).toEqual([{ type: 'rollDice', player: 0 }]);
    expect(turnLegal(midGame())).toEqual([{ type: 'endTurn', player: 1 }]);
    expect(turnLegal(discardGame())).toEqual([]);
    expect(turnLegal(moveRobberGame())).toEqual([]);
  });

  it('rngForRoll helper really rolls the total', () => {
    const s = emptyBoardGame();
    s.rng = rngForRoll(12);
    const after = expectOk(applyAction(s, { type: 'rollDice', player: 0 }));
    expect(after.dice).toEqual([6, 6]);
  });
});
