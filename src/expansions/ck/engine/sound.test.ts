/** Soundness: every legal C&K action is accepted, states stay JSON-safe and cloneable. */
import { describe, expect, it } from 'vitest';
import { applyAction, legalActions } from '../../../engine/engine';
import { cloneState } from '../../../engine/clone';
import type { Action, GameState } from '../../../engine/types';
import { ckGame } from './testkit';

function walk(s0: GameState, seed: number, steps: number, check: (s: GameState) => void): void {
  let s = s0;
  let pick = seed * 7919;
  for (let step = 0; step < steps && s.phase.kind !== 'gameOver'; step++) {
    const legal = legalActions(s);
    expect(legal.length, `no legal action in ${s.phase.kind}`).toBeGreaterThan(0);
    check(s);
    // Prefer progress over ending the turn, deterministically.
    pick = (pick * 1103515245 + 12345) >>> 0;
    const progress = legal.filter((a) => a.type !== 'endTurn' && a.type !== 'ck/cancel');
    const from = progress.length > 0 && pick % 3 !== 0 ? progress : legal;
    const r = applyAction(s, from[pick % from.length] as Action);
    if (!r.ok) throw new Error(r.error);
    s = r.state;
  }
}

describe('soundness', () => {
  it('every legal action is accepted (3-4 players, 2500 random steps per seed)', () => {
    for (const [seed, n] of [
      [1, 4],
      [2, 3],
      [3, 4],
    ] as const) {
      walk(ckGame(n, { seed }), seed, 2500, (s) => {
        for (const a of legalActions(s).slice(0, 30)) {
          const r = applyAction(s, a);
          expect(r.ok, `${JSON.stringify(a)}: ${r.ok ? '' : r.error}`).toBe(true);
        }
      });
    }
  });

  it('5-6 players with the special build phase', () => {
    walk(ckGame(6, { seed: 5 }), 5, 2500, (s) => {
      for (const a of legalActions(s).slice(0, 20)) expect(applyAction(s, a).ok).toBe(true);
    });
  });

  it('states are JSON-safe and cloneState copies the slice', () => {
    walk(ckGame(4, { seed: 9 }), 9, 1500, (s) => {
      expect(JSON.parse(JSON.stringify(s))).toEqual(s);
      const c = cloneState(s);
      expect(c).toEqual(s);
      expect(c.ext['ck']).not.toBe(s.ext['ck']);
    });
  });
});
