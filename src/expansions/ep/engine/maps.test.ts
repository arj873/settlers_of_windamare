import { describe, expect, it } from 'vitest';
import { generateBoard } from '../../../engine/board';
import { isResource } from '../../../engine/resources';
import { Rng } from '../../../engine/rng';
import { topologyFor } from '../../../engine/topology';
import type { GameState, HexId } from '../../../engine/types';
import { graph, isCoastal, staticOf } from './geometry';
import {
  decksOf,
  DISCS,
  mapIdOf,
  MAP_KEYS,
  prepared,
  specOf,
  T,
  type Content,
  type EpBoard,
  type MapKey,
} from './maps';
import { epGame } from './testkit';

const isLand = (c: Content) => typeof c === 'string' && isResource(c);

describe('E&P maps (rules doc §2, §8.3, appendix)', () => {
  // Every position: island (incl. printed pasture) + regions + Council + face-up sea + printed sea.
  const POSITIONS: Record<MapKey, number> = {
    landHo: 51,
    pirateLairs: 58,
    fish: 58,
    spices: 65,
    full: 72,
    pirateLairs56: 79,
    fish56: 88,
    spices56: 88,
    full56: 97,
  };
  const REGION: Record<MapKey, number> = {
    landHo: 8,
    pirateLairs: 11,
    fish: 11,
    spices: 13,
    full: 16,
    pirateLairs56: 14,
    fish56: 16,
    spices56: 16,
    full56: 20,
  };

  it.each(MAP_KEYS)('%s: position, island, region and deck counts', (key) => {
    const p = prepared(key);
    const big = specOf(key).big;
    expect(p.inside).toHaveLength(POSITIONS[key]);
    expect(p.island).toHaveLength(big ? 22 : 15);
    expect(p.parrot).toHaveLength(REGION[key]);
    expect(p.goose).toHaveLength(REGION[key]);
    const decks = decksOf(key);
    const used = decks.parrotShoalsUsed;
    expect(decks.parrot.length - (used === undefined ? 0 : 3 - used)).toBe(REGION[key]);
    expect(decks.goose).toHaveLength(REGION[key]);
    // One number disc per land hex of each deck.
    const discs = big ? DISCS.big : DISCS.small;
    expect(decks.parrot.filter(isLand)).toHaveLength(discs.parrot.length);
    expect(decks.goose.filter(isLand)).toHaveLength(discs.goose.length);
  });

  it('island numbers match the component tables (15 discs for 3-4, 22 for 5-6)', () => {
    const tokens = (key: MapKey) =>
      prepared(key)
        .island.map((i) => i.token)
        .sort((a, b) => a - b);
    expect(tokens('full')).toEqual([3, 3, 4, 4, 5, 6, 6, 8, 8, 9, 10, 10, 11, 11, 12]);
    expect(tokens('full56')).toEqual([
      2, 3, 3, 4, 4, 4, 5, 5, 6, 6, 6, 8, 8, 8, 9, 9, 10, 10, 10, 11, 11, 12,
    ]);
  });

  it('5-6 regions mirror each other top to bottom; 3-4 too', () => {
    for (const key of MAP_KEYS) {
      const spec = specOf(key);
      const mid = spec.big ? 4 : 3;
      const north = spec.parrot.map(([c, r]) => `${c},${2 * mid - r}`).sort();
      expect(spec.goose.map(([c, r]) => `${c},${r}`).sort(), key).toEqual(north);
    }
  });

  it.each(MAP_KEYS)('%s generates; harbor start spots are coastal island corners', (key) => {
    const { board } = generateBoard(mapIdOf(key), Rng.fromSeed(3), specOf(key).big ? 5 : 4);
    const ext = board.ext?.ep as EpBoard;
    expect(ext.harborSpots).toHaveLength(specOf(key).big ? 18 : 14);
    const s = {
      settings: { map: mapIdOf(key), expansions: ['ep'] },
      board,
    } as unknown as GameState;
    const island = new Set(ext.island);
    for (const v of ext.harborSpots) {
      expect(isCoastal(s, v), v).toBe(true);
      expect(
        (graph(s).hexesAt.get(v) ?? []).some((h) => island.has(h)),
        v,
      ).toBe(true);
    }
    // The printed pasture with its 6 at the west end of the middle row.
    const printed = prepared(key).island.find((i) => i.printed);
    expect(board.hexes[printed?.hex as HexId]).toMatchObject({ terrain: 'wool', token: 6 });
    // Face-down hexes show only their back.
    const backs = Object.values(board.hexes).filter(
      (t) => t.terrain === T.parrot || t.terrain === T.goose,
    );
    expect(backs).toHaveLength(prepared(key).parrot.length * 2);
  });

  it('the Council of Catan touches exactly one island hex (the one to its west)', () => {
    for (const key of ['fish', 'spices', 'full', 'fish56', 'full56'] as MapKey[]) {
      const p = prepared(key);
      const council = p.council as HexId;
      const topo = topologyFor(mapIdOf(key));
      const island = new Set(p.island.map((i) => i.hex));
      const touching = (topo.hex[council]?.neighbors ?? []).filter((h) => island.has(h));
      expect(touching, key).toHaveLength(1);
    }
    expect(prepared('landHo').council).toBeNull();
    expect(prepared('pirateLairs').council).toBeNull();
  });

  it('Land Ho! and Pirate Lairs (3-4) have a fixed island; Fish, Spices and the full game a random one', () => {
    const terrains = (key: MapKey, seed: number) => {
      const { board } = generateBoard(mapIdOf(key), Rng.fromSeed(seed), 4);
      return prepared(key).island.map((i) => board.hexes[i.hex]?.terrain);
    };
    expect(terrains('landHo', 1)).toEqual(terrains('landHo', 2));
    expect(terrains('pirateLairs', 1)).toEqual(terrains('pirateLairs', 2));
    expect(terrains('full', 1)).not.toEqual(terrains('full', 2));
    // The pool: 2 hills, 4 forests, 4 pastures (one printed), 2 fields, 3 mountains.
    const count = (list: unknown[], t: string) => list.filter((x) => x === t).length;
    const t = terrains('full', 5);
    expect([
      count(t, 'brick'),
      count(t, 'lumber'),
      count(t, 'wool'),
      count(t, 'grain'),
      count(t, 'ore'),
    ]).toEqual([2, 4, 4, 2, 3]);
  });

  it('a game deals every face-down hex its hidden content (no leftovers, no reuse)', () => {
    const s = epGame('full');
    const slice = s.ext.ep as { hidden: Record<HexId, { terrain: string; shoal?: number }> };
    expect(Object.keys(slice.hidden)).toHaveLength(32);
    const shoals = Object.values(slice.hidden).flatMap((h) =>
      h.shoal === undefined ? [] : [h.shoal],
    );
    expect(shoals.sort()).toEqual([1, 2, 3, 4, 5, 6]);
    expect(staticOf(s).island.size).toBe(15);
  });
});
