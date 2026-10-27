import { describe, expect, it } from 'vitest';
import { RESOURCES, hexVertices, topologyOf, type GameState, type LogEntry } from '../../engine';
import { payableProduction } from '../../engine/rules/production';
import { midGame } from '../../engine/fixtures';
import { rollTotal, run } from '../../engine/actions/testkit';
import {
  Coalescer,
  FLIGHT_MS,
  LAUNCH_WINDOW_MS,
  MAX_CARDS,
  RAPID_MS,
  newLogEntries,
  parseGain,
  productionPlan,
  timeline,
  type ProductionPlan,
} from './plan';

/** midGame with Blue's turn ended: White (2) is about to roll. */
function preRoll(): GameState {
  return run(midGame(), { type: 'endTurn', player: 1 });
}

const e = (turn: number, player: number | null, text: string): LogEntry => ({ turn, player, text });

describe('newLogEntries', () => {
  it('returns what was appended', () => {
    const a = [e(1, 0, 'Red rolled 8 (4+4)'), e(1, 0, 'Red built a road')];
    expect(newLogEntries(a, [...a, e(1, 1, 'x')])).toEqual([e(1, 1, 'x')]);
    expect(newLogEntries(a, a)).toEqual([]);
  });

  it('finds the old tail in a trimmed log', () => {
    const old = Array.from({ length: 10 }, (_, i) => e(i, 0, `line ${i}`));
    const trimmed = [...old.slice(3), e(10, 1, 'new')];
    expect(newLogEntries(old, trimmed)).toEqual([e(10, 1, 'new')]);
  });

  it('is empty when the logs do not belong together', () => {
    expect(newLogEntries([e(5, 0, 'a'), e(5, 0, 'b')], [e(0, null, 'other game')])).toEqual([]);
  });

  it('does not mistake a repeated line for the old tail', () => {
    const old = [e(1, 0, 'A'), e(1, 0, 'Red rolled 8 (4+4)')];
    const next = [...old, e(2, 0, 'B'), e(2, 0, 'Red rolled 8 (4+4)')];
    expect(newLogEntries(old, next)).toEqual(next.slice(2));
  });
});

describe('parseGain', () => {
  it('reads card lists, "a" and "and"', () => {
    expect(parseGain('2 grain, 1 ore')).toEqual([
      { kind: 'grain', count: 2 },
      { kind: 'ore', count: 1 },
    ]);
    expect(parseGain('a fish')).toEqual([{ kind: 'fish', count: 1 }]);
    expect(parseGain('1 paper and 1 coin')).toEqual([
      { kind: 'paper', count: 1 },
      { kind: 'coin', count: 1 },
    ]);
  });

  it('rejects anything that is not a card list', () => {
    expect(parseGain('a development card')).toBeNull();
    expect(parseGain('a gift: 1 victory point')).toBeNull();
    expect(parseGain('the trade metropolis from Red')).toBeNull();
  });
});

describe('productionPlan (engine rolls)', () => {
  const totals = (plan: ProductionPlan | null) =>
    Object.fromEntries(
      (plan?.gains ?? []).map((g) => [
        g.player,
        Object.fromEntries(g.items.map((it) => [it.kind, it.count])),
      ]),
    );

  for (const roll of [2, 3, 4, 5, 6, 8, 9, 10, 11, 12]) {
    it(`matches what the engine paid on a ${roll}`, () => {
      const prev = preRoll();
      const next = rollTotal(prev, roll);
      const paid = payableProduction(prev, roll);
      const want: Record<number, Record<string, number>> = {};
      paid.forEach((hand, p) => {
        const got = Object.fromEntries(
          RESOURCES.filter((r) => hand[r] > 0).map((r) => [r, hand[r]]),
        );
        if (Object.keys(got).length > 0) want[p] = got;
      });
      const plan = productionPlan(prev, next);
      expect(totals(plan)).toEqual(want);
      expect(plan === null || plan.roll === roll).toBe(true);

      // Every card flies from a hex of its terrain, with the roll, next to the player.
      const t = topologyOf(next);
      for (const g of plan?.gains ?? []) {
        for (const it of g.items) {
          expect(it.from).not.toBeNull();
          const hex = next.board.hexes[it.from as never];
          expect(hex?.token).toBe(roll);
          expect(hex?.terrain).toBe(it.kind);
          const owners = hexVertices(t, it.from as never).map(
            (v) => next.pieces.buildings[v]?.owner,
          );
          expect(owners).toContain(g.player);
        }
      }
    });
  }

  it('shows the robber hex when it blocks the roll', () => {
    const prev = preRoll();
    const t = topologyOf(prev);
    // Put the robber on a numbered hex next to a building.
    const hex = t.landHexes.find(
      (h) => prev.board.hexes[h]?.token && hexVertices(t, h).some((v) => prev.pieces.buildings[v]),
    );
    expect(hex).toBeDefined();
    const robbed: GameState = { ...prev, robber: hex as never };
    const roll = prev.board.hexes[hex as never]?.token as number;
    const plan = productionPlan(robbed, rollTotal(robbed, roll));
    expect(plan?.blocked).toBe(hex);
    // Nothing flies from the robber's hex.
    for (const g of plan?.gains ?? []) for (const it of g.items) expect(it.from).not.toBe(hex);
    // The robber elsewhere: no block.
    const free = productionPlan(prev, rollTotal(prev, roll));
    expect(free?.blocked ?? null).toBe(prev.robber === hex ? hex : null);
  });

  it('is null without a previous state, on a 7, and on non-roll changes', () => {
    const prev = preRoll();
    expect(productionPlan(null, rollTotal(prev, 8))).toBeNull();
    expect(productionPlan(prev, rollTotal(prev, 7))).toBeNull();
    const rolled = rollTotal(prev, 8);
    const built = {
      ...rolled,
      log: [...rolled.log, e(rolled.turn.number, 3, 'Orange built a road')],
    };
    expect(productionPlan(rolled, built)).toBeNull();
    // Another game (seed) never animates.
    const other = { ...rolled, settings: { ...rolled.settings, seed: 'elsewhere' } };
    expect(productionPlan(prev, other)).toBeNull();
  });
});

describe('productionPlan (expansion log lines)', () => {
  /** A rolled state plus extra log lines, as an expansion's afterProduction would write them. */
  const withLines = (lines: [number, string][], roll = 8) => {
    const prev = preRoll();
    const n = prev.turn.number;
    const next: GameState = {
      ...prev,
      dice: [4, roll - 4],
      log: [
        ...prev.log,
        e(n, 3, `Orange rolled ${roll} (4+${roll - 4})`),
        ...lines.map(([p, text]) => e(n, p, text)),
      ],
    };
    return { prev, next };
  };

  it('reads commodities, gold, fish and oil', () => {
    const { prev, next } = withLines([
      [0, 'Red received 1 paper, 2 coin'],
      [1, 'Blue received 2 gold'],
      [2, 'White caught 2 fish'],
      [3, 'Orange received 1 oil'],
      [3, 'Orange received 1 ore'],
    ]);
    const plan = productionPlan(prev, next);
    expect(plan?.gains.map((g) => [g.player, g.items.map((i) => `${i.count} ${i.kind}`)])).toEqual([
      [0, ['1 paper', '2 coin']],
      [1, ['2 gold']],
      [2, ['2 fish']],
      [3, ['1 oil', '1 ore']],
    ]);
  });

  it('takes a later gold pick, not steals or other takes', () => {
    const { next: rolled } = withLines([]);
    const n = rolled.turn.number;
    const pick = { ...rolled, log: [...rolled.log, e(n, 0, 'Red took 1 ore, 1 wool (gold)')] };
    expect(productionPlan(rolled, pick)?.gains).toEqual([
      {
        player: 0,
        items: [
          { kind: 'ore', count: 1, from: null },
          { kind: 'wool', count: 1, from: null },
        ],
      },
    ]);
    const steal = { ...rolled, log: [...rolled.log, e(n, 3, 'Orange took 5 ore')] };
    expect(productionPlan(rolled, steal)).toBeNull();
  });

  it('ignores lines of an earlier turn', () => {
    const prev = preRoll();
    const next = { ...prev, log: [...prev.log, e(prev.turn.number, 0, 'Red received 1 ore')] };
    // midGame's last roll ("Blue rolled 8") is turn 12; Orange has not rolled yet.
    expect(productionPlan(prev, next)).toBeNull();
  });
});

describe('timeline', () => {
  const plan = (counts: number[]): ProductionPlan => ({
    roll: 8,
    blocked: null,
    gains: counts.map((n, p) => ({ player: p, items: [{ kind: 'grain', count: n, from: null }] })),
  });

  it('staggers cards player after player and stays near a second', () => {
    const t = timeline(plan([2, 1, 3]));
    expect(t.flights.map((f) => f.player)).toEqual([0, 0, 1, 2, 2, 2]);
    const delays = t.flights.map((f) => f.delay);
    expect([...delays].sort((a, b) => a - b)).toEqual(delays);
    expect(t.end).toBeLessThanOrEqual(LAUNCH_WINDOW_MS + FLIGHT_MS);
    expect(t.end).toBeGreaterThanOrEqual(FLIGHT_MS);
    // A player's badge pops when their first card lands.
    expect(t.badges).toEqual([
      { player: 0, at: FLIGHT_MS },
      { player: 1, at: (delays[2] ?? 0) + FLIGHT_MS },
      { player: 2, at: (delays[3] ?? 0) + FLIGHT_MS },
    ]);
  });

  it('caps the cards in the air; the badge still counts them all', () => {
    const t = timeline(plan([9, 9, 9, 9, 9, 9, 9, 9]));
    expect(t.flights.length).toBe(MAX_CARDS);
    expect(t.end).toBeLessThanOrEqual(LAUNCH_WINDOW_MS + FLIGHT_MS);
  });

  it('without flights shows every badge at once', () => {
    expect(timeline(plan([1, 2]), false)).toEqual({
      flights: [],
      badges: [
        { player: 0, at: 0 },
        { player: 1, at: 0 },
      ],
      end: 0,
    });
  });
});

describe('Coalescer', () => {
  it('flies unless rolls come in fast or motion is off', () => {
    const c = new Coalescer();
    expect(c.next(0, true)).toBe(true);
    expect(c.next(RAPID_MS - 1, true)).toBe(false); // fast bots: badges only
    expect(c.next(RAPID_MS * 2 + 10, true)).toBe(true);
    expect(c.next(RAPID_MS * 10, false)).toBe(false);
  });

  it('a burst of rolls keeps skipping until the bots slow down', () => {
    const c = new Coalescer();
    const out = [0, 100, 200, 300, 400, 2000].map((t) => c.next(t, true));
    expect(out).toEqual([true, false, false, false, false, true]);
  });
});
