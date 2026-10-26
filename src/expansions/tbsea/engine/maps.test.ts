/** The T&B + Seafarers boards and the mode (docs/rules/combos.md §3). */
import { describe, expect, it } from 'vitest';
import { NO_ROBBER } from '../../../engine/expansions/ext';
import { centreVertex, parseHexId } from '../../../engine/hex';
import { mapById } from '../../../engine/mapLookup';
import { isWaterHex, topologyOf } from '../../../engine/topology';
import type { HexId } from '../../../engine/types';
import { mapKeyOf, seaBoard } from '../../seafarers/engine/maps';
import { rulesOf, seaSlice } from '../../seafarers/engine/state';
import { featuresOf, tbBoard, tradersOf } from '../../tb/engine';
import { pathEdges } from '../../tb/engine/paths';
import { BASE_MAP, PAIRS, TBSEA, TBSEA_SCENARIOS, shiftId } from '.';
import { game } from './testkit';

const mainIsland = (s: ReturnType<typeof game>): HexId[] => {
  const region = seaBoard(s).region;
  return (Object.keys(region) as HexId[]).filter((h) => region[h] === 'M');
};

describe('the mode', () => {
  it('composes tbsea, seafarers and tb in that order', () => {
    expect(game('tbsea/traders').settings.expansions).toEqual([TBSEA, 'seafarers', 'tb']);
  });

  it('plays each T&B scenario on New Shores at the sheets’ VP targets', () => {
    const vp: Record<string, number> = {
      'tbsea/traders': 17, // New Shores 14 + 3
      'tbsea/fishermen': 14, // the Seafarers scenario's target (the boot: +1)
      'tbsea/rivers': 14,
      'tbsea/caravans': 16, // + 2
      'tbsea/barbarianAttack': 14, // "14 or more VPs"
    };
    for (const sc of TBSEA_SCENARIOS) {
      const s = game(sc, 3);
      expect(s.settings.vpToWin, sc).toBe(vp[sc]);
      expect(rulesOf(s).key).toBe('newShores');
      expect(featuresOf(sc)).toEqual(
        [PAIRS.find((p) => p.id === sc)?.tb.slice(3)].map((f) =>
          f === 'fishermen' ? 'fish' : f === 'barbarianAttack' ? 'ba' : f,
        ),
      );
    }
  });

  it('is for 3-4 players, on the standard map only', () => {
    expect(() => game('tbsea/traders', 5)).toThrow(/players/);
    expect(() => game('tbsea/traders', 2)).toThrow(/players/);
    expect(() =>
      game('tbsea/fishermen', 4, { options: { seafarers: { layout: 'variable' } } }),
    ).toThrow(/standard map/);
    expect(() => createOther()).toThrow(/no scenario/);
  });
});

function createOther() {
  return game('seafarers/newShores');
}

describe('the boards', () => {
  it('are New Shores with the T&B island as the main island', () => {
    for (const pair of PAIRS) {
      const s = game(pair.id, 4, { seed: 9 });
      expect(mapKeyOf(s.settings.map), pair.id).toBe('hns4');
      expect((mapById(s.settings.map) as { basedOn?: string }).basedOn).toBe(BASE_MAP);
      const main = mainIsland(s);
      expect(main).toHaveLength(19);
      // The T&B board's 19 hexes, shifted onto the main island (centre h:0,4).
      const centre = parseHexId('h:0,4');
      for (const h of main) {
        const p = parseHexId(h);
        const d = Math.max(
          Math.abs(p.q - centre.q),
          Math.abs(p.r - centre.r),
          Math.abs(p.q + p.r - centre.q - centre.r),
        );
        expect(d, `${pair.id} ${h}`).toBeLessThanOrEqual(2);
      }
      // New Shores' small islands are still there (9 cells, 2 gold).
      const small = Object.values(s.board.hexes).filter(
        (t) => seaBoard(s).region[t.id] === 'S' && t.terrain !== 'sea',
      );
      expect(small).toHaveLength(9);
      expect(small.filter((t) => t.terrain === 'gold')).toHaveLength(2);
      // The harbours are the T&B island's.
      expect(s.board.ports).toHaveLength(9);
      for (const port of s.board.ports)
        expect(main).toContain(topologyOf(s).edge[port.edge]?.hexes[0]);
    }
  });

  it('Traders & Barbarians: trade hexes with plazas, the barbarians on their X marks, no pirate', () => {
    const s = game('tbsea/traders');
    const trade = tbBoard(s).tradeHexes ?? [];
    expect(trade.map((t) => t.hex).sort()).toEqual(['h:-2,4', 'h:0,6', 'h:2,2'].sort());
    for (const t of trade) {
      const { q, r } = parseHexId(t.hex);
      expect(topologyOf(s).vertex[centreVertex(q, r)], t.hex).toBeDefined();
    }
    expect(tradersOf(s).barbarians).toEqual(['e:1,2,SE', 'e:-2,5,NE', 'e:0,5,E']);
    for (const e of tradersOf(s).barbarians) expect(pathEdges(s)).toContain(e);
    expect(seaSlice(s).pirate).toBeNull();
    expect(s.robber).toBe(NO_ROBBER);
  });

  it('Fishermen: the lake inland, every fishing ground on a water hex at its tip', () => {
    const s = game('tbsea/fishermen');
    const b = tbBoard(s);
    const main = mainIsland(s);
    expect(b.lakes).toHaveLength(1);
    expect(main).toContain(b.lakes?.[0]?.hex);
    expect(b.grounds).toHaveLength(6);
    const t = topologyOf(s);
    for (const g of b.grounds ?? []) {
      expect(g.hex && isWaterHex(t, g.hex), JSON.stringify(g)).toBe(true);
      expect(t.water[g.hex as HexId]?.vertices).toContain(g.vertices[0]);
    }
    expect(seaSlice(s).pirate).not.toBeNull();
    expect(s.robber).toBe(NO_ROBBER);
  });

  it('Rivers: rivers and bridge sites on the main island, the robber on a swamp', () => {
    const s = game('tbsea/rivers');
    const b = tbBoard(s);
    const main = mainIsland(s);
    for (const h of b.rivers ?? []) expect(main).toContain(h);
    expect(b.bridgeSites).toHaveLength(7);
    for (const e of b.bridgeSites ?? []) expect(topologyOf(s).edge[e]).toBeDefined();
    expect(s.board.hexes[s.robber]?.terrain).toBe('tb/swamp');
    expect(b.twoOnTwelve && s.board.hexes[b.twoOnTwelve]?.token).toBe(12);
  });

  it('Caravans: the oasis in the middle of the main island, three starts', () => {
    const s = game('tbsea/caravans');
    expect(s.board.hexes['h:0,4']?.terrain).toBe('tb/oasis');
    expect(tbBoard(s).caravanStarts).toHaveLength(3);
  });

  it('Barbarian Attack: the castle and the coast in check order on the main island, no pirate', () => {
    const s = game('tbsea/barbarianAttack');
    const b = tbBoard(s);
    expect(b.castles).toEqual([shiftId('h:-2,2')]);
    expect(s.board.hexes['h:-2,6']?.terrain).toBe('tb/castle');
    expect(b.coast).toHaveLength(10);
    for (const h of b.coast ?? []) expect(mainIsland(s)).toContain(h);
    expect(seaSlice(s).pirate).toBeNull();
  });
});
