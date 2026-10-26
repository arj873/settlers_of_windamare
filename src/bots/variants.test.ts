/** Real-engine bot games with the T13 rule variants (special build phase, balanced dice). */
import { describe, expect, it } from 'vitest';
import type { MapId } from '../engine';
import { createRandomBot } from './index';
import { botSeedFor, newGame, randomSource, runGame, type GameSetup } from './runner';
import { defaultMaxSteps } from './sim';

const CASES: { name: string; setup: Omit<GameSetup, 'seed'> }[] = [
  { name: '6 players, base56, SBP default on', setup: { players: 6, map: 'base56' as MapId } },
  {
    name: '8 players, base78, SBP + balanced dice',
    setup: { players: 8, map: 'base78' as MapId, balancedDice: true },
  },
  {
    name: '3 players, base, SBP forced on',
    setup: { players: 3, map: 'base' as MapId, specialBuildPhase: true },
  },
  {
    name: '6 players, base56, SBP off',
    setup: { players: 6, map: 'base56' as MapId, specialBuildPhase: false },
  },
  // The 5+ player rule set (RULES.md §20) at every size, and map rules (§19) all allowed.
  ...([5, 6, 7, 8] as const).map((players) => ({
    name: `${players} players, 5+ rule set`,
    setup: { players, variants: { rules56: true } } as Omit<GameSetup, 'seed'>,
  })),
  {
    name: '8 players, 5+ rule set, every adjacency allowed',
    setup: {
      players: 8,
      variants: {
        rules56: true,
        mapRules: {
          allowRedTouch: true,
          allowExtremeTouch: true,
          allowSameNumberTouch: true,
          allowSameResourceTouch: true,
        },
      },
    } as Omit<GameSetup, 'seed'>,
  },
];

describe('bot games with rule variants', () => {
  for (const { name, setup } of CASES) {
    it(`${name}: finishes with no violations`, () => {
      for (const seed of [1, 2]) {
        const full = { ...setup, seed };
        const initial = newGame(full);
        const r = runGame({
          initial,
          maxSteps: defaultMaxSteps(setup.players),
          source: randomSource(createRandomBot(), botSeedFor(seed)),
        });
        expect(r.failure?.message ?? null).toBeNull();
        expect(r.outcome).toBe('finished');
        const passes = r.history.filter((a) => a.type === 'passSpecialBuild').length;
        if (initial.settings.specialBuildPhase) expect(passes).toBeGreaterThan(0);
        else expect(passes).toBe(0);
        if (setup.balancedDice) expect(r.finalState.diceDeck.length).toBeGreaterThan(0);
        else expect(r.finalState.diceDeck).toEqual([]);
      }
    });
  }
});
