/** Seafarers in the headless sim: random bots finish every scenario; the invariants catch damage. */
import { describe, expect, it } from 'vitest';
import { createRandomBot } from '../../bots';
import { checkInvariants } from '../../bots/invariants';
import { botSeedFor, newGame, randomSource, runGame } from '../../bots/runner';
import { topologyOf, type EdgeId } from '../../engine';
import { SCENARIOS, scenarioIdOf, seaSlice } from './engine';

describe('Seafarers in the simulator', () => {
  const bot = createRandomBot({ progressBias: 0.5 });
  it.each(SCENARIOS.map((s, i) => [s.key, i] as const))(
    '%s: bots finish 4- and 5-player games with no error or invariant failure',
    (key, i) => {
      for (const players of [4, 5]) {
        const seed = 10 + i * 2 + players;
        const result = runGame({
          initial: newGame({ seed, players, mode: 'seafarers', scenario: scenarioIdOf(key) }),
          maxSteps: 30000,
          source: randomSource(bot, botSeedFor(seed)),
        });
        expect(result.failure, JSON.stringify(result.failure?.message)).toBeNull();
        expect(result.outcome).toBe('finished');
      }
    },
    120_000,
  );

  it('the invariants catch a ship on land, lost cloth and a broken fog stack', () => {
    const s = newGame({
      seed: 1,
      players: 4,
      mode: 'seafarers',
      scenario: 'seafarers/clothForCatan',
    });
    expect(checkInvariants(s)).toEqual([]);
    seaSlice(s).cloth!.supply -= 1;
    expect(checkInvariants(s).map((v) => v.message)).toEqual(['seafarers: cloth 49, expected 50']);
    const f = newGame({ seed: 1, players: 4, mode: 'seafarers', scenario: 'seafarers/fogIslands' });
    seaSlice(f).fog!.terrains.pop();
    expect(checkInvariants(f).some((v) => v.message.includes('fog stack'))).toBe(true);
    const h = newGame({ seed: 1, players: 4, mode: 'seafarers', scenario: 'seafarers/newShores' });
    const t = topologyOf(h);
    const inland = t.edges.find((e) => t.edge[e]?.hexes.length === 2) as EdgeId;
    seaSlice(h).ships[inland] = { owner: 0 };
    expect(checkInvariants(h).map((v) => v.message)).toEqual([
      `seafarers: ship on a land edge ${inland}`,
    ]);
  });
});
