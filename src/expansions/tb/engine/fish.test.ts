/** Fishermen of Catan rules (docs/rules/traders-barbarians.md §3.3, §4.5). */
import { describe, expect, it } from 'vitest';
import { NO_ROBBER } from '../../../engine/expansions/ext';
import { victoryPoints, publicVictoryPoints } from '../../../engine/selectors';
import { hexVertices, topologyOf } from '../../../engine/topology';
import type { GameState, HexId, VertexId } from '../../../engine/types';
import { fishCost, fishOwed, fishOf, tbBoard } from '.';
import { fishPayment } from './fish';
import { bad, build, legalOf, ok, roll, setHand, tbGame, tbMain } from './testkit';

const ground = (s: GameState, n: number) => {
  const g = (tbBoard(s).grounds ?? []).find((x) => x.number === n);
  if (!g) throw new Error(`no ground ${n}`);
  return g;
};
const lake = (s: GameState): HexId => tbBoard(s).lakes?.[0]?.hex as HexId;
const setFish = (s: GameState, p: number, hand: number[]) => {
  const f = fishOf(s);
  for (const t of hand) {
    const i = f.pool.indexOf(t);
    if (i < 0) throw new Error(`no ${t} in the pool`);
    f.pool.splice(i, 1);
  }
  f.hands[p] = [...hand];
};

describe('fish production', () => {
  it('a fishing ground pays settlements 1 and cities 2 on its number', () => {
    const s = tbMain('fishermen');
    const g = ground(s, 8);
    build(s, 1, g.vertices[0] as VertexId);
    build(s, 2, g.vertices[1] as VertexId, 'city');
    expect(fishOwed(s, 8)).toEqual([0, 1, 2, 0]);
    expect(fishOwed(s, 9)[1]).toBe(0);
  });

  it('the lake pays on 2, 3, 11 and 12; the robber on it blocks all four', () => {
    const s = tbMain('fishermen');
    const v = hexVertices(topologyOf(s), lake(s))[0] as VertexId;
    build(s, 1, v);
    for (const n of [2, 3, 11, 12]) expect(fishOwed(s, n)[1]).toBe(1);
    expect(fishOwed(s, 4)[1]).toBe(0);
    s.robber = lake(s);
    expect(fishOwed(s, 2)[1]).toBe(0);
  });

  it('a production roll draws tokens into the hand', () => {
    const s = tbMain('fishermen');
    build(s, 0, ground(s, 8).vertices[0] as VertexId, 'city');
    const pool = fishOf(s).pool.length;
    const next = roll(s, 4, 4);
    const f = fishOf(next);
    const got = (f.hands[0]?.length ?? 0) + (f.boot === 0 ? 1 : 0);
    expect(got).toBe(2);
    expect(f.pool.length).toBe(pool - 2);
  });

  it('when the pool cannot cover the roll, nobody gets fish', () => {
    const s = tbMain('fishermen');
    build(s, 0, ground(s, 8).vertices[0] as VertexId, 'city');
    const f = fishOf(s);
    f.spent = f.pool.splice(0, f.pool.length - 1);
    const next = roll(s, 4, 4);
    expect(fishOf(next).hands[0]).toEqual([]);
    expect(next.log.some((l) => l.text.includes('nobody gets fish'))).toBe(true);
  });

  it('the second setup settlement on a fishing ground draws a fish', () => {
    let s = tbGame('fishermen', 3);
    const v = ground(s, 6).vertices[0] as VertexId;
    s.phase = { kind: 'setup', index: 3, step: 'settlement', lastSettlement: null };
    s.turn.current = 2;
    s = ok(s, { type: 'placeSetupSettlement', player: 2, vertex: v });
    const f = fishOf(s);
    expect((f.hands[2]?.length ?? 0) + (f.boot === 2 ? 1 : 0)).toBe(1);
  });
});

describe('fish actions', () => {
  it('pays with whole tokens, the smallest overpayment first', () => {
    expect(fishPayment([3, 3, 1], 4)).toEqual([3, 1]);
    expect(fishPayment([3, 2], 4)).toEqual([3, 2]);
    expect(fishPayment([1, 1], 4)).toBeNull();
  });

  it('2 fish chase the robber off the board', () => {
    const s = tbMain('fishermen');
    s.robber = 'h:0,0';
    setFish(s, 0, [2]);
    const next = ok(s, { type: 'tb/fish', player: 0, use: 'robber' });
    expect(next.robber).toBe(NO_ROBBER);
    expect(fishOf(next).hands[0]).toEqual([]);
    expect(fishOf(next).spent).toContain(2);
    bad(next, { type: 'tb/fish', player: 0, use: 'robber' }, /needs 2 fish/);
  });

  it('3 fish steal a random card', () => {
    const s = tbMain('fishermen');
    setFish(s, 0, [3]);
    setHand(s, 1, { ore: 1 });
    const next = ok(s, { type: 'tb/fish', player: 0, use: 'steal', victim: 1 });
    expect(next.players[0]?.resources.ore).toBe(1);
    expect(next.players[1]?.resources.ore).toBe(0);
    bad(tbMain('fishermen'), { type: 'tb/fish', player: 0, use: 'steal', victim: 1 }, /fish/);
  });

  it('4 fish take a resource of choice from the bank', () => {
    const s = tbMain('fishermen');
    setFish(s, 0, [2, 2]);
    const next = ok(s, { type: 'tb/fish', player: 0, use: 'resource', resource: 'grain' });
    expect(next.players[0]?.resources.grain).toBe(1);
  });

  it('5 fish build a free road', () => {
    const s = tbMain('fishermen');
    build(s, 0, 'v:0,0,N');
    setFish(s, 0, [3, 2]);
    const next = ok(s, { type: 'tb/fish', player: 0, use: 'road' });
    expect(next.phase).toEqual({ kind: 'roadBuilding', remaining: 1, resume: 'main' });
  });

  it('7 fish draw a development card (not playable this turn)', () => {
    const s = tbMain('fishermen');
    setFish(s, 0, [3, 3, 1]);
    const deck = s.devDeck.length;
    const next = ok(s, { type: 'tb/fish', player: 0, use: 'devCard' });
    expect(next.devDeck.length).toBe(deck - 1);
    const fresh = Object.values(next.players[0]?.newDevCards ?? {}).reduce((a, b) => a + b, 0);
    expect(fresh).toBe(1);
  });

  it('only on your own turn, before the roll or in the main phase (not in the SBP)', () => {
    const s = tbMain('fishermen');
    setFish(s, 1, [3, 3, 1]);
    bad(s, { type: 'tb/fish', player: 1, use: 'devCard' }, /not your turn/);
    s.phase = { kind: 'specialBuild', builder: 1, owner: 0 };
    s.turn.current = 1;
    bad(s, { type: 'tb/fish', player: 1, use: 'devCard' }, /own turn/);
    expect(legalOf(s, 'tb/fish')).toEqual([]);
  });

  it('at 7 tokens a bigger catch replaces the smallest token', () => {
    const s = tbMain('fishermen');
    setFish(s, 0, [1, 1, 1, 1, 1, 1, 1]);
    build(s, 0, ground(s, 8).vertices[0] as VertexId, 'city');
    // Force big tokens on top of the pool.
    const f = fishOf(s);
    f.pool = f.pool.filter((t) => t !== 0);
    f.pool.push(3, 3);
    const next = roll(s, 4, 4);
    expect(fishOf(next).hands[0]?.length).toBe(7);
    expect(fishOf(next).hands[0]?.filter((t) => t === 3)).toHaveLength(2);
  });
});

describe('the old boot', () => {
  it('its owner needs one more VP (hidden, not a public minus)', () => {
    const s = tbMain('fishermen');
    build(s, 0, 'v:0,0,N');
    fishOf(s).boot = 0;
    expect(publicVictoryPoints(s, 0)).toBe(1);
    expect(victoryPoints(s, 0)).toBe(0);
  });

  it('may be given after the roll to a player with at least as many public VP', () => {
    const s = tbMain('fishermen');
    fishOf(s).boot = 0;
    build(s, 0, 'v:0,0,N');
    build(s, 1, 'v:2,0,N');
    const next = ok(s, { type: 'tb/giveBoot', player: 0, to: 1 });
    expect(fishOf(next).boot).toBe(1);
    bad(s, { type: 'tb/giveBoot', player: 0, to: 2 }, /at least as many/);
    s.phase = { kind: 'preRoll' };
    bad(s, { type: 'tb/giveBoot', player: 0, to: 1 }, /after your roll/);
  });
});

describe('Catan for Two', () => {
  it('each player starts with 5 fish; the player behind pays 1 fish less', () => {
    const s = tbMain('fishermen', 2);
    expect(fishOf(s).hands).toEqual([
      [1, 1, 2, 2, 3],
      [1, 1, 2, 2, 3],
    ]);
    build(s, 1, 'v:0,0,N');
    expect(fishCost(s, 0, 'resource')).toBe(3);
    expect(fishCost(s, 1, 'resource')).toBe(4);
  });
});
