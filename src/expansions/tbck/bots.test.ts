/** T&B + C&K in the headless sim: bots finish every combined scenario; invariants catch damage. */
import { describe, expect, it } from 'vitest';
import { createRandomBot } from '../../bots';
import { checkInvariants } from '../../bots/invariants';
import { botSeedFor, newGame, randomSource, runGame } from '../../bots/runner';
import { applyAction, legalActions, upgradeState, type Action } from '../../engine';
import fixture from './fixtures/rivers-diplomat-stall.json';
import { TBCK_MODE, TBCK_SCENARIOS } from './engine';

describe('T&B + C&K in the simulator', () => {
  const bot = createRandomBot({ progressBias: 0.5 });
  it.each(TBCK_SCENARIOS.flatMap((s) => [3, 4, 5].map((n) => [s, n] as const)))(
    '%s, %i players: bots finish with no error or invariant failure',
    (scenario, players) => {
      const seed = 60 + players;
      const result = runGame({
        initial: newGame({ seed, players, mode: TBCK_MODE, scenario }),
        maxSteps: 30000,
        source: randomSource(bot, botSeedFor(seed)),
      });
      expect(result.failure, JSON.stringify(result.failure?.message)).toBeNull();
      expect(result.outcome).toBe('finished');
    },
    120_000,
  );

  it('the invariants catch a development card in a C&K game', () => {
    const s = newGame({ seed: 1, players: 4, mode: TBCK_MODE, scenario: 'tb/fishermen' });
    expect(checkInvariants(s)).toEqual([]);
    s.players[0]!.devCards.knight = 1;
    expect(checkInvariants(s).map((v) => v.message)).toContain(
      'tbck: player 0 holds development cards',
    );
  });

  it('regression (sim seed 157): no Diplomat when every open road is a bridge or an unpaid river road', () => {
    // The state right before the stall, saved as a v5 snapshot: the recorded action history
    // only replays on the RNG stream it was played with, which s15 replaced.
    const dump = fixture as unknown as { state: unknown; play: Action };
    const s = upgradeState(dump.state);
    if (!s) throw new Error('fixture state does not load');
    const play = dump.play;
    expect(play).toMatchObject({ type: 'ck/play', card: 'diplomat' });
    expect(legalActions(s).some((a) => JSON.stringify(a) === JSON.stringify(play))).toBe(false);
    expect(applyAction(s, play).ok).toBe(false);
    expect(legalActions(s).length).toBeGreaterThan(0);
  });
});
