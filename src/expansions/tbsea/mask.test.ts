/**
 * T&B + Seafarers online views: the pair adds no secret of its own (no slice); the T&B secrets
 * (fish tokens and pool, Barbarian Attack deck, commodity stacks) stay masked when the two
 * modules are composed, and the Seafarers slice reaches every viewer unchanged on New Shores.
 */
import { describe, expect, it } from 'vitest';
import {
  viewFor,
  type DevCardType,
  type EdgeId,
  type GameState,
  type HexId,
  type Terrain,
  type Viewer,
} from '../../engine';
import type { Gift, SeaSlice } from '../seafarers/engine';
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

  // C3: the other Seafarers scenarios (fish hands and pool, BA deck, commodity stacks).
  it.each([
    ['tbsea/fishermenFog', 4, 35, true],
    ['tbsea/fishermenTribe', 3, 36, true],
    ['tbsea/fishermenNewWorld', 4, 37, true],
    ['tbsea/tradersDesert', 4, 38, false],
    ['tbsea/barbarianAttackDesert', 3, 39, false],
  ])('%s, %i players: T&B secrets stay hidden', (scenario, players, seed, perSeat) => {
    const states = sample(scenario, players, seed);
    const report = expectNoLeak(states, plant);
    expect(report.planted).toBeGreaterThan(5);
    if (perSeat) expect(report.ownerSaw).toBeGreaterThan(players);
  });

  it('the Seafarers secrets of the composed scenario stay hidden: fog stacks, Tribe gifts', () => {
    const plantSea: Plant = (state, owner) => {
      if (owner !== null) return null;
      const s = state.ext['seafarers'] as SeaSlice;
      const out: SeaSlice = { ...s };
      const canaries: string[] = [];
      if (s.fog && s.fog.terrains.length > 0) {
        const terrains = s.fog.terrains.map((_, i) => canary(`fog${i}`) as Terrain);
        out.fog = { ...s.fog, terrains };
        canaries.push(...terrains);
      }
      if (s.gifts) {
        const gifts = { ...s.gifts };
        for (const [e, g] of Object.entries(gifts) as [EdgeId, Gift][]) {
          if (g.kind !== 'dev') continue;
          const card = canary(`gift${e}`) as DevCardType;
          gifts[e] = { kind: 'dev', card };
          canaries.push(card);
        }
        out.gifts = gifts;
      }
      if (canaries.length === 0) return null;
      return { state: { ...state, ext: { ...state.ext, seafarers: out } }, canaries };
    };
    for (const [sc, seed] of [
      ['tbsea/riversFog', 40],
      ['tbsea/fishermenTribe', 41],
      ['tbsea/caravansTribe', 42],
    ] as const) {
      expect(expectNoLeak(sample(sc, 4, seed), plantSea).planted, sc).toBeGreaterThan(5);
    }
  });

  it('the pair keeps no slice; the Seafarers slice has no secret on New Shores', () => {
    for (const s of sample('tbsea/caravans', 4, 34)) {
      expect(s.ext[TBSEA]).toBeUndefined();
      for (const v of viewersOf(s))
        expect(viewFor(s, v).ext['seafarers']).toEqual(s.ext['seafarers']);
    }
  });
});
