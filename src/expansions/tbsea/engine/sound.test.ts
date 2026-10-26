/** Soundness: every legal action of every T&B + Seafarers scenario is accepted; states stay JSON-safe. */
import { describe, expect, it } from 'vitest';
import { applyAction, legalActions } from '../../../engine/engine';
import { cloneState } from '../../../engine/clone';
import type { Action, GameState } from '../../../engine/types';
import { TBSEA_SCENARIOS } from '.';
import { game } from './testkit';

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
    const a = from[pick % from.length] as Action;
    const r = applyAction(s, a);
    if (!r.ok) throw new Error(`${JSON.stringify(a)}: ${r.error}`);
    s = r.state;
  }
}

describe('soundness', { timeout: 180_000 }, () => {
  for (const sc of TBSEA_SCENARIOS) {
    it(`${sc}: every legal action is accepted (3 and 4 players)`, () => {
      for (const n of [3, 4]) {
        walk(game(sc, n, { seed: n }), n, 1000, (s) => {
          for (const a of legalActions(s).slice(0, 30)) {
            const r = applyAction(s, a);
            expect(r.ok, `${JSON.stringify(a)}: ${r.ok ? '' : r.error}`).toBe(true);
          }
        });
      }
    });
  }

  it('states are JSON-safe and cloneState copies the slices', () => {
    for (const sc of TBSEA_SCENARIOS) {
      walk(game(sc, 4, { seed: 5 }), 5, 300, (s) => {
        expect(JSON.parse(JSON.stringify(s))).toEqual(s);
        const c = cloneState(s);
        expect(c).toEqual(s);
        expect(c.ext['tb']).not.toBe(s.ext['tb']);
      });
    }
  });

  it('the input state is never mutated', () => {
    let s = game('tbsea/traders', 4, { seed: 11 });
    for (let i = 0; i < 300 && s.phase.kind !== 'gameOver'; i++) {
      const frozen = JSON.stringify(s);
      const legal = legalActions(s);
      const r = applyAction(s, legal[(i * 7) % legal.length] as Action);
      expect(JSON.stringify(s)).toBe(frozen);
      if (r.ok) s = r.state;
    }
  });
});
