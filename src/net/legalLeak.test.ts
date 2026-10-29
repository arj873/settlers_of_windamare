/**
 * Property test: `legal` is sent to each seat (session.ts) but computed from the FULL state, so it
 * must not depend on other seats' hidden state. For every ready mode, over states from simulated
 * games, scrambling the other seats' hands, dev cards and the deck order (public counts kept)
 * never changes a seat's legal actions.
 */
import { describe, expect, it } from 'vitest';
import {
  DEV_CARD_TYPES,
  legalActions,
  listModes,
  RESOURCES,
  Rng,
  totalDevCards,
  totalResources,
  type DevCardCounts,
  type GameState,
  type ResourceCounts,
} from '../engine';
import { createRandomBot } from '../bots';
import { newGame, runGame } from '../bots/runner';

function spread<K extends string>(keys: readonly K[], total: number, rng: Rng): Record<K, number> {
  const out = Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;
  for (let i = 0; i < total; i++) out[rng.pick(keys)] += 1;
  return out;
}

/** Same public counts, different secrets, for every seat except `seat`. */
function scrambleOthers(state: GameState, seat: number, rng: Rng): GameState {
  return {
    ...state,
    players: state.players.map((p) => {
      if (p.id === seat) return p;
      const dev = totalDevCards(p.devCards);
      const fresh = totalDevCards(p.newDevCards);
      return {
        ...p,
        resources: spread(RESOURCES, totalResources(p.resources), rng) as ResourceCounts,
        devCards: spread(DEV_CARD_TYPES, dev, rng) as DevCardCounts,
        newDevCards: spread(DEV_CARD_TYPES, fresh, rng) as DevCardCounts,
      };
    }),
    devDeck: rng.shuffle(state.devDeck.map(() => rng.pick(DEV_CARD_TYPES))),
  };
}

const key = (state: GameState, seat: number): string[] =>
  legalActions(state)
    .filter((a) => a.player === seat)
    .map((a) => JSON.stringify(a))
    .sort();

describe('legal actions leak no other seat’s hidden state', () => {
  const modes = listModes().filter((m) => m.status === 'ready');
  it('there are ready modes to check', () => expect(modes.length).toBeGreaterThan(0));

  for (const mode of modes) {
    it(`mode ${mode.id}`, () => {
      const players = Math.max(mode.players.min, Math.min(4, mode.players.max));
      const states: GameState[] = [];
      runGame({
        initial: newGame({
          seed: 11,
          players,
          ...(mode.id === 'base' ? {} : { mode: mode.id }),
          ...(mode.scenarios[0] ? { scenario: mode.scenarios[0] } : {}),
        }),
        maxSteps: 1500,
        bot: createRandomBot({ progressBias: 0.5 }),
        onStep: ({ step, state }) => {
          if (step % 9 === 0) states.push(state);
        },
      });
      const rng = new Rng(7919);
      for (const state of states) {
        // An open trade holds consented (hence public) hand facts; scrambling mid-trade would
        // make that state inconsistent, not reveal anything.
        if (/trade/i.test(state.phase.kind)) continue;
        // Master Merchant (C&K) lists the goods its victim holds: the card lets the player look
        // at that hand, so this reveal is by the rules (the legal list still carries it).
        if (
          state.phase.kind === 'ck/card' &&
          'victim' in state.phase &&
          state.phase.victim !== null
        )
          continue;
        for (const p of state.players) {
          expect(key(scrambleOthers(state, p.id, rng), p.id)).toEqual(key(state, p.id));
        }
      }
    });
  }
});
