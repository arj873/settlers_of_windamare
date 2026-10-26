import { describe, expect, it } from 'vitest';
import { cloneState } from './clone';
import {
  discardGame,
  freshGame,
  gameOverGame,
  midGame,
  moveRobberGame,
  setupInProgressGame,
  tradeOfferGame,
} from './fixtures';
import type { GameState } from './types';

const FIXTURES: GameState[] = [
  freshGame(3),
  freshGame(4),
  setupInProgressGame(),
  midGame(),
  discardGame(),
  moveRobberGame(),
  tradeOfferGame(),
  gameOverGame(),
  (() => {
    const s = midGame();
    s.phase = { kind: 'steal', candidates: [0, 3], resume: 'main' };
    return s;
  })(),
];

/** Paths of objects/arrays that `a` and `b` share by reference (outside the allowed ones). */
function sharedPaths(a: unknown, b: unknown, path = '$'): string[] {
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) return [];
  if (path === '$.board' || path === '$.settings' || path === '$.stats') return [];
  if (/^\$\.log\[\d+\]$/.test(path)) return [];
  if (a === b) return [path];
  const out: string[] = [];
  for (const k of Object.keys(a)) {
    out.push(
      ...sharedPaths(
        (a as Record<string, unknown>)[k],
        (b as Record<string, unknown>)[k],
        Array.isArray(a) ? `${path}[${k}]` : `${path}.${k}`,
      ),
    );
  }
  return out;
}

describe('cloneState', () => {
  it('returns an equal state', () => {
    for (const s of FIXTURES) expect(cloneState(s)).toEqual(s);
  });

  it('shares nothing mutable: only board, settings, stats and log entries (all immutable)', () => {
    for (const s of FIXTURES) {
      const c = cloneState(s);
      expect(sharedPaths(s, c)).toEqual([]);
      expect(c.board).toBe(s.board);
      expect(c.log).not.toBe(s.log);
    }
  });

  it('copies every top-level field of GameState (fails when a new field is not copied)', () => {
    for (const s of FIXTURES)
      expect(Object.keys(cloneState(s)).sort()).toEqual(Object.keys(s).sort());
  });
});
