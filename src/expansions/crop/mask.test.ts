/**
 * Crop Trust online views (engine/mask.ts): the face-down event tokens (supply stack, the tokens
 * under every unbuilt piece, the Longest Road / Largest Army tokens) never reach any view; counts
 * stay public; revealed (used) tokens stay visible.
 */
import { describe, expect, it } from 'vitest';
import { viewFor, type GameState } from '../../engine';
import { canary, expectNoLeak, sampleStates, type Plant } from '../maskTestkit';
import { CROP, cropSlice, type CropEvent, type Species } from './engine';

const fake = (tag: string): CropEvent => ({ k: 'small', s: canary(tag) as Species });

/** Canaries in every face-down token: nobody (owner null) may see them. */
const plantCrop: Plant = (state, owner) => {
  if (owner !== null) return null;
  const s = cropSlice(state);
  const canaries: string[] = [];
  const mk = (tag: string): CropEvent => {
    canaries.push(canary(tag));
    return fake(tag);
  };
  const out = {
    ...s,
    stack: s.stack.map((_, i) => mk(`st${i}`)),
    pieces: s.pieces.map((p, q) => ({
      settlement: p.settlement.map((_, i) => mk(`s${q}_${i}`)),
      city: p.city.map((_, i) => mk(`c${q}_${i}`)),
    })),
    cards: {
      longestRoad: s.cards.longestRoad && mk('lr'),
      largestArmy: s.cards.largestArmy && mk('la'),
    },
  };
  return { state: { ...state, ext: { ...state.ext, [CROP]: out } } as GameState, canaries };
};

describe('Crop Trust online views', () => {
  it.each([
    [3, 31],
    [4, 32],
  ])('no face-down event token leaks, %i players', (players, seed) => {
    const states = sampleStates({ seed, players, mode: CROP }, 1500, 15);
    expect(states.length).toBeGreaterThan(5);
    const report = expectNoLeak(states, plantCrop, { ownerSees: false });
    expect(report.planted).toBeGreaterThan(5);
  });

  it('keeps counts, hides values, leaves used tokens and the input alone', () => {
    const [s] = sampleStates({ seed: 5, players: 4, mode: CROP }, 60, 1).slice(-1);
    const full = cropSlice(s as GameState);
    full.used = [{ k: 'large', s: 'rice' }];
    const before = JSON.stringify(s);
    for (const viewer of ['spectator', 0, 1] as const) {
      const v = cropSlice(viewFor(s as GameState, viewer));
      expect(v.stack).toHaveLength(full.stack.length);
      expect(v.pieces.map((p) => [p.settlement.length, p.city.length])).toEqual(
        full.pieces.map((p) => [p.settlement.length, p.city.length]),
      );
      expect(v.cards.longestRoad === null).toBe(full.cards.longestRoad === null);
      expect(v.used).toEqual(full.used);
      expect(v.crops).toEqual(full.crops);
      expect(v.stack.every((t) => t.k === 'mono')).toBe(true);
    }
    expect(JSON.stringify(s)).toBe(before);
  });
});
