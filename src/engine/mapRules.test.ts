import { describe, expect, it } from 'vitest';
import { beginnerBoard, generateBoard, mapRuleViolations, randomBoard } from './board';
import { createGame } from './createGame';
import { MAPS, MAP_IDS } from './maps';
import { Rng } from './rng';
import type { MapId, MapRules } from './types';

const RANDOM_MAPS = MAP_IDS.filter((m) => MAPS[m].layout === 'random');
const SEEDS = 150;

const ALL_ALLOWED: MapRules = {
  allowRedTouch: true,
  allowExtremeTouch: true,
  allowSameNumberTouch: true,
  allowSameResourceTouch: true,
};

describe('map rules: default (everything constrained)', () => {
  for (const map of RANDOM_MAPS) {
    it(`${map}: no touching 6/8, 2/12, equal numbers or equal resources, ${SEEDS} seeds`, () => {
      for (let seed = 0; seed < SEEDS; seed++) {
        const { board } = randomBoard(Rng.fromSeed(seed), map);
        expect(mapRuleViolations(board.hexes, map), `seed ${seed}`).toEqual({
          red: 0,
          extreme: 0,
          sameNumber: 0,
          sameResource: 0,
        });
      }
    });
  }

  it('keeps the official component counts', () => {
    for (const map of RANDOM_MAPS) {
      const { board } = randomBoard(Rng.fromSeed(3), map);
      const hexes = Object.values(board.hexes);
      const terrain = (t: string) => hexes.filter((h) => h.terrain === t).length;
      for (const [t, n] of Object.entries(MAPS[map].terrain)) expect(terrain(t)).toBe(n);
      const tokens = hexes
        .flatMap((h) => (h.token === null ? [] : [h.token]))
        .sort((a, b) => a - b);
      expect(tokens).toEqual([...MAPS[map].tokens].sort((a, b) => a - b));
    }
  });
});

describe('map rules: each allow-flag lifts exactly its own rule', () => {
  const cases: [keyof MapRules, keyof ReturnType<typeof mapRuleViolations>][] = [
    ['allowRedTouch', 'red'],
    ['allowExtremeTouch', 'extreme'],
    ['allowSameNumberTouch', 'sameNumber'],
    ['allowSameResourceTouch', 'sameResource'],
  ];
  for (const [flag, key] of cases) {
    it(`${flag}: the others still hold, and ${key} pairs do occur`, () => {
      let seen = 0;
      for (const map of RANDOM_MAPS) {
        for (let seed = 0; seed < 60; seed++) {
          const { board } = randomBoard(Rng.fromSeed(seed), map, { [flag]: true });
          const v = mapRuleViolations(board.hexes, map);
          for (const other of Object.keys(v) as (keyof typeof v)[]) {
            if (other !== key) expect(v[other], `${map} seed ${seed} ${other}`).toBe(0);
          }
          seen += v[key];
        }
      }
      expect(seen).toBeGreaterThan(0);
    });
  }

  it('everything allowed is a plain shuffle (violations show up)', () => {
    let total = 0;
    for (let seed = 0; seed < 40; seed++) {
      const v = mapRuleViolations(
        randomBoard(Rng.fromSeed(seed), 'base56', ALL_ALLOWED).board.hexes,
        'base56',
      );
      total += v.red + v.extreme + v.sameNumber + v.sameResource;
    }
    expect(total).toBeGreaterThan(0);
  });
});

describe('map rules: determinism and the fixed map', () => {
  it('same seed, same board; different seeds differ', () => {
    for (const map of RANDOM_MAPS) {
      expect(randomBoard(Rng.fromSeed(9), map)).toEqual(randomBoard(Rng.fromSeed(9), map));
      expect(randomBoard(Rng.fromSeed(9), map)).not.toEqual(randomBoard(Rng.fromSeed(10), map));
    }
  });

  it('the beginner layout ignores the rules (it is official)', () => {
    const fixed = beginnerBoard();
    expect(generateBoard('base', Rng.fromSeed(1), {}).board).toEqual(fixed.board);
    expect(generateBoard('base', Rng.fromSeed(2), ALL_ALLOWED).board).toEqual(fixed.board);
    // The official layout itself touches equal numbers/resources? It must stay exactly as printed.
    expect(fixed.board.hexes['h:0,0']?.terrain).toBe('desert');
  });

  it('terminates on the biggest board with every rule on (vitest times out otherwise)', () => {
    for (let seed = 0; seed < 100; seed++) randomBoard(Rng.fromSeed(`t${seed}`), 'base78');
  });

  it('the first desert is the robber start when asked', () => {
    for (let seed = 0; seed < 30; seed++) {
      const { board, robber } = randomBoard(Rng.fromSeed(seed), 'base56', {}, true);
      const first = Object.values(board.hexes).find((h) => h.terrain === 'desert');
      expect(first).toBeDefined();
      // landHexes order = hex ids in insertion order of board.hexes
      expect(robber).toBe(first?.id);
    }
  });
});

describe('map rules in settings', () => {
  const players = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ name: `P${i}`, color: `c${i}` }));

  it('default games store nothing; only true flags are stored', () => {
    const base = createGame({ seed: 1, players: players(4) });
    expect(base.settings.mapRules).toBeUndefined();
    const g = createGame({
      seed: 1,
      players: players(4),
      mapRules: { allowRedTouch: true, allowExtremeTouch: false },
    });
    expect(g.settings.mapRules).toEqual({ allowRedTouch: true });
  });

  it('rejects unknown keys and non-booleans', () => {
    expect(() =>
      createGame({ seed: 1, players: players(4), mapRules: { nope: true } as MapRules }),
    ).toThrow(/unknown map rule/);
    expect(() =>
      createGame({
        seed: 1,
        players: players(4),
        mapRules: { allowRedTouch: 1 } as unknown as MapRules,
      }),
    ).toThrow(/true or false/);
  });

  it('createGame honours the rules on a random map', () => {
    for (const [n, map] of [
      [4, 'baseRandom'],
      [6, 'base56'],
      [8, 'base78'],
    ] as [number, MapId][]) {
      const g = createGame({ seed: 5, players: players(n), map });
      expect(mapRuleViolations(g.board.hexes, map)).toEqual({
        red: 0,
        extreme: 0,
        sameNumber: 0,
        sameResource: 0,
      });
    }
  });
});
