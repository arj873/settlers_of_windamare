import { describe, expect, it } from 'vitest';
import {
  applyAction,
  createGame,
  legalActions,
  PLAYER_COLORS,
  tokenPips,
  TOPOLOGY,
  vertexHexes,
  type Action,
  type EdgeId,
  type GameState,
  type HexId,
  type VertexId,
} from '../../src/engine';
import { freshGame, midGame } from '../../src/engine/fixtures';
import {
  actionName,
  describeEdge,
  describeHex,
  describeId,
  describeVertex,
  formatSpots,
  hexLabel,
  listSpots,
  movesBehindButtons,
  spotKey,
  spotVerb,
  type Spot,
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

  it('names the ends of an open-sea edge too (not in the land topology)', () => {
    const e = 'e:0,6,SE' as EdgeId;
    expect(TOPOLOGY.edge[e]).toBeUndefined();
    const text = describeEdge(freshGame(3), e, 0);
    expect(text).toMatch(/^between sea; ends v:\S+ \(open\), v:\S+ \(open\)$/);
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

describe('expansion spots', () => {
  const edge = TOPOLOGY.edges[0] as EdgeId;
  const road = { type: 'placeSetupRoad', player: 0, edge } as Action;
  const ship = { type: 'seafarers/placeSetupShip', player: 0, edge } as unknown as Action;

  it('names module moves from their type and base moves from a table', () => {
    const s = freshGame(3);
    expect(actionName(s, ship)).toBe('place setup ship');
    expect(actionName(s, { type: 'ck/selectKnight' })).toBe('select knight');
    expect(actionName(s, road)).toBe('setup road');
    expect(actionName(s, { type: 'placeSetupSettlement' })).toBe('setup settlement');
  });

  it('T&B barbarian: the pick step and the destination step have their own words', () => {
    const s = freshGame(3);
    const a = { type: 'tb/placeBarbarian' };
    s.phase = { kind: 'tb/barbarian', from: null } as never;
    expect(spotVerb(s, a.type)).toBe('pick the barbarian to move');
    expect(actionName(s, a)).toBe('pick barbarian');
    s.phase = { kind: 'tb/barbarian', from: 'e:0,1,E' } as never;
    expect(spotVerb(s, a.type)).toBe('move the barbarian to');
    expect(actionName(s, a)).toBe('move barbarian here');
  });

  it('names the setup city when the engine places one (C&K round 2)', () => {
    let s = createGame({ seed: 'ck-spots', players: PLAYER_COLORS.slice(0, 3), mode: 'ck' });
    while (s.phase.kind === 'setup' && s.phase.index < s.players.length) {
      const r = applyAction(s, legalActions(s)[0] as Action);
      if (!r.ok) throw new Error(r.error);
      s = r.state;
    }
    expect(actionName(s, { type: 'placeSetupSettlement' })).toBe('setup city');
    expect(spotVerb(s, 'placeSetupSettlement')).toBe('place your setup city');
  });

  it('lists road and ship on one edge as two named spots', () => {
    const s = freshGame(3);
    const spots = listSpots(s, [road, ship], 0);
    expect(spots.map((x) => [x.does, x.type])).toEqual([
      ['setup road', 'placeSetupRoad'],
      ['place setup ship', 'seafarers/placeSetupShip'],
    ]);
    const out = formatSpots(s, spots, []);
    expect(out).toMatch(/several kinds of move/);
    expect(out).toContain('[place setup ship]');
    expect(spotKey(spots[0] as Spot)).not.toBe(spotKey(spots[1] as Spot));
  });

  it('tells two pieces on one spot apart by their other fields', () => {
    const s = freshGame(3);
    const a = { type: 'ep/selectShip', player: 0, ship: 0, edge } as unknown as Action;
    const b = { type: 'ep/selectShip', player: 0, ship: 1, edge } as unknown as Action;
    const spots = listSpots(s, [a, b], 0);
    expect(spots.map((x) => x.does)).toEqual(['select ship (ship 0)', 'select ship (ship 1)']);
    expect(formatSpots(s, spots, [])).toContain('[select ship (ship 1)]');
  });

  it('points at the button that unlocks board moves', () => {
    const s = freshGame(3);
    const v = TOPOLOGY.vertices[0] as VertexId;
    const select = { type: 'ck/selectKnight', player: 0, vertex: v } as unknown as Action;
    const controls = [
      { label: 'Command', enabled: true, actions: ['ck/selectKnight'] },
      { label: 'Road 13/15', enabled: false, actions: ['buildRoad'] },
    ];
    expect(movesBehindButtons(s, [select], [], controls, 0)).toEqual([
      '[Command]: select knight (1)',
    ]);
    expect(movesBehindButtons(s, [select], [select], controls, 0)).toEqual([]);
    expect(formatSpots(s, [], ['[Command]: select knight (1)'])).toMatch(
      /No board spots[\s\S]*behind a button[\s\S]*\[Command\]/,
    );
  });
});
