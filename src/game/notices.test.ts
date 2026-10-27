import { describe, expect, it } from 'vitest';
import type { GameState, LogEntry } from '../engine';
import { midGame } from '../engine/fixtures';
import { emitGameNotice, gameNotices, onGameNotice, type GameNotice } from './notices';

/** midGame (Red 0, Blue 1, White 2, Orange 3; Red holds Longest Road, White Largest Army). */
const withLog = (s: GameState, ...entries: LogEntry[]): GameState => ({
  ...s,
  log: [...s.log, ...entries],
});

describe('gameNotices', () => {
  const prev = midGame();
  const steal: LogEntry = {
    turn: 12,
    player: 1,
    text: 'Blue stole from Red',
    secret: [{ to: [1, 0], text: 'Blue stole 1 ore from Red' }],
  };

  it('steal (#32): thief and victim, in their own words; nobody else', () => {
    const next = withLog(prev, steal);
    expect(gameNotices(prev, next, 1)).toEqual([
      { kind: 'steal', text: 'You stole 1 ore from Red' },
    ]);
    expect(gameNotices(prev, next, 0)).toEqual([
      { kind: 'steal', text: 'Blue stole 1 ore from you' },
    ]);
    expect(gameNotices(prev, next, 2)).toEqual([]);
    expect(gameNotices(prev, next, null)).toEqual([]);
  });

  it('award (#36): who took it from whom; lost; first holder', () => {
    const next = { ...prev, awards: { longestRoad: 1, largestArmy: 2 } };
    expect(gameNotices(prev, next, 3)).toEqual([
      {
        kind: 'award',
        award: 'longestRoad',
        label: 'Longest Road',
        to: 1,
        from: 0,
        text: 'Blue took Longest Road from Red',
      },
    ]);
    expect(gameNotices(prev, next, 0)[0]?.text).toBe('Blue took Longest Road from you');
    expect(gameNotices(prev, next, 1)[0]?.text).toBe('You took Longest Road from Red');
    const lost = { ...prev, awards: { longestRoad: null, largestArmy: 2 } };
    expect(gameNotices(prev, lost, 3)[0]?.text).toBe('Red lost Longest Road; nobody holds it');
    const first = { ...prev, awards: { longestRoad: 0, largestArmy: null } };
    expect(gameNotices(first, prev, 3)[0]).toMatchObject({
      award: 'largestArmy',
      from: null,
      text: 'White took Largest Army',
    });
  });

  it('expansion titles from the log (C&K metropolis, Harbormaster)', () => {
    const next = withLog(
      prev,
      { turn: 12, player: 1, text: 'Blue took the science metropolis from Orange' },
      { turn: 12, player: 1, text: 'Blue became Harbormaster' },
    );
    expect(gameNotices(prev, next, 3)).toEqual([
      {
        kind: 'award',
        award: 'other',
        label: 'science metropolis',
        to: 1,
        from: 3,
        text: 'Blue took the science metropolis from you',
      },
      {
        kind: 'award',
        award: 'other',
        label: 'Harbormaster',
        to: 1,
        from: null,
        text: 'Blue became Harbormaster',
      },
    ]);
  });

  it('nothing for the same state or another game', () => {
    expect(gameNotices(prev, prev, 1)).toEqual([]);
    const rematch = { ...withLog(prev, steal), turn: { ...prev.turn, number: 1 } };
    expect(gameNotices(prev, rematch, 1)).toEqual([]);
  });

  it('listeners get every emitted notice until they unsubscribe', () => {
    const got: GameNotice[] = [];
    const off = onGameNotice((n) => got.push(n));
    emitGameNotice({ kind: 'steal', text: 'x' });
    off();
    emitGameNotice({ kind: 'steal', text: 'y' });
    expect(got).toEqual([{ kind: 'steal', text: 'x' }]);
  });
});
