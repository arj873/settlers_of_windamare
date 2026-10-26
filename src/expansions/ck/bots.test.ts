/** Cities & Knights in the simulator: bots finish games, invariants (base + C&K) hold. */
import { describe, expect, it } from 'vitest';
import { createRandomBot } from '../../bots';
import { checkInvariants } from '../../bots/invariants';
import { botSeedFor, newGame, randomSource, runGame } from '../../bots/runner';
import { CK, ckSlice } from './engine';

describe('ck in the simulator', () => {
  it('random bots finish 3-6 player games on both scenarios with no stall, error or violation', () => {
    const bot = createRandomBot({ progressBias: 0.5 });
    for (const [seed, players, scenario, variants] of [
      [1, 3, 'ck/starter', {}],
      [2, 4, 'ck/classic', {}],
      [3, 5, 'ck/classic', {}],
      [4, 6, 'ck/classic', {}],
      [5, 4, 'ck/classic', { eventCards: true }],
      [6, 4, 'ck/starter', { robberMode: 'friendly' }],
    ] as const) {
      const result = runGame({
        initial: newGame({ seed, players, mode: CK, scenario, variants }),
        maxSteps: 30000,
        source: randomSource(bot, botSeedFor(seed)),
      });
      expect(result.failure, JSON.stringify(result.failure?.message)).toBeNull();
      expect(result.outcome).toBe('finished');
    }
  });

  it('the invariants catch a lost commodity and a lost progress card', () => {
    const s = newGame({ seed: 1, players: 4, mode: CK });
    expect(checkInvariants(s)).toEqual([]);
    ckSlice(s).bank.coin -= 1;
    expect(checkInvariants(s).map((v) => v.message)).toEqual([
      'ck: coin: supply + hands = 11, expected 12',
    ]);
    ckSlice(s).bank.coin += 1;
    ckSlice(s).decks.trade.pop();
    expect(checkInvariants(s)).toHaveLength(1);
  });
});
