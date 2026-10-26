/** Catan for Two (§2.1, §4.4). */
import { describe, expect, it } from 'vitest';
import { legalActions } from '../../../engine/engine';
import { longestRoadLengths } from '../../../engine/rules/longestRoad';
import { topologyOf } from '../../../engine/topology';
import type { EdgeId, GameState, VertexId } from '../../../engine/types';
import { neutralAt, tokenPrice, twoOf } from '.';
import { NEUTRAL_STARTS } from './two';
import { bad, build, legalOf, ok, rngFor, roads, setHand, tbGame, tbMain } from './testkit';

/** A free road edge next to `v` for player 0 (with the settlement on v). */
function roadFrom(s: GameState, v: VertexId): EdgeId {
  return (topologyOf(s).vertex[v]?.edges ?? [])[0] as EdgeId;
}

describe('setup', () => {
  it('two neutral settlements on the marked spots; 5 tokens each, 10 in the supply', () => {
    const s = tbGame('variants', 2);
    const two = twoOf(s);
    expect(two.neutrals.map((n) => n.settlements)).toEqual([
      [NEUTRAL_STARTS[0]],
      [NEUTRAL_STARTS[1]],
    ]);
    expect(two.tokens).toEqual([5, 5]);
    expect(two.supply).toBe(10);
    // The distance rule respects them.
    const spots = legalOf(s, 'placeSetupSettlement').map((a) => (a as { vertex: VertexId }).vertex);
    expect(spots).not.toContain(NEUTRAL_STARTS[0]);
    for (const n of topologyOf(s).vertex[NEUTRAL_STARTS[0]]?.vertices ?? [])
      expect(spots).not.toContain(n);
  });

  it('only for two players', () => {
    expect(tbGame('variants', 3).ext['tb']).not.toHaveProperty('two');
  });
});

describe('two rolls per turn', () => {
  it('after the first roll is resolved the player rolls again, and the second roll differs', () => {
    const s = tbMain('variants', 2);
    s.phase = { kind: 'preRoll' };
    s.rng = rngFor(2, 3, 1, 4, 3, 3);
    let next = ok(s, { type: 'rollDice', player: 0 });
    expect(next.phase.kind).toBe('preRoll');
    expect(twoOf(next).firstRoll).toBe(5);
    next = ok(next, { type: 'rollDice', player: 0 });
    expect(next.dice).toEqual([3, 3]);
    expect(next.phase.kind).toBe('main');
    expect(legalOf(next, 'rollDice')).toEqual([]);
  });
});

describe('neutral builds', () => {
  it('each road you build is followed by a neutral road; each settlement by a neutral settlement or road', () => {
    const s = tbMain('variants', 2);
    const v: VertexId = 'v:0,0,S';
    build(s, 0, v);
    setHand(s, 0, { brick: 1, lumber: 1 });
    let next = ok(s, { type: 'buildRoad', player: 0, edge: roadFrom(s, v) });
    expect(next.phase).toMatchObject({ kind: 'tb/neutral', piece: 'road' });
    expect(legalActions(next).every((a) => a.type === 'tb/neutralRoad')).toBe(true);
    bad(next, { type: 'endTurn', player: 0 });
    const a = legalOf(next, 'tb/neutralRoad')[0] as unknown as { edge: EdgeId; neutral: 0 | 1 };
    next = ok(next, { type: 'tb/neutralRoad', player: 0, edge: a.edge, neutral: a.neutral });
    expect(twoOf(next).neutrals[a.neutral].roads).toEqual([a.edge]);
    expect(next.phase.kind).toBe('main');
    // A player road may not go on a neutral road.
    expect(legalOf(next, 'buildRoad')).toEqual([]);
  });

  it('a neutral settlement needs its own road; otherwise the neutral builds a road instead', () => {
    const s = tbMain('variants', 2);
    const v: VertexId = 'v:1,0,S';
    roads(s, 0, roadFrom(s, v));
    setHand(s, 0, { brick: 1, lumber: 1, wool: 1, grain: 1 });
    const next = ok(s, { type: 'buildSettlement', player: 0, vertex: v });
    expect(next.phase).toMatchObject({ kind: 'tb/neutral', piece: 'road' });
  });

  it('neutral buildings cut your road and can hold Longest Road', () => {
    const s = tbMain('variants', 2);
    const t = topologyOf(s);
    // 5 neutral roads in a chain from its settlement.
    const n = twoOf(s).neutrals[0];
    let v = NEUTRAL_STARTS[0];
    for (let i = 0; i < 5; i++) {
      const e = (t.vertex[v]?.edges ?? []).find((x) => !n.roads.includes(x)) as EdgeId;
      n.roads.push(e);
      v = (t.edge[e]?.vertices ?? []).find((x) => x !== v) as VertexId;
    }
    expect(neutralAt(s, NEUTRAL_STARTS[0])).toBe(0);
    roads(s, 1, 'e:-2,2,NE', 'e:-2,2,E', 'e:-2,2,SE', 'e:-2,3,NE', 'e:-2,1,SE');
    expect(longestRoadLengths(s)[1]).toBe(0);
  });
});

describe('trade tokens', () => {
  it('a settlement on the coast earns 1, by the desert 2', () => {
    const s = tbMain('variants', 2);
    const coast = topologyOf(s).vertices.find(
      (v) =>
        topologyOf(s).vertex[v]?.coastal &&
        !topologyOf(s).vertex[v]?.hexes.some((h) => s.board.hexes[h]?.terrain === 'desert'),
    ) as VertexId;
    roads(s, 0, roadFrom(s, coast));
    setHand(s, 0, { brick: 1, lumber: 1, wool: 1, grain: 1 });
    const next = ok(s, { type: 'buildSettlement', player: 0, vertex: coast });
    expect(twoOf(next).tokens[0]).toBe(6);
    expect(twoOf(next).supply).toBe(9);
  });

  it('the price is 1 token while not ahead, else 2; one token action per turn', () => {
    const s = tbMain('variants', 2);
    expect(tokenPrice(s, 0)).toBe(1);
    build(s, 0, 'v:0,0,N');
    expect(tokenPrice(s, 0)).toBe(2);
    expect(tokenPrice(s, 1)).toBe(1);
  });

  it('forced trade: take 2 random cards, give 2 of your choice back', () => {
    const s = tbMain('variants', 2);
    setHand(s, 1, { ore: 2 });
    setHand(s, 0, { wool: 1 });
    let next = ok(s, { type: 'tb/forcedTrade', player: 0 });
    expect(next.players[0]?.resources.ore).toBe(2);
    expect(next.phase).toMatchObject({ kind: 'tb/forcedGive', count: 2 });
    bad(next, { type: 'tb/forcedGive', player: 0, resources: { wool: 1 } }, /exactly 2/);
    next = ok(next, { type: 'tb/forcedGive', player: 0, resources: { wool: 1, ore: 1 } });
    expect(next.players[1]?.resources).toMatchObject({ wool: 1, ore: 1 });
    expect(twoOf(next).tokens[0]).toBe(4);
    bad(next, { type: 'tb/forcedTrade', player: 0 }, /one token action/);
  });

  it('the robber token moves the robber to the desert without stealing', () => {
    const s = tbMain('variants', 2);
    const desert = Object.values(s.board.hexes).find((h) => h.terrain === 'desert')?.id;
    s.robber = 'h:0,0' === desert ? 'h:1,0' : 'h:0,0';
    const next = ok(s, { type: 'tb/tokenRobber', player: 0 });
    expect(next.robber).toBe(desert);
  });

  it('a face-up Knight turns into 2 tokens once per turn; Largest Army is set aside unless still strictly ahead', () => {
    const s = tbMain('variants', 2);
    const p0 = s.players[0];
    const p1 = s.players[1];
    if (!p0 || !p1) throw new Error('players');
    p0.knightsPlayed = 3;
    p1.knightsPlayed = 2;
    for (let i = 0; i < 5; i++) s.devDeck.splice(s.devDeck.indexOf('knight'), 1);
    s.awards.largestArmy = 0;
    const next = ok(s, { type: 'tb/knightForTokens', player: 0 });
    expect(next.players[0]?.knightsPlayed).toBe(2);
    expect(twoOf(next).tokens[0]).toBe(7);
    expect(next.awards.largestArmy).toBeNull();
    bad(next, { type: 'tb/knightForTokens', player: 0 }, /once per turn/);
  });

  it('no trade tokens in the Fishermen scenario', () => {
    const s = tbMain('fishermen', 2);
    setHand(s, 1, { ore: 2 });
    bad(s, { type: 'tb/forcedTrade', player: 0 }, /no trade tokens/);
  });
});
