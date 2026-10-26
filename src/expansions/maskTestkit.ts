/**
 * Test kit for the `maskFor` hook (docs/EXPANSIONS.md §5, online views): sample states from bot
 * games, plant canaries in a module's secrets, and check that no other seat's (or a
 * spectator's) serialized view contains them while the owner's own view still does.
 * Test-only (imports the bots); every module's mask test uses it.
 */
import { expect } from 'vitest';
import { hiddenFrom, viewFor, type GameState, type PlayerId, type Viewer } from '../engine';
import { createRandomBot } from '../bots';
import { newGame, runGame, type GameSetup } from '../bots/runner';

/** Every `every`-th state of a bot game (plus the last one). */
export function sampleStates(setup: GameSetup, maxSteps = 1500, every = 7): GameState[] {
  const out: GameState[] = [];
  const result = runGame({
    initial: newGame(setup),
    maxSteps,
    bot: createRandomBot({ progressBias: 0.5 }),
    onStep: ({ step, state }) => {
      if (step % every === 0) out.push(state);
    },
  });
  out.push(result.finalState);
  return out;
}

/** A distinctive string (a fake card / terrain id); never appears in a real game. */
export const canary = (tag: string | number): string => `zzcanary${tag}zz`;
/** A distinctive number (a fake count / token); never appears in a real game. */
export const canaryNumber = (k: number): number => 7_770_000 + k;

/**
 * Plant canaries. `owner` = a seat: that seat's private secrets (its hand); null = secrets
 * nobody may see (deck order, face-down stacks, rng). Return the changed full state and the
 * canary texts as they serialize (`canary(..)`, `String(canaryNumber(..))`), or null when the
 * state has nothing to plant for that owner.
 */
export type Plant = (
  state: GameState,
  owner: PlayerId | null,
) => { state: GameState; canaries: readonly string[] } | null;

export interface LeakReport {
  /** Plantings checked (states × owners that had something to plant). */
  planted: number;
  /** Of them, per-seat plantings whose owner saw their own canaries. */
  ownerSaw: number;
}

/**
 * For every sampled state and owner: plant, then no viewer that `owner`'s secret is hidden from
 * may see any canary (global secrets: no viewer at all). The owner's own view must show them
 * (else the plant hit a field the game never sends, and the test proves nothing), unless
 * `ownerSees` is false.
 */
export function expectNoLeak(
  states: readonly GameState[],
  plant: Plant,
  opts: { ownerSees?: boolean } = {},
): LeakReport {
  const report: LeakReport = { planted: 0, ownerSaw: 0 };
  for (const state of states) {
    const viewers: Viewer[] = ['spectator', ...state.players.map((p) => p.id)];
    for (const owner of [null, ...state.players.map((p) => p.id)]) {
      const planted = plant(state, owner);
      if (!planted || planted.canaries.length === 0) continue;
      report.planted += 1;
      for (const viewer of viewers) {
        const text = JSON.stringify(viewFor(planted.state, viewer));
        const hidden = owner === null || hiddenFrom(state, viewer, owner);
        const seen = planted.canaries.filter((c) => text.includes(c));
        if (hidden) {
          expect(seen, `viewer ${viewer}, owner ${owner}, phase ${state.phase.kind}`).toEqual([]);
        } else if (owner === viewer && opts.ownerSees !== false) {
          expect(seen.length, `owner ${owner} sees own canaries`).toBeGreaterThan(0);
          report.ownerSaw += 1;
        }
      }
    }
  }
  return report;
}
