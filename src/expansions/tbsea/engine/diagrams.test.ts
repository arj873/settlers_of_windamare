/**
 * C3: the pairs the 2025 sheets set up with diagrams (docs/rules/combos.md §2d): Rivers on the Fog
 * Islands and Through the Desert, Merchant Trains on the Four Islands, Traders & Barbarians and
 * Barbarian Attack Through the Desert. One test per rule.
 */
import { describe, expect, it } from 'vitest';
import { cloneState } from '../../../engine/clone';
import { NO_ROBBER } from '../../../engine/expansions/ext';
import { centreVertex, parseHexId } from '../../../engine/hex';
import { topologyOf } from '../../../engine/topology';
import type { EdgeId, GameState, HexId } from '../../../engine/types';
import { cellEdge, cellHex, parseCell, type BookSide } from '../../seafarers/engine/coords';
import { OFF_BOARD, seaBoard } from '../../seafarers/engine/maps';
import { seaSlice } from '../../seafarers/engine/state';
import { baOf, tbBoard, tbModule, tradersOf } from '../../tb/engine';
import { knightSpots } from '../../tb/engine/ba';
import { CASTLE, OASIS, SWAMP } from '../../tb/engine/state';
import { tbseaBoard } from '.';
import { game, legalOf, main } from './testkit';

const cell = (s: string): HexId => cellHex(parseCell(s));
const edge = (s: string): EdgeId => {
  const [c = '', side = ''] = s.split(' ');
  return cellEdge(parseCell(c), side as BookSide);
};
const tokenOf = (s: GameState, c: string) => s.board.hexes[cell(c)]?.token;

describe('Rivers on the Fog Islands', () => {
  it('3 players: the printed rivers, swamps at the mouths, second discs on the hills', () => {
    const s = game('tbsea/riversFog', 3);
    const b = tbBoard(s);
    expect(b.rivers).toEqual(['3,1', '2,2', '1,3', '0,4', '6,10', '5,11', '4,12'].map(cell));
    expect(s.board.hexes[cell('0,4')]?.terrain).toBe(SWAMP);
    expect(s.board.hexes[cell('4,12')]?.terrain).toBe(SWAMP);
    expect(b.bridgeSites).toHaveLength(7);
    expect(b.bridgeSites).toContain(edge('0,4 NW'));
    expect(b.bridgeSites).toContain(edge('4,12 S'));
    expect(tbseaBoard(s.board).extraTokens).toEqual([
      { hex: cell('2,2'), number: 11 },
      { hex: cell('5,11'), number: 12 },
    ]);
    expect(tokenOf(s, '2,2')).toBe(2);
  });

  it('the fog stays as printed; the robber starts on a swamp, the pirate on the frame', () => {
    for (const n of [3, 4]) {
      const s = game('tbsea/riversFog', n);
      const fog = Object.values(s.board.hexes).filter((h) => h.terrain === 'fog');
      expect(fog).toHaveLength(12);
      expect(seaSlice(s).fog?.terrains).toHaveLength(12);
      expect(s.board.hexes[s.robber]?.terrain).toBe(SWAMP);
      expect(seaSlice(s).pirate).toBe(cell('-1,9'));
    }
  });

  it('4 players: eight harbours, the grain one on 6,10 NE', () => {
    const s = game('tbsea/riversFog', 4);
    expect(s.board.ports).toHaveLength(8);
    expect(s.board.ports.find((p) => p.kind === 'grain')?.edge).toBe(edge('6,10 NE'));
    expect(tbseaBoard(s.board).extraTokens).toEqual([{ hex: cell('5,11'), number: 12 }]);
  });
});

describe('Rivers Through the Desert', () => {
  it('version 1: the outer deserts are swamps; the mouths open on the desert and a gold field', () => {
    for (const n of [3, 4]) {
      const s = game('tbsea/riversDesert', n);
      expect(s.board.hexes[cell('4,2')]?.terrain).toBe(SWAMP);
      expect(s.board.hexes[cell('6,4')]?.terrain).toBe(SWAMP);
      expect(s.board.hexes[cell('5,3')]?.terrain).toBe('desert');
      // A mouth on land is a bridge site like any river crossing.
      expect(tbBoard(s).bridgeSites).toContain(edge('4,2 SE'));
      expect(tbBoard(s).bridgeSites).toContain(edge('6,4 N'));
      expect(s.robber).toBe(cell('5,3'));
      expect(seaSlice(s).pirate).toBe(cell('7,3'));
    }
  });

  it('version 2: the deserts stay; the strip beyond them is the 3-hex river', () => {
    const s = game('tbsea/riversDesert2', 3);
    for (const c of ['4,2', '5,3', '6,4']) expect(s.board.hexes[cell(c)]?.terrain).toBe('desert');
    expect(tbBoard(s).rivers?.slice(0, 3)).toEqual(['6,2', '5,1', '4,0'].map(cell));
    expect(s.board.hexes[cell('4,0')]?.terrain).toBe(SWAMP);
    expect(tbseaBoard(s.board).extraTokens).toEqual([{ hex: cell('2,4'), number: 12 }]);
    expect(Object.values(s.board.hexes).filter((h) => h.terrain === 'gold')).toHaveLength(1);
  });

  it('4 players: the 2025 harbours (grain on 1,1 N)', () => {
    for (const sc of ['tbsea/riversDesert', 'tbsea/riversDesert2']) {
      const s = game(sc, 4);
      expect(s.board.ports).toHaveLength(9);
      expect(s.board.ports.find((p) => p.kind === 'grain')?.edge).toBe(edge('1,1 N'));
    }
  });
});

describe('Merchant Trains on the Four Islands', () => {
  it('the watering hole alone in the middle, three camel starts on the sea', () => {
    for (const n of [3, 4]) {
      const s = game('tbsea/caravansFour', n);
      expect(s.board.hexes[cell('3,5')]?.terrain).toBe(OASIS);
      const starts = tbBoard(s).caravanStarts ?? [];
      expect(starts.map((x) => x.edge).sort()).toEqual(
        [edge('3,3 SE'), edge('3,7 NE'), edge('2,4 S')].sort(),
      );
      const t = topologyOf(s);
      for (const x of starts) {
        expect(t.edge[x.edge] ?? t.seaEdge[x.edge], x.edge).toBeDefined();
        const around = [...(t.edge[x.edge] ?? t.seaEdge[x.edge])!.hexes];
        for (const h of around) expect(s.board.hexes[h]?.terrain).toBe('sea');
      }
      // The hole is no island to settle for 2 VP.
      expect(seaBoard(s).area[cell('3,5')]).toBeUndefined();
    }
  });

  it('the pirate starts beside the board and comes in with the first 7', () => {
    const s = main('tbsea/caravansFour', 4);
    expect(seaSlice(s).pirate).toBe(OFF_BOARD);
    s.phase = { kind: 'moveRobber', resume: 'main' };
    expect(legalOf(s, 'seafarers/movePirate').length).toBeGreaterThan(0);
  });

  it('the 2025 islands: 3 players lumber on 0,4 and 4,10; 4 players a 7-hex east island', () => {
    const s3 = game('tbsea/caravansFour', 3);
    expect(s3.board.hexes[cell('0,4')]).toMatchObject({ terrain: 'lumber', token: 3 });
    expect(s3.board.hexes[cell('4,10')]).toMatchObject({ terrain: 'lumber', token: 8 });
    expect(s3.board.hexes[cell('2,4')]?.terrain).toBe('sea');
    const s4 = game('tbsea/caravansFour', 4);
    expect(s4.board.hexes[cell('4,6')]?.terrain).toBe('sea');
    const area = seaBoard(s4).area;
    expect(area[cell('4,10')]).toBe(area[cell('4,8')]);
    expect(s4.board.ports.find((p) => p.kind === 'lumber')?.edge).toBe(edge('1,5 SW'));
  });

  it('a camel may go on an edge of the pirate’s hex', () => {
    const s = main('tbsea/caravansFour', 4);
    // The pirate on the sea hex north of the hole: a start edge is one of its sides.
    seaSlice(s).pirate = cell('3,3');
    s.phase = {
      kind: 'tb/vote',
      ender: 0,
      order: [],
      bids: [0, 0, 0, 0],
      camels: 1,
      placer: 0,
      then: 'endTurn',
    } as unknown as typeof s.phase;
    const camels = legalOf(s, 'tb/placeCamel').map((a) => (a as unknown as { edge: EdgeId }).edge);
    expect(camels).toContain(edge('3,3 SE'));
  });
});

describe('Traders & Barbarians Through the Desert', () => {
  it('castle, quarry beyond the desert and glassworks, each with a plaza', () => {
    for (const n of [3, 4]) {
      const s = game('tbsea/tradersDesert', n);
      expect(tbBoard(s).tradeHexes).toEqual(
        [
          { hex: cell('1,1'), kind: 'castle' },
          { hex: cell('3,7'), kind: 'glassworks' },
          { hex: cell('5,1'), kind: 'quarry' },
        ].sort((a, b) => (a.hex < b.hex ? -1 : 1)),
      );
      for (const t of tbBoard(s).tradeHexes ?? []) {
        const { q, r } = parseHexId(t.hex);
        expect(topologyOf(s).vertex[centreVertex(q, r)], t.hex).toBeDefined();
        expect(s.board.hexes[t.hex]?.token).toBeNull();
      }
    }
  });

  it('3 players: the glassworks takes a sea cell and its harbour; the 2025 small islands', () => {
    const s = game('tbsea/tradersDesert', 3);
    expect(s.board.ports).toHaveLength(7);
    expect(s.board.hexes[cell('2,10')]).toMatchObject({ terrain: 'grain', token: 9 });
    expect(s.board.hexes[cell('4,10')]).toMatchObject({ terrain: 'gold', token: 5 });
    expect(s.board.hexes[cell('1,9')]?.terrain).toBe('sea');
  });

  it('the barbarians start on three paths by the desert; no robber, no pirate', () => {
    const s = game('tbsea/tradersDesert', 4);
    expect(tradersOf(s).barbarians).toEqual([edge('5,3 NW'), edge('3,5 SW'), edge('2,2 SW')]);
    expect(s.robber).toBe(NO_ROBBER);
    expect(seaSlice(s).pirate).toBeNull();
  });

  it('the board prints a 2 and a 12, so they are not re-rolled', () => {
    const s = game('tbsea/tradersDesert', 4);
    expect(tokenOf(s, '4,12')).toBe(2);
    expect(tbBoard(s).keep212).toBe(true);
    // T&B's dice hook stands aside (plain dice); on New Shores it re-rolls 2 and 12.
    expect(tbModule.hooks?.rollDice?.(cloneState(s))).toBeUndefined();
    expect(tbModule.hooks?.rollDice?.(cloneState(game('tbsea/traders', 4)))).toBeDefined();
  });
});

describe('Barbarian Attack Through the Desert', () => {
  it('the castle on the main island, the coast in check order without castle and deserts', () => {
    const s = game('tbsea/barbarianAttackDesert', 3);
    const b = tbBoard(s);
    expect(b.castles).toEqual([cell('2,0')]);
    expect(s.board.hexes[cell('2,0')]?.terrain).toBe(CASTLE);
    const coast = b.coast ?? [];
    expect(coast).toHaveLength(10);
    const region = seaBoard(s).region;
    for (const h of coast) expect(region[h]).toBe('M');
    expect(new Set(coast.map((h) => s.board.hexes[h]?.token)).size).toBe(10);
    expect(coast).not.toContain(cell('2,4'));
  });

  it('one barbarian each on the coastal 2 and 12 at the start', () => {
    const s = game('tbsea/barbarianAttackDesert', 3);
    expect(baOf(s).onHex).toEqual({ [cell('1,1')]: 1, [cell('5,5')]: 1 });
  });

  it('knights only on the main island', () => {
    const s = game('tbsea/barbarianAttackDesert', 4);
    const main = new Set(tbBoard(s).knightArea);
    expect(main.has(cell('3,3'))).toBe(true);
    expect(main.has(cell('4,0'))).toBe(false);
    const spots = knightSpots(s, 'swiftKnight');
    expect(spots.length).toBeGreaterThan(0);
    for (const e of spots) {
      expect(
        (topologyOf(s).edge[e]?.hexes ?? []).some((h) => main.has(h)),
        e,
      ).toBe(true);
    }
  });

  it('no robber, no pirate; 14 VP', () => {
    const s = game('tbsea/barbarianAttackDesert', 4);
    expect(s.robber).toBe(NO_ROBBER);
    expect(seaSlice(s).pirate).toBeNull();
    expect(s.settings.vpToWin).toBe(14);
  });
});
