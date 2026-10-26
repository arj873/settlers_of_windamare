/** Rivers of Catan (§3.4, §4.6), gold coins and Harbormaster (§4.9). */
import { describe, expect, it } from 'vitest';
import { legalActions } from '../../../engine/engine';
import { createGame } from '../../../engine/createGame';
import { piecesLeft, publicVictoryPoints, victoryPoints } from '../../../engine/selectors';
import { hexVertices, topologyOf } from '../../../engine/topology';
import type { EdgeId, GameState, HexId, VertexId } from '../../../engine/types';
import { bridgesOf, goldOf, tbBoard, tbSlice } from '.';
import { bad, build, legalOf, ok, players, roads, roll, setGold, setHand, tbMain } from './testkit';

/** A bridge site whose endpoint is free, with a road of `p` leading to it. */
function siteWithRoad(s: GameState, p: number): EdgeId {
  const t = topologyOf(s);
  const site = (tbBoard(s).bridgeSites ?? [])[1] as EdgeId;
  const end = t.edge[site]?.vertices[0] as VertexId;
  const feeder = (t.vertex[end]?.edges ?? []).find(
    (e) => e !== site && !(tbBoard(s).bridgeSites ?? []).includes(e),
  ) as EdgeId;
  roads(s, p, feeder);
  return site;
}

describe('bridges', () => {
  it('roads may not use a bridge site', () => {
    const s = tbMain('rivers');
    const site = siteWithRoad(s, 0);
    setHand(s, 0, { brick: 1, lumber: 1 });
    bad(s, { type: 'buildRoad', player: 0, edge: site }, /road/);
    expect(legalOf(s, 'buildRoad').some((a) => a.type === 'buildRoad' && a.edge === site)).toBe(
      false,
    );
  });

  it('a bridge costs 2 brick + 1 lumber, goes on a connected site and pays 3 gold', () => {
    const s = tbMain('rivers');
    const site = siteWithRoad(s, 0);
    setHand(s, 0, { brick: 2, lumber: 1 });
    const before = goldOf(s, 0);
    const next = ok(s, { type: 'tb/buildBridge', player: 0, edge: site });
    expect(next.pieces.roads[site]).toBe(0);
    expect(bridgesOf(next)[site]).toBe(0);
    expect(goldOf(next, 0)).toBe(before + 3 + 0);
    expect(next.players[0]?.resources.brick).toBe(0);
    // Bridges do not use up roads.
    expect(piecesLeft(next, 0).road).toBe(14);
  });

  it('is refused off a site, unconnected, unaffordable, or past 3 bridges', () => {
    const s = tbMain('rivers');
    const site = siteWithRoad(s, 0);
    bad(s, { type: 'tb/buildBridge', player: 0, edge: site }, /afford/);
    setHand(s, 0, { brick: 8, lumber: 4 });
    bad(s, { type: 'tb/buildBridge', player: 0, edge: 'e:0,0,E' }, /not a bridge site/);
    const lonely = (tbBoard(s).bridgeSites ?? []).find(
      (e) =>
        e !== site &&
        !legalOf(s, 'tb/buildBridge').some((a) => (a as { edge?: string }).edge === e),
    ) as EdgeId;
    bad(s, { type: 'tb/buildBridge', player: 0, edge: lonely }, /connect/);
    const sites = (tbBoard(s).bridgeSites ?? []).filter((e) => e !== site).slice(0, 3);
    for (const e of sites) tbSlice(s).rivers!.bridges[e] = 0;
    bad(s, { type: 'tb/buildBridge', player: 0, edge: site }, /no bridges left/);
  });
});

describe('gold from rivers', () => {
  const riverVertex = (s: GameState): VertexId => {
    const h = (tbBoard(s).rivers ?? [])[1] as HexId;
    return hexVertices(topologyOf(s), h)[0] as VertexId;
  };

  it('a settlement next to a river pays 1 gold, a city upgrade does not', () => {
    const s = tbMain('rivers');
    const v = riverVertex(s);
    const t = topologyOf(s);
    const e = (t.vertex[v]?.edges ?? [])[0] as EdgeId;
    roads(s, 0, e);
    setHand(s, 0, { brick: 1, lumber: 1, wool: 1, grain: 3, ore: 3 });
    let next = ok(s, { type: 'buildSettlement', player: 0, vertex: v });
    expect(goldOf(next, 0)).toBe(1);
    next = ok(next, { type: 'buildCity', player: 0, vertex: v });
    expect(goldOf(next, 0)).toBe(1);
  });

  it('a road next to a river pays 1 gold; setup pieces too', () => {
    let s = createGame({
      seed: 3,
      players: players(3),
      mode: 'tb',
      scenario: 'tb/rivers',
      startingPlayer: 0,
    });
    const v = riverVertex(s);
    s = ok(s, { type: 'placeSetupSettlement', player: 0, vertex: v });
    const e = legalActions(s).find((a) => a.type === 'placeSetupRoad') as
      { edge: EdgeId } | undefined;
    expect(goldOf(s, 0)).toBe(1);
    s = ok(s, { type: 'placeSetupRoad', player: 0, edge: e!.edge });
    expect(goldOf(s, 0)).toBeGreaterThanOrEqual(1);
  });

  it('the 2 shares the hex of the 12: that hex produces on a 2', () => {
    const s = tbMain('rivers');
    const h = tbBoard(s).twoOnTwelve as HexId;
    const v = hexVertices(topologyOf(s), h)[0] as VertexId;
    build(s, 1, v, 'city');
    s.robber = 'h:999,999';
    const terrain = s.board.hexes[h]?.terrain as 'brick';
    const next = roll(s, 1, 1);
    expect(next.players[1]?.resources[terrain]).toBe(2);
  });
});

describe('Wealthiest and Poor Settler', () => {
  it('strictly the most gold: +1; everyone tied at the least: -2 each (0 included)', () => {
    const s = tbMain('rivers');
    build(s, 0, 'v:0,0,N');
    build(s, 1, 'v:2,0,N');
    build(s, 2, 'v:-2,0,N');
    build(s, 3, 'v:0,2,N');
    setGold(s, 0, 3);
    setGold(s, 1, 1);
    expect(publicVictoryPoints(s, 0)).toBe(2);
    expect(publicVictoryPoints(s, 1)).toBe(1);
    expect(publicVictoryPoints(s, 2)).toBe(-1);
    expect(publicVictoryPoints(s, 3)).toBe(-1);
    setGold(s, 1, 3);
    expect(publicVictoryPoints(s, 0)).toBe(1);
  });
});

describe('gold coins', () => {
  it('2 gold buy one resource, at most twice per turn, not in the special build phase', () => {
    const s = tbMain('rivers');
    setGold(s, 0, 6);
    let next = ok(
      s,
      { type: 'tb/buyResource', player: 0, resource: 'ore' },
      { type: 'tb/buyResource', player: 0, resource: 'ore' },
    );
    expect(next.players[0]?.resources.ore).toBe(2);
    expect(goldOf(next, 0)).toBe(2);
    bad(next, { type: 'tb/buyResource', player: 0, resource: 'ore' }, /at most 2/);
    next = structuredClone(s);
    next.phase = { kind: 'specialBuild', builder: 0, owner: 3 };
    bad(next, { type: 'tb/buyResource', player: 0, resource: 'ore' }, /only on your turn/);
  });

  it('4 identical resources (3 with a 3:1 harbour) sell for 1 gold', () => {
    const s = tbMain('rivers');
    setHand(s, 0, { wool: 4 });
    const next = ok(s, { type: 'tb/sellForGold', player: 0, resource: 'wool' });
    expect(next.players[0]?.resources.wool).toBe(0);
    expect(goldOf(next, 0)).toBe(1);
    const generic = s.board.ports.find((p) => p.kind === 'generic');
    build(s, 0, generic!.vertices[0]);
    setHand(s, 0, { wool: 3 });
    expect(goldOf(ok(s, { type: 'tb/sellForGold', player: 0, resource: 'wool' }), 0)).toBe(1);
  });

  it('there is no gold in the Fishermen scenario', () => {
    const s = tbMain('fishermen');
    bad(s, { type: 'tb/buyResource', player: 0, resource: 'ore' }, /no gold/);
  });
});

describe('Harbormaster', () => {
  const portVertices = (s: GameState) => s.board.ports.map((p) => p.vertices[0]);

  it('+1 to the VP goal', () => {
    const s = tbMain('rivers', 4, { options: { tb: { harbormaster: true } } });
    expect(s.settings.vpToWin).toBe(11);
    expect(tbMain('traders', 4, { options: { tb: { harbormaster: true } } }).settings.vpToWin).toBe(
      14,
    );
  });

  it('3 harbour points (settlement 1, city 2) and the most take the 2 VP card; ties keep it', () => {
    let s = tbMain('variants', 4, { options: { tb: { harbormaster: true } } });
    const [a, b, c] = portVertices(s) as [VertexId, VertexId, VertexId];
    build(s, 0, a, 'city');
    build(s, 0, b);
    // Any action recomputes the holder.
    s = ok(s, { type: 'endTurn', player: 0 });
    expect(tbSlice(s).harbormaster).toBe(0);
    expect(victoryPoints(s, 0)).toBe(3 + 2);
    build(s, 1, c, 'city');
    build(s, 1, portVertices(s)[3] as VertexId);
    s = ok(s, { type: 'rollDice', player: 1 });
    expect(tbSlice(s).harbormaster).toBe(0);
    build(s, 1, portVertices(s)[4] as VertexId);
    s.phase = { kind: 'main' };
    s = ok(s, { type: 'endTurn', player: 1 });
    expect(tbSlice(s).harbormaster).toBe(1);
  });

  it('is off without the option', () => {
    let s = tbMain('variants');
    build(s, 0, portVertices(s)[0] as VertexId, 'city');
    build(s, 0, portVertices(s)[1] as VertexId, 'city');
    s = ok(s, { type: 'endTurn', player: 0 });
    expect(publicVictoryPoints(s, 0)).toBe(4);
  });
});
