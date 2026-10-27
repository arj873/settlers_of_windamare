/** Catan for Two + C&K in the headless sim: bots finish; the pair's invariants catch damage. */
import { describe, expect, it } from 'vitest';
import { createRandomBot } from '../../bots';
import { checkInvariants } from '../../bots/invariants';
import { botSeedFor, newGame, randomSource, runGame } from '../../bots/runner';
import { ckSlice } from '../ck/engine';
import { SC_BASE } from '../tb/engine';
import { TWOCK_MODE, neutralOwner } from './engine';

describe('Catan for Two + C&K in the simulator', () => {
  const bot = createRandomBot({ progressBias: 0.5 });
  it.each([81, 82])(
    'seed %i: bots finish with no error or invariant failure',
    (seed) => {
      const result = runGame({
        initial: newGame({ seed, players: 2, mode: TWOCK_MODE, scenario: SC_BASE }),
        maxSteps: 40000,
        source: randomSource(bot, botSeedFor(seed)),
      });
      expect(result.failure, JSON.stringify(result.failure?.message)).toBeNull();
      expect(result.outcome).toBe('finished');
    },
    180_000,
  );

  it('the invariants catch an active or mighty neutral knight', () => {
    const s = newGame({ seed: 1, players: 2, mode: TWOCK_MODE, scenario: SC_BASE });
    expect(checkInvariants(s)).toEqual([]);
    ckSlice(s).knights['v:0,0,N'] = {
      owner: neutralOwner(s, 1),
      level: 3,
      active: true,
      activatedOn: 1,
      promotedOn: null,
    };
    const messages = checkInvariants(s).map((v) => v.message);
    expect(messages).toContain('twock: an active neutral knight on v:0,0,N');
    expect(messages).toContain('twock: a mighty neutral knight on v:0,0,N');
  });
});
