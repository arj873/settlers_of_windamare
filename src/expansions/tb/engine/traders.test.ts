/** Traders & Barbarians, the main scenario (§2.6, §3.7, §4.7). */
import { describe, expect, it } from 'vitest';
import { longestRoadLengths } from '../../../engine/rules/longestRoad';
import { publicVictoryPoints } from '../../../engine/selectors';
import { topologyOf } from '../../../engine/topology';
import type { EdgeId, GameState, VertexId } from '../../../engine/types';
import { goldOf, stepCost, tbBoard, tradersOf, wagonSteps } from '.';
import {
  bad,
  build,
  legalOf,
  ok,
  rngFor,
  roads,
  setGold,
  setHand,
  tbGame,
  tbMain,
} from './testkit';

const at = (s: GameState, p: number, v: VertexId) => {
  tradersOf(s).wagons[p] = v;
};

describe('setup', () => {
  it('5 gold each, 3 barbarians on their X paths, no robber; the second building is a city carrying the wagon', () => {
    let s = tbGame('traders', 3);
    expect(goldOf(s, 0)).toBe(5);
    expect(tradersOf(s).barbarians).toEqual(['e:1,-2,SE', 'e:-2,1,NE', 'e:0,1,E']);
    expect(s.robber).toBe('h:999,999');
    s.phase = { kind: 'setup', index: 3, step: 'settlement', lastSettlement: null };
    s.turn.current = 2;
    s = ok(s, { type: 'placeSetupSettlement', player: 2, vertex: 'v:0,0,N' });
    expect(s.pieces.buildings['v:0,0,N']?.kind).toBe('city');
    expect(tradersOf(s).wagons[2]).toBe('v:0,0,N');
  });

  it('nobody settles on a plaza or a sea-only corner; no road on a sea side', () => {
    const s = tbMain('traders');
    const noBuild = tbBoard(s).noBuild ?? [];
    const g = tbGame('traders');
    const spots = legalOf(g, 'placeSetupSettlement').map((a) => (a as { vertex: VertexId }).vertex);
    expect(spots).not.toContain('v:2,-2,C');
    for (const v of noBuild) expect(spots).not.toContain(v);
    const e = (tbBoard(s).noRoad ?? [])[0] as EdgeId;
    const end = topologyOf(s).edge[e]?.vertices.find((v) => !noBuild.includes(v)) as VertexId;
    build(s, 0, end);
    setHand(s, 0, { brick: 1, lumber: 1 });
    bad(s, { type: 'buildRoad', player: 0, edge: e });
  });

  it('roads may run on the spokes', () => {
    const s = tbMain('traders');
    build(s, 0, 'v:2,-2,S');
    setHand(s, 0, { brick: 1, lumber: 1 });
    const next = ok(s, { type: 'buildRoad', player: 0, edge: 'e:2,-2,CS' });
    expect(next.pieces.roads['e:2,-2,CS']).toBe(0);
  });

  it('there is no Longest Road', () => {
    const s = tbMain('traders');
    roads(s, 0, 'e:0,0,NE', 'e:0,0,E', 'e:0,0,SE', 'e:0,1,NE', 'e:0,1,E');
    expect(longestRoadLengths(s)[0]).toBe(0);
  });
});

describe('the roll', () => {
  it('a 2 or a 12 is rolled again', () => {
    const s = tbMain('traders');
    s.phase = { kind: 'preRoll' };
    s.rng = rngFor(1, 1, 6, 6, 2, 3);
    const next = ok(s, { type: 'rollDice', player: 0 });
    expect(next.dice).toEqual([2, 3]);
  });

  it('a 7: discards, then a barbarian moves and robs the road owner on its new path', () => {
    const s = tbMain('traders');
    roads(s, 1, 'e:0,0,E');
    setHand(s, 1, { ore: 1 });
    s.phase = { kind: 'preRoll' };
    s.rng = rngFor(3, 4);
    let next = ok(s, { type: 'rollDice', player: 0 });
    expect(next.phase).toMatchObject({ kind: 'tb/barbarian', from: null, steal: true });
    bad(next, { type: 'tb/placeBarbarian', player: 0, edge: 'e:0,0,E' }, /no barbarian/);
    next = ok(next, { type: 'tb/placeBarbarian', player: 0, edge: 'e:0,1,E' });
    bad(next, { type: 'tb/placeBarbarian', player: 0, edge: 'e:1,-2,SE' }, /cannot go/);
    next = ok(next, { type: 'tb/placeBarbarian', player: 0, edge: 'e:0,0,E' });
    expect(tradersOf(next).barbarians).toContain('e:0,0,E');
    expect(next.players[0]?.resources.ore).toBe(1);
    expect(next.phase.kind).toBe('main');
  });

  it('a Knight moves a barbarian and counts for Largest Army', () => {
    const s = tbMain('traders');
    const pl = s.players[0];
    if (pl) pl.devCards.knight = 1;
    s.devDeck.splice(s.devDeck.indexOf('knight'), 1);
    let next = ok(s, { type: 'playKnight', player: 0 });
    expect(next.phase).toMatchObject({ kind: 'tb/barbarian', steal: true, resume: 'main' });
    next = ok(
      next,
      { type: 'tb/placeBarbarian', player: 0, edge: 'e:0,1,E' },
      { type: 'tb/placeBarbarian', player: 0, edge: 'e:1,1,E' },
    );
    expect(next.players[0]?.knightsPlayed).toBe(1);
  });
});

describe('the wagon', () => {
  it('movement points: 2 without a road, 1 on your road, 1 + 1 gold toll on another road, +2 on a barbarian', () => {
    const s = tbMain('traders');
    roads(s, 0, 'e:0,0,NE');
    roads(s, 1, 'e:0,0,E');
    expect(stepCost(s, 0, 'e:0,0,SE')).toEqual({ mp: 2, toll: null });
    expect(stepCost(s, 0, 'e:0,0,NE')).toEqual({ mp: 1, toll: null });
    expect(stepCost(s, 0, 'e:0,0,E')).toEqual({ mp: 1, toll: 1 });
    expect(stepCost(s, 0, 'e:0,1,E')).toEqual({ mp: 4, toll: null });
  });

  it('moves after building (no more building), pays tolls, and cannot overspend', () => {
    const s = tbMain('traders');
    at(s, 0, 'v:0,0,N');
    roads(s, 1, 'e:0,0,NE');
    setHand(s, 0, { brick: 1, lumber: 1 });
    // e:0,0,NE runs from v:0,0,N to v:1,-1,S.
    let next = ok(s, { type: 'tb/startWagon', player: 0, vertex: 'v:1,-1,S' });
    expect(next.phase.kind).toBe('tb/wagon');
    expect(goldOf(next, 0)).toBe(4);
    expect(goldOf(next, 1)).toBe(6);
    expect(tradersOf(next).move.mp).toBe(3);
    expect(legalOf(next, 'buildRoad')).toEqual([]);
    next = ok(next, {
      type: 'tb/wagonStep',
      player: 0,
      vertex: wagonSteps(next, 0).find((x) => x.vertex !== 'v:0,0,N')?.vertex as VertexId,
    });
    expect(tradersOf(next).move.mp).toBe(1);
    expect(wagonSteps(next, 0).every((x) => stepCost(next, 0, x.edge).mp <= 1)).toBe(true);
    next = ok(next, { type: 'endTurn', player: 0 });
    expect(next.turn.current).toBe(1);
  });

  it('no toll without gold', () => {
    const s = tbMain('traders');
    at(s, 0, 'v:0,0,N');
    roads(s, 1, 'e:0,0,NE');
    setGold(s, 0, 0);
    expect(wagonSteps(s, 0).map((x) => x.edge)).not.toContain('e:0,0,NE');
  });

  it('1 grain buys 2 more movement points once per move', () => {
    const s = tbMain('traders');
    at(s, 0, 'v:0,0,N');
    setHand(s, 0, { grain: 2 });
    let next = ok(
      s,
      { type: 'tb/startWagon', player: 0, vertex: 'v:1,-1,S' },
      { type: 'tb/wagonGrain', player: 0 },
    );
    expect(tradersOf(next).move.mp).toBe(4);
    bad(next, { type: 'tb/wagonGrain', player: 0 }, /already/);
    next = structuredClone(s);
    bad(next, { type: 'tb/wagonGrain', player: 0 }, /while moving/);
  });

  it('a plaza ends the move: first visit loads a commodity, the right plaza takes the delivery for 1 VP and gold', () => {
    const s = tbMain('traders');
    at(s, 0, 'v:2,-2,S');
    let next = ok(s, { type: 'tb/startWagon', player: 0, vertex: 'v:2,-2,C' });
    const t = tradersOf(next);
    expect(t.move.over).toBe(true);
    expect(wagonSteps(next, 0)).toEqual([]);
    const loaded = t.commodity[0];
    expect(loaded === 'marble' || loaded === 'sand').toBe(true);
    // Deliver marble at the castle (level 1: 1 gold).
    const d = structuredClone(s);
    tradersOf(d).commodity[0] = 'marble';
    at(d, 0, 'v:-2,0,N');
    next = ok(d, { type: 'tb/startWagon', player: 0, vertex: 'v:-2,0,C' });
    expect(tradersOf(next).delivered[0]).toBe(1);
    expect(goldOf(next, 0)).toBe(6);
    expect(publicVictoryPoints(next, 0)).toBe(1);
    expect(tradersOf(next).commodity[0]).not.toBeNull();
  });

  it('a commodity the plaza does not want stays loaded', () => {
    const s = tbMain('traders');
    tradersOf(s).commodity[0] = 'sand';
    at(s, 0, 'v:-2,0,N');
    const next = ok(s, { type: 'tb/startWagon', player: 0, vertex: 'v:-2,0,C' });
    expect(tradersOf(next).commodity[0]).toBe('sand');
    expect(tradersOf(next).delivered[0]).toBe(0);
  });

  it('upgrades cost lumber, wool, ore (2 lumber from 4); level 5 is +1 VP; more MP and gold', () => {
    const s = tbMain('traders');
    setHand(s, 0, { lumber: 6, wool: 4, ore: 4 });
    const next = ok(
      s,
      { type: 'tb/upgradeWagon', player: 0 },
      { type: 'tb/upgradeWagon', player: 0 },
      { type: 'tb/upgradeWagon', player: 0 },
      { type: 'tb/upgradeWagon', player: 0 },
    );
    expect(tradersOf(next).level[0]).toBe(5);
    expect(next.players[0]?.resources).toMatchObject({ lumber: 0, wool: 0, ore: 0 });
    expect(publicVictoryPoints(next, 0)).toBe(1);
    bad(next, { type: 'tb/upgradeWagon', player: 0 }, /best/);
  });

  it('driving off a barbarian needs an upgraded card and a roll in its range', () => {
    const s = tbMain('traders');
    // The barbarian on e:0,1,E; park next to it.
    const [v] = topologyOf(s).edge['e:0,1,E']?.vertices ?? [];
    at(s, 0, v as VertexId);
    setHand(s, 0, { grain: 1 });
    // Level 1 cannot drive off; level 2 succeeds on a 6.
    const d = structuredClone(s);
    tradersOf(d).level[0] = 2;
    d.phase = { kind: 'tb/wagon' } as never;
    expect(legalOf(d, 'tb/driveOff').length).toBe(1);
    d.rng = rngFor(6);
    let next = ok(d, { type: 'tb/driveOff', player: 0, edge: 'e:0,1,E' });
    expect(next.phase).toMatchObject({
      kind: 'tb/barbarian',
      from: 'e:0,1,E',
      steal: false,
      resume: 'wagon',
    });
    next = ok(next, { type: 'tb/placeBarbarian', player: 0, edge: 'e:1,1,E' });
    expect(next.phase.kind).toBe('tb/wagon');
    expect(legalOf(next, 'tb/driveOff')).toEqual([]);
    const fail = structuredClone(d);
    fail.rng = rngFor(5);
    next = ok(fail, { type: 'tb/driveOff', player: 0, edge: 'e:0,1,E' });
    expect(next.phase.kind).toBe('tb/wagon');
    bad(next, { type: 'tb/driveOff', player: 0, edge: 'e:0,1,E' });
    const lvl1 = structuredClone(d);
    tradersOf(lvl1).level[0] = 1;
    expect(legalOf(lvl1, 'tb/driveOff')).toEqual([]);
  });

  it('Swift Journey moves the wagon again after a regular move', () => {
    const s = tbMain('traders');
    at(s, 0, 'v:0,0,N');
    tradersOf(s).swift.held[0] = 1;
    tradersOf(s).swift.deck -= 1;
    bad(s, { type: 'tb/swiftJourney', player: 0 }, /after moving/);
    let next = ok(s, { type: 'tb/startWagon', player: 0, vertex: 'v:1,-1,S' });
    next = ok(next, { type: 'tb/swiftJourney', player: 0 });
    expect(tradersOf(next).move.mp).toBe(4);
    expect(next.turn.devCardPlayed).toBe(true);
  });
});
