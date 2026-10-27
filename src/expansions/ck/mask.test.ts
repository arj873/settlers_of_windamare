// @vitest-environment jsdom
/**
 * Cities & Knights online views (engine/mask.ts): progress hands, the commodity split and the
 * three stacks never reach another seat's (or a spectator's) view, in C&K, Seafarers + C&K and
 * T&B + C&K bot games; Spy and Master Merchant reveal to their player only; a game over reveals
 * the hands but not the stacks; the log names no secret card; the HUD renders a masked view.
 */
import { describe, expect, it } from 'vitest';
import { legalActions, viewFor, type Action, type GameState, type PlayerId } from '../../engine';
import { Hud } from '../../ui/hud';
import { canary, canaryNumber, expectNoLeak, sampleStates, type Plant } from '../maskTestkit';
import type { GameSetup } from '../../bots/runner';
import {
  CARD_NAMES,
  CK,
  HIDDEN_PROGRESS_CARD,
  TRACKS,
  VP_CARDS,
  ckSlice,
  commodityCount,
  phaseOf,
  type CkSlice,
  type ProgressCard,
} from './engine';
import { V, build, ckMain, giveCards, setGoods } from './engine/testkit';
import { SEACK_MODE } from '../seack/engine';
import { TBCK_MODE } from '../tbck/engine';
import { EPCK_MODE } from '../epck/engine';
import { BACK_MODE } from '../back/engine';
import { TWOCK_MODE } from '../twock/engine';

const withSlice = (state: GameState, s: CkSlice): GameState => ({
  ...state,
  ext: { ...state.ext, [CK]: s },
});

/** The victim the current card phase lets its player look at (Spy / Master Merchant). */
function lookedAt(state: GameState, card: 'spy' | 'masterMerchant'): PlayerId | null {
  const phase = phaseOf(state);
  if (phase.kind !== 'ck/card' || (phase.card !== 'spy' && phase.card !== 'masterMerchant')) {
    return null;
  }
  return phase.card === card ? phase.victim : null;
}

/** Canaries as `owner`'s progress hand (at least one card). */
const plantProgress: Plant = (state, owner) => {
  if (owner === null || lookedAt(state, 'spy') === owner) return null;
  const s = ckSlice(state);
  const n = Math.max(1, s.players[owner]?.progress.length ?? 0);
  const cards = Array.from({ length: n }, (_, i) => canary(`p${owner}-${i}`) as ProgressCard);
  const players = s.players.map((pl, p) => (p === owner ? { ...pl, progress: cards } : pl));
  return { state: withSlice(state, { ...s, players }), canaries: cards };
};

/** Canary numbers as `owner`'s commodity split. */
const plantCommodities: Plant = (state, owner) => {
  if (owner === null || lookedAt(state, 'masterMerchant') === owner) return null;
  const s = ckSlice(state);
  const commodities = { paper: canaryNumber(1), cloth: canaryNumber(2), coin: canaryNumber(3) };
  const players = s.players.map((pl, p) => (p === owner ? { ...pl, commodities } : pl));
  return {
    state: withSlice(state, { ...s, players }),
    canaries: Object.values(commodities).map(String),
  };
};

/** Canaries as the three stacks (global secret). */
const plantDecks: Plant = (state, owner) => {
  if (owner !== null) return null;
  const s = ckSlice(state);
  const canaries: string[] = [];
  const stack = (t: string, n: number) =>
    Array.from({ length: Math.max(1, n) }, (_, i) => {
      const c = canary(`${t}${i}`);
      canaries.push(c);
      return c as ProgressCard;
    });
  const decks = {
    trade: stack('trade', s.decks.trade.length),
    politics: stack('politics', s.decks.politics.length),
    science: stack('science', s.decks.science.length),
  };
  return { state: withSlice(state, { ...s, decks }), canaries };
};

/** Non-VP card names may appear in the log only where the card is played (public). */
const SECRET_NAMES = (Object.keys(CARD_NAMES) as ProgressCard[])
  .filter((c) => !VP_CARDS.includes(c))
  .map((c) => CARD_NAMES[c]);
function expectLogNamesNoSecretCard(states: readonly GameState[]) {
  for (const s of states) {
    for (const e of s.log) {
      if (/ played /.test(e.text)) continue;
      const named = SECRET_NAMES.filter((n) => e.text.includes(n));
      expect(named, e.text).toEqual([]);
    }
  }
}

function checkGame(setup: GameSetup, maxSteps = 1500, every = 50) {
  const states = sampleStates(setup, maxSteps, every);
  const progress = expectNoLeak(states, plantProgress);
  const goods = expectNoLeak(states, plantCommodities);
  const decks = expectNoLeak(states, plantDecks);
  expect(progress.ownerSaw).toBeGreaterThan(5);
  expect(goods.ownerSaw).toBeGreaterThan(5);
  expect(decks.planted).toBeGreaterThan(5);
  expectLogNamesNoSecretCard(states);
  return states;
}

describe('C&K online views: secrets in bot games', () => {
  it.each([
    [3, 'ck/starter', 11],
    [4, 'ck/classic', 12],
    [6, 'ck/classic', 13],
  ])(
    'C&K, %i players (%s): hands, commodities and stacks stay hidden',
    (players, scenario, seed) => {
      const states = checkGame({ seed, players, mode: CK, scenario });
      // The game got somewhere: progress cards were drawn.
      const last = ckSlice(states[states.length - 1] as GameState);
      const left = TRACKS.reduce((n, t) => n + last.decks[t].length, 0);
      expect(left).toBeLessThan(54);
    },
  );

  it('Seafarers + C&K: the C&K mask runs (hands, commodities, stacks)', () => {
    checkGame({ seed: 21, players: 4, mode: SEACK_MODE, scenario: 'seafarers/newShores' });
  });

  it.each(['tb/fishermen', 'tb/rivers'])('T&B + C&K (%s): the C&K mask runs', (scenario) => {
    checkGame({ seed: 31, players: 4, mode: TBCK_MODE, scenario });
  });

  it('E&P + C&K: the C&K mask runs (hands, commodities, stacks)', () => {
    checkGame({ seed: 41, players: 4, mode: EPCK_MODE, scenario: 'ep/pirateLairs' }, 3000, 60);
  }, 60_000);

  it('Barbarian Attack + C&K: the C&K mask runs (hands, commodities, stacks)', () => {
    checkGame({ seed: 51, players: 4, mode: BACK_MODE, scenario: 'tb/barbarianAttack' }, 3000, 60);
  }, 60_000);

  it('Catan for Two + C&K: the C&K mask runs (neutral knights are no seat)', () => {
    checkGame({ seed: 61, players: 2, mode: TWOCK_MODE, scenario: 'tb/variants' }, 3000, 60);
  }, 60_000);
});

describe('C&K online views: shape and reveals', () => {
  /** Player 0 holds two progress cards and commodities; player 1 too. */
  function hands(): GameState {
    const s = ckMain(4);
    giveCards(s, 0, 'spy', 'crane');
    giveCards(s, 1, 'bishop', 'alchemist', 'merchant');
    setGoods(s, 0, { coin: 2, paper: 1 });
    setGoods(s, 1, { cloth: 3, ore: 2 });
    return s;
  }

  it('keeps hand and stack sizes, zeroes the split, publishes commodity totals', () => {
    const s = hands();
    const before = JSON.stringify(s);
    const full = ckSlice(s);
    const v = viewFor(s, 2);
    const m = ckSlice(v);
    expect(m.players[1]?.progress).toEqual([
      HIDDEN_PROGRESS_CARD,
      HIDDEN_PROGRESS_CARD,
      HIDDEN_PROGRESS_CARD,
    ]);
    expect(m.players[1]?.commodities).toEqual({ paper: 0, cloth: 0, coin: 0 });
    for (const t of TRACKS) {
      expect(m.decks[t]).toEqual(full.decks[t].map(() => HIDDEN_PROGRESS_CARD));
    }
    expect(m.commodityCounts).toEqual([3, 3, 0, 0]);
    expect([0, 1, 2, 3].map((p) => commodityCount(v, p))).toEqual([3, 3, 0, 0]);
    expect([0, 1, 2, 3].map((p) => commodityCount(s, p))).toEqual([3, 3, 0, 0]);
    // Everything public is the same as in the full slice.
    const strip = (x: CkSlice) => ({ ...x, players: undefined, decks: undefined });
    expect({ ...strip(m), commodityCounts: undefined }).toEqual(strip(full));
    expect(m.players.map((p) => ({ ...p, progress: [], commodities: null }))).toEqual(
      full.players.map((p) => ({ ...p, progress: [], commodities: null })),
    );
    // The owner sees their own hand.
    expect(ckSlice(viewFor(s, 1)).players[1]).toEqual(full.players[1]);
    expect(JSON.stringify(s)).toBe(before); // input untouched
    expect(ckSlice(s).commodityCounts).toBeUndefined();
  });

  it('Spy: the spy player sees the victim’s progress cards, nobody else does', () => {
    const s = hands();
    s.phase = { kind: 'ck/card', card: 'spy', victim: null } as never;
    expect(ckSlice(viewFor(s, 0)).players[1]?.progress).toEqual(
      Array(3).fill(HIDDEN_PROGRESS_CARD),
    );
    s.phase = { kind: 'ck/card', card: 'spy', victim: 1 } as never;
    expect(ckSlice(viewFor(s, 0)).players[1]?.progress).toEqual([
      'bishop',
      'alchemist',
      'merchant',
    ]);
    for (const v of [2, 3, 'spectator'] as const) {
      expect(ckSlice(viewFor(s, v)).players[1]?.progress).toEqual(
        Array(3).fill(HIDDEN_PROGRESS_CARD),
      );
    }
    // The victim does not see the spy's hand; the spy sees nobody else's.
    expect(ckSlice(viewFor(s, 1)).players[0]?.progress).toEqual(
      Array(2).fill(HIDDEN_PROGRESS_CARD),
    );
    giveCards(s, 2, 'wedding');
    expect(ckSlice(viewFor(s, 0)).players[2]?.progress).toEqual([HIDDEN_PROGRESS_CARD]);
    // The commodities stay hidden.
    expect(ckSlice(viewFor(s, 0)).players[1]?.commodities).toEqual({ paper: 0, cloth: 0, coin: 0 });
  });

  it('Master Merchant: its player sees the victim’s resources and commodities only', () => {
    const s = hands();
    s.phase = { kind: 'ck/card', card: 'masterMerchant', victim: 1, left: 2 } as never;
    const v0 = viewFor(s, 0);
    expect(v0.players[1]?.resources).toEqual(s.players[1]?.resources);
    expect(ckSlice(v0).players[1]?.commodities).toEqual({ paper: 0, cloth: 3, coin: 0 });
    expect(ckSlice(v0).players[1]?.progress).toEqual(Array(3).fill(HIDDEN_PROGRESS_CARD));
    for (const v of [2, 3, 'spectator'] as const) {
      const view = viewFor(s, v);
      expect(view.players[1]?.resources.ore).toBe(0);
      expect(ckSlice(view).players[1]?.commodities.cloth).toBe(0);
    }
    expect(viewFor(s, 1).players[0]?.resources.ore).toBe(0);
    expect(ckSlice(viewFor(s, 1)).players[0]?.commodities.coin).toBe(0);
  });

  it('a game over reveals every hand but not the stacks', () => {
    const s = { ...hands(), phase: { kind: 'gameOver' as const } } as GameState;
    const full = ckSlice(s);
    for (const v of [0, 2, 'spectator'] as const) {
      const m = ckSlice(viewFor(s, v));
      expect(m.players).toEqual(full.players);
      for (const t of TRACKS) {
        expect(m.decks[t]).toEqual(full.decks[t].map(() => HIDDEN_PROGRESS_CARD));
      }
    }
    expectNoLeak([s], plantDecks);
  });
});

describe('C&K HUD on an online view', () => {
  const render = (full: GameState, viewer: PlayerId | null) => {
    const root = document.createElement('div');
    document.body.replaceChildren(root);
    const hud = new Hud(root);
    const sent: Action[] = [];
    hud.on('action', (a) => sent.push(a));
    const legal = viewer === null ? [] : legalActions(full).filter((a) => a.player === viewer);
    hud.render(viewFor(full, viewer ?? 'spectator'), {
      viewer: viewer ?? -1,
      legal,
      isBotTurn: false,
      ...(viewer === null ? { spectator: true } : {}),
    });
    return { root, sent };
  };

  function hands(): GameState {
    const s = ckMain(4);
    giveCards(s, 0, 'spy', 'crane');
    giveCards(s, 1, 'bishop');
    setGoods(s, 0, { coin: 2, paper: 1 });
    setGoods(s, 1, { cloth: 1 });
    return s;
  }

  it('shows opponents’ counts, the own hand for real, no hidden card names', () => {
    const s = hands();
    const { root } = render(s, 1);
    const rows = [...root.querySelectorAll('.sec-ext-ck .ck-row')];
    expect(rows).toHaveLength(4);
    const stats = (i: number) =>
      [...(rows[i]?.querySelectorAll('.ck-stat') ?? [])].map((e) => e.textContent?.trim());
    expect(stats(0).slice(1)).toEqual(['3', '🂠 2']); // commodities total, progress count
    expect(stats(1).slice(1)).toEqual(['1', '🂠 1']);
    // Own progress card listed by name; the opponent's never (nor the placeholder's).
    expect(root.textContent).toContain('Bishop');
    expect(root.textContent).not.toContain('Spy');
    expect(root.textContent).not.toContain('Crane');
    expect(root.textContent).not.toContain(CARD_NAMES[HIDDEN_PROGRESS_CARD]);
    expect(root.querySelector('.hand .ck-hp .count-badge')?.textContent).toBe('1');
  });

  it('a spectator view renders counts only', () => {
    const { root } = render(hands(), null);
    const rows = [...root.querySelectorAll('.sec-ext-ck .ck-row')];
    expect(rows[0]?.textContent).toContain('3');
    expect(root.textContent).not.toContain('Bishop');
    expect(root.textContent).not.toContain('Spy');
  });

  it('Master Merchant: victims and goods come from the legal actions, not the masked view', () => {
    const s = hands();
    build(s, 1, V(0, 0, 'S'), 'city'); // player 1 has more VP (and a card)
    s.phase = { kind: 'ck/card', card: 'masterMerchant', victim: null, left: 2 } as never;
    const first = render(s, 0);
    const name = s.players[1]?.name ?? '';
    const pick = [...first.root.querySelectorAll('button')].find((b) =>
      b.textContent?.includes(name),
    );
    expect(pick).toBeDefined();
    pick?.click();
    expect(first.sent.at(-1)).toEqual({ type: 'ck/pickPlayer', player: 0, target: 1 });
    s.phase = { kind: 'ck/card', card: 'masterMerchant', victim: 1, left: 2 } as never;
    const second = render(s, 0);
    expect(second.root.textContent).toContain('Cloth');
  });

  it('Spy: the spy player picks from the victim’s real cards', () => {
    const s = hands();
    s.phase = { kind: 'ck/card', card: 'spy', victim: 1 } as never;
    const { root, sent } = render(s, 0);
    const pick = [...root.querySelectorAll('button.ck-choice')].find((b) =>
      b.textContent?.includes('Bishop'),
    ) as HTMLButtonElement | undefined;
    pick?.click();
    expect(sent.at(-1)).toEqual({ type: 'ck/pickCard', player: 0, card: 'bishop' });
  });
});
