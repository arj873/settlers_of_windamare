/** The Caravans (§3.5, §4.3). */
import { describe, expect, it } from 'vitest';
import { longestRoadLengths } from '../../../engine/rules/longestRoad';
import { publicVictoryPoints } from '../../../engine/selectors';
import { topologyOf } from '../../../engine/topology';
import type { EdgeId, GameState, VertexId } from '../../../engine/types';
import { camelOptions, caravansOf, tbBoard, type TbPhase } from '.';
import { bad, build, legalOf, ok, roads, setHand, tbMain } from './testkit';

const vote = (s: GameState) => s.phase as unknown as Extract<TbPhase, { kind: 'tb/vote' }>;

/** Player 0 builds a settlement (on a free spot with a road) this turn. */
function builtThisTurn(s: GameState): GameState {
  caravansOf(s).built = true;
  return s;
}

describe('camels', () => {
  it('the first camel of each caravan goes on its start edge', () => {
    const s = tbMain('caravans');
    const starts = (tbBoard(s).caravanStarts ?? []).map((x) => x.edge);
    expect(camelOptions(s).map((c) => c.edge)).toEqual(starts);
  });

  it('later camels extend from the head, never branch, never share an edge', () => {
    const s = tbMain('caravans');
    const c = caravansOf(s);
    const start = tbBoard(s).caravanStarts?.[0];
    c.camels.push({ edge: start!.edge, head: start!.head, caravan: 0 });
    c.heads[0] = start!.head;
    c.left -= 1;
    const t = topologyOf(s);
    const from0 = camelOptions(s).filter((o) => o.caravan === 0);
    expect(from0.length).toBe((t.vertex[start!.head]?.edges.length ?? 0) - 1);
    for (const o of from0) expect(t.edge[o.edge]?.vertices).toContain(start!.head);
  });

  it('no camels left: no placement', () => {
    const s = tbMain('caravans');
    caravansOf(s).left = 0;
    expect(camelOptions(s)).toEqual([]);
  });
});

describe('the voting round', () => {
  it('no settlement or city built: the turn ends without a vote', () => {
    const s = tbMain('caravans');
    const next = ok(s, { type: 'endTurn', player: 0 });
    expect(next.phase.kind).toBe('preRoll');
    expect(next.turn.current).toBe(1);
  });

  it('a build starts the vote; bids go round from the ender; the top bidder places the camel', () => {
    let s = builtThisTurn(tbMain('caravans'));
    setHand(s, 2, { wool: 2, grain: 1 });
    setHand(s, 1, { wool: 1 });
    s = ok(s, { type: 'endTurn', player: 0 });
    expect(vote(s).kind).toBe('tb/vote');
    expect(vote(s).order).toEqual([0, 1, 2, 3]);
    bad(s, { type: 'tb/bid', player: 1, wool: 0, grain: 0 }, /not your bid/);
    s = ok(
      s,
      { type: 'tb/bid', player: 0, wool: 0, grain: 0 },
      { type: 'tb/bid', player: 1, wool: 1, grain: 0 },
    );
    bad(s, { type: 'tb/bid', player: 2, wool: 3, grain: 0 }, /do not have/);
    s = ok(
      s,
      { type: 'tb/bid', player: 2, wool: 2, grain: 1 },
      { type: 'tb/bid', player: 3, wool: 0, grain: 0 },
    );
    expect(vote(s).placer).toBe(2);
    // Bids are discarded to the bank.
    expect(s.players[2]?.resources.wool).toBe(0);
    expect(legalOf(s, 'tb/placeCamel').every((a) => a.player === 2)).toBe(true);
    const edge = camelOptions(s)[0]?.edge as EdgeId;
    s = ok(s, { type: 'tb/placeCamel', player: 2, edge });
    expect(caravansOf(s).camels).toHaveLength(1);
    expect(s.phase.kind).toBe('preRoll');
    expect(s.turn.current).toBe(1);
  });

  it('a tie for most votes leaves the camel to the player whose turn ended', () => {
    let s = builtThisTurn(tbMain('caravans'));
    setHand(s, 1, { wool: 1 });
    setHand(s, 3, { grain: 1 });
    s = ok(s, { type: 'endTurn', player: 0 });
    s = ok(
      s,
      { type: 'tb/bid', player: 0, wool: 0, grain: 0 },
      { type: 'tb/bid', player: 1, wool: 1, grain: 0 },
      { type: 'tb/bid', player: 2, wool: 0, grain: 0 },
      { type: 'tb/bid', player: 3, wool: 0, grain: 1 },
    );
    expect(vote(s).placer).toBe(0);
  });

  it('Catan for Two places two camels per round', () => {
    let s = builtThisTurn(tbMain('caravans', 2));
    s = ok(
      s,
      { type: 'endTurn', player: 0 },
      { type: 'tb/bid', player: 0, wool: 0, grain: 0 },
      { type: 'tb/bid', player: 1, wool: 0, grain: 0 },
    );
    s = ok(s, { type: 'tb/placeCamel', player: 0, edge: camelOptions(s)[0]?.edge as EdgeId });
    expect(s.phase.kind).toBe('tb/vote');
    s = ok(s, { type: 'tb/placeCamel', player: 0, edge: camelOptions(s)[0]?.edge as EdgeId });
    expect(caravansOf(s).camels).toHaveLength(2);
    expect(s.turn.current).toBe(1);
  });

  it('building in the main phase marks the turn; setup builds do not', () => {
    const s = tbMain('caravans');
    const t = topologyOf(s);
    const v: VertexId = 'v:2,-1,N';
    roads(s, 0, (t.vertex[v]?.edges ?? [])[0] as EdgeId);
    setHand(s, 0, { brick: 1, lumber: 1, wool: 1, grain: 1 });
    const next = ok(s, { type: 'buildSettlement', player: 0, vertex: v });
    expect(caravansOf(next).built).toBe(true);
  });
});

describe('5-6 players', () => {
  it('a settlement built in the special build phase calls another camel after the phase', () => {
    let s = tbMain('caravans', 5);
    s.phase = { kind: 'specialBuild', builder: 4, owner: 3 };
    s.turn.current = 4;
    const v: VertexId = 'v:2,-1,N';
    roads(s, 4, (topologyOf(s).vertex[v]?.edges ?? [])[0] as EdgeId);
    setHand(s, 4, { brick: 1, lumber: 1, wool: 1, grain: 1 });
    s = ok(s, { type: 'buildSettlement', player: 4, vertex: v });
    expect(caravansOf(s).sbpBuilt).toBe(true);
    s = ok(s, { type: 'passSpecialBuild', player: 4 });
    // Player 4 was the last builder before the owner: player 4's own turn starts with the vote.
    expect(s.turn.current).toBe(4);
    expect(vote(s)).toMatchObject({ kind: 'tb/vote', ender: 3, then: 'preRoll' });
    expect(vote(s).order[0]).toBe(3);
    for (const p of [3, 4, 0, 1, 2]) s = ok(s, { type: 'tb/bid', player: p, wool: 0, grain: 0 });
    s = ok(s, { type: 'tb/placeCamel', player: 3, edge: camelOptions(s)[0]?.edge as EdgeId });
    expect(s.phase.kind).toBe('preRoll');
    expect(s.turn.current).toBe(4);
  });
});

describe('scoring', () => {
  it('+1 VP for a building between two camels', () => {
    const s = tbMain('caravans');
    const t = topologyOf(s);
    const v: VertexId = 'v:1,0,N';
    const [a, b] = t.vertex[v]?.edges ?? [];
    caravansOf(s).camels.push(
      { edge: a as EdgeId, head: v, caravan: 0 },
      { edge: b as EdgeId, head: v, caravan: 1 },
    );
    build(s, 1, v, 'city');
    expect(publicVictoryPoints(s, 1)).toBe(3);
  });

  it('a road under a camel counts double for Longest Road', () => {
    const s = tbMain('caravans');
    const t = topologyOf(s);
    // A connected chain: walk 4 adjacent edges from one vertex.
    const path: EdgeId[] = [];
    let v: VertexId = 'v:0,-1,N';
    for (let i = 0; i < 4; i++) {
      const e = (t.vertex[v]?.edges ?? []).find((x) => !path.includes(x)) as EdgeId;
      path.push(e);
      v = (t.edge[e]?.vertices ?? []).find((x) => x !== v) as VertexId;
    }
    roads(s, 0, ...path);
    expect(longestRoadLengths(s)[0]).toBe(4);
    caravansOf(s).camels.push(
      { edge: path[0] as EdgeId, head: 'v:0,0,N', caravan: 0 },
      { edge: path[1] as EdgeId, head: 'v:0,0,N', caravan: 0 },
    );
    expect(longestRoadLengths(s)[0]).toBe(6);
  });

  it('the robber may not stand on the oasis', () => {
    const s = tbMain('caravans');
    s.phase = { kind: 'moveRobber', resume: 'main' };
    bad(s, { type: 'moveRobber', player: 0, hex: 'h:0,0' }, /oasis/);
    expect(legalOf(s, 'moveRobber').some((a) => a.type === 'moveRobber' && a.hex === 'h:0,0')).toBe(
      false,
    );
  });
});
