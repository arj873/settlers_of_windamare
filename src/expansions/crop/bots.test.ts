/** Crop Trust in the headless sim: bots finish games, invariants (base + crop) hold. */
import { describe, expect, it } from 'vitest';
import { createRandomBot } from '../../bots';
import { checkInvariants } from '../../bots/invariants';
import { botSeedFor, newGame, randomSource, runGame } from '../../bots/runner';
import type { HexId } from '../../engine';
import { CROP, cropSlice, fieldsHexes, type CropCounts } from './engine';

describe('crop in the simulator', () => {
  it('random bots play 3-4 players on both scenarios with no stall, error or invariant failure', () => {
    const bot = createRandomBot({ progressBias: 0.5 });
    for (const [seed, players, scenario] of [
      [1, 3, 'crop/cropTrust'],
      [2, 4, 'crop/cropTrust'],
      [3, 4, 'crop/cropTrustVariable'],
      [4, 3, 'crop/cropTrustVariable'],
    ] as const) {
      const result = runGame({
        initial: newGame({ seed, players, mode: CROP, scenario }),
        maxSteps: 20000,
        source: randomSource(bot, botSeedFor(seed)),
      });
      expect(result.failure, JSON.stringify(result.failure?.message)).toBeNull();
      expect(result.outcome).toBe('finished');
      expect(result.winner).not.toBeNull();
    }
  });

  it('the invariants catch lost crops, a hex over 7 and a wrong event count', () => {
    const s = newGame({ seed: 1, players: 4, mode: CROP });
    expect(checkInvariants(s)).toEqual([]);
    const slice = cropSlice(s);
    slice.supply.rice -= 1;
    expect(checkInvariants(s).map((v) => v.message)).toEqual([
      'crop: rice: 17 tokens, expected 18',
    ]);
    slice.supply.rice += 1;
    const counts = slice.crops[fieldsHexes(s)[0] as HexId] as CropCounts;
    counts.beans += 8;
    slice.supply.beans -= 8;
    expect(checkInvariants(s).map((v) => v.message)).toEqual([expect.stringContaining('holds')]);
    counts.beans -= 8;
    slice.supply.beans += 8;
    slice.stack.pop();
    expect(checkInvariants(s).map((v) => v.message)).toEqual([
      'crop: 40 event tokens, expected 41',
    ]);
  });
});
