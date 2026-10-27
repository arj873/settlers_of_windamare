/** Barbarian Attack + C&K in the headless sim: bots finish; the pair's invariants catch damage. */
import { describe, expect, it } from 'vitest';
import { createRandomBot } from '../../bots';
import { checkInvariants } from '../../bots/invariants';
import { botSeedFor, newGame, randomSource, runGame } from '../../bots/runner';
import { ckSlice } from '../ck/engine';
import { SC_BA } from '../tb/engine';
import { BACK_MODE } from './engine';

describe('Barbarian Attack + C&K in the simulator', () => {
  const bot = createRandomBot({ progressBias: 0.5 });
  it.each([3, 4, 5, 6])(
    '%i players: bots finish with no error or invariant failure',
    (players) => {
      const seed = 70 + players;
      const result = runGame({
        initial: newGame({ seed, players, mode: BACK_MODE, scenario: SC_BA }),
        maxSteps: 30000,
        source: randomSource(bot, botSeedFor(seed)),
      });
      expect(result.failure, JSON.stringify(result.failure?.message)).toBeNull();
      expect(result.outcome).toBe('finished');
    },
    120_000,
  );

  it('the invariants catch a sailing barbarian ship and a C&K knight on an intersection', () => {
    const s = newGame({ seed: 1, players: 4, mode: BACK_MODE, scenario: SC_BA });
    expect(checkInvariants(s)).toEqual([]);
    ckSlice(s).barbarian = 2;
    ckSlice(s).knights['v:0,0,N'] = {
      owner: 0,
      level: 1,
      active: false,
      activatedOn: null,
      promotedOn: null,
    };
    const messages = checkInvariants(s).map((v) => v.message);
    expect(messages).toContain('back: the barbarian ship sailed');
    expect(messages).toContain('back: a C&K knight on an intersection');
  });
});
