/** E&P + C&K in the headless sim: bots finish every scenario; the invariants catch damage. */
import { describe, expect, it } from 'vitest';
import { createRandomBot } from '../../bots';
import { checkInvariants } from '../../bots/invariants';
import { botSeedFor, newGame, randomSource, runGame } from '../../bots/runner';
import type { VertexId } from '../../engine';
import { ckSlice } from '../ck/engine';
import { epSlice } from '../ep/engine';
import { V } from '../ep/engine/testkit';
import { EPCK_MODE, EPCK_SCENARIOS, epckSlice } from './engine';

describe('E&P + C&K in the simulator', () => {
  const bot = createRandomBot({ progressBias: 0.5 });
  it.each(EPCK_SCENARIOS.flatMap((s) => [3, 4].map((n) => [s, n] as const)))(
    '%s, %i players: bots finish with no error or invariant failure',
    (scenario, players) => {
      const seed = 50 + players;
      const result = runGame({
        initial: newGame({ seed, players, mode: EPCK_MODE, scenario }),
        maxSteps: 20000,
        source: randomSource(bot, botSeedFor(seed)),
      });
      expect(result.failure, JSON.stringify(result.failure?.message)).toBeNull();
      expect(result.outcome).toBe('finished');
    },
    120_000,
  );

  it('the invariants catch a harbor city, a knight beside fog, a stray Aqueduct queue', () => {
    const s = newGame({ seed: 1, players: 4, mode: EPCK_MODE, scenario: 'ep/full' });
    expect(checkInvariants(s)).toEqual([]);
    const fog = Object.keys(epSlice(s).hidden)[0] as string;
    const [q, r] = fog.slice(2).split(',').map(Number) as [number, number];
    const corner = `v:${q},${r},N` as VertexId;
    ckSlice(s).knights[corner] = {
      owner: 0,
      level: 1,
      active: false,
      activatedOn: null,
      promotedOn: null,
    };
    const v = V(3, 0, 'S');
    s.pieces.buildings[v] = { owner: 1, kind: 'city' };
    epSlice(s).harbors[v] = [];
    epckSlice(s).aqueduct = [2];
    const messages = checkInvariants(s).map((x) => x.message);
    expect(messages).toContain(`epck: knight on ${corner} beside an unexplored hex`);
    expect(messages).toContain(`epck: city on ${v} is a harbor settlement`);
    expect(messages.some((m) => m.startsWith('epck: Aqueduct queue'))).toBe(true);
  });
});
