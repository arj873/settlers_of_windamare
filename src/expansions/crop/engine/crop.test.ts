/** Crop Trust rules (docs/rules/crop-trust.md): one test per rule, plus a soundness test. */
import { describe, expect, it } from 'vitest';
import { RESOURCES } from '../../../engine/constants';
import { applyAction, legalActions } from '../../../engine/engine';
import { createGame } from '../../../engine/createGame';
import { Rng } from '../../../engine/rng';
import { victoryPoints } from '../../../engine/selectors';
import { hexVertices, topologyOf } from '../../../engine/topology';
import {
  expectConserved,
  expectFail,
  expectOk,
  rngForRoll,
  run,
  setHand,
} from '../../../engine/actions/testkit';
import type { Action, GameState, HexId, PlayerId, VertexId } from '../../../engine/types';
import {
  CROP,
  SPECIES,
  TOKENS_PER_SPECIES,
  adjacentFields,
  cropSlice,
  emptyCounts,
  emptyFields,
  fieldsHexes,
  recordVp,
  storedCount,
  totalOf,
  type CropCounts,
  type CropEvent,
  type Species,
} from '.';

const players = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ name: `P${i}`, color: `#10101${i}` }));

function cropGame(n = 4, seed: number | string = 1, scenario = 'crop/cropTrust'): GameState {
  return createGame({ seed, players: players(n), mode: CROP, scenario, startingPlayer: 0 });
}

function mainGame(n = 4): GameState {
  const s = cropGame(n);
  s.turn = { number: 3, current: 0, devCardPlayed: false, tradeOffers: 0 };
  s.phase = { kind: 'main' };
  return s;
}

const act = (s: GameState, a: Record<string, unknown>) => applyAction(s, a as unknown as Action);
const flag = (a: Action, key: string): unknown => (a as Record<string, unknown>)[key];

/** The fields hex carrying `token` (first one). */
function fieldsWith(s: GameState, token: number): HexId {
  const h = fieldsHexes(s).find((x) => s.board.hexes[x]?.token === token);
  if (!h) throw new Error(`no fields hex ${token}`);
  return h;
}

function build(s: GameState, p: PlayerId, hex: HexId, i: number, kind: 'settlement' | 'city') {
  const v = hexVertices(topologyOf(s), hex)[i] as VertexId;
  s.pieces.buildings[v] = { owner: p, kind };
  return v;
}

function setCrops(s: GameState, hex: HexId, counts: Partial<CropCounts>): void {
  const slice = cropSlice(s);
  const c = slice.crops[hex] as CropCounts;
  for (const sp of SPECIES) {
    const want = counts[sp] ?? 0;
    slice.supply[sp] += c[sp] - want;
    c[sp] = want;
  }
}

/** Tokens of one species everywhere: board + supply + vaults + records + box + in hand. */
function speciesTotal(s: GameState, sp: Species): number {
  const c = cropSlice(s);
  const phase = s.phase;
  return (
    fieldsHexes(s).reduce((n, h) => n + (c.crops[h]?.[sp] ?? 0), 0) +
    c.supply[sp] +
    c.box[sp] +
    c.vault.reduce((n, v) => n + (v.species === sp ? v.count : 0), 0) +
    c.record.reduce(
      (n, r) => n + r.top.filter((x) => x === sp).length + r.bottom.filter((x) => x === sp).length,
      0,
    ) +
    (phase.kind === 'crop/replant' && phase['species'] === sp ? (phase['left'] as number) : 0)
  );
}

function eventTotal(s: GameState): number {
  const c = cropSlice(s);
  return (
    c.stack.length +
    c.used.length +
    c.boxed +
    c.pieces.reduce((n, p) => n + p.settlement.length + p.city.length, 0) +
    (c.cards.longestRoad ? 1 : 0) +
    (c.cards.largestArmy ? 1 : 0)
  );
}

const small = (s: Species): CropEvent => ({ k: 'small', s });

describe('crop setup', () => {
  it('first-game board: 5 fields hexes, no desert, three 9s, robber on the pasture 2', () => {
    const s = cropGame();
    expect(s.settings).toMatchObject({
      mode: 'crop',
      scenario: 'crop/cropTrust',
      map: 'crop/first19',
      vpToWin: 10,
    });
    const hexes = Object.values(s.board.hexes);
    const count = (t: string) => hexes.filter((h) => h.terrain === t).length;
    expect(count('grain')).toBe(5);
    expect(count('desert')).toBe(0);
    expect(count('lumber')).toBe(4);
    expect(count('wool')).toBe(4);
    expect(count('brick')).toBe(3);
    expect(count('ore')).toBe(3);
    expect(hexes.filter((h) => h.token === 9)).toHaveLength(3);
    expect(hexes.every((h) => h.token !== null)).toBe(true);
    expect(s.board.hexes[s.robber]).toMatchObject({ terrain: 'wool', token: 2 });
  });

  it('puts crops on each fields hex by its number', () => {
    const s = cropGame();
    const crops = (n: number) => cropSlice(s).crops[fieldsWith(s, n)] as CropCounts;
    expect(crops(3)).toEqual({ ...emptyCounts(), quinoa: 1, maize: 1 });
    expect(crops(4)).toEqual({ ...emptyCounts(), quinoa: 1, maize: 1, wheat: 1 });
    expect(crops(9)).toEqual({ ...emptyCounts(), quinoa: 1, maize: 1, wheat: 1, beans: 1 });
    expect(crops(6)).toEqual({ beans: 1, maize: 1, quinoa: 1, rice: 1, wheat: 1 });
    expect(crops(10)).toEqual({ ...emptyCounts(), quinoa: 1, maize: 1, wheat: 1 });
  });

  it('seeds the vaults: the starting player rice, then beans, wheat, maize clockwise', () => {
    const s = createGame({ seed: 2, players: players(4), mode: CROP, startingPlayer: 2 });
    expect(cropSlice(s).vault).toEqual([
      { species: 'wheat', count: 4 }, // seat 0: third from the start (seat 2 = rice, 3 = beans, 0 = wheat)
      { species: 'maize', count: 4 },
      { species: 'rice', count: 4 },
      { species: 'beans', count: 4 },
    ]);
  });

  it('keeps 18 tokens of each species (90 in all) and 41 event tokens', () => {
    for (const n of [3, 4]) {
      const s = cropGame(n);
      for (const sp of SPECIES) expect(speciesTotal(s, sp), sp).toBe(TOKENS_PER_SPECIES);
      expect(eventTotal(s)).toBe(41);
      expect(cropSlice(s).stack).toHaveLength(41 - 7 * n - 2);
      for (const p of cropSlice(s).pieces) {
        expect(p.settlement).toHaveLength(3);
        expect(p.city).toHaveLength(4);
      }
    }
  });

  it('variable setup: shuffled terrain on the printed numbers, robber on the 2', () => {
    const a = cropGame(4, 5, 'crop/cropTrustVariable');
    const b = cropGame(4, 6, 'crop/cropTrustVariable');
    expect(a.settings.map).toBe('crop/random19');
    expect(fieldsHexes(a)).toHaveLength(5);
    expect(a.board.hexes[a.robber]?.token).toBe(2);
    expect(Object.values(a.board.hexes).map((h) => h.terrain)).not.toEqual(
      Object.values(b.board.hexes).map((h) => h.terrain),
    );
    for (const sp of SPECIES) expect(speciesTotal(a, sp)).toBe(TOKENS_PER_SPECIES);
  });

  it('is deterministic and JSON-safe, 3-4 players only', () => {
    expect(cropGame(4, 9)).toEqual(cropGame(4, 9));
    expect(JSON.parse(JSON.stringify(cropGame(3, 9)))).toEqual(cropGame(3, 9));
    expect(() => createGame({ seed: 1, players: players(5), mode: CROP })).toThrow(/3-4/);
  });
});

describe('harvesting', () => {
  function rolled(s: GameState, roll: number): GameState {
    s.turn = { number: 3, current: 0, devCardPlayed: false, tradeOffers: 0 };
    s.phase = { kind: 'preRoll' };
    s.rng = rngForRoll(roll);
    return run(s, { type: 'rollDice', player: 0 });
  }

  it('fields no longer pay grain; other terrains still pay', () => {
    const s = cropGame();
    const f = fieldsWith(s, 6);
    const ore = (Object.keys(s.board.hexes) as HexId[]).find(
      (h) => s.board.hexes[h]?.terrain === 'ore' && s.board.hexes[h]?.token === 8,
    ) as HexId;
    build(s, 1, f, 0, 'city');
    build(s, 1, ore, 0, 'settlement');
    const after = rolled(s, 6);
    expect(after.players[1]?.resources.grain).toBe(0);
    expect(after.phase.kind).toBe('crop/harvest');
    const orePaid = rolled(s, 8);
    expect(orePaid.players[1]?.resources.ore).toBe(1);
  });

  it('opens harvest rounds in player order from the roller; a city harvests a second time', () => {
    const s = cropGame();
    const f = fieldsWith(s, 6);
    build(s, 2, f, 0, 'settlement');
    build(s, 1, f, 2, 'city');
    build(s, 3, f, 4, 'settlement');
    const after = rolled(s, 6);
    const phase = after.phase as unknown as { queue: { player: number }[] };
    // Round 1 from the roller (P0 has nothing): P1, P2, P3. Round 2: cities only: P1.
    expect(phase.queue.map((e) => e.player)).toEqual([1, 2, 3, 1]);
    expect(legalActions(after).map((a) => a.player)).toEqual(Array(6).fill(1));
    expect(new Set(legalActions(after).map((a) => a.type))).toEqual(
      new Set(['crop/harvest', 'crop/skipHarvest']),
    );
  });

  it('a harvest removes a crop of your choice and gives 1 food; only the actor may harvest', () => {
    const s = cropGame();
    const f = fieldsWith(s, 6);
    build(s, 1, f, 0, 'settlement');
    build(s, 2, f, 2, 'settlement');
    const open = rolled(s, 6);
    expectFail(act(open, { type: 'crop/harvest', player: 2, species: 'rice' }), /not your harvest/);
    expectFail(act(open, { type: 'crop/harvest', player: 0, species: 'rice' }), /not your harvest/);
    expectFail(act(open, { type: 'crop/harvest', player: 1, species: 'nope' }), /no such crop/);
    const one = expectOk(act(open, { type: 'crop/harvest', player: 1, species: 'rice' }));
    expect(one.players[1]?.resources.grain).toBe(1);
    expect((cropSlice(one).crops[f] as CropCounts).rice).toBe(0);
    expect(cropSlice(one).supply.rice).toBe(cropSlice(open).supply.rice + 1);
    expect(one.bank.grain).toBe(18);
    expectConserved(one);
    for (const sp of SPECIES) expect(speciesTotal(one, sp)).toBe(TOKENS_PER_SPECIES);
    // P2 may decline: no food, the phase ends and the roller continues.
    const done = expectOk(act(one, { type: 'crop/skipHarvest', player: 2 }));
    expect(done.phase).toEqual({ kind: 'main' });
    expect(done.players[2]?.resources.grain).toBe(0);
  });

  it('harvesting stops when the hex runs out of crops', () => {
    const s = cropGame();
    const f = fieldsWith(s, 6);
    for (const [i, p] of [1, 2, 3].entries()) build(s, p, f, i * 2, 'settlement');
    setCrops(s, f, { wheat: 1 });
    const open = rolled(s, 6);
    const one = run(open, { type: 'crop/harvest', player: 1, species: 'wheat' });
    expect(one.phase).toEqual({ kind: 'main' }); // P2 and P3 get nothing
    expect(one.players[2]?.resources.grain).toBe(0);
  });

  it('the robber stops the harvest of its hex', () => {
    const s = cropGame();
    const f = fieldsWith(s, 6);
    build(s, 1, f, 0, 'settlement');
    s.robber = f;
    expect(rolled(s, 6).phase).toEqual({ kind: 'main' });
  });

  it('two fields hexes with the same number are harvested one after the other', () => {
    const s = cropGame();
    const a = fieldsWith(s, 6);
    const b = fieldsWith(s, 4);
    s.board = {
      ...s.board,
      hexes: {
        ...s.board.hexes,
        [b]: {
          ...(s.board.hexes[b] as never as { id: HexId; q: number; r: number; terrain: 'grain' }),
          token: 6,
        },
      },
    };
    build(s, 1, a, 0, 'settlement');
    build(s, 2, b, 0, 'settlement');
    const open = rolled(s, 6);
    const phase = open.phase as unknown as { queue: { hex: HexId; player: number }[] };
    expect(new Set(phase.queue.map((e) => e.hex))).toEqual(new Set([a, b]));
    // All entries of one hex come before the next hex's (rounds are per hex).
    const hexes = phase.queue.map((e) => e.hex);
    expect(hexes.join()).toBe(
      [...hexes].sort((x, y) => hexes.indexOf(x) - hexes.indexOf(y)).join(),
    );
  });

  it('is skipped when the bank has no food', () => {
    const s = cropGame();
    const f = fieldsWith(s, 6);
    build(s, 1, f, 0, 'settlement');
    setHand(s, 3, { grain: 19 });
    expect(rolled(s, 6).phase).toEqual({ kind: 'main' });
  });

  it('a 7 harvests nothing', () => {
    const s = cropGame();
    build(s, 1, fieldsWith(s, 6), 0, 'settlement');
    expect(rolled(s, 7).phase.kind).not.toBe('crop/harvest');
  });
});

describe('the seed vault', () => {
  /** P0 in the main phase with a settlement on the 6 fields hex (all five crops) and 2 deposits of cash. */
  function vaultGame(): { s: GameState; f: HexId } {
    const s = mainGame();
    const f = fieldsWith(s, 6);
    build(s, 0, f, 0, 'settlement');
    setHand(s, 0, { lumber: 3, ore: 3 });
    return { s, f };
  }
  const deposit = (f: HexId, species: Species, row: 'top' | 'bottom' = 'top'): Action =>
    ({ type: 'crop/deposit', player: 0, hex: f, species, row }) as unknown as Action;

  it('costs 1 lumber + 1 ore: the crop moves to your record, 4 seeds fill the vault, the old seeds are replanted', () => {
    const { s, f } = vaultGame();
    const start = s.ext.crop as ReturnType<typeof cropSlice>;
    expect(start.vault[0]).toEqual({ species: 'rice', count: 4 });
    const after = expectOk(act(s, deposit(f, 'wheat')));
    const c = cropSlice(after);
    expect(after.players[0]?.resources).toMatchObject({ lumber: 2, ore: 2 });
    expect(c.record[0]).toEqual({ top: ['wheat'], bottom: [] });
    expect(c.vault[0]).toEqual({ species: 'wheat', count: 4 });
    expect((c.crops[f] as CropCounts).wheat).toBe(0);
    expect(after.phase).toMatchObject({ kind: 'crop/replant', species: 'rice', left: 4, used: [] });
    expect(cropSlice(after).deposited).toBe(true);
    for (const sp of SPECIES) expect(speciesTotal(after, sp), sp).toBe(TOKENS_PER_SPECIES);
    expectConserved(after);
  });

  it('replanting puts the 4 old seeds on 4 different fields hexes, then play continues', () => {
    const { s, f } = vaultGame();
    let g = run(s, deposit(f, 'wheat'));
    const spots = legalActions(g).filter((a) => a.type === 'crop/plant');
    expect(new Set(spots.map((a) => a.player))).toEqual(new Set([0]));
    expect(spots).toHaveLength(5);
    const hexes = fieldsHexes(g);
    for (const h of hexes.slice(0, 3)) g = run(g, { type: 'crop/plant', player: 0, hex: h });
    expect(g.phase.kind).toBe('crop/replant');
    expectFail(act(g, { type: 'crop/plant', player: 0, hex: hexes[0] as HexId }), /cannot plant/);
    g = run(g, { type: 'crop/plant', player: 0, hex: hexes[3] as HexId });
    expect(g.phase).toEqual({ kind: 'main' });
    expect(fieldsHexes(g).map((h) => (cropSlice(g).crops[h] as CropCounts).rice)).toEqual(
      fieldsHexes(s).map((h, i) => (cropSlice(s).crops[h] as CropCounts).rice + (i < 4 ? 1 : 0)),
    );
    for (const sp of SPECIES) expect(speciesTotal(g, sp), sp).toBe(TOKENS_PER_SPECIES);
  });

  it('a hex holds at most 7 tokens; tokens that do not fit go back to the supply', () => {
    const { s, f } = vaultGame();
    const hexes = fieldsHexes(s);
    // Four hexes are full: only 1 hex (plus none) can take seeds.
    for (const h of hexes.filter((x) => x !== f).slice(0, 3)) setCrops(s, h, { quinoa: 7 });
    setCrops(s, f, { wheat: 1, maize: 6 });
    const g = run(s, deposit(f, 'wheat'));
    // f has 6 maize now (7th slot free), one more hex is free.
    const spots = legalActions(g).filter((a) => a.type === 'crop/plant');
    expect(spots).toHaveLength(2);
    const supplyBefore = cropSlice(g).supply.rice;
    let h = run(g, spots[0] as Action);
    expect(h.phase.kind).toBe('crop/replant'); // 3 left, one spot free
    h = run(h, legalActions(h)[0] as Action);
    expect(h.phase).toEqual({ kind: 'main' }); // no spot left: the other 2 return to the supply
    expect(cropSlice(h).supply.rice).toBe(supplyBefore + 2);
    for (const sp of SPECIES) expect(speciesTotal(h, sp), sp).toBe(TOKENS_PER_SPECIES);
  });

  it('only once per turn, from a fields hex next to your buildings, with the cash', () => {
    const { s, f } = vaultGame();
    const other = fieldsWith(s, 3);
    expectFail(act(s, deposit(other, 'quinoa')), /not next to/);
    expectFail(act(s, { ...deposit(f, 'wheat'), player: 1 }), /not your turn/);
    expectFail(act(s, { ...deposit(f, 'wheat'), row: 'middle' }), /invalid/);
    setHand(s, 0, { lumber: 1 });
    expectFail(act(s, deposit(f, 'wheat')), /lumber and 1 ore/);
    setHand(s, 0, { lumber: 3, ore: 3 });
    setCrops(s, f, { beans: 1, wheat: 0, maize: 0, quinoa: 0, rice: 0 });
    expectFail(act(s, deposit(f, 'wheat')), /no wheat/);
    let g = run(s, deposit(f, 'beans'));
    for (const h of fieldsHexes(g).slice(0, 4))
      g = run(g, { type: 'crop/plant', player: 0, hex: h });
    setCrops(g, f, { maize: 1 });
    expectFail(act(g, deposit(f, 'maize')), /already stored/);
    const pre = { ...s, phase: { kind: 'preRoll' as const } };
    expectFail(act(pre, deposit(f, 'beans')), /main phase/);
  });

  it('the robber does not stop a deposit', () => {
    const { s, f } = vaultGame();
    s.robber = f;
    expectOk(act(s, deposit(f, 'quinoa')));
  });

  it('1 crop per species per row; the same species goes in the other row', () => {
    const { s, f } = vaultGame();
    cropSlice(s).record[0] = { top: ['wheat'], bottom: [] };
    cropSlice(s).supply.wheat -= 1;
    cropSlice(s).supply.wheat += 0;
    expectFail(act(s, deposit(f, 'wheat', 'top')), /already in that row/);
    // Wheat is in the top row: the bottom row takes it (the token came off the board earlier).
    const g = expectOk(act(s, deposit(f, 'maize', 'top')));
    expect(cropSlice(g).record[0]?.top).toEqual(['wheat', 'maize']);
    expect(
      legalActions(s)
        .filter((a) => a.type === 'crop/deposit' && flag(a, 'species') === 'wheat')
        .every((a) => flag(a, 'row') === 'bottom'),
    ).toBe(true);
  });

  it('the 2nd token of a row pays a development card, the 3rd, 4th and 5th are worth 1 VP each', () => {
    const { s, f } = vaultGame();
    const slice = cropSlice(s);
    const decks = s.devDeck.length;
    slice.record[0] = { top: ['wheat'], bottom: [] };
    const second = expectOk(act(s, deposit(f, 'maize')));
    expect(second.devDeck).toHaveLength(decks - 1);
    expect(Object.values(second.players[0]?.newDevCards ?? {}).reduce((a, b) => a + b, 0)).toBe(1);
    expect(recordVp(second, 0)).toBe(0);
    // Third token: 1 VP.
    const t = structuredClone(s);
    cropSlice(t).record[0] = { top: ['wheat', 'beans'], bottom: [] };
    const third = expectOk(act(t, deposit(f, 'maize')));
    expect(recordVp(third, 0)).toBe(1);
    expect(victoryPoints(third, 0)).toBe(victoryPoints(t, 0) + 1);
    // A full set of 5 in both rows = 3 + 3 VP.
    const u = structuredClone(s);
    cropSlice(u).record[0] = { top: [...SPECIES], bottom: [...SPECIES] };
    expect(recordVp(u, 0)).toBe(6);
    expect(storedCount(u, 0)).toBe(10);
  });

  it('a species stored in both rows cannot be stored again', () => {
    const { s, f } = vaultGame();
    cropSlice(s).record[0] = { top: ['maize'], bottom: ['maize'] };
    expect(
      legalActions(s).some((a) => a.type === 'crop/deposit' && flag(a, 'species') === 'maize'),
    ).toBe(false);
    expectFail(act(s, deposit(f, 'maize', 'top')), /already in that row/);
    expectFail(act(s, deposit(f, 'maize', 'bottom')), /already in that row/);
  });

  it('seeds in the vault keep a species alive; with no supply the vault gets what is left', () => {
    const { s, f } = vaultGame();
    const slice = cropSlice(s);
    slice.supply.wheat = 2;
    const g = run(s, deposit(f, 'wheat'));
    expect(cropSlice(g).vault[0]).toEqual({ species: 'wheat', count: 2 });
    expect(cropSlice(g).supply.wheat).toBe(0);
  });
});

describe('event tokens', () => {
  function setup(): { s: GameState; f: HexId } {
    const s = mainGame();
    const f = fieldsWith(s, 6);
    setHand(s, 0, { brick: 3, lumber: 3, wool: 3, grain: 3, ore: 3 });
    // A road to build the settlement from, with the spot two edges from P0's settlement.
    return { s, f };
  }

  /** Build a settlement for P0 on a legal spot via direct state edits + the real action. */
  function buildSettlementFor(s: GameState, token: CropEvent): GameState {
    const t = topologyOf(s);
    cropSlice(s).pieces[0]!.settlement = [
      token,
      ...cropSlice(s).pieces[0]!.settlement.slice(1),
    ].reverse();
    // Own road leading to a free spot.
    const spot = t.vertices.find(
      (v) =>
        !s.pieces.buildings[v] &&
        !t.vertex[v]!.vertices.some((n) => s.pieces.buildings[n]) &&
        t.vertex[v]!.edges.length === 3,
    ) as VertexId;
    const edge = t.vertex[spot]!.edges[0] as never;
    s.pieces.roads[edge] = 0;
    return run(s, { type: 'buildSettlement', player: 0, vertex: spot });
  }

  it('building a settlement reveals the token under that piece and resolves it', () => {
    const { s, f } = setup();
    const before = (cropSlice(s).crops[f] as CropCounts).rice;
    expect(before).toBe(1);
    // A regional loss of rice on number 6 hits the 6 fields hex.
    const g = buildSettlementFor(s, { k: 'regional', s: 'rice', n: [6] });
    expect((cropSlice(g).crops[f] as CropCounts).rice).toBe(0);
    expect(cropSlice(g).pieces[0]?.settlement).toHaveLength(2);
    expect(cropSlice(g).used).toHaveLength(1);
    expect(g.log.some((l) => l.text.includes('Regional loss'))).toBe(true);
    for (const sp of SPECIES) expect(speciesTotal(g, sp), sp).toBe(TOKENS_PER_SPECIES);
    expect(eventTotal(g)).toBe(41);
  });

  it('a city reveals the token under the city piece; the settlement piece gets a new token', () => {
    const { s, f } = setup();
    const v = build(s, 0, f, 0, 'settlement');
    cropSlice(s).pieces[0]!.city = [
      small('beans'),
      small('beans'),
      small('beans'),
      small('quinoa'),
    ];
    const stack = cropSlice(s).stack.length;
    const g = run(s, { type: 'buildCity', player: 0, vertex: v });
    // 'quinoa' (last of the city pieces) was revealed: 2 quinoa removed.
    expect(cropSlice(g).pieces[0]?.city).toHaveLength(3);
    expect(cropSlice(g).pieces[0]?.settlement).toHaveLength(4);
    expect(cropSlice(g).stack).toHaveLength(stack - 1);
    expect(
      totalOf(
        Object.values(cropSlice(g).crops).reduce<CropCounts>((a, c) => {
          SPECIES.forEach((sp) => (a[sp] += c[sp]));
          return a;
        }, emptyCounts()),
      ),
    ).toBe(
      totalOf(
        Object.values(cropSlice(s).crops).reduce<CropCounts>((a, c) => {
          SPECIES.forEach((sp) => (a[sp] += c[sp]));
          return a;
        }, emptyCounts()),
      ) - 2,
    );
    expect(eventTotal(g)).toBe(41);
  });

  it('small and large losses take tokens from hexes next to your buildings first', () => {
    const s = mainGame();
    const near = fieldsWith(s, 6);
    const far = fieldsWith(s, 4);
    build(s, 0, near, 0, 'settlement');
    setCrops(s, near, { quinoa: 1 });
    setCrops(s, far, { quinoa: 5 });
    const g = buildSettlementFor2(s, { k: 'large', s: 'quinoa' });
    const c = cropSlice(g).crops;
    expect((c[near] as CropCounts).quinoa).toBe(0);
    // 3 removed: 1 near, then 2 from the others.
    const all = fieldsHexes(g).reduce((n, h) => n + (c[h] as CropCounts).quinoa, 0);
    const before = fieldsHexes(s).reduce(
      (n, h) => n + (cropSlice(s).crops[h] as CropCounts).quinoa,
      0,
    );
    expect(all).toBe(before - 3);
    expect(adjacentFields(g, 0)).toContain(near);
  });

  /** buildSettlementFor, but the settlement must not be next to `near` fields (keeps the setup). */
  function buildSettlementFor2(s: GameState, token: CropEvent): GameState {
    setHand(s, 0, { brick: 3, lumber: 3, wool: 3, grain: 3, ore: 3 });
    return buildSettlementFor(s, token);
  }

  it('a monoculture wipes out every fields hex with a single crop', () => {
    const s = mainGame();
    const a = fieldsWith(s, 6);
    const b = fieldsWith(s, 4);
    const c = fieldsWith(s, 3);
    setCrops(s, a, { rice: 1, beans: 2 });
    setCrops(s, b, { wheat: 3 });
    setCrops(s, c, { maize: 1 });
    setHand(s, 0, { brick: 3, lumber: 3, wool: 3, grain: 3, ore: 3 });
    const g = buildSettlementFor(s, { k: 'mono' });
    const crops = cropSlice(g).crops;
    expect(totalOf(crops[a] as CropCounts)).toBe(3); // two crops: kept
    expect(totalOf(crops[b] as CropCounts)).toBe(0);
    expect(totalOf(crops[c] as CropCounts)).toBe(0);
  });

  it('a token of an extinct species goes back to the box and another is drawn', () => {
    const s = mainGame();
    const c = cropSlice(s);
    c.extinct.push('beans');
    c.box.beans = c.supply.beans;
    c.supply.beans = 0;
    for (const h of fieldsHexes(s)) {
      const counts = c.crops[h] as CropCounts;
      c.box.beans += counts.beans;
      counts.beans = 0;
    }
    c.vault = c.vault.map((v) => (v.species === 'beans' ? { species: 'rice', count: 0 } : v));
    c.box.beans += 0;
    const stack = c.stack.length;
    c.stack.push({ k: 'mono' });
    setHand(s, 0, { brick: 3, lumber: 3, wool: 3, grain: 3, ore: 3 });
    const g = buildSettlementFor(s, small('beans'));
    expect(cropSlice(g).boxed).toBe(1);
    expect(cropSlice(g).stack).toHaveLength(stack); // one drawn (the mono), none left over
    expect(g.log.some((l) => l.text.includes('Monoculture'))).toBe(true);
  });

  it('Longest Road and Largest Army reveal the token on the card when someone takes it', () => {
    const s = mainGame();
    const c = cropSlice(s);
    c.cards.largestArmy = small('maize');
    s.players[0]!.knightsPlayed = 2;
    s.players[0]!.devCards.knight = 1;
    s.devDeck.splice(s.devDeck.indexOf('knight'), 1);
    s.phase = { kind: 'preRoll' };
    const before = c.stack.length;
    const g = run(s, { type: 'playKnight', player: 0 });
    expect(g.awards.largestArmy).toBe(0);
    expect(cropSlice(g).used).toContainEqual(small('maize'));
    expect(cropSlice(g).cards.largestArmy).not.toBeNull();
    expect(cropSlice(g).stack).toHaveLength(before - 1);
    expect(g.log.some((l) => l.text.includes('Small-scale loss'))).toBe(true);
    expect(eventTotal(g)).toBe(41);
  });

  it('the stack is reshuffled from the used tokens when it runs out', () => {
    const s = mainGame();
    const c = cropSlice(s);
    c.used = c.stack.splice(0);
    const n = c.used.length;
    setHand(s, 0, { brick: 3, lumber: 3, wool: 3, grain: 3, ore: 3 });
    const g = buildSettlementFor(s, small('quinoa'));
    expect(cropSlice(g).stack.length + cropSlice(g).used.length).toBe(n + 1);
    expect(eventTotal(g)).toBe(41);
  });
});

describe('the crop collapse', () => {
  /** A game where P0 is about to build a settlement whose event empties the board. */
  function nearlyEmpty(): GameState {
    const s = mainGame();
    const hexes = fieldsHexes(s);
    // Two fields hexes are already empty; the third has a single quinoa on it.
    setCrops(s, hexes[0] as HexId, {});
    setCrops(s, hexes[1] as HexId, {});
    setCrops(s, hexes[2] as HexId, { quinoa: 1 });
    setCrops(s, hexes[3] as HexId, { quinoa: 2 });
    setCrops(s, hexes[4] as HexId, { quinoa: 2 });
    expect(emptyFields(s)).toHaveLength(2);
    return s;
  }

  function withEvent(s: GameState, token: CropEvent): GameState {
    const t = topologyOf(s);
    setHand(s, 0, { brick: 3, lumber: 3, wool: 3, grain: 3, ore: 3 });
    cropSlice(s).pieces[0]!.settlement = [token];
    const spot = t.vertices.find(
      (v) =>
        !s.pieces.buildings[v] &&
        !t.vertex[v]!.vertices.some((n) => s.pieces.buildings[n]) &&
        t.vertex[v]!.edges.length === 3,
    ) as VertexId;
    s.pieces.roads[t.vertex[spot]!.edges[0] as never] = 0;
    return run(s, { type: 'buildSettlement', player: 0, vertex: spot });
  }

  it('3 empty fields hexes end the game: the most stored crops wins', () => {
    const s = nearlyEmpty();
    cropSlice(s).record[2] = { top: ['wheat', 'beans'], bottom: [] };
    cropSlice(s).record[1] = { top: ['rice'], bottom: [] };
    const g = withEvent(s, { k: 'small', s: 'quinoa' });
    // Removing 1 quinoa from the near-empty hex (if adjacent) or the largest stacks...
    expect(emptyFields(g).length >= 3 || g.phase.kind !== 'gameOver').toBe(true);
    const mono = withEvent(structuredClone(s), { k: 'mono' });
    expect(emptyFields(mono)).toHaveLength(5);
    expect(mono.phase).toEqual({ kind: 'gameOver' });
    expect(mono.winner).toBe(2);
    expect(mono.log.at(-1)?.text).toMatch(/Crop collapse/);
  });

  it('ties are broken by victory points', () => {
    const s = nearlyEmpty();
    cropSlice(s).record[1] = { top: ['wheat', 'beans'], bottom: [] };
    cropSlice(s).record[3] = { top: ['rice', 'quinoa'], bottom: [] };
    s.players[3]!.devCards.victoryPoint = 1;
    s.devDeck.splice(s.devDeck.indexOf('victoryPoint'), 1);
    const g = withEvent(s, { k: 'mono' });
    expect(g.winner).toBe(3);
  });

  it('2 extinct species end the game', () => {
    const s = mainGame();
    const c = cropSlice(s);
    // Beans and wheat are gone from the board and the vaults; the next event notices.
    for (const h of fieldsHexes(s))
      setCrops(s, h, { ...(c.crops[h] as CropCounts), beans: 0, wheat: 0 });
    c.vault = c.vault.map((v) =>
      v.species === 'beans' || v.species === 'wheat' ? { species: 'maize', count: 0 } : v,
    );
    c.supply.maize -= 0;
    expect(c.extinct).toEqual([]);
    c.record[1] = { top: ['maize'], bottom: [] };
    const g = withEvent(s, small('maize'));
    expect(g.phase).toEqual({ kind: 'gameOver' });
    expect(cropSlice(g).extinct).toEqual(expect.arrayContaining(['beans', 'wheat']));
    expect(cropSlice(g).box.beans + cropSlice(g).box.wheat).toBeGreaterThan(0);
    expect(g.winner).toBe(1);
  });

  it('a harvest that causes the collapse loses; the next best wins', () => {
    const s = cropGame();
    const f = fieldsWith(s, 6);
    const hexes = fieldsHexes(s);
    setCrops(s, hexes.find((h) => h !== f && h !== hexes[0]) as HexId, {});
    for (const h of hexes.filter((x) => x !== f).slice(0, 2)) setCrops(s, h, {});
    setCrops(s, f, { quinoa: 1 });
    build(s, 1, f, 0, 'settlement');
    cropSlice(s).record[1] = { top: ['wheat', 'beans', 'rice'], bottom: [] }; // P1 stores the most
    cropSlice(s).record[2] = { top: ['wheat'], bottom: [] };
    s.turn = { number: 3, current: 0, devCardPlayed: false, tradeOffers: 0 };
    s.phase = { kind: 'preRoll' };
    s.rng = rngForRoll(6);
    const open = run(s, { type: 'rollDice', player: 0 });
    expect(open.phase.kind).toBe('crop/harvest');
    const over = run(open, { type: 'crop/harvest', player: 1, species: 'quinoa' });
    expect(over.phase).toEqual({ kind: 'gameOver' });
    expect(over.winner).toBe(2); // P1 caused it: P2 has the second most
  });

  it('reaching 10 VP while building still lets the collapse be decided by stored crops', () => {
    const s = nearlyEmpty();
    const cropSl = cropSlice(s);
    cropSl.record[0] = {
      top: ['wheat', 'beans', 'rice', 'maize', 'quinoa'],
      bottom: ['wheat', 'beans', 'rice', 'maize'],
    };
    s.settings.vpToWin = 6; // the builder reaches it with 2 settlements + 6 record VP... and the event
    const g = withEvent(s, { k: 'mono' });
    expect(g.phase).toEqual({ kind: 'gameOver' });
    expect(g.winner).toBe(0); // most stored, also over the target
    expect(g.log.at(-1)?.text).toMatch(/Crop collapse/);
  });

  it('10 VP on your turn wins as in the base game', () => {
    const s = mainGame();
    s.settings.vpToWin = 4;
    for (let i = 0; i < 3; i++) build(s, 0, fieldsHexes(s)[i] as HexId, 0, 'city');
    const g = run(s, { type: 'endTurn', player: 0 });
    expect(g.winner).toBeNull(); // not the current player's turn any more
    const t = mainGame();
    t.settings.vpToWin = 4;
    for (let i = 0; i < 2; i++) build(t, 0, fieldsHexes(t)[i] as HexId, 0, 'city');
    cropSlice(t).record[0] = { top: ['wheat', 'beans', 'rice'], bottom: [] };
    setHand(t, 0, { lumber: 1, ore: 1 });
    const f = fieldsHexes(t)[0] as HexId;
    setCrops(t, f, { maize: 1 });
    const win = run(t, {
      type: 'crop/deposit',
      player: 0,
      hex: f,
      species: 'maize',
      row: 'bottom',
    });
    expect(victoryPoints(win, 0)).toBeGreaterThanOrEqual(4);
    expect(win.winner).toBe(0);
  });
});

describe('crop soundness', () => {
  it('every legal action is accepted and all tokens are conserved, over random games', () => {
    for (const [n, scenario] of [
      [3, 'crop/cropTrust'],
      [4, 'crop/cropTrustVariable'],
    ] as const) {
      for (let seed = 0; seed < 3; seed++) {
        let s = cropGame(n, `sound-${n}-${seed}`, scenario);
        const rng = new Rng(11 + n + seed);
        const seen = new Set<string>();
        for (let steps = 0; s.phase.kind !== 'gameOver' && steps < 3000; steps++) {
          const legal = legalActions(s);
          expect(legal.length, `stalled in ${s.phase.kind}`).toBeGreaterThan(0);
          const own = legal.filter((a) => a.type.startsWith('crop/'));
          const a = rng.pick(own.length > 0 && rng.float() < 0.6 ? own : legal);
          const r = applyAction(s, a);
          expect(r.ok, `${JSON.stringify(a)} -> ${r.ok ? '' : r.error}`).toBe(true);
          if (!r.ok) return;
          s = r.state;
          seen.add(a.type);
          for (const sp of SPECIES) expect(speciesTotal(s, sp), sp).toBe(TOKENS_PER_SPECIES);
          expect(eventTotal(s)).toBe(41);
          expectConserved(s);
        }
        expect(seen.has('crop/harvest') || seen.has('crop/deposit')).toBe(true);
      }
    }
    expect(RESOURCES).toHaveLength(5);
  }, 60_000);
});
