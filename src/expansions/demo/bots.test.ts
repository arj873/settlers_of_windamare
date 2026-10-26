/** Demo expansion in the headless sim: bots finish games, invariants (base + demo) hold. */
import { describe, expect, it } from 'vitest';
import type { VertexId } from '../../engine';
import { createRandomBot } from '../../bots';
import { checkInvariants } from '../../bots/invariants';
import { botSeedFor, newGame, randomSource, runGame } from '../../bots/runner';
import { parseArgs, simSetup } from '../../bots/sim';
import { DEMO, demoSlice } from './engine';

describe('demo in the simulator', () => {
  it('random bots finish games with no stall, error or invariant failure', () => {
    const bot = createRandomBot({ progressBias: 0.5 });
    for (const seed of [1, 2, 3, 4]) {
      const setup = { seed, players: 3 + (seed % 2), mode: DEMO };
      const result = runGame({
        initial: newGame(setup),
        maxSteps: 5000,
        source: randomSource(bot, botSeedFor(seed)),
      });
      expect(result.failure, JSON.stringify(result.failure?.message)).toBeNull();
      expect(result.outcome).toBe('finished');
    }
  });

  it('the demo invariants catch a well without a building', () => {
    const s = newGame({ seed: 1, players: 4, mode: DEMO });
    expect(checkInvariants(s)).toEqual([]);
    demoSlice(s).wells['v:0,0,N' as VertexId] = 2;
    expect(checkInvariants(s).map((v) => v.code)).toEqual(['expansion']);
  });

  it('sim flags --mode / --scenario / --option build the game setup', () => {
    const args = parseArgs([
      '--mode',
      'demo',
      '--option',
      'demo.friendlyRobber=false',
      '--players',
      '3',
    ]);
    expect(simSetup(args, 7)).toEqual({
      seed: 7,
      players: 3,
      mode: 'demo',
      options: { demo: { friendlyRobber: false } },
    });
    const s = newGame(simSetup(args, 7));
    expect(s.settings.options).toEqual({ demo: { friendlyRobber: false } });
    // Base runs keep the pre-F1 setup exactly (same map field, nothing else).
    expect(simSetup(parseArgs([]), 1)).toEqual({ seed: 1, players: 4, map: 'baseRandom' });
    expect(() => parseArgs(['--mode', 'moon'])).toThrow(/--mode/);
    expect(() => parseArgs(['--option', 'nope'])).toThrow(/--option/);
  });
});
