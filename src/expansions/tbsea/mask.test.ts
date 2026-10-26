/**
 * T&B + Seafarers online views: the pair adds no secret of its own (no slice); the T&B secrets
 * (fish tokens and pool, Barbarian Attack deck, commodity stacks) stay masked when the two
 * modules are composed, and the Seafarers slice reaches every viewer unchanged on New Shores.
 */
import { describe, expect, it } from 'vitest';
import { viewFor, type GameState, type HexId, type Viewer } from '../../engine';
import { canary, canaryNumber, expectNoLeak, sampleStates, type Plant } from '../maskTestkit';
import { TB, tbSlice, type BaCard, type Commodity, type TbSlice } from '../tb/engine';
import { TBSEA, TBSEA_MODE } from './engine';

const viewersOf = (s: GameState): Viewer[] => ['spectator', ...s.players.map((p) => p.id)];
const sample = (scenario: string, players: number, seed: number) =>
  sampleStates({ seed, players, mode: TBSEA_MODE, scenario }, 900, 45);

const plant: Plant = (state, owner) => {
  const s = tbSlice(state);
  const out: TbSlice = { ...s };
  const canaries: string[] = [];
  if (owner === null) {
    if (s.fish && s.fish.pool.length > 0) {
      const pool = s.fish.pool.map((_, i) => canaryNumber(100 + i));
      out.fish = { ...s.fish, pool };
      canaries.push(...pool.map(String));
    }
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
  } else {
    const hand = s.fish?.hands[owner] ?? [];
    if (s.fish && hand.length > 0) {
      const mine = hand.map((_, i) => canaryNumber(owner * 10 + i));
      out.fish = { ...s.fish, hands: s.fish.hands.map((h, p) => (p === owner ? mine : h)) };
      canaries.push(...mine.map(String));
    }
  }
  if (canaries.length === 0) return null;
  return { state: { ...state, ext: { ...state.ext, [TB]: out } }, canaries };
};

describe('T&B + Seafarers online views', () => {
  it.each([
    ['tbsea/fishermen', 4, 31, true],
    ['tbsea/traders', 3, 32, false],
    ['tbsea/barbarianAttack', 4, 33, false],
  ])('%s, %i players: T&B secrets stay hidden', (scenario, players, seed, perSeat) => {
    const states = sample(scenario, players, seed);
    expect((states.at(-1) as GameState).turn.number).toBeGreaterThan(10);
    const report = expectNoLeak(states, plant);
    expect(report.planted).toBeGreaterThan(5);
    if (perSeat) expect(report.ownerSaw).toBeGreaterThan(players);
  });

  it('the pair keeps no slice; the Seafarers slice has no secret on New Shores', () => {
    for (const s of sample('tbsea/caravans', 4, 34)) {
      expect(s.ext[TBSEA]).toBeUndefined();
      for (const v of viewersOf(s))
        expect(viewFor(s, v).ext['seafarers']).toEqual(s.ext['seafarers']);
    }
  });
});
