/**
 * T&B × T&B online views (C4): the sheets add no secret of their own (barbarians by paths, the
 * barbarian phases and the sheet rules are public), so T&B's masking covers them: the Barbarian
 * Attack deck, the commodity stacks and the Swift Journeys never reach another viewer in a bot
 * game of each sheet with them.
 */
import { describe, expect, it } from 'vitest';
import { viewFor, type GameState, type HexId } from '../../engine';
import { canary, canaryNumber, expectNoLeak, sampleStates, type Plant } from '../maskTestkit';
import { TB, tbSlice, type BaCard, type Commodity, type TbSlice } from '../tb/engine';
import { TBPAIR_MODE } from './engine';

const withSlice = (state: GameState, s: TbSlice): GameState => ({
  ...state,
  ext: { ...state.ext, [TB]: s },
});

/** Canaries in the BA deck and the stacks (global), and a seat's Swift Journey cards. */
const plant: Plant = (state, owner) => {
  const s = tbSlice(state);
  const out: TbSlice = { ...s };
  const canaries: string[] = [];
  if (owner === null) {
    if (s.ba && s.ba.deck.length > 0) {
      const deck = s.ba.deck.map((_, i) => canary(`ba${i}`) as BaCard);
      out.ba = { ...s.ba, deck };
      canaries.push(...deck);
    }
    if (s.traders) {
      const stacks: Record<HexId, Commodity[]> = {};
      for (const [h, st] of Object.entries(s.traders.stacks) as [HexId, Commodity[]][]) {
        stacks[h] = st.map((_, i) => canary(`${h}#${i}`) as Commodity);
        canaries.push(...stacks[h]);
      }
      out.traders = { ...s.traders, stacks };
    }
  } else if (s.traders) {
    // Both piles: their sum is the public card count (as in T&B's own leak test).
    const held = canaryNumber(500 + owner);
    const fresh = canaryNumber(600 + owner);
    const set = (xs: number[], v: number) => xs.map((x, p) => (p === owner ? v : x));
    const { swift } = s.traders;
    out.traders = {
      ...s.traders,
      swift: { ...swift, held: set(swift.held, held), fresh: set(swift.fresh, fresh) },
    };
    canaries.push(String(held), String(fresh));
  }
  return canaries.length > 0 ? { state: withSlice(state, out), canaries } : null;
};

describe('T&B × T&B online views', () => {
  it.each([
    ['tbpair/baTraders', 4, 31],
    ['tbpair/riversTraders', 3, 32],
    ['tbpair/caravansTraders', 4, 33],
    ['tbpair/riversBa', 4, 34],
    ['tbpair/caravansBa', 3, 35],
  ])(
    '%s, %i players: no secret leaks',
    (scenario, players, seed) => {
      const states = sampleStates({ seed, players, mode: TBPAIR_MODE, scenario }, 900, 45);
      expect(states[states.length - 1]?.turn.number).toBeGreaterThan(10);
      const report = expectNoLeak(states, plant);
      expect(report.planted).toBeGreaterThan(5);
    },
    60_000,
  );

  it('Rivers + Caravans: the T&B slice has no secret, every viewer gets it unchanged', () => {
    const states = sampleStates(
      { seed: 36, players: 4, mode: TBPAIR_MODE, scenario: 'tbpair/riversCaravans' },
      500,
      100,
    );
    for (const s of states) {
      for (const v of ['spectator', 0, 1, 2, 3] as const) {
        expect(viewFor(s, v).ext[TB]).toEqual(s.ext[TB]);
      }
    }
  });

  it('BA + T&B: barbarians by paths are public', () => {
    const states = sampleStates(
      { seed: 37, players: 4, mode: TBPAIR_MODE, scenario: 'tbpair/baTraders' },
      1500,
      150,
    );
    for (const s of states) {
      expect(tbSlice(viewFor(s, 1)).ba?.paths).toEqual(tbSlice(s).ba?.paths);
    }
  });
});
