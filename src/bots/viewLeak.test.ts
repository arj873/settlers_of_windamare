/**
 * Property test for the online views (engine/view.ts): over many states from simulated games,
 * no view carries secret data, the public counts match, and a view does not change when only
 * secret data changes (so it cannot leak it).
 */
import { describe, expect, it } from 'vitest';
import {
  DEV_CARD_TYPES,
  HIDDEN_DEV_CARD,
  HIDDEN_SEED,
  RESOURCES,
  Rng,
  totalDevCards,
  totalResources,
  viewFor,
  type DevCardCounts,
  type GameState,
  type MapId,
  type ResourceCounts,
  type Viewer,
} from '../engine';
import { createRandomBot } from './index';
import { newGame, runGame } from './runner';

/** Every `every`-th state of a bot game (plus the last one). */
function sampleStates(setup: {
  seed: number;
  players: number;
  map?: MapId;
  balancedDice?: boolean;
}): GameState[] {
  const out: GameState[] = [];
  const result = runGame({
    initial: newGame(setup),
    maxSteps: 1500,
    bot: createRandomBot({ progressBias: 0.5 }),
    onStep: ({ step, state }) => {
      if (step % 7 === 0) out.push(state);
    },
  });
  out.push(result.finalState);
  return out;
}

/** Spread `total` cards over `keys` at random. */
function spread<K extends string>(keys: readonly K[], total: number, rng: Rng): Record<K, number> {
  const out = Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;
  for (let i = 0; i < total; i++) out[rng.pick(keys)] += 1;
  return out;
}

/**
 * Same public information, different secrets: other hands redistributed (same sizes), dev
 * cards redistributed between types and between bought-this-turn / older (same total), decks
 * reshuffled, rng and seed changed.
 */
function scramble(state: GameState, viewer: Viewer, rng: Rng): GameState {
  const revealAll = state.phase.kind === 'gameOver';
  const seed = `other-${rng.int(1e9)}`;
  return {
    ...state,
    settings: { ...state.settings, seed },
    players: state.players.map((p) => {
      if (revealAll || p.id === viewer) return p;
      const dev = totalDevCards(p.devCards) + totalDevCards(p.newDevCards);
      const fresh = rng.int(dev + 1);
      return {
        ...p,
        resources: spread(RESOURCES, totalResources(p.resources), rng) as ResourceCounts,
        devCards: spread(DEV_CARD_TYPES, dev - fresh, rng) as DevCardCounts,
        newDevCards: spread(DEV_CARD_TYPES, fresh, rng) as DevCardCounts,
      };
    }),
    devDeck: rng.shuffle(state.devDeck.map(() => rng.pick(DEV_CARD_TYPES))),
    diceDeck: state.diceDeck.map(() => rng.int(36)),
    rng: rng.int(2 ** 32),
    log: state.log.map((e) =>
      e.text.startsWith('Game created (')
        ? { ...e, text: e.text.replace(/seed .*\)$/, `seed ${seed})`) }
        : e,
    ),
  };
}

const GAMES = [
  { seed: 1, players: 4 },
  { seed: 2, players: 3 },
  { seed: 3, players: 4, balancedDice: true },
  { seed: 4, players: 5, map: 'base56' as const },
  { seed: 5, players: 7, map: 'base78' as const, balancedDice: true },
];

describe('online views leak nothing (property test over simulated games)', () => {
  for (const game of GAMES) {
    it(`game ${JSON.stringify(game)}`, () => {
      const states = sampleStates(game);
      const rng = new Rng(game.seed * 7919);
      expect(states.length).toBeGreaterThan(20);
      for (const state of states) {
        const viewers: Viewer[] = ['spectator', ...state.players.map((p) => p.id)];
        const revealAll = state.phase.kind === 'gameOver';
        for (const viewer of viewers) {
          const v = viewFor(state, viewer);

          // No secret fields.
          expect(v.rng).toBe(0);
          expect(v.settings.seed).toBe(HIDDEN_SEED);
          expect(v.devDeck.every((c) => c === HIDDEN_DEV_CARD)).toBe(true);
          expect(v.diceDeck.every((c) => c === 0)).toBe(true);
          expect(v.log.some((e) => /seed/.test(e.text))).toBe(false);
          for (const p of v.players) {
            const own = revealAll || p.id === viewer;
            const real = state.players[p.id]!;
            if (own) {
              expect(p).toEqual(real);
            } else {
              expect(totalResources(p.resources)).toBe(0);
              expect(totalDevCards(p.devCards) + totalDevCards(p.newDevCards)).toBe(0);
            }
            // Public counts match the real ones.
            expect(v.view.handCounts[p.id]).toBe(totalResources(real.resources));
            expect(v.view.devCardCounts[p.id]).toBe(
              totalDevCards(real.devCards) + totalDevCards(real.newDevCards),
            );
          }
          expect(v.devDeck.length).toBe(state.devDeck.length);
          expect(v.diceDeck.length).toBe(state.diceDeck.length);

          // Indistinguishable: changing only secrets gives the same view.
          expect(viewFor(scramble(state, viewer, rng), viewer)).toEqual(v);
        }
      }
    });
  }
});
