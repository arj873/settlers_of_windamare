// @vitest-environment jsdom
/**
 * Traders & Barbarians online views (engine/mask.ts): opponents' fish tokens and Swift Journey
 * cards, the face-down fish pool, the Barbarian Attack deck, the commodity stacks and the share
 * of Swift Journeys in the dev deck never reach a view (bot games, every viewer); hands are
 * revealed at game over, stacks are not; the HUD renders a masked view.
 */
import { describe, expect, it } from 'vitest';
import {
  createGame,
  devCardCount,
  devDeckCounts,
  HIDDEN_DEV_CARD,
  legalActions,
  viewFor,
  type GameState,
  type HexId,
  type Viewer,
} from '../../engine';
import { Hud } from '../../ui/hud';
import { availability, bankView, buildCards } from '../../ui/model';
import { canary, canaryNumber, expectNoLeak, sampleStates, type Plant } from '../maskTestkit';
import {
  SC_BA,
  SC_BASE,
  SC_CARAVANS,
  SC_FISH,
  SC_RIVERS,
  SC_TRADERS,
  TB,
  tbSlice,
  type BaCard,
  type Commodity,
  type TbSlice,
} from './engine';
import { HIDDEN_BA_CARD, HIDDEN_COMMODITY, HIDDEN_FISH } from './engine/mask';

const withSlice = (state: GameState, s: TbSlice): GameState => ({
  ...state,
  ext: { ...state.ext, [TB]: s },
});

const viewersOf = (s: GameState): Viewer[] => ['spectator', ...s.players.map((p) => p.id)];

const sample = (scenario: string, players: number, seed: number, maxSteps = 900, every = 45) =>
  sampleStates({ seed, players, mode: TB, scenario }, maxSteps, every);

const seats = (n: number) =>
  ['A', 'B', 'C', 'D', 'E', 'F'].slice(0, n).map((name, i) => ({ name, color: `#20202${i}` }));

/** A fresh game of `scenario`, player 0 in the main phase. */
function main(scenario: string, n = 4): GameState {
  const s = createGame({ seed: 7, players: seats(n), mode: TB, scenario, startingPlayer: 0 });
  s.turn = { number: 3, current: 0, devCardPlayed: false, tradeOffers: 0 };
  s.phase = { kind: 'main' };
  return s;
}

/**
 * Canaries in every T&B secret. Global (owner null): the fish pool, the BA deck, the commodity
 * stacks. A seat: its fish tokens and its Swift Journey cards.
 */
const plantTb: Plant = (state, owner) => {
  const s = tbSlice(state);
  const canaries: string[] = [];
  const out: TbSlice = { ...s };
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
    if (s.traders) {
      const held = canaryNumber(500 + owner);
      const fresh = canaryNumber(600 + owner);
      const set = (xs: number[], v: number) => xs.map((x, p) => (p === owner ? v : x));
      out.traders = {
        ...s.traders,
        swift: {
          ...s.traders.swift,
          held: set(s.traders.swift.held, held),
          fresh: set(s.traders.swift.fresh, fresh),
        },
      };
      canaries.push(String(held), String(fresh));
    }
  }
  return canaries.length > 0 ? { state: withSlice(state, out), canaries } : null;
};

describe('T&B online views: no secret leaks in bot games', () => {
  it.each([
    ['Fishermen', 4, SC_FISH, 11, true],
    ['Fishermen (Catan for Two)', 2, SC_FISH, 12, true],
    ['Fishermen', 5, SC_FISH, 13, true],
    ['Barbarian Attack', 3, SC_BA, 14, false],
    ['Barbarian Attack', 5, SC_BA, 15, false],
    ['Traders & Barbarians', 4, SC_TRADERS, 16, true],
    ['Traders & Barbarians (Catan for Two)', 2, SC_TRADERS, 17, true],
    ['Traders & Barbarians', 6, SC_TRADERS, 18, true],
  ])('%s, %i players', (_name, players, scenario, seed, perSeat) => {
    const states = sample(scenario, players, seed);
    const last = states[states.length - 1] as GameState;
    expect(last.turn.number).toBeGreaterThan(10); // the bots played a real game
    const report = expectNoLeak(states, plantTb);
    expect(report.planted).toBeGreaterThan(5);
    if (perSeat) expect(report.ownerSaw).toBeGreaterThan(players);
  });

  it.each([
    [SC_RIVERS, 4, 21],
    [SC_CARAVANS, 4, 22],
    [SC_BASE, 2, 23],
    [SC_BASE, 5, 24],
  ])('%s, %i players: the T&B slice has no secret, every viewer gets it unchanged', (sc, n, k) => {
    for (const s of sample(sc, n, k, 500, 100)) {
      for (const v of viewersOf(s)) expect(viewFor(s, v).ext[TB]).toEqual(s.ext[TB]);
    }
  });
});

describe('T&B online views: shape and reveals', () => {
  it('fish: pool and opponents tokens face down, counts kept, own tokens and the rest public', () => {
    const s = main(SC_FISH);
    const f = tbSlice(s).fish;
    if (!f) throw new Error('no fish');
    f.hands = [[3, 2, 2], [3, 3], [], [1]];
    f.spent = [2, 1];
    f.boot = 2;
    const before = JSON.stringify(s);
    const view = tbSlice(viewFor(s, 1)).fish;
    expect(view?.hands).toEqual([
      [HIDDEN_FISH, HIDDEN_FISH, HIDDEN_FISH],
      [3, 3],
      [],
      [HIDDEN_FISH],
    ]);
    expect(view?.pool).toEqual(f.pool.map(() => HIDDEN_FISH));
    expect(view?.pool.length).toBeGreaterThan(0);
    expect(view?.spent).toEqual([2, 1]);
    expect(view?.boot).toBe(2);
    const spec = tbSlice(viewFor(s, 'spectator')).fish;
    expect(spec?.hands.map((h) => h.length)).toEqual([3, 2, 0, 1]);
    expect(spec?.hands.flat().every((t) => t === HIDDEN_FISH)).toBe(true);
    expect(JSON.stringify(s)).toBe(before); // input untouched
  });

  it('game over: every fish hand and Swift Journey is revealed, the stacks stay face down', () => {
    const fish = main(SC_FISH);
    tbSlice(fish).fish!.hands = [[3, 2], [1], [], []];
    fish.phase = { kind: 'gameOver' };
    const fv = tbSlice(viewFor(fish, 'spectator')).fish;
    expect(fv?.hands).toEqual([[3, 2], [1], [], []]);
    expect(fv?.pool.every((t) => t === HIDDEN_FISH)).toBe(true);

    const tr = main(SC_TRADERS);
    tbSlice(tr).traders!.swift.held = [0, 1, 0, 0];
    tr.phase = { kind: 'gameOver' };
    const tv = tbSlice(viewFor(tr, 2)).traders;
    expect(tv?.swift.held).toEqual([0, 1, 0, 0]);
    const stacks = Object.values(tv?.stacks ?? {});
    expect(stacks.length).toBe(3);
    expect(stacks.flat().every((c) => c === HIDDEN_COMMODITY)).toBe(true);
    expectNoLeak([fish, tr], plantTb);
  });

  it('BA: the card deck is face down with its size; the discard pile is public', () => {
    const s = main(SC_BA);
    const ba = tbSlice(s).ba!;
    ba.discard = ['treason'];
    const v = tbSlice(viewFor(s, 0)).ba;
    expect(v?.deck).toEqual(ba.deck.map(() => HIDDEN_BA_CARD));
    expect(v?.deck.length).toBeGreaterThan(20);
    expect(v?.discard).toEqual(['treason']);
    expect({ ...v, deck: [] }).toEqual({ ...ba, deck: [] });
  });

  it('T&B: commodity stacks keep their sizes; wagons, commodities held and deliveries are public', () => {
    const s = main(SC_TRADERS);
    const t = tbSlice(s).traders!;
    t.commodity = ['glass', null, 'sand', null];
    t.delivered = [2, 0, 1, 0];
    const v = tbSlice(viewFor(s, 'spectator')).traders!;
    for (const [h, st] of Object.entries(t.stacks) as [HexId, Commodity[]][]) {
      expect(v.stacks[h]).toEqual(st.map(() => HIDDEN_COMMODITY));
    }
    expect(v.commodity).toEqual(t.commodity);
    expect(v.delivered).toEqual(t.delivered);
    expect(v.wagons).toEqual(t.wagons);
    expect(v.barbarians).toEqual(t.barbarians);
    expect(v.level).toEqual(t.level);
  });

  it('Swift Journeys: hidden in hands, and their share of the dev deck folds into devDeck', () => {
    const s = main(SC_TRADERS);
    const t = tbSlice(s).traders!;
    t.swift = { deck: 2, held: [0, 1, 0, 0], fresh: [0, 0, 0, 0] };
    const v0 = viewFor(s, 0);
    const v1 = viewFor(s, 1);
    expect(tbSlice(v0).traders?.swift).toEqual({
      deck: 0,
      held: [0, 0, 0, 0],
      fresh: [0, 0, 0, 0],
    });
    expect(tbSlice(v1).traders?.swift.held).toEqual([0, 1, 0, 0]);
    // The public dev card count includes the held Swift Journey, for every viewer.
    for (const v of [v0, v1, viewFor(s, 'spectator')]) {
      expect(devCardCount(v, 1)).toBe(devCardCount(s, 1) + 1);
    }
    // A held Swift Journey and a held base dev card look the same to the others.
    const asDev = structuredClone(s);
    tbSlice(asDev).traders!.swift.held = [0, 0, 0, 0];
    asDev.players[1]!.devCards.knight += 1;
    expect(JSON.stringify(viewFor(asDev, 0))).toBe(JSON.stringify(v0));
    expect(v0.devDeck.length).toBe(s.devDeck.length + 2);
    expect(v0.devDeck.every((c) => c === HIDDEN_DEV_CARD)).toBe(true);
    // The same number of undrawn cards with one Swift Journey fewer (a base card instead): the
    // views cannot tell the two apart.
    const other = structuredClone(s);
    tbSlice(other).traders!.swift.deck = 1;
    other.devDeck.push('roadBuilding');
    for (const viewer of viewersOf(s)) {
      expect(JSON.stringify(viewFor(other, viewer))).toBe(JSON.stringify(viewFor(s, viewer)));
    }
  });
});

describe('dev deck counter with Swift Journeys (extraDevCards)', () => {
  it('counts the 3 Swift Journeys, hotseat and online alike', () => {
    const s = main(SC_TRADERS);
    const base = s.devDeck.length;
    expect(tbSlice(s).traders?.swift.deck).toBe(3);
    // Hotseat (full state): the base deck plus the undrawn Swift Journeys, out of all of them.
    expect(devDeckCounts(s)).toEqual({ left: base + 3, total: base + 3 });
    expect(bankView(s).devDeck).toBe(base + 3);
    const card = buildCards(s, 0, availability(legalActions(s, 0))).find((c) => c.kind === 'dev');
    expect(card).toMatchObject({ left: base + 3, total: base + 3 });
    // Every online view reads the same (the mask folds them into devDeck; total unchanged).
    for (const viewer of viewersOf(s)) {
      const v = viewFor(s, viewer);
      expect(devDeckCounts(v)).toEqual(devDeckCounts(s));
      expect(bankView(v).devDeck).toBe(base + 3);
    }
    // One Swift Journey drawn and one base card drawn: 2 fewer left, the total stays.
    tbSlice(s).traders!.swift.deck = 2;
    s.devDeck.pop();
    expect(devDeckCounts(s)).toEqual({ left: base + 1, total: base + 3 });
    expect(devDeckCounts(viewFor(s, 1))).toEqual(devDeckCounts(s));
  });

  it('adds nothing in the other scenarios or without a dev deck (T&B + C&K)', () => {
    const fish = main(SC_FISH);
    expect(devDeckCounts(fish).total).toBe(fish.devDeck.length);
    const tbck = createGame({ seed: 3, players: seats(4), mode: 'tb+ck', scenario: SC_TRADERS });
    expect(devDeckCounts(tbck)).toEqual({ left: 0, total: 0 });
  });
});

describe('T&B HUD on a masked view', () => {
  it('shows opponents fish as a count, own fish values, no placeholder values', () => {
    const s = main(SC_FISH);
    tbSlice(s).fish!.hands = [[3, 2, 2], [3, 3], [], []];
    const root = document.createElement('div');
    document.body.replaceChildren(root);
    const hud = new Hud(root);
    hud.render(viewFor(s, 1), { viewer: 1, legal: legalActions(s), isBotTurn: false });
    const panel = root.querySelector('.sec-ext-tb');
    const rows = panel?.querySelectorAll('.tb-row');
    expect(rows?.[0]?.textContent).toContain('3×');
    expect(rows?.[0]?.textContent).not.toContain('7');
    expect(rows?.[1]?.textContent).toContain('6');
    expect([...(panel?.querySelectorAll('.tb-chip-fish') ?? [])].map((c) => c.textContent)).toEqual(
      ['3', '3'],
    );
  });

  it('renders a masked Traders & Barbarians view for a spectator-like seat without crashing', () => {
    const s = main(SC_TRADERS);
    tbSlice(s).traders!.swift.held = [1, 0, 0, 0];
    const root = document.createElement('div');
    document.body.replaceChildren(root);
    const hud = new Hud(root);
    expect(() =>
      hud.render(viewFor(s, 2), { viewer: 2, legal: legalActions(s), isBotTurn: false }),
    ).not.toThrow();
    expect(root.textContent).not.toContain('Swift Journey ×');
  });
});
