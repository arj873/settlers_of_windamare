/**
 * C3: T&B scenarios on the other Seafarers scenarios, from the 2025 sheets' text set-ups
 * (docs/rules/combos.md §2d). One test per rule.
 */
import { describe, expect, it } from 'vitest';
import { legalActions } from '../../../engine/engine';
import { hexDistance, parseHexId, SIDES, neighbor, hexId } from '../../../engine/hex';
import { mapById } from '../../../engine/mapLookup';
import { computeProduction } from '../../../engine/rules/production';
import { hexVertices, topologyOf } from '../../../engine/topology';
import type { GameState, HexId, Terrain, VertexId } from '../../../engine/types';
import { cellHex, parseCell } from '../../seafarers/engine/coords';
import { components, mapKeyOf, OFF_BOARD, seaBoard } from '../../seafarers/engine/maps';
import { rulesOf, seaSlice } from '../../seafarers/engine/state';
import { cloneState } from '../../../engine/clone';
import { featuresOf, fishOf, goldOf, tbBoard } from '../../tb/engine';
import { LAKE, OASIS, SWAMP } from '../../tb/engine/state';
import { SEA_PAIRS, tbseaBoard, tbseaModule, TBSEA_SCENARIOS } from '.';
import { act, fails, game, legalOf, main, run } from './testkit';

const cell = (s: string): HexId => cellHex(parseCell(s));
const land = (t: Terrain | undefined) => t !== undefined && t !== 'sea' && t !== 'fog';
const settle = (s: GameState, v: VertexId, owner: number) =>
  (s.pieces.buildings[v] = { owner, kind: 'settlement' });
const vertexOf = (s: GameState, h: HexId): VertexId => hexVertices(topologyOf(s), h)[0] as VertexId;

/** The terrains of the board's hexes (`filter` = which hexes). */
function counts(s: GameState, filter: (h: HexId) => boolean = () => true) {
  const out: Record<string, number> = {};
  for (const t of Object.values(s.board.hexes)) {
    if (filter(t.id)) out[t.terrain] = (out[t.terrain] ?? 0) + 1;
  }
  return out;
}

describe('the scenarios', () => {
  it('are offered by the mode at the sheets’ VP targets, playing as both scenarios', () => {
    const vp: Record<string, [string, number]> = {
      'tbsea/fishermenFour': ['fourIslands', 13], // the Seafarers target (the boot: +1)
      'tbsea/fishermenFog': ['fogIslands', 12],
      'tbsea/fishermenDesert': ['throughTheDesert', 14],
      'tbsea/fishermenTribe': ['forgottenTribe', 13],
      'tbsea/fishermenCloth': ['clothForCatan', 14],
      'tbsea/fishermenWonders': ['wondersOfCatan', 10],
      'tbsea/fishermenNewWorld': ['newWorld', 12],
      'tbsea/caravansDesert': ['throughTheDesert', 16], // Merchant Trains: + 2
      'tbsea/caravansTribe': ['forgottenTribe', 15],
      'tbsea/caravansNewWorld': ['newWorld', 14],
      'tbsea/riversTribe': ['forgottenTribe', 13], // the sheet names no change
      'tbsea/riversNewWorld': ['newWorld', 12],
      // The set-up diagrams.
      'tbsea/riversFog': ['fogIslands', 12],
      'tbsea/riversDesert': ['throughTheDesert', 14],
      'tbsea/riversDesert2': ['throughTheDesert', 14],
      'tbsea/caravansFour': ['fourIslands', 15], // + 2
      'tbsea/tradersDesert': ['throughTheDesert', 17], // + 3
      'tbsea/barbarianAttackDesert': ['throughTheDesert', 14], // "14 or more VPs"
    };
    const feature: Record<string, string> = {
      'tb/fishermen': 'fish',
      'tb/caravans': 'caravans',
      'tb/rivers': 'rivers',
      'tb/traders': 'traders',
      'tb/barbarianAttack': 'ba',
    };
    expect(SEA_PAIRS.map((p) => p.id).sort()).toEqual(Object.keys(vp).sort());
    for (const pair of SEA_PAIRS) {
      expect(TBSEA_SCENARIOS).toContain(pair.id);
      for (const n of [3, 4]) {
        const s = game(pair.id, n);
        const [key, target] = vp[pair.id] as [string, number];
        expect(rulesOf(s).key, pair.id).toBe(key);
        expect(s.settings.vpToWin, pair.id).toBe(target);
        expect(featuresOf(pair.id)).toEqual([feature[pair.tb]]);
      }
    }
  });

  it('are built on the Seafarers scenario’s own map, so its per-map rules apply', () => {
    const base: Record<string, [string, string]> = {
      'tbsea/fishermenFour': ['four3', 'four4'],
      'tbsea/fishermenFog': ['fog3', 'fog4'],
      'tbsea/fishermenDesert': ['desert3', 'desert4'],
      'tbsea/caravansDesert': ['desert3', 'desert4'],
      'tbsea/fishermenTribe': ['tribe', 'tribe'],
      'tbsea/fishermenCloth': ['cloth', 'cloth'],
      'tbsea/fishermenWonders': ['wonders', 'wonders'],
      'tbsea/fishermenNewWorld': ['newworld', 'newworld'],
    };
    for (const [sc, keys] of Object.entries(base)) {
      for (const [i, n] of [3, 4].entries()) {
        const s = game(sc, n);
        expect(mapKeyOf(s.settings.map), `${sc} ${n}`).toBe(keys[i]);
        expect((mapById(s.settings.map) as { basedOn?: string }).basedOn).toBe(
          `seafarers/${keys[i]}`,
        );
      }
    }
    expect(seaSlice(game('tbsea/fishermenFog')).fog?.terrains.length).toBeGreaterThan(0);
    expect(Object.keys(seaSlice(game('tbsea/fishermenTribe')).gifts ?? {})).toHaveLength(18);
    expect(seaSlice(game('tbsea/fishermenCloth')).cloth).toBeDefined();
    expect(seaSlice(game('tbsea/fishermenWonders')).wonders).toBeDefined();
  });

  it('are for 3-4 players', () => {
    expect(() => game('tbsea/fishermenFour', 5)).toThrow(/players/);
    expect(() => game('tbsea/riversTribe', 2)).toThrow(/players/);
  });
});

// ---------------------------------------------------------------------------------------------
// Fishing on Catan
// ---------------------------------------------------------------------------------------------

const FISHING = SEA_PAIRS.filter((p) => p.tb === 'tb/fishermen').map((p) => p.id);

describe('Fishing on Catan with the Seafarers scenarios', () => {
  it('six fishing grounds 4-10, each at a notch of two land hexes, none sharing a corner', () => {
    for (const sc of FISHING) {
      for (const n of [3, 4]) {
        for (const seed of [1, 2, 3]) {
          const s = game(sc, n, { seed });
          const grounds = tbBoard(s).grounds ?? [];
          const t = topologyOf(s);
          expect(grounds.map((g) => g.number).sort(), sc).toEqual([10, 4, 5, 6, 8, 9]);
          const used = new Set<string>();
          for (const g of grounds) {
            expect(g.vertices).toHaveLength(3);
            for (const v of g.vertices) {
              expect(used.has(v), `${sc}: ${v} twice`).toBe(false);
              used.add(v);
            }
            const tip = t.vertex[g.vertices[0] as VertexId];
            const around = [...(tip?.hexes ?? []), ...(tip?.seas ?? [])];
            expect(
              around.filter((h) => land(s.board.hexes[h]?.terrain)),
              sc,
            ).toHaveLength(2);
            expect(around).toContain(g.hex);
            expect(land(s.board.hexes[g.hex as HexId]?.terrain)).toBe(false);
            expect(s.board.hexes[g.hex as HexId]?.terrain).not.toBe('fog');
          }
        }
      }
    }
  });

  it('no lake on Four Islands, Fog, Cloth, Wonders and New World', () => {
    for (const sc of FISHING.filter((x) => !/Desert|Tribe/.test(x))) {
      expect(tbBoard(game(sc)).lakes ?? [], sc).toEqual([]);
      expect(Object.values(game(sc).board.hexes).some((h) => h.terrain === LAKE)).toBe(false);
    }
  });

  it('Four Islands: 4 and 8 by one small island, 6 and 10 by the other, 5 and 9 by the big ones', () => {
    for (const n of [3, 4]) {
      for (const seed of [1, 2, 3, 4]) {
        const s = game('tbsea/fishermenFour', n, { seed });
        const isl = components(
          Object.values(s.board.hexes)
            .filter((h) => land(h.terrain))
            .map((h) => h.id),
        ).sort((a, b) => a.length - b.length);
        const islandOf = (h: HexId) => isl.findIndex((i) => i.includes(h));
        const where = new Map<number, number>();
        for (const g of tbBoard(s).grounds ?? []) {
          const tip = topologyOf(s).vertex[g.vertices[0] as VertexId];
          const lands = (tip?.hexes ?? []).filter((h) => land(s.board.hexes[h]?.terrain));
          expect(new Set(lands.map(islandOf)).size).toBe(1);
          where.set(g.number, islandOf(lands[0] as HexId));
        }
        expect(where.get(4)).toBe(where.get(8));
        expect(where.get(6)).toBe(where.get(10));
        expect([where.get(4), where.get(6)].sort()).toEqual([0, 1]);
        expect([where.get(5), where.get(9)].sort()).toEqual([2, 3]);
      }
    }
  });

  it('Fog Islands: the grounds lie along the face-up islands', () => {
    for (const n of [3, 4]) {
      const s = game('tbsea/fishermenFog', n);
      for (const g of tbBoard(s).grounds ?? []) {
        const tip = topologyOf(s).vertex[g.vertices[0] as VertexId];
        for (const h of tip?.hexes ?? []) expect(s.board.hexes[h]?.terrain).not.toBe('fog');
      }
    }
  });

  it('Through the Desert (3): the lake replaces the 2 field; the 2 joins the 12 pasture', () => {
    const s = game('tbsea/fishermenDesert', 3);
    const lake = cell('2,4');
    expect(s.board.hexes[lake]?.terrain).toBe(LAKE);
    expect(s.board.hexes[lake]?.token).toBeNull();
    expect(tbBoard(s).lakes).toEqual([{ hex: lake, numbers: [2, 3, 11, 12] }]);
    // The 2025 map prints 12 on the 5,9 pasture (our 5th-edition map: 11).
    expect(tbseaBoard(s.board).extraTokens).toEqual([{ hex: cell('5,9'), number: 2 }]);
    expect(s.board.hexes[cell('5,9')]).toMatchObject({ terrain: 'wool', token: 12 });
  });

  it('Through the Desert (4): the lake replaces the 11 hill; the 11 joins the 2 hill', () => {
    const s = game('tbsea/fishermenDesert', 4);
    expect(s.board.hexes[cell('3,5')]?.terrain).toBe(LAKE);
    expect(tbseaBoard(s.board).extraTokens).toEqual([{ hex: cell('4,12'), number: 11 }]);
    expect(s.board.hexes[cell('4,12')]).toMatchObject({ terrain: 'brick', token: 2 });
  });

  it('a hex with two discs produces on either number, unless the robber is on it', () => {
    const s = main('tbsea/fishermenDesert', 4);
    const hill = cell('4,12');
    settle(s, vertexOf(s, hill), 1);
    s.robber = cell('5,3');
    expect(computeProduction(s, 11)[1]?.brick).toBe(1);
    expect(computeProduction(s, 2)[1]?.brick).toBe(1);
    expect(computeProduction(s, 5)[1]?.brick).toBe(0);
    s.robber = hill;
    expect(computeProduction(s, 11)[1]?.brick).toBe(0);
    s.robber = cell('5,3');
    s.pieces.buildings[vertexOf(s, hill)] = { owner: 1, kind: 'city' };
    expect(computeProduction(s, 11)[1]?.brick).toBe(2);
  });

  it('Forgotten Tribe: the lake replaces the 12 field, the grounds lie around the main island', () => {
    const s = game('tbsea/fishermenTribe');
    expect(s.board.hexes[cell('3,7')]?.terrain).toBe(LAKE);
    const region = seaBoard(s).region;
    for (const g of tbBoard(s).grounds ?? []) {
      const tip = topologyOf(s).vertex[g.vertices[0] as VertexId];
      for (const h of (tip?.hexes ?? []).filter((x) => land(s.board.hexes[x]?.terrain))) {
        expect(region[h]).toBe('M');
      }
    }
  });

  it('Forgotten Tribe: the robber goes on the large island only', () => {
    const s = main('tbsea/fishermenTribe');
    s.phase = { kind: 'moveRobber', resume: 'main' };
    const hexes = legalOf(s, 'moveRobber').map((a) => (a as { hex: HexId }).hex);
    expect(hexes.length).toBeGreaterThan(0);
    for (const h of hexes) expect(seaBoard(s).region[h]).toBe('M');
    fails(s, act('moveRobber', 0, { hex: cell('6,4') }), /robber/);
  });

  it('Cloth for Catan: three grounds by each large island', () => {
    for (const seed of [1, 2, 3]) {
      const s = game('tbsea/fishermenCloth', 4, { seed });
      const region = seaBoard(s).region;
      const big = components(
        Object.values(s.board.hexes)
          .filter((h) => region[h.id] === 'M' && land(h.terrain))
          .map((h) => h.id),
      );
      expect(big).toHaveLength(2);
      const per = [0, 0];
      for (const g of tbBoard(s).grounds ?? []) {
        const tip = topologyOf(s).vertex[g.vertices[0] as VertexId];
        const h = (tip?.hexes ?? []).find((x) => land(s.board.hexes[x]?.terrain)) as HexId;
        const i = big.findIndex((b) => b.includes(h));
        per[i] = (per[i] ?? 0) + 1;
      }
      expect(per).toEqual([3, 3]);
    }
  });

  it('Cloth for Catan: 2 fish remove the pirate only with a route to a village', () => {
    const s = main('tbsea/fishermenCloth');
    fishOf(s).hands[0] = [2];
    expect(legalOf(s, 'tbsea/fishPirate')).toHaveLength(0);
    fails(s, act('tbsea/fishPirate', 0), /route to a village/);
    const cloth = seaSlice(s).cloth;
    if (!cloth) throw new Error('no cloth');
    const village = Object.keys(cloth.villages)[0] as VertexId;
    cloth.links[village] = [0];
    const t = run(s, act('tbsea/fishPirate', 0));
    expect(seaSlice(t).pirate).toBe(OFF_BOARD);
  });

  it('Wonders: no pirate in the scenario, so the 2-fish pirate action never comes up', () => {
    const s = main('tbsea/fishermenWonders');
    fishOf(s).hands[0] = [3, 3];
    expect(seaSlice(s).pirate).toBeNull();
    fails(s, act('tbsea/fishPirate', 0), /not on the board/);
  });

  it('New World: the grounds never share a corner with a harbour', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const s = game('tbsea/fishermenNewWorld', 4, { seed });
      const harbour = new Set(s.board.ports.flatMap((p) => p.vertices));
      for (const g of tbBoard(s).grounds ?? []) {
        for (const v of g.vertices) expect(harbour.has(v), `seed ${seed}`).toBe(false);
      }
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Merchant Trains (our Caravans)
// ---------------------------------------------------------------------------------------------

describe('Merchant Trains with the Seafarers scenarios', () => {
  it('Through the Desert: the watering hole replaces the 2 field (3) / the 11 hill (4)', () => {
    const s3 = game('tbsea/caravansDesert', 3);
    expect(s3.board.hexes[cell('2,4')]?.terrain).toBe(OASIS);
    expect(tbseaBoard(s3.board).extraTokens).toEqual([{ hex: cell('5,9'), number: 2 }]);
    const s4 = game('tbsea/caravansDesert', 4);
    expect(s4.board.hexes[cell('3,5')]?.terrain).toBe(OASIS);
    expect(tbseaBoard(s4.board).extraTokens).toEqual([{ hex: cell('4,12'), number: 11 }]);
    for (const s of [s3, s4]) {
      const starts = tbBoard(s).caravanStarts ?? [];
      expect(starts).toHaveLength(3);
      for (const st of starts) expect(topologyOf(s).edge[st.edge]).toBeDefined();
    }
  });

  it('Forgotten Tribe: the watering hole on the 12 field, the 12 on the 2 pasture', () => {
    const s = game('tbsea/caravansTribe');
    const oasis = cell('3,7');
    expect(s.board.hexes[oasis]?.terrain).toBe(OASIS);
    expect(tbseaBoard(s.board).extraTokens).toEqual([{ hex: cell('3,11'), number: 12 }]);
    expect(s.board.hexes[cell('3,11')]).toMatchObject({ terrain: 'wool', token: 2 });
  });

  it('Forgotten Tribe: the robber starts on the watering hole and may go back there', () => {
    const s = main('tbsea/caravansTribe');
    const oasis = cell('3,7');
    expect(game('tbsea/caravansTribe').robber).toBe(oasis);
    s.robber = cell('3,3');
    s.phase = { kind: 'moveRobber', resume: 'main' };
    expect(legalOf(s, 'moveRobber').map((a) => (a as { hex: HexId }).hex)).toContain(oasis);
    const t = run(s, act('moveRobber', 0, { hex: oasis }));
    expect(t.robber).toBe(oasis);
  });

  it('elsewhere the robber still never stands on the watering hole', () => {
    const s = main('tbsea/caravansDesert', 4);
    s.robber = cell('5,3');
    s.phase = { kind: 'moveRobber', resume: 'main' };
    expect(legalOf(s, 'moveRobber').map((a) => (a as { hex: HexId }).hex)).not.toContain(
      cell('3,5'),
    );
    fails(s, act('moveRobber', 0, { hex: cell('3,5') }), /oasis/);
  });

  it('New World: the watering hole as central as possible, one sea hex out', () => {
    for (const seed of [1, 2, 3]) {
      const s = game('tbsea/caravansNewWorld', 4, { seed });
      const oasis = Object.values(s.board.hexes).filter((h) => h.terrain === OASIS);
      expect(oasis).toHaveLength(1);
      expect(['3,5', '3,7'].map(cell)).toContain(oasis[0]?.id);
      expect(counts(s)).toMatchObject({ sea: 18, grain: 5, brick: 4, ore: 4, wool: 5, lumber: 5 });
      const tokens = Object.values(s.board.hexes).filter((h) => h.token !== null);
      expect(tokens).toHaveLength(23);
      expect(tbBoard(s).caravanStarts).toHaveLength(3);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Rivers of Catan
// ---------------------------------------------------------------------------------------------

/** The rivers of a board as straight lines: swamp first, consecutive hexes neighbours. */
function riversOf(s: GameState): HexId[][] {
  const hexes = tbBoard(s).rivers ?? [];
  return [hexes.slice(0, 4), hexes.slice(4)];
}

const near = (a: HexId, b: HexId) => hexDistance(parseHexId(a), parseHexId(b)) <= 1;

describe('Rivers of Catan with the Seafarers scenarios', () => {
  it('Forgotten Tribe: 7 river hexes on the large island, swamps flowing into the sea, apart', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const s = game('tbsea/riversTribe', 4, { seed });
      const region = seaBoard(s).region;
      const [r1, r2] = riversOf(s) as [HexId[], HexId[]];
      expect(r1).toHaveLength(4);
      expect(r2).toHaveLength(3);
      for (const r of [r1, r2]) {
        expect(s.board.hexes[r[0] as HexId]?.terrain).toBe(SWAMP);
        for (const h of r) expect(region[h]).toBe('M');
        for (let i = 0; i + 1 < r.length; i++)
          expect(near(r[i] as HexId, r[i + 1] as HexId)).toBe(true);
        const { q, r: rr } = parseHexId(r[0] as HexId);
        const water = SIDES.some((side) => {
          const n = neighbor(q, rr, side);
          return !land(s.board.hexes[hexId(n.q, n.r)]?.terrain);
        });
        expect(water).toBe(true);
      }
      for (const a of r1) for (const b of r2) expect(near(a, b), `seed ${seed}`).toBe(false);
      expect(tbBoard(s).bridgeSites).toHaveLength(7);
      expect(s.board.hexes[s.robber]?.terrain).toBe(SWAMP);
    }
  });

  it('Forgotten Tribe: 2 hills, 2 pastures, 1 field and 2 mountains make way for the rivers', () => {
    const s = game('tbsea/riversTribe');
    const region = seaBoard(s).region;
    expect(counts(s, (h) => region[h] === 'M')).toEqual({
      lumber: 4,
      grain: 3,
      ore: 3,
      wool: 3,
      brick: 3,
      [SWAMP]: 2,
    });
  });

  it('Forgotten Tribe: numbers without the 2 and 12, which join the lowest-ranking pasture or field', () => {
    for (const seed of [1, 2, 3, 4]) {
      const s = game('tbsea/riversTribe', 3, { seed });
      const region = seaBoard(s).region;
      const main = Object.values(s.board.hexes).filter((h) => region[h.id] === 'M');
      for (const h of main) {
        expect(h.token === null, h.id).toBe(h.terrain === SWAMP);
        expect([2, 12]).not.toContain(h.token);
      }
      const extra = tbseaBoard(s.board).extraTokens ?? [];
      expect(extra.map((x) => x.number)).toEqual([2, 12]);
      const pips = (n: number) => 6 - Math.abs(7 - n);
      const fields = main.filter((h) => h.terrain === 'wool' || h.terrain === 'grain');
      const low = Math.min(...fields.map((h) => pips(h.token as number)));
      for (const x of extra) {
        const h = s.board.hexes[x.hex];
        expect(['wool', 'grain']).toContain(h?.terrain);
        expect(pips(h?.token as number), `seed ${seed}`).toBeLessThanOrEqual(
          low + (x.number === 12 ? 1 : 0),
        );
      }
      expect(extra[0]?.hex).not.toBe(extra[1]?.hex);
    }
  });

  it('New World: 2 hills, 1 pasture, 2 mountains and 2 sea hexes make way; the rivers flow into the frame', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const s = game('tbsea/riversNewWorld', 4, { seed });
      expect(counts(s)).toMatchObject({
        sea: 17,
        grain: 5,
        brick: 4,
        ore: 4,
        wool: 5,
        lumber: 5,
        [SWAMP]: 2,
      });
      const inside = new Set(seaBoard(s).inside);
      const [r1, r2] = riversOf(s) as [HexId[], HexId[]];
      for (const r of [r1, r2]) {
        const { q, r: rr } = parseHexId(r[0] as HexId);
        const frame = SIDES.some((side) => {
          const n = neighbor(q, rr, side);
          return !inside.has(hexId(n.q, n.r));
        });
        expect(frame, `seed ${seed}`).toBe(true);
      }
      for (const a of r1) for (const b of r2) expect(near(a, b)).toBe(false);
      const tokens = Object.values(s.board.hexes).filter((h) => h.token !== null);
      expect(tokens).toHaveLength(23);
      expect(tbBoard(s).bridgeSites).toHaveLength(7);
    }
  });

  it('gold fields produce resource cards, never gold coins', () => {
    const s = main('tbsea/riversTribe');
    const gold = Object.values(s.board.hexes).find((h) => h.terrain === 'gold');
    if (!gold) throw new Error('no gold field');
    gold.token = 5;
    settle(s, vertexOf(s, gold.id), 1);
    const d = cloneState(s);
    d.phase = tbseaModule.hooks?.afterProduction?.(d, 5, []) ?? { kind: 'main' };
    // Seafarers' choice of a resource card; T&B's gold coins untouched.
    expect(d.phase.kind).toBe('seafarers/gold');
    expect((d.phase as { pending: number[] }).pending[1]).toBe(1);
    expect(goldOf(d, 1)).toBe(0);
    expect(legalActions(d).every((a) => a.player === 1)).toBe(true);
  });
});
