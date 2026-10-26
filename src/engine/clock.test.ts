import { describe, expect, it } from 'vitest';
import {
  TIMER_PRESET_VALUES,
  chargeBank,
  creditIncrement,
  initialBanks,
  restoreBanks,
  timerOf,
  timerSettings,
  turnKey,
} from './clock';
import { createGame } from './createGame';
import { applyAction } from './engine';
import { FIXTURE_PLAYERS, freshGame, midGame } from './fixtures';
import type { GameState } from './types';

const game = (timer: Parameters<typeof createGame>[0]['timer']) =>
  createGame({ seed: 1, players: FIXTURE_PLAYERS, map: 'base', timer });

describe('timer presets', () => {
  it('classic is a 20 min bank plus 30 s per turn', () => {
    expect(TIMER_PRESET_VALUES.classic).toEqual({ bankSec: 1200, incrementSec: 30 });
    expect(timerSettings('classic')).toEqual({
      preset: 'classic',
      bankSec: 1200,
      incrementSec: 30,
    });
    expect(timerSettings('off')).toBeNull();
  });

  it('presets get shorter from classic to bullet', () => {
    const order = ['bullet', 'blitz', 'rapid', 'classic'] as const;
    for (let i = 1; i < order.length; i++) {
      expect(TIMER_PRESET_VALUES[order[i]!].bankSec).toBeGreaterThan(
        TIMER_PRESET_VALUES[order[i - 1]!].bankSec,
      );
    }
  });

  it('custom validates bank and increment', () => {
    expect(timerSettings('custom', { bankSec: 600, incrementSec: 0 })).toEqual({
      preset: 'custom',
      bankSec: 600,
      incrementSec: 0,
    });
    expect(() => timerSettings('custom')).toThrow();
    expect(() => timerSettings('custom', { bankSec: 5, incrementSec: 10 })).toThrow();
    expect(() => timerSettings('custom', { bankSec: 600, incrementSec: -1 })).toThrow();
  });

  it('createGame stores the clock; it excludes the legacy per-turn timer', () => {
    const s = game(timerSettings('blitz'));
    expect(s.settings.timer).toEqual(timerSettings('blitz'));
    expect(timerOf(s.settings)).toMatchObject({ kind: 'bank', preset: 'blitz' });
    expect(() =>
      createGame({
        seed: 1,
        players: FIXTURE_PLAYERS,
        timer: timerSettings('blitz'),
        turnTimerSec: 30,
      }),
    ).toThrow();
  });

  it('timerOf reads old saves: turnTimerSec is the legacy per-turn timer', () => {
    expect(timerOf(freshGame().settings)).toEqual({ kind: 'off' });
    const legacy = { ...freshGame().settings, turnTimerSec: 45 };
    expect(timerOf(legacy)).toEqual({ kind: 'perTurn', sec: 45 });
  });
});

describe('banks', () => {
  const settings = game(timerSettings('classic')).settings;

  it('start full, run down, never below 0', () => {
    const b = initialBanks(settings, 4);
    expect(b).toEqual([1_200_000, 1_200_000, 1_200_000, 1_200_000]);
    expect(chargeBank(b, 2, 1000)[2]).toBe(1_199_000);
    expect(chargeBank(b, 2, 5_000_000)[2]).toBe(0);
    expect(chargeBank(b, 2, 0)).toBe(b);
  });

  it('credit the increment to the player whose turn just ended', () => {
    const before = midGame(); // Blue, turn 12, main
    const r = applyAction(before, { type: 'endTurn', player: 1 });
    if (!r.ok) throw new Error(r.error);
    const b = initialBanks(settings, 4);
    const after = creditIncrement(settings, b, before, r.state);
    expect(after[1]).toBe(b[1]! + 30_000);
    expect(after.filter((_, i) => i !== 1)).toEqual([1_200_000, 1_200_000, 1_200_000]);
    // No turn change: nothing credited.
    expect(creditIncrement(settings, b, before, before)).toBe(b);
  });

  it('each setup placement is a turn', () => {
    const s: GameState = freshGame();
    expect(turnKey(s)).toEqual({ key: 'setup:0', player: 0 });
  });

  it('restore banks from a save, or start fresh when malformed', () => {
    expect(restoreBanks([1, 2, 3, 4], settings, 4)).toEqual([1, 2, 3, 4]);
    expect(restoreBanks([1, 2, 3], settings, 4)).toEqual(initialBanks(settings, 4));
    expect(restoreBanks(['x', 2, 3, 4], settings, 4)).toEqual(initialBanks(settings, 4));
  });
});
