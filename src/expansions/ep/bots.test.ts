/** E&P in the headless sim: bots finish every scenario; the invariants catch damage. */
import { describe, expect, it } from 'vitest';
import { createRandomBot } from '../../bots';
import { checkInvariants } from '../../bots/invariants';
import { botSeedFor, newGame, randomSource, runGame } from '../../bots/runner';
import { isResource, topologyOf, type EdgeId } from '../../engine';
import { epSlice, SCENARIOS, scenarioIdOf } from './engine';

describe('Explorers & Pirates in the simulator', () => {
  const bot = createRandomBot({ progressBias: 0.5 });
  it.each(SCENARIOS.map((s, i) => [s.key, i] as const))(
    '%s: bots finish 3-, 4- (and 5-6-) player games with no error or invariant failure',
    (key, i) => {
      const counts = key === 'landHo' ? [3, 4] : [4, 6];
      for (const players of counts) {
        const seed = 20 + i * 3 + players;
        const result = runGame({
          initial: newGame({ seed, players, mode: 'ep', scenario: scenarioIdOf(key) }),
          maxSteps: 30000,
          source: randomSource(bot, botSeedFor(seed)),
        });
        expect(result.failure, JSON.stringify(result.failure?.message)).toBeNull();
        expect(result.outcome).toBe('finished');
      }
    },
    120_000,
  );

  it('the invariants catch a ship on land, an overloaded hold and a lost fish haul', () => {
    const fresh = () => newGame({ seed: 1, players: 4, mode: 'ep', scenario: 'ep/full' });
    const s = fresh();
    expect(checkInvariants(s)).toEqual([]);
    const t = topologyOf(s);
    const inland = t.edges.find((e) => {
      const hs = t.edge[e]?.hexes ?? [];
      return hs.length === 2 && hs.every((h) => isResource(s.board.hexes[h]?.terrain));
    }) as EdgeId;
    epSlice(s).ships.push({ id: 0, owner: 0, edge: inland, cargo: ['settler', 'crew'] });
    epSlice(s).nextShip = 1;
    const msgs = checkInvariants(s).map((v) => v.message);
    expect(msgs).toContain(`ep: ship on a land edge ${inland}`);
    expect(msgs.some((m) => m.includes('overloaded'))).toBe(true);
    const u = fresh();
    epSlice(u).haulSupply -= 1;
    expect(checkInvariants(u).some((v) => v.message.includes('fish hauls'))).toBe(true);
  });
});
