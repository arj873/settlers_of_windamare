import { describe, expect, it } from 'vitest';
import {
  legalActions,
  tokenPips,
  TOPOLOGY,
  vertexHexes,
  type EdgeId,
  type GameState,
  type HexId,
  type VertexId,
} from '../../src/engine';
import { freshGame, midGame } from '../../src/engine/fixtures';
import {
  describeEdge,
  describeHex,
  describeId,
  describeVertex,
  hexLabel,
  listSpots,
} from './spots';

/** A fresh game with one building placed by hand (fixture states are ours to copy). */
function withBuilding(v: VertexId, owner: number): GameState {
  const s = freshGame(3);
  return {
    ...s,
    pieces: {
      ...s.pieces,
      buildings: { ...s.pieces.buildings, [v]: { owner, kind: 'settlement' } },
    },
  };
}

describe('hexLabel', () => {
  it('names terrain + token, marks the robber and the desert', () => {
    const s = freshGame(3);
    const land = TOPOLOGY.landHexes.find((h) => s.board.hexes[h]?.token !== null) as HexId;
    const hex = s.board.hexes[land];
    expect(hexLabel(s, land)).toBe(`${hex?.terrain} ${hex?.token}`);
    expect(hexLabel(s, s.robber)).toBe('desert [robber]');
    expect(hexLabel(s, 'h:9,9')).toBe('sea');
  });
});

describe('describeVertex', () => {
  it('lists the adjacent hexes and their total pips', () => {
    const s = freshGame(3);
    const v = TOPOLOGY.vertices.find((x) => vertexHexes(TOPOLOGY, x).length === 3) as VertexId;
    const text = describeVertex(s, v, 0);
    const pips = vertexHexes(TOPOLOGY, v).reduce((n, h) => {
      const t = s.board.hexes[h]?.token;
      return n + (t ? tokenPips(t) : 0);
    }, 0);
    for (const h of vertexHexes(TOPOLOGY, v)) expect(text).toContain(hexLabel(s, h));
    expect(text).toContain(`(pips ${pips})`);
    expect(text).not.toContain('coast');
  });

  it('mentions the coast and the harbor', () => {
    const s = freshGame(3);
    const port = s.board.ports.find((p) => p.kind === 'generic');
    if (!port) throw new Error('no generic port');
    const text = describeVertex(s, port.vertices[0], 0);
    expect(text).toContain('coast');
    expect(text).toContain('harbor 3:1 any');
    const two = s.board.ports.find((p) => p.kind !== 'generic');
    if (!two) throw new Error('no 2:1 port');
    expect(describeVertex(s, two.vertices[1], 0)).toContain(`harbor 2:1 ${two.kind}`);
  });

  it("says whose building stands there, from the viewer's side", () => {
    const v = TOPOLOGY.vertices[10] as VertexId;
    const s = withBuilding(v, 1);
    expect(describeVertex(s, v, 1)).toContain('your settlement');
    expect(describeVertex(s, v, 0)).toContain("Blue's settlement");
  });
});

describe('describeEdge / describeHex', () => {
  it('names both sides and both ends of a road spot', () => {
    const e = TOPOLOGY.edges.find((x) => TOPOLOGY.edge[x]?.hexes.length === 1) as EdgeId;
    const [a, b] = TOPOLOGY.edge[e]?.vertices ?? [];
    const s = withBuilding(a as VertexId, 0);
    const text = describeEdge(s, e, 0);
    expect(text).toContain('| sea');
    expect(text).toContain(`${a} (your settlement)`);
    expect(text).toContain(`${b} (open)`);
  });

  it('lists the buildings around a robber target', () => {
    const h = TOPOLOGY.landHexes[0] as HexId;
    const v = TOPOLOGY.hex[h]?.vertices[0] as VertexId;
    expect(describeHex(withBuilding(v, 2), h, 0)).toContain("White's settlement");
    expect(describeHex(freshGame(3), h, 0)).toContain('buildings: none');
  });

  it('describeId accepts any board id and rejects junk', () => {
    const s = freshGame(3);
    expect(describeId(s, 'h:0,0', 0)).toContain('buildings');
    expect(describeId(s, TOPOLOGY.edges[0] as string, 0)).toContain('between');
    expect(describeId(s, 'v:99,99,N', 0)).toBeNull();
  });
});

describe('listSpots', () => {
  it('numbers setup spots from 1, best (most pips) first', () => {
    const s = freshGame(3);
    const targets = legalActions(s, 0);
    const spots = listSpots(s, targets, 0);
    expect(spots).toHaveLength(TOPOLOGY.vertices.length);
    expect(spots.map((x) => x.n)).toEqual(spots.map((_, i) => i + 1));
    const pips = spots.map((x) => Number(/pips (\d+)/.exec(x.text)?.[1]));
    expect(pips).toEqual([...pips].sort((a, b) => b - a));
  });

  it('handles road and robber targets', () => {
    const s = midGame();
    const roads = legalActions(s, 1).filter((a) => a.type === 'buildRoad');
    const spots = listSpots(s, roads, 1);
    expect(spots.length).toBe(roads.length);
    expect(spots.every((x) => x.kind === 'edge')).toBe(true);
    expect(listSpots(s, [{ type: 'moveRobber', player: 1, hex: 'h:0,0' }], 1)[0]).toMatchObject({
      n: 1,
      id: 'h:0,0',
      kind: 'hex',
    });
  });
});
