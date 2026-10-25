import { describe, expect, it } from 'vitest';
import { beginnerBoard, randomBoard, redNumbersSeparated, type GeneratedBoard } from './board';
import { NUMBER_TOKENS, PORT_KINDS, TERRAIN_COUNTS } from './constants';
import { Rng } from './rng';
import { TOPOLOGY } from './topology';
import type { Terrain } from './types';

function checkBoard({ board, robber }: GeneratedBoard) {
  const hexes = Object.values(board.hexes);
  expect(hexes).toHaveLength(19);
  expect(Object.keys(board.hexes).sort()).toEqual([...TOPOLOGY.landHexes].sort());

  const terrainCounts: Partial<Record<Terrain, number>> = {};
  for (const h of hexes) terrainCounts[h.terrain] = (terrainCounts[h.terrain] ?? 0) + 1;
  expect(terrainCounts).toEqual(TERRAIN_COUNTS);

  const tokens = hexes.flatMap((h) => (h.token === null ? [] : [h.token]));
  expect(tokens.sort((a, b) => a - b)).toEqual([...NUMBER_TOKENS]);

  for (const h of hexes) expect(h.token === null).toBe(h.terrain === 'desert');
  expect(board.hexes[robber]?.terrain).toBe('desert');
  expect(redNumbersSeparated(board.hexes)).toBe(true);

  expect(board.ports).toHaveLength(9);
  expect(board.ports.map((p) => p.kind).sort()).toEqual([...PORT_KINDS].sort());
  board.ports.forEach((p, i) => expect(p.edge).toBe(TOPOLOGY.portSlots[i]?.edge));
}

describe('beginner board', () => {
  it('satisfies all constraints', () => checkBoard(beginnerBoard()));

  it('matches the rulebook rows', () => {
    const { board } = beginnerBoard();
    const row = (r: number) =>
      TOPOLOGY.landHexes
        .map((id) => board.hexes[id])
        .filter((h) => h?.r === r)
        .map((h) => `${h?.terrain}${h?.token ?? ''}`);
    expect(row(-2)).toEqual(['ore10', 'wool2', 'lumber9']);
    expect(row(0)).toEqual(['grain9', 'lumber11', 'desert', 'lumber3', 'ore8']);
    expect(row(2)).toEqual(['brick5', 'grain6', 'wool11']);
  });
});

describe('random board', () => {
  it('satisfies all constraints over many seeds', () => {
    for (let seed = 0; seed < 500; seed++) checkBoard(randomBoard(Rng.fromSeed(seed)));
  });

  it('is deterministic per seed and varies across seeds', () => {
    expect(randomBoard(Rng.fromSeed(5))).toEqual(randomBoard(Rng.fromSeed(5)));
    expect(randomBoard(Rng.fromSeed(5))).not.toEqual(randomBoard(Rng.fromSeed(6)));
  });

  it('detects adjacent red numbers', () => {
    const { board } = beginnerBoard();
    const [a, b] = ['h:0,0', 'h:1,0'] as const;
    const hexes = structuredClone(board.hexes);
    hexes[a] = { ...hexes[a]!, token: 6 };
    hexes[b] = { ...hexes[b]!, token: 8 };
    expect(redNumbersSeparated(hexes)).toBe(false);
  });
});
