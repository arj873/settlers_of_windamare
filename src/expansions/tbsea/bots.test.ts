/** T&B + Seafarers in the headless sim: bots finish a game; the pair's invariants catch damage. */
import { describe, expect, it } from 'vitest';
import { createRandomBot } from '../../bots';
import { checkInvariants } from '../../bots/invariants';
import { botSeedFor, newGame, randomSource, runGame } from '../../bots/runner';
import type { EdgeId } from '../../engine';
import { seaSlice } from '../seafarers/engine';
import { tbBoard } from '../tb/engine';
import { TBSEA_MODE } from './engine';

describe('T&B + Seafarers in the simulator', () => {
  it.each([
    ['tbsea/traders', 3],
    ['tbsea/fishermen', 4],
  ] as const)(
    '%s, %i players: bots finish with no error or invariant failure',
    (scenario, n) => {
      const seed = 70 + n;
      const result = runGame({
        initial: newGame({ seed, players: n, mode: TBSEA_MODE, scenario }),
        maxSteps: 20000,
        source: randomSource(createRandomBot({ progressBias: 0.5 }), botSeedFor(seed)),
      });
      expect(result.failure, JSON.stringify(result.failure?.message)).toBeNull();
      expect(result.outcome).toBe('finished');
    },
    180_000,
  );

  it('the invariants catch a pirate in T&B and a ship on a bridge site', () => {
    const s = newGame({ seed: 1, players: 4, mode: TBSEA_MODE, scenario: 'tbsea/traders' });
    expect(checkInvariants(s)).toEqual([]);
    seaSlice(s).pirate = 'h:1,1';
    expect(checkInvariants(s).map((v) => v.message)).toContain(
      'tbsea: a pirate in a game without one',
    );
    const r = newGame({ seed: 1, players: 4, mode: TBSEA_MODE, scenario: 'tbsea/rivers' });
    const site = (tbBoard(r).bridgeSites ?? [])[0] as EdgeId;
    seaSlice(r).ships[site] = { owner: 0 };
    expect(checkInvariants(r).map((v) => v.message)).toContain(
      `tbsea: a ship on the bridge site ${site}`,
    );
  });
});
