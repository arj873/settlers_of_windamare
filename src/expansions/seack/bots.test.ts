/** Seafarers + C&K in the headless sim: bots finish both scenarios; the invariants catch damage. */
import { describe, expect, it } from 'vitest';
import { createRandomBot } from '../../bots';
import { checkInvariants } from '../../bots/invariants';
import { botSeedFor, newGame, randomSource, runGame } from '../../bots/runner';
import type { VertexId } from '../../engine';
import { ckSlice } from '../ck/engine';
import { graph } from '../seafarers/engine/geometry';
import { touchesLand } from '../../engine';
import { SEACK_MODE, SEACK_SCENARIOS, seackSlice } from './engine';

describe('Seafarers + C&K in the simulator', () => {
  const bot = createRandomBot({ progressBias: 0.5 });
  it.each(SEACK_SCENARIOS.flatMap((s) => [3, 4, 5].map((n) => [s, n] as const)))(
    '%s, %i players: bots finish with no error or invariant failure',
    (scenario, players) => {
      const seed = 40 + players;
      const result = runGame({
        initial: newGame({
          seed,
          players,
          mode: SEACK_MODE,
          scenario,
          ...(players >= 5 ? { specialBuildPhase: true } : {}),
        }),
        maxSteps: 30000,
        source: randomSource(bot, botSeedFor(seed)),
      });
      expect(result.failure, JSON.stringify(result.failure?.message)).toBeNull();
      expect(result.outcome).toBe('finished');
    },
    120_000,
  );

  it('the invariants catch a knight at sea without a ship and a stray chase flag', () => {
    const s = newGame({ seed: 1, players: 4, mode: SEACK_MODE });
    expect(checkInvariants(s)).toEqual([]);
    const sea = graph(s).vertices.find((v) => !touchesLand(s, v)) as VertexId;
    ckSlice(s).knights[sea] = {
      owner: 0,
      level: 1,
      active: true,
      activatedOn: null,
      promotedOn: null,
    };
    seackSlice(s).chase = 'pirate';
    const messages = checkInvariants(s).map((v) => v.message);
    expect(messages).toContain(`seack: knight on ${sea} at sea without its owner's ship`);
    expect(messages).toContain('seack: chase pirate outside moveRobber');
  });
});
