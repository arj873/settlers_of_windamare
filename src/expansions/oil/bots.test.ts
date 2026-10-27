/** Oil Springs in the headless sim: bots finish games, invariants (base + oil) hold. */
import { describe, expect, it } from 'vitest';
import { createRandomBot } from '../../bots';
import { checkInvariants } from '../../bots/invariants';
import { botSeedFor, newGame, randomSource, runGame } from '../../bots/runner';
import { parseArgs, simSetup } from '../../bots/sim';
import { OIL, oilSlice } from './engine';

describe('oil in the simulator', () => {
  it('random bots play 3-6 players on both scenarios with no stall, error or invariant failure', () => {
    const bot = createRandomBot({ progressBias: 0.5 });
    for (const [seed, players, scenario] of [
      [1, 3, 'oil/oilSprings'],
      [2, 4, 'oil/oilSpringsVariable'],
      [3, 5, 'oil/oilSprings'],
      [4, 6, 'oil/oilSpringsVariable'],
    ] as const) {
      const result = runGame({
        initial: newGame({ seed, players, mode: OIL, scenario }),
        maxSteps: 20000,
        source: randomSource(bot, botSeedFor(seed)),
      });
      expect(result.failure, JSON.stringify(result.failure?.message)).toBeNull();
      expect(result.outcome).toBe('finished');
    }
  }, 60_000);

  it('the invariants catch lost oil, a loose metropolis and an unresolved disaster', () => {
    const s = newGame({ seed: 1, players: 4, mode: OIL });
    expect(checkInvariants(s)).toEqual([]);
    oilSlice(s).supply -= 1;
    expect(checkInvariants(s).map((v) => v.message)).toEqual(['oil: oil total 14, expected 15']);
    oilSlice(s).supply += 1;
    oilSlice(s).metropolis['v:0,0,N'] = 1;
    expect(checkInvariants(s)).toHaveLength(1);
    delete oilSlice(s).metropolis['v:0,0,N'];
    oilSlice(s).oil[0] = 5;
    oilSlice(s).supply -= 5;
    expect(checkInvariants(s).map((v) => v.message)).toEqual(['oil: player 0 holds 5 oil (cap 4)']);
  });

  it('sim flags build the oil setup', () => {
    const args = parseArgs([
      '--mode',
      'oil',
      '--scenario',
      'oil/oilSpringsVariable',
      '--players',
      '5',
    ]);
    expect(simSetup(args, 7)).toEqual({
      seed: 7,
      players: 5,
      mode: 'oil',
      scenario: 'oil/oilSpringsVariable',
    });
    expect(newGame(simSetup(args, 7)).settings.map).toBe('oil/random30');
  });
});
