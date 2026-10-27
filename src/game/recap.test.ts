import { describe, expect, it } from 'vitest';
import type { GameState } from '../engine';
import { midGame } from '../engine/fixtures';
import { TurnRecap } from './recap';

const at = (base: GameState, number: number, current: number): GameState => ({
  ...base,
  turn: { ...base.turn, number, current },
});

describe('TurnRecap (#33)', () => {
  const s = midGame();

  it('recaps from where the viewer’s last turn ended when their next turn starts', () => {
    const r = new TurnRecap();
    const mine = at(s, 5, 1);
    const ended = at(s, 6, 2); // Blue (1) ended turn 5
    expect(r.update(mine, ended, 1)).toBeNull();
    const t7 = at(s, 7, 3);
    expect(r.update(ended, t7, 1)).toBeNull();
    const t8 = at(s, 8, 0);
    expect(r.update(t7, t8, 1)).toBeNull();
    const back = at(s, 9, 1);
    expect(r.update(t8, back, 1)).toBe(ended);
    // Only once per turn.
    expect(r.update(back, back, 1)).toBeNull();
  });

  it('nothing without a previous turn, for spectators, or in another game', () => {
    const r = new TurnRecap();
    expect(r.update(null, at(s, 3, 1), 1)).toBeNull();
    expect(r.update(at(s, 3, 1), at(s, 4, 2), null)).toBeNull();
    expect(r.update(at(s, 4, 2), at(s, 5, 1), -1)).toBeNull();
    // The viewer never ended a turn yet: nothing to recap.
    expect(new TurnRecap().update(at(s, 5, 0), at(s, 6, 1), 1)).toBeNull();
    // A rematch (turn numbers restart) forgets everything.
    r.update(at(s, 6, 1), at(s, 7, 2), 1);
    expect(r.update(at(s, 7, 2), at(s, 1, 1), 1)).toBeNull();
    expect(r.update(at(s, 1, 1), at(s, 2, 2), 1)).toBeNull();
  });
});
