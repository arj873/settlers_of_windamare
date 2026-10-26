import { describe, expect, it } from 'vitest';
import { defaultMaxSteps, emptyStats, main, parseArgs, record } from './sim';
import type { GameResult } from './runner';
import { midGame } from '../engine/fixtures';

const result = (over: Partial<GameResult>): GameResult => ({
  outcome: 'finished',
  steps: 10,
  turns: 20,
  winner: 1,
  failure: null,
  history: [],
  finalState: midGame(),
  ...over,
});

describe('parseArgs', () => {
  it('has sensible defaults', () => {
    expect(parseArgs([])).toMatchObject({ games: 10, seed: 1, players: 4, bias: 0, replay: null });
  });
  it('parses both "--k v" and "--k=v", ignoring a bare "--"', () => {
    const a = parseArgs([
      '--',
      '--games',
      '5',
      '--seed=42',
      '--players',
      '3',
      '--max-steps=99',
      '--verbose',
    ]);
    expect(a).toMatchObject({ games: 5, seed: 42, players: 3, maxSteps: 99, verbose: true });
  });
  it('parses --map, the --layout alias and up to 8 players', () => {
    expect(parseArgs([]).map).toBeNull();
    expect(parseArgs(['--map', 'base78', '--players', '8'])).toMatchObject({
      map: 'base78',
      players: 8,
    });
    expect(parseArgs(['--layout', 'beginner']).map).toBe('base');
    expect(parseArgs(['--layout=random']).map).toBe('baseRandom');
  });
  it('rejects bad input', () => {
    expect(() => parseArgs(['--players', '9'])).toThrow();
    expect(() => parseArgs(['--players', '1'])).toThrow();
    expect(() => parseArgs(['--map', 'huge'])).toThrow();
    expect(() => parseArgs(['--games', '0'])).toThrow();
    expect(() => parseArgs(['--bias', '1.5'])).toThrow();
    expect(() => parseArgs(['--games'])).toThrow();
    expect(() => parseArgs(['--nope'])).toThrow();
    expect(() => parseArgs(['--sbp', 'maybe'])).toThrow();
  });

  it('parses the T13 rule flags; max steps default grows with the player count', () => {
    expect(parseArgs([])).toMatchObject({ sbp: null, balancedDice: false, maxSteps: null });
    expect(parseArgs(['--sbp', 'off', '--balanced-dice'])).toMatchObject({
      sbp: false,
      balancedDice: true,
    });
    expect(parseArgs(['--sbp=on']).sbp).toBe(true);
    expect([3, 4, 5, 6, 7, 8].map(defaultMaxSteps)).toEqual([
      5000, 5000, 15000, 15000, 30000, 30000,
    ]);
  });
});

describe('record', () => {
  it('tallies finishes, wins, stalls, errors and invariant failures', () => {
    const s = emptyStats(4);
    const failure = (kind: 'stall' | 'illegal-action' | 'invariant') => ({
      kind,
      step: 0,
      action: null,
      message: '',
      violations: kind === 'invariant' ? [{ code: 'robber-position' as const, message: 'x' }] : [],
      stateBefore: midGame(),
      stateAfter: null,
    });
    expect(record(s, 1, result({}))).toBe(false);
    expect(record(s, 2, result({ outcome: 'maxSteps', winner: null }))).toBe(false);
    expect(record(s, 3, result({ outcome: 'failed', failure: failure('stall') }))).toBe(true);
    expect(record(s, 4, result({ outcome: 'failed', failure: failure('illegal-action') }))).toBe(
      true,
    );
    expect(record(s, 5, result({ outcome: 'failed', failure: failure('invariant') }))).toBe(true);
    expect(s).toMatchObject({
      games: 5,
      finished: 1,
      maxSteps: 1,
      stalls: 1,
      errors: 1,
      invariantFailures: 1,
      failedSeeds: [3, 4, 5],
      violationCodes: { 'robber-position': 1 },
      totalTurnsFinished: 20,
    });
    expect(s.wins).toEqual([0, 1, 0, 0]);
  });
});

describe('main', () => {
  it('exits 2 on bad usage and 0 on --help', () => {
    const quiet = () => {};
    const err = console.error;
    console.error = quiet;
    try {
      expect(main(['--players', '9'], quiet)).toBe(2);
    } finally {
      console.error = err;
    }
    expect(main(['--help'], quiet)).toBe(0);
  });
});
