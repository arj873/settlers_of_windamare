// @vitest-environment jsdom
/**
 * Seafarers online views (engine/mask.ts): the fog stacks and the Forgotten Tribe's face-down
 * gift cards never reach a view (bot games, every viewer, game over included); every other
 * Seafarers datum is the same for every viewer; the HUD renders a masked view.
 */
import { describe, expect, it } from 'vitest';
import { legalActions, viewFor, type EdgeId, type GameState, type Viewer } from '../../engine';
import type { DevCardType, Terrain } from '../../engine/types';
import { Hud } from '../../ui/hud';
import { canary, canaryNumber, expectNoLeak, sampleStates, type Plant } from '../maskTestkit';
import { SCENARIOS, scenarioIdOf, seaSlice, SEAFARERS, type Gift, type SeaSlice } from './engine';
import { FOG_TERRAIN, FOG_TOKEN, GIFT_CARD } from './engine/mask';
import { seaGame } from './engine/testkit';
import type { ScenarioKey } from './engine/state';

const withSlice = (state: GameState, s: SeaSlice): GameState => ({
  ...state,
  ext: { ...state.ext, [SEAFARERS]: s },
});

const viewersOf = (s: GameState): Viewer[] => ['spectator', ...s.players.map((p) => p.id)];

const sample = (key: ScenarioKey, players: number, seed: number, maxSteps = 900, every = 60) =>
  sampleStates({ seed, players, mode: 'seafarers', scenario: scenarioIdOf(key) }, maxSteps, every);

/** Canaries in both fog stacks (global secret). */
const plantFog: Plant = (state, owner) => {
  const s = seaSlice(state);
  if (owner !== null || !s.fog || s.fog.terrains.length + s.fog.tokens.length === 0) return null;
  const terrains = s.fog.terrains.map((_, i) => canary(`fog${i}`) as Terrain);
  const tokens = s.fog.tokens.map((_, i) => canaryNumber(i));
  return {
    state: withSlice(state, { ...s, fog: { terrains, tokens } }),
    canaries: [...terrains, ...tokens.map(String)],
  };
};

/** Canaries as the face-down gift cards (global secret). */
const plantGifts: Plant = (state, owner) => {
  const s = seaSlice(state);
  if (owner !== null || !s.gifts) return null;
  const gifts: Record<EdgeId, Gift> = {};
  const canaries: string[] = [];
  for (const [e, g] of Object.entries(s.gifts) as [EdgeId, Gift][]) {
    if (g.kind !== 'dev') {
      gifts[e] = g;
      continue;
    }
    const card = canary(`gift${canaries.length}`);
    canaries.push(card);
    gifts[e] = { kind: 'dev', card: card as DevCardType };
  }
  return { state: withSlice(state, { ...s, gifts }), canaries };
};

describe('Seafarers online views: secrets', () => {
  it.each([
    [3, 21],
    [4, 22],
    [5, 23],
  ])('Fog Islands, %i players: no viewer sees the fog stacks', (players, seed) => {
    const states = sample('fogIslands', players, seed);
    const report = expectNoLeak(states, plantFog);
    expect(report.planted).toBeGreaterThan(5);
    // Some fog was discovered along the way: the stack shrank, the board shows the new land.
    const last = seaSlice(states[states.length - 1] as GameState).fog;
    expect(last?.terrains.length).toBeLessThan(players === 5 ? 25 : 12);
  });

  it.each([
    [4, 31],
    [5, 32],
  ])('Forgotten Tribe, %i players: no viewer sees the face-down gift cards', (players, seed) => {
    const states = sample('forgottenTribe', players, seed);
    const report = expectNoLeak(states, plantGifts);
    expect(report.planted).toBeGreaterThan(5);
  });

  it('the masked view keeps the shape: stack sizes, gift kinds, harbours and chits', () => {
    for (const s of [seaGame('fogIslands', 4), seaGame('forgottenTribe', 4)]) {
      const before = JSON.stringify(s);
      const full = seaSlice(s);
      for (const v of viewersOf(s)) {
        const view = viewFor(s, v);
        const m = seaSlice(view);
        expect(view.board).toEqual(s.board);
        if (full.fog) {
          expect(m.fog?.terrains).toEqual(full.fog.terrains.map(() => FOG_TERRAIN));
          expect(m.fog?.tokens).toEqual(full.fog.tokens.map(() => FOG_TOKEN));
        }
        if (full.gifts) {
          expect(Object.keys(m.gifts ?? {})).toEqual(Object.keys(full.gifts));
          for (const [e, g] of Object.entries(full.gifts) as [EdgeId, Gift][]) {
            expect(m.gifts?.[e]).toEqual(g.kind === 'dev' ? { kind: 'dev', card: GIFT_CARD } : g);
          }
          expect(m.harbors).toEqual(full.harbors);
        }
        expect({ ...m, fog: undefined, gifts: undefined }).toEqual({
          ...full,
          fog: undefined,
          gifts: undefined,
        });
      }
      expect(JSON.stringify(s)).toBe(before); // inputs untouched
    }
  });

  it('a game over keeps the stacks and gift cards hidden', () => {
    const s = { ...seaGame('forgottenTribe', 4), phase: { kind: 'gameOver' as const } };
    const fog = { ...seaGame('fogIslands', 4), phase: { kind: 'gameOver' as const } };
    expectNoLeak([s], plantGifts);
    expectNoLeak([fog], plantFog);
  });
});

describe('Seafarers online views: the other scenarios', () => {
  const others = SCENARIOS.map((r) => r.key).filter(
    (k) => k !== 'fogIslands' && k !== 'forgottenTribe',
  );
  it.each(others.map((k, i) => [k, i] as const))(
    '%s: the slice and the board are public and identical for every viewer',
    (key, i) => {
      for (const players of [4, 5]) {
        for (const s of sample(key, players, 40 + i * 2 + players, 500, 100)) {
          for (const v of viewersOf(s)) {
            const view = viewFor(s, v);
            expect(view.ext[SEAFARERS]).toEqual(s.ext[SEAFARERS]);
            expect(view.board).toEqual(s.board);
          }
        }
      }
    },
  );

  it('Fog / Tribe: every viewer gets the same Seafarers slice', () => {
    for (const s of [
      ...sample('fogIslands', 4, 51, 600, 150),
      ...sample('forgottenTribe', 4, 52, 600, 150),
    ]) {
      const views = viewersOf(s).map((v) => JSON.stringify(viewFor(s, v).ext[SEAFARERS]));
      expect(new Set(views).size).toBe(1);
    }
  });
});

describe('Seafarers HUD on a masked view', () => {
  it('shows the fog stack size and the gifts left, not placeholder values', () => {
    for (const [key, text] of [
      ['fogIslands', 'Fog stack: 12 hexes'],
      ['forgottenTribe', 'Gifts left: 18'],
    ] as const) {
      const s = seaGame(key, 4);
      const root = document.createElement('div');
      document.body.replaceChildren(root);
      const hud = new Hud(root);
      expect(() =>
        hud.render(viewFor(s, 1), { viewer: 1, legal: legalActions(s), isBotTurn: false }),
      ).not.toThrow();
      expect(root.textContent).toContain(text);
      expect(root.textContent).not.toContain('knight');
    }
  });
});
