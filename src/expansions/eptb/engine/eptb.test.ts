/**
 * Explorers & Pirates + Traders & Barbarians (2025 sheet, docs/rules/combos.md §6): the
 * Fishermen of Catan on the E&P island. One test per rule, the composition, soundness.
 */
import { describe, expect, it } from 'vitest';
import { applyAction, legalActions } from '../../../engine/engine';
import { createGame } from '../../../engine/createGame';
import { Rng } from '../../../engine/rng';
import { victoryPoints } from '../../../engine/selectors';
import { hexVertices, topologyOf } from '../../../engine/topology';
import type { Action, GameState, PlayerId, VertexId } from '../../../engine/types';
import { epSlice, freshTurn, shipTurn } from '../../ep/engine';
import { E, H, players, V } from '../../ep/engine/testkit';
import { fishOf, fishOwed, LAKE, tbBoard } from '../../tb/engine';
import { roll } from '../../tb/engine/testkit';
import { EPTB, EPTB_MODE, EPTB_SCENARIOS, GROUND_PLACES, LAKE_HEX, eptbSlice } from '.';

function game(scenario = 'ep/full', n = 4, extra: Record<string, unknown> = {}): GameState {
  return createGame({
    seed: 1,
    players: players(n),
    mode: EPTB_MODE,
    scenario,
    startingPlayer: 0,
    ...extra,
  });
}

/** Player 0 in the Action phase of turn 3: no pieces, empty hands, no gold, no fish. */
function main(scenario = 'ep/full'): GameState {
  const s = game(scenario);
  s.pieces = { buildings: {}, roads: {} };
  for (const p of s.players) {
    for (const r of Object.keys(p.resources) as (keyof typeof p.resources)[]) {
      s.bank[r] += p.resources[r];
      p.resources[r] = 0;
    }
  }
  const e = epSlice(s);
  e.harbors = {};
  e.ships = [];
  e.gold = s.players.map(() => 0);
  e.turn = freshTurn();
  const f = fishOf(s);
  for (const h of f.hands) f.pool.push(...h.splice(0));
  s.turn = { number: 3, current: 0, devCardPlayed: false, tradeOffers: 0 };
  s.phase = { kind: 'main' };
  delete s.stats;
  return s;
}

/** Give `p` fish tokens worth `values` from the pool. */
function setFish(s: GameState, p: PlayerId, values: number[]) {
  const f = fishOf(s);
  for (const t of values) {
    const i = f.pool.indexOf(t);
    if (i < 0) throw new Error(`no ${t} in the pool`);
    f.pool.splice(i, 1);
    (f.hands[p] ??= []).push(t);
  }
}

const run = (s: GameState, ...actions: Action[]): GameState =>
  actions.reduce((st, a) => {
    const r = applyAction(st, a);
    if (!r.ok) throw new Error(`${JSON.stringify(a)}: ${r.error}`);
    return r.state;
  }, s);
const a = (type: string, player: PlayerId, payload: object = {}) =>
  ({ type, player, ...payload }) as unknown as Action;
const fails = (s: GameState, x: Action, match?: RegExp) => {
  const r = applyAction(s, x);
  expect(r.ok, JSON.stringify(x)).toBe(false);
  if (!r.ok && match) expect(r.error).toMatch(match);
};
const legalOf = (s: GameState, type: string, p?: PlayerId) =>
  legalActions(s, p).filter((x) => x.type === type);
const count = (s: GameState, t: string) =>
  Object.values(s.board.hexes).filter((h) => h.terrain === t).length;

describe('the mode', () => {
  it('composes eptb, tb, ep; every 3-4 player E&P scenario; the scenario’s VP target', () => {
    const s = game();
    expect(s.settings.expansions).toEqual([EPTB, 'tb', 'ep']);
    expect(s.settings.vpToWin).toBe(17);
    for (const sc of EPTB_SCENARIOS) expect(game(sc).settings.scenario).toBe(sc);
    expect(() => game('ep/full', 5)).toThrow();
  });

  it('refuses what the sheet calls impossible: Friendly Robber, Harbors of Catan', () => {
    expect(() => game('ep/full', 4, { robberMode: 'friendly' })).toThrow(/Friendly Robber/);
    expect(() => game('ep/full', 4, { options: { tb: { harbormaster: true } } })).toThrow(
      /harbors/,
    );
  });

  it('Event Cards give the numbers only', () => {
    expect(game('ep/full', 4, { eventCards: true }).settings.eventCards).toBe(true);
  });
});

describe('the board', () => {
  it('six fishing grounds where the sheet shows them, numbered 4, 5, 6, 8, 9, 10', () => {
    const s = game();
    const grounds = tbBoard(s).grounds ?? [];
    expect(grounds.map((g) => g.vertices)).toEqual(GROUND_PLACES);
    expect(grounds.map((g) => g.number).sort((x, y) => x - y)).toEqual([4, 5, 6, 8, 9, 10]);
    const t = topologyOf(s);
    for (const g of grounds) for (const v of g.vertices) expect(t.vertex[v]?.coastal).toBe(true);
  });

  it('the lake replaces the 12 (its disc out); the island has one mountain less', () => {
    for (const sc of ['ep/full', 'ep/pirateLairs', 'ep/landHo']) {
      const s = game(sc);
      const without = game(sc, 4, { options: { eptb: { lake: false } } });
      expect(s.board.hexes[LAKE_HEX]?.terrain, sc).toBe(LAKE);
      expect(s.board.hexes[LAKE_HEX]?.token).toBeNull();
      expect(tbBoard(s).lakes).toEqual([{ hex: LAKE_HEX, numbers: [2, 3, 11, 12] }]);
      expect(without.board.hexes[LAKE_HEX]?.token).toBe(12);
      expect(tbBoard(without).lakes).toEqual([]);
      expect(count(s, 'ore'), sc).toBe(count(without, 'ore') - 1);
      for (const r of ['brick', 'lumber', 'wool', 'grain']) {
        expect(count(s, r), `${sc} ${r}`).toBe(count(without, r));
      }
    }
  });
});

describe('fish', () => {
  it('a ground pays its settlements, harbor settlements too (1 fish each)', () => {
    const s = main();
    const g = (tbBoard(s).grounds ?? [])[0];
    if (!g) throw new Error('no ground');
    s.pieces.buildings[g.vertices[0] as VertexId] = { owner: 1, kind: 'settlement' };
    s.pieces.buildings[g.vertices[2] as VertexId] = { owner: 2, kind: 'settlement' };
    epSlice(s).harbors[g.vertices[2] as VertexId] = [];
    const owed = fishOwed(s, g.number);
    expect(owed[1]).toBe(1);
    expect(owed[2]).toBe(1);
  });

  it('only fish from a roll: 1 gold too (fish are no resource cards)', () => {
    const s0 = main();
    const v = hexVertices(topologyOf(s0), LAKE_HEX)[0] as VertexId;
    // A corner of the lake touching no resource hex with a 2: only fish on a 2.
    s0.pieces.buildings[v] = { owner: 1, kind: 'settlement' };
    const s = roll(s0, 1, 1);
    expect(fishOf(s).hands[1]?.length).toBe(1);
    expect(epSlice(s).gold[1]).toBe(1);
  });

  it('a setup settlement on a ground or at the lake takes a fish', () => {
    let s = game();
    for (let i = 0; i < 4; i++) s = run(s, legalOf(s, 'placeSetupSettlement')[0] as Action);
    const ground = GROUND_PLACES[2]?.[0] as VertexId;
    expect(legalOf(s, 'placeSetupSettlement').some((x) => JSON.stringify(x).includes(ground))).toBe(
      true,
    );
    const p = s.turn.current;
    s = run(s, a('placeSetupSettlement', p, { vertex: ground }));
    expect(fishOf(s).hands[p]?.length ?? 0).toBe(1);
  });

  it('T&B uses with nothing to act on are never offered (robber, development card)', () => {
    const s = main();
    setFish(s, 0, [3, 3, 2]);
    const uses = legalOf(s, 'tb/fish').map((x) => (x as unknown as { use: string }).use);
    expect(uses).not.toContain('robber');
    expect(uses).not.toContain('devCard');
    expect(uses).toContain('resource');
  });
});

describe('the E&P fish uses', () => {
  it('2 fish: no tribute to the pirate this turn (ships built later too)', () => {
    let s = main();
    epSlice(s).pirate = { owner: 1, hex: H(9, 4) };
    epSlice(s).ships.push({ id: 1, owner: 0, edge: E(5, 0, 'E'), cargo: [] });
    setFish(s, 0, [2]);
    s = run(s, a('eptb/fish', 0, { use: 'pirate' }));
    expect(eptbSlice(s).freePassage).toEqual([0]);
    expect(shipTurn(epSlice(s), 1).tribute).toBe(true);
    epSlice(s).ships.push({ id: 2, owner: 0, edge: E(5, 0, 'SE'), cargo: [] });
    s = run(s, a('ep/startMovement', 0));
    expect(shipTurn(epSlice(s), 2).tribute).toBe(true);
    s = run(s, a('endTurn', 0));
    expect(eptbSlice(s).freePassage).toEqual([]);
  });

  it('2 fish need an opponent’s pirate', () => {
    const s = main();
    setFish(s, 0, [2]);
    fails(s, a('eptb/fish', 0, { use: 'pirate' }), /pirate/);
    epSlice(s).pirate = { owner: 0, hex: H(9, 4) };
    fails(s, a('eptb/fish', 0, { use: 'pirate' }), /pirate/);
  });

  it('5 fish: a ship at your harbor, in the Action phase', () => {
    let s = main();
    const harbor = V(5, 0, 'SE');
    s.pieces.buildings[harbor] = { owner: 0, kind: 'settlement' };
    epSlice(s).harbors[harbor] = [];
    setFish(s, 0, [3, 2]);
    const spots = legalOf(s, 'eptb/fishShip');
    expect(spots.length).toBeGreaterThan(0);
    s = run(s, spots[0] as Action);
    expect(epSlice(s).ships.filter((x) => x.owner === 0)).toHaveLength(1);
    expect(fishOf(s).hands[0]).toEqual([]);
    const m = main();
    m.pieces.buildings[harbor] = { owner: 0, kind: 'settlement' };
    epSlice(m).harbors[harbor] = [];
    setFish(m, 0, [3, 2]);
    epSlice(m).turn.movement = true;
    expect(legalOf(m, 'eptb/fishShip')).toHaveLength(0);
    fails(m, spots[0] as Action, /Movement/);
  });

  it('5 fish: or a road (T&B’s use), never in the Movement phase', () => {
    const s = main();
    s.pieces.buildings[V(3, 0, 'S')] = { owner: 0, kind: 'settlement' };
    setFish(s, 0, [3, 2]);
    expect(legalOf(s, 'tb/fish').some((x) => JSON.stringify(x).includes('road'))).toBe(true);
    epSlice(s).turn.movement = true;
    expect(legalOf(s, 'tb/fish').some((x) => JSON.stringify(x).includes('road'))).toBe(false);
    fails(s, a('tb/fish', 0, { use: 'road' }), /Movement/);
  });

  it('7 fish: a ship that sailed this turn sails again', () => {
    let s = main();
    epSlice(s).ships.push({ id: 4, owner: 0, edge: E(5, 0, 'E'), cargo: [] });
    epSlice(s).turn.movement = true;
    epSlice(s).turn.ships[4] = { used: 4, extra: false, done: true, tribute: false, chased: false };
    setFish(s, 0, [3, 2, 2]);
    expect(legalOf(s, 'eptb/fish').some((x) => JSON.stringify(x).includes('secondMove'))).toBe(
      true,
    );
    s = run(s, a('eptb/fish', 0, { use: 'secondMove', ship: 4 }));
    expect(shipTurn(epSlice(s), 4)).toMatchObject({ used: 0, done: false });
    expect(legalOf(s, 'ep/moveShip').length).toBeGreaterThan(0);
  });

  it('7 fish need a ship that has sailed', () => {
    const s = main();
    epSlice(s).ships.push({ id: 4, owner: 0, edge: E(5, 0, 'E'), cargo: [] });
    epSlice(s).turn.movement = true;
    setFish(s, 0, [3, 2, 2]);
    fails(s, a('eptb/fish', 0, { use: 'secondMove', ship: 4 }), /not sailed/);
  });
});

describe('the old boot', () => {
  it('its holder needs one more VP', () => {
    const s = main();
    s.pieces.buildings[V(3, 0, 'S')] = { owner: 0, kind: 'settlement' };
    const before = victoryPoints(s, 0);
    fishOf(s).boot = 0;
    expect(victoryPoints(s, 0)).toBe(before - 1);
  });
});

describe('soundness', () => {
  it('every legal action applies during a random game', () => {
    let s = game('ep/fish', 4, { seed: 9 });
    const rng = new Rng(13);
    for (let step = 0; step < 1500 && s.winner === null; step++) {
      const acts = legalActions(s);
      expect(acts.length, `step ${step} ${s.phase.kind}`).toBeGreaterThan(0);
      if (step % 40 === 0) {
        for (const x of acts) {
          const r = applyAction(s, x);
          expect(r.ok, `${JSON.stringify(x)} ${r.ok ? '' : r.error}`).toBe(true);
        }
      }
      const pick = acts.filter((x) => x.type !== 'endTurn' || acts.length === 1);
      s = run(s, rng.pick(pick.length > 0 && rng.float() < 0.8 ? pick : acts));
    }
  });
});
