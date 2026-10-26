/** Soundness: every legal T&B action is accepted; states stay JSON-safe and cloneable. */
import { describe, expect, it } from 'vitest';
import { applyAction, legalActions } from '../../../engine/engine';
import { cloneState } from '../../../engine/clone';
import type { Action, GameState } from '../../../engine/types';
import { tbGame } from './testkit';

function walk(s0: GameState, seed: number, steps: number, check: (s: GameState) => void): void {
  let s = s0;
  let pick = seed * 7919;
  for (let step = 0; step < steps && s.phase.kind !== 'gameOver'; step++) {
    const legal = legalActions(s);
    expect(legal.length, `no legal action in ${s.phase.kind}`).toBeGreaterThan(0);
    check(s);
    pick = (pick * 1103515245 + 12345) >>> 0;
    const progress = legal.filter((a) => a.type !== 'endTurn');
    const from = progress.length > 0 && pick % 3 !== 0 ? progress : legal;
    const r = applyAction(s, from[pick % from.length] as Action);
    if (!r.ok) throw new Error(`${JSON.stringify(from[pick % from.length])}: ${r.error}`);
    s = r.state;
  }
}

const SCENARIOS = ['variants', 'fishermen', 'rivers', 'caravans', 'barbarianAttack', 'traders'];

describe('soundness', { timeout: 120_000 }, () => {
  for (const sc of SCENARIOS) {
    it(`${sc}: every legal action is accepted (2-4 and 5-6 players)`, () => {
      const sizes = sc === 'barbarianAttack' ? [3, 5] : [2, 4, 6];
      for (const n of sizes) {
        walk(tbGame(sc, n, { seed: n }), n, 1200, (s) => {
          for (const a of legalActions(s).slice(0, 25)) {
            const r = applyAction(s, a);
            expect(r.ok, `${JSON.stringify(a)}: ${r.ok ? '' : r.error}`).toBe(true);
          }
        });
      }
    });
  }

  it('states are JSON-safe and cloneState copies the slice', () => {
    for (const sc of SCENARIOS) {
      walk(tbGame(sc, 4, { seed: 3 }), 3, 400, (s) => {
        expect(JSON.parse(JSON.stringify(s))).toEqual(s);
        const c = cloneState(s);
        expect(c).toEqual(s);
        expect(c.ext['tb']).not.toBe(s.ext['tb']);
      });
    }
  });

  it('the input state is never mutated', () => {
    let s = tbGame('traders', 4, { seed: 11 });
    for (let i = 0; i < 300 && s.phase.kind !== 'gameOver'; i++) {
      const frozen = JSON.stringify(s);
      const legal = legalActions(s);
      const r = applyAction(s, legal[(i * 7) % legal.length] as Action);
      expect(JSON.stringify(s)).toBe(frozen);
      if (r.ok) s = r.state;
    }
  });
});
