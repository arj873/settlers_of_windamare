/**
 * Seafarers scenario rules (docs/rules/seafarers.md §2, §4-§6): gold, the pirate, the robber
 * beside the board, special VP for new land, fog, the Forgotten Tribe, Cloth for Catan, the Pirate
 * Islands, the Wonders of Catan, New World, and the variant combinations createGame refuses.
 */
import { describe, expect, it } from 'vitest';
import { createGame } from '../../../engine/createGame';
import { applyAction, legalActions } from '../../../engine/engine';
import {
  expectConserved,
  expectFail,
  expectOk,
  rollTotal,
  run,
  setHand,
} from '../../../engine/actions/testkit';
import { bankTradeRatio } from '../../../engine/actions/trade';
import { Rng } from '../../../engine/rng';
import { canPlaceSettlement, edgeTouchesLand, touchesLand } from '../../../engine/rules/placement';
import { topologyOf } from '../../../engine/topology';
import { setupOrderOf, victoryPoints } from '../../../engine/selectors';
import { supplyOf } from '../../../engine/mapLookup';
import type { Action, EdgeId, GameState, HexId, PlayerId, VertexId } from '../../../engine/types';
import { goldOwed } from './actions';
import { tribeGifts, wonderCards, wonderMarks } from './features';
import { graph, isShipEdge } from './geometry';
import { OFF_BOARD } from './maps';
import { fleetHex, fortressOf, lineOf, pirateSeats, warships } from './pirates';
import { shipsLeft } from './ships';
import { seaSlice, type GoldPhase } from './state';
import { E, H, V, mainPhase, players, seaGame, ship } from './testkit';

const act = (a: Record<string, unknown>) => a as unknown as Action;

/** An rng state whose next two dice are `a` and `b`. */
function rngForDice(a: number, b: number): number {
  for (let seed = 0; seed < 200_000; seed++) {
    const r = new Rng(seed);
    if (r.die() === a && r.die() === b) return seed;
  }
  throw new Error('no seed');
}

/** An rng state whose next die is `d`. */
function rngForDie(d: number): number {
  for (let seed = 0; seed < 1000; seed++) if (new Rng(seed).die() === d) return seed;
  throw new Error('no seed');
}

const preRoll = (s: GameState, p: PlayerId = 0) => {
  s.turn = { number: 3, current: p, devCardPlayed: false, tradeOffers: 0 };
  s.phase = { kind: 'preRoll' };
  return s;
};

/** A harmless action of the current player (runs the victory check): 4 wool for 1 ore. */
const trade4 = (s: GameState, p: PlayerId = 0): GameState => {
  setHand(s, p, { wool: 4 });
  return expectOk(applyAction(s, { type: 'bankTrade', player: p, give: 'wool', receive: 'ore' }));
};

describe('gold fields (§4.3, FAQ #2)', () => {
  // Heading for New Shores 4p: gold (6,8) has a 4; nothing else with a 4 has buildings here.
  it('a settlement picks 1, a city 2, any combination; the bank pays', () => {
    const s = preRoll(seaGame('newShores', 4));
    s.pieces.buildings[V(6, 8, 'NW')] = { owner: 0, kind: 'settlement' };
    s.pieces.buildings[V(6, 8, 'SE')] = { owner: 1, kind: 'city' };
    const t = rollTotal(s, 4);
    expect(t.phase.kind).toBe('seafarers/gold');
    expect((t.phase as GoldPhase).pending.slice(0, 2)).toEqual([1, 2]);
    const options = legalActions(t, 1).filter((a) => a.type === 'seafarers/pickGold');
    expect(options.length).toBe(15); // 2 cards from 5 kinds
    let u = expectOk(
      applyAction(t, act({ type: 'seafarers/pickGold', player: 1, resources: { ore: 2 } })),
    );
    expectFail(
      applyAction(u, act({ type: 'seafarers/pickGold', player: 0, resources: { ore: 2 } })),
      /exactly 1/,
    );
    u = expectOk(
      applyAction(u, act({ type: 'seafarers/pickGold', player: 0, resources: { wool: 1 } })),
    );
    expect(u.phase.kind).toBe('main');
    expect(u.players[1]?.resources.ore).toBe(2);
    expect(u.players[0]?.resources.wool).toBe(1);
    expectConserved(u);
  });

  it('the robber blocks a gold field', () => {
    const s = preRoll(seaGame('newShores', 4));
    s.pieces.buildings[V(6, 8, 'NW')] = { owner: 0, kind: 'settlement' };
    s.robber = H(6, 8);
    expect(rollTotal(s, 4).phase.kind).toBe('main');
  });

  it('bank shortage: picks are limited to what the bank still has (Q5)', () => {
    const s = preRoll(seaGame('newShores', 4));
    s.pieces.buildings[V(6, 8, 'NW')] = { owner: 0, kind: 'settlement' };
    s.pieces.buildings[V(6, 8, 'SE')] = { owner: 1, kind: 'city' };
    for (const r of ['brick', 'lumber', 'wool', 'grain'] as const) {
      s.players[2]!.resources[r] += s.bank[r];
      s.bank[r] = 0;
    }
    s.players[2]!.resources.ore += s.bank.ore - 1;
    s.bank.ore = 1;
    const t = rollTotal(s, 4);
    expect(goldOwed(t, 1)).toBe(1);
    const u = expectOk(
      applyAction(t, act({ type: 'seafarers/pickGold', player: 1, resources: { ore: 1 } })),
    );
    expect(u.phase.kind).toBe('main'); // the bank is empty: player 0 gets nothing
  });

  it('a paying starting settlement on gold picks a free resource (§2.1, Q5)', () => {
    const s = seaGame('newShores', 4);
    s.phase = { kind: 'setup', index: 4, step: 'settlement', lastSettlement: null };
    s.turn.current = setupOrderOf(s).order[4] as PlayerId;
    const p = s.turn.current;
    // Setup is restricted to the main island; pretend the gold hex is main land for this test.
    const board = s.board.ext?.seafarers as { region: Record<HexId, string> };
    board.region[H(6, 8)] = 'M';
    const t = expectOk(
      applyAction(s, { type: 'placeSetupSettlement', player: p, vertex: V(6, 8, 'NW') }),
    );
    expect(t.phase.kind).toBe('seafarers/gold');
    expect(goldOwed(t, p)).toBe(1);
    const u = expectOk(
      applyAction(t, act({ type: 'seafarers/pickGold', player: p, resources: { grain: 1 } })),
    );
    expect(u.phase).toMatchObject({ kind: 'setup', step: 'road', index: 4 });
  });
});

describe('the pirate (§4.4, FAQ #4-#7)', () => {
  function sevenGame() {
    const s = mainPhase(seaGame('newShores', 4));
    s.phase = { kind: 'moveRobber', resume: 'main' };
    seaSlice(s).pirate = H(3, -1);
    return s;
  }

  it('after a 7 or a Knight, the robber OR the pirate moves; the pirate only to sea', () => {
    const s = sevenGame();
    const moves = legalActions(s, 0);
    expect(moves.some((a) => a.type === 'moveRobber')).toBe(true);
    const pirate = moves.filter((a) => a.type === 'seafarers/movePirate');
    expect(pirate.length).toBeGreaterThan(10);
    expectFail(applyAction(s, act({ type: 'seafarers/movePirate', player: 0, hex: H(2, 8) })));
  });

  it('robs only a player with a ship next to it, one card (FAQ #7)', () => {
    const s = sevenGame();
    ship(s, 1, E(2, 8, 'S'));
    s.pieces.buildings[V(2, 8, 'SE')] = { owner: 2, kind: 'settlement' }; // coastal, no ship
    setHand(s, 1, { ore: 2 });
    setHand(s, 2, { ore: 2 });
    const t = expectOk(
      applyAction(s, act({ type: 'seafarers/movePirate', player: 0, hex: H(2, 10) })),
    );
    expect(t.phase).toMatchObject({ kind: 'steal', candidates: [1] });
    const u = expectOk(applyAction(t, { type: 'steal', player: 0, victim: 1 }));
    expect(u.players[0]?.resources.ore).toBe(1);
    expect(seaSlice(u).pirate).toBe(H(2, 10));
  });

  it('the robber goes to land only: never fog or sea', () => {
    const s = mainPhase(seaGame('fogIslands', 4));
    s.phase = { kind: 'moveRobber', resume: 'main' };
    const hexes = legalActions(s, 0).flatMap((a) => (a.type === 'moveRobber' ? [a.hex] : []));
    for (const h of hexes) expect(['fog', 'sea']).not.toContain(s.board.hexes[h]?.terrain);
    const fog = (Object.keys(s.board.hexes) as HexId[]).find(
      (h) => s.board.hexes[h]?.terrain === 'fog',
    );
    expectFail(applyAction(s, { type: 'moveRobber', player: 0, hex: fog as HexId }));
  });
});

describe('robber beside the board (FAQ #9)', () => {
  it('The Six Islands have no desert: the robber waits beside the board, then goes to any land', () => {
    const s = seaGame('fourIslands', 5);
    expect(s.robber).toBe(OFF_BOARD);
    const t = mainPhase(s);
    t.phase = { kind: 'moveRobber', resume: 'main' };
    const targets = legalActions(t, 0).filter((a) => a.type === 'moveRobber');
    expect(targets).toHaveLength(32);
  });
});

describe('special victory points for new land (§4.6, E5, E6, FAQ #3)', () => {
  it('Heading for New Shores: 2 VP for your first settlement on each small island', () => {
    const s = mainPhase(seaGame('newShores', 4));
    seaSlice(s).pirate = H(3, -1);
    // Small island (6,2)+(6,4): reach it by ship, settle twice.
    const v1 = V(6, 2, 'NW');
    const v2 = V(6, 4, 'SW');
    for (const v of [v1, v2]) {
      const e = (graph(s).edgesAt.get(v) ?? []).find((x) => isShipEdge(s, x)) as EdgeId;
      ship(s, 0, e);
    }
    setHand(s, 0, { brick: 2, lumber: 2, wool: 2, grain: 2 });
    const before = victoryPoints(s, 0);
    let t = expectOk(applyAction(s, { type: 'buildSettlement', player: 0, vertex: v1 }));
    expect(victoryPoints(t, 0)).toBe(before + 3);
    t = expectOk(applyAction(t, { type: 'buildSettlement', player: 0, vertex: v2 }));
    expect(victoryPoints(t, 0)).toBe(before + 4); // no second bonus on that island
    // Another player still earns it there (E5) — and a city never pays.
    const u = mainPhase(structuredClone(t), 1);
    const v3 = V(6, 4, 'SE');
    const e3 = (graph(u).edgesAt.get(v3) ?? []).find((x) => isShipEdge(u, x)) as EdgeId;
    ship(u, 1, e3);
    setHand(u, 1, { brick: 1, lumber: 1, wool: 1, grain: 1 });
    if (canPlaceSettlement(u, 1, v3, { requireRoad: false })) {
      const w = expectOk(applyAction(u, { type: 'buildSettlement', player: 1, vertex: v3 }));
      expect(seaSlice(w).chits.filter((c) => c.player === 1)).toHaveLength(1);
    }
  });

  it('The Four Islands: your home islands pay nothing, each foreign one 2 (E6)', () => {
    const s = seaGame('fourIslands', 4);
    // Player 0 starts twice on the NW island.
    seaSlice(s).home[0] = ['I0'];
    mainPhase(s);
    const board = s.board.ext?.seafarers as { area: Record<HexId, string> };
    const home = (Object.keys(board.area) as HexId[]).find((h) => board.area[h] === 'I0') as HexId;
    const away = (Object.keys(board.area) as HexId[]).find((h) => board.area[h] === 'I1') as HexId;
    const reach = (h: HexId) => {
      const v = (graph(s).hexVertices.get(h) ?? []).find(
        (x) =>
          (graph(s).edgesAt.get(x) ?? []).some((e) => isShipEdge(s, e)) &&
          canPlaceSettlement(s, 0, x, { requireRoad: false }),
      ) as VertexId;
      const e = (graph(s).edgesAt.get(v) ?? []).find((x) => isShipEdge(s, x)) as EdgeId;
      ship(s, 0, e);
      return v;
    };
    const vh = reach(home);
    const va = reach(away);
    setHand(s, 0, { brick: 2, lumber: 2, wool: 2, grain: 2 });
    let t = expectOk(applyAction(s, { type: 'buildSettlement', player: 0, vertex: vh }));
    expect(seaSlice(t).chits).toHaveLength(0);
    t = expectOk(applyAction(t, { type: 'buildSettlement', player: 0, vertex: va }));
    expect(seaSlice(t).chits).toEqual([{ player: 0, vp: 2, area: 'I1', vertex: va }]);
  });

  it('New World: only one special VP per player (5th edition)', () => {
    const s = mainPhase(seaGame('newWorld', 4));
    seaSlice(s).chits.push({ player: 0, vp: 1, area: 'I9', vertex: 'v:0,0,N' });
    s.pieces.buildings['v:0,0,N'] = { owner: 0, kind: 'settlement' };
    const before = seaSlice(s).chits.length;
    // Whatever island the next settlement is on, no second chit.
    const board = s.board.ext?.seafarers as { area: Record<HexId, string> };
    const h = Object.keys(board.area)[0] as HexId;
    const v = (graph(s).hexVertices.get(h) ?? []).find((x) =>
      canPlaceSettlement(s, 0, x, { requireRoad: false }),
    );
    if (!v) return;
    s.pieces.roads[(graph(s).edgesAt.get(v) ?? [])[0] as EdgeId] = 0;
    setHand(s, 0, { brick: 1, lumber: 1, wool: 1, grain: 1 });
    const r = applyAction(s, { type: 'buildSettlement', player: 0, vertex: v });
    if (r.ok) expect(seaSlice(r.state).chits).toHaveLength(before);
  });
});

describe('fog (§4.7, E7)', () => {
  /** A ship edge from a land vertex to a vertex touching exactly one fog hex. */
  function fogEdge(s: GameState): { from: VertexId; edge: EdgeId; fog: HexId } {
    const g = graph(s);
    const fogAt = (v: VertexId) =>
      (g.hexesAt.get(v) ?? []).filter((h) => s.board.hexes[h]?.terrain === 'fog');
    for (const e of g.edges) {
      if (!isShipEdge(s, e)) continue;
      const [a, b] = g.ends.get(e) ?? [];
      if (!a || !b) continue;
      const land = (v: VertexId) =>
        (g.hexesAt.get(v) ?? []).some((h) => s.board.hexes[h]?.terrain === 'wool');
      if (land(a) && fogAt(a).length === 0 && fogAt(b).length === 1)
        return { from: a, edge: e, fog: fogAt(b)[0] as HexId };
    }
    throw new Error('no fog edge');
  }

  function fogGame(stack: string[], tokens: number[]) {
    const s = mainPhase(seaGame('fogIslands', 4));
    seaSlice(s).pirate = null;
    seaSlice(s).fog = { terrains: stack as never, tokens };
    const f = fogEdge(s);
    s.pieces.buildings[f.from] = { owner: 0, kind: 'settlement' };
    setHand(s, 0, { lumber: 1, wool: 1 });
    return { s, ...f };
  }

  it('a land hex: turned with its number token, 1 card of it to the discoverer', () => {
    const { s, edge, fog } = fogGame(['sea', 'ore'], [3, 9]);
    const t = expectOk(applyAction(s, act({ type: 'seafarers/buildShip', player: 0, edge })));
    expect(t.board.hexes[fog]).toMatchObject({ terrain: 'ore', token: 9 });
    expect(t.players[0]?.resources.ore).toBe(1);
    expect(seaSlice(t).fog?.terrains).toEqual(['sea']);
    expectConserved(t);
  });

  it('a sea hex gives nothing; gold gives a free pick', () => {
    const a = fogGame(['ore', 'sea'], [3]);
    const t = expectOk(
      applyAction(a.s, act({ type: 'seafarers/buildShip', player: 0, edge: a.edge })),
    );
    expect(t.board.hexes[a.fog]?.terrain).toBe('sea');
    expect(t.board.hexes[a.fog]?.token).toBeNull();
    expect(Object.values(t.players[0]!.resources).reduce((x, y) => x + y, 0)).toBe(0);
    const b = fogGame(['gold'], [5]);
    const u = expectOk(
      applyAction(b.s, act({ type: 'seafarers/buildShip', player: 0, edge: b.edge })),
    );
    expect(u.phase.kind).toBe('seafarers/gold');
    expect(goldOwed(u, 0)).toBe(1);
  });

  it('a road discovers too (Q13)', () => {
    // The Fog Island 5-6: the gold hex (0,2) borders fog directly.
    const s = mainPhase(seaGame('fogIslands', 5));
    seaSlice(s).fog = { terrains: ['grain'], tokens: [4] };
    const g = graph(s);
    // A coast road whose far end touches a fog hex.
    const fogAt = (v: VertexId) =>
      (g.hexesAt.get(v) ?? []).some((h) => s.board.hexes[h]?.terrain === 'fog');
    const t0 = topologyOf(s);
    let e: EdgeId | undefined;
    let from: VertexId | undefined;
    for (const x of t0.edges) {
      if (!edgeTouchesLand(s, x)) continue;
      const [a, b] = g.ends.get(x) ?? [];
      if (a && b && fogAt(b) && !fogAt(a) && touchesLand(s, a)) [e, from] = [x, a];
      else if (a && b && fogAt(a) && !fogAt(b) && touchesLand(s, b)) [e, from] = [x, b];
      if (e) break;
    }
    if (!e || !from) throw new Error('no road next to fog');
    s.pieces.buildings[from] = { owner: 0, kind: 'settlement' };
    setHand(s, 0, { brick: 1, lumber: 1 });
    const t = expectOk(applyAction(s, { type: 'buildRoad', player: 0, edge: e }));
    const fogLeft = (x: GameState) =>
      Object.values(x.board.hexes).filter((h) => h.terrain === 'fog').length;
    expect(fogLeft(t)).toBe(fogLeft(s) - 1);
    expect(Object.values(t.board.hexes).some((h) => h.terrain === 'grain' && h.token === 4)).toBe(
      true,
    );
  });
});

describe('The Forgotten Tribe (§4.8, E8, E9)', () => {
  function tribeGame() {
    const s = mainPhase(seaGame('forgottenTribe', 4));
    seaSlice(s).pirate = null;
    return s;
  }
  /** Put a ship of `p` next to `gift` so that the gift edge itself can be built. */
  function approach(s: GameState, p: PlayerId, gift: EdgeId) {
    const g = graph(s);
    for (const v of g.ends.get(gift) ?? []) {
      const e = (g.edgesAt.get(v) ?? []).find(
        (x) => x !== gift && isShipEdge(s, x) && !seaSlice(s).gifts?.[x],
      );
      if (e) {
        ship(s, p, e);
        return;
      }
    }
    throw new Error('no approach');
  }
  const gifts = tribeGifts('tribe');
  if (!gifts) throw new Error('no gifts');

  it('a chit gift: 1 VP', () => {
    const s = tribeGame();
    const gift = gifts.chit[0] as EdgeId;
    approach(s, 0, gift);
    setHand(s, 0, { lumber: 1, wool: 1 });
    const before = victoryPoints(s, 0);
    const t = expectOk(applyAction(s, act({ type: 'seafarers/buildShip', player: 0, edge: gift })));
    expect(victoryPoints(t, 0)).toBe(before + 1);
    expect(seaSlice(t).gifts?.[gift]).toBeUndefined();
  });

  it('a development card gift: like a bought card, not playable this turn (E9)', () => {
    const s = tribeGame();
    const gift = gifts.dev[0] as EdgeId;
    const card = seaSlice(s).gifts?.[gift];
    expect(card?.kind).toBe('dev');
    approach(s, 0, gift);
    setHand(s, 0, { lumber: 1, wool: 1 });
    const t = expectOk(applyAction(s, act({ type: 'seafarers/buildShip', player: 0, edge: gift })));
    const p = t.players[0]!;
    expect(Object.values(p.newDevCards).reduce((a, b) => a + b, 0)).toBe(1);
    expect(Object.values(p.devCards).reduce((a, b) => a + b, 0)).toBe(0);
    // The 4 gift cards came off the top of the deck.
    expect(s.devDeck.length + 4).toBe(25);
  });

  it('a harbour gift waits until you have a coastal building, then must be placed (E8)', () => {
    const s = tribeGame();
    // (2,14) SW: the south island, reachable over open sea.
    const gift = gifts.harbor[3] as EdgeId;
    approach(s, 0, gift);
    setHand(s, 0, { lumber: 1, wool: 1 });
    const t = expectOk(applyAction(s, act({ type: 'seafarers/buildShip', player: 0, edge: gift })));
    expect(t.phase.kind).toBe('main');
    expect(seaSlice(t).harbors?.[0]).toHaveLength(1);
    // Settle on the coast of the main island next to an own ship: the harbour comes out.
    const u = mainPhase(structuredClone(t));
    const coast = V(2, 0, 'NW');
    const e = (graph(u).edgesAt.get(coast) ?? []).find((x) => isShipEdge(u, x)) as EdgeId;
    ship(u, 0, e);
    setHand(u, 0, { brick: 1, lumber: 1, wool: 1, grain: 1 });
    const w = expectOk(applyAction(u, { type: 'buildSettlement', player: 0, vertex: coast }));
    expect(w.phase.kind).toBe('seafarers/placeHarbor');
    const spot = legalActions(w, 0).find((a) => a.type === 'seafarers/placeHarbor') as Action;
    const x = expectOk(applyAction(w, spot));
    expect(x.board.ports).toHaveLength(1);
    expect(x.phase.kind).toBe('main');
    const kind = x.board.ports[0]?.kind;
    if (kind && kind !== 'generic') expect(bankTradeRatio(x, 0, kind)).toBe(2);
  });

  it('no settlement on the small islands without number tokens', () => {
    const s = tribeGame();
    expect(canPlaceSettlement(s, 0, V(0, 4, 'NE'), { requireRoad: false })).toBe(false);
    expect(canPlaceSettlement(s, 0, V(2, 4, 'NW'), { requireRoad: false })).toBe(true);
  });

  it('the robber never goes to the small islands', () => {
    const s = tribeGame();
    s.phase = { kind: 'moveRobber', resume: 'main' };
    const hexes = legalActions(s, 0).flatMap((a) => (a.type === 'moveRobber' ? [a.hex] : []));
    expect(hexes).toHaveLength(18); // the 18 numbered main-island hexes
  });
});

describe('Cloth for Catan (§2.7, §4.9, E10, E11)', () => {
  const W9 = V(3, 3, 'W'); // village with a 9 on (3,3)
  const HOME = V(1, 3, 'E'); // west island, one sea edge from W9
  const LINK = E(2, 2, 'S');

  function clothGame() {
    const s = mainPhase(seaGame('clothForCatan', 4));
    s.pieces.buildings[HOME] = { owner: 0, kind: 'settlement' };
    return s;
  }

  it('three setup rounds; only the third pays (F3)', () => {
    const s = seaGame('clothForCatan', 4);
    const o = setupOrderOf(s);
    expect(o.order).toEqual([0, 1, 2, 3, 3, 2, 1, 0, 0, 1, 2, 3]);
    expect(o.pays.map((x, i) => (x ? i : -1)).filter((i) => i >= 0)).toEqual([8, 9, 10, 11]);
  });

  it('a ship route to a village: 1 cloth, then 1 per roll of its number; route closed', () => {
    const s = clothGame();
    setHand(s, 0, { lumber: 1, wool: 1 });
    const t = expectOk(applyAction(s, act({ type: 'seafarers/buildShip', player: 0, edge: LINK })));
    const cloth = seaSlice(t).cloth!;
    expect(cloth.held[0]).toBe(1);
    expect(cloth.villages[W9]?.cloth).toBe(4);
    expect(cloth.links[W9]).toEqual([0]);
    expect(seaSlice(t).ships[LINK]?.closed).toBe(true);
    const u = rollTotal(preRoll(structuredClone(t)), 9);
    expect(seaSlice(u).cloth?.held[0]).toBe(2);
    expect(victoryPoints(u, 0) - victoryPoints(t, 0)).toBe(1); // 2 cloth = 1 VP
  });

  it('an empty village gives nothing, even with supply left; a short one draws on the supply', () => {
    const s = clothGame();
    ship(s, 0, LINK);
    const c = seaSlice(s).cloth!;
    c.links[W9] = [0, 1];
    c.villages[W9]!.cloth = 1;
    c.supply -= 1;
    c.held[2] = 1; // keep the total
    let t = rollTotal(preRoll(s), 9);
    expect(seaSlice(t).cloth?.held.slice(0, 2)).toEqual([1, 1]);
    expect(seaSlice(t).cloth?.villages[W9]?.cloth).toBe(0);
    t = rollTotal(preRoll(t), 9);
    expect(seaSlice(t).cloth?.held.slice(0, 2)).toEqual([1, 1]);
  });

  it('the pirate moves only for players with a village route (E11); robber not on village islands', () => {
    const s = clothGame();
    s.phase = { kind: 'moveRobber', resume: 'main' };
    expect(legalActions(s, 0).some((a) => a.type === 'seafarers/movePirate')).toBe(false);
    const robber = legalActions(s, 0).flatMap((a) => (a.type === 'moveRobber' ? [a.hex] : []));
    expect(robber).not.toContain(H(3, 3));
    expect(robber).not.toContain(H(2, 6));
    seaSlice(s).cloth!.links[W9] = [0];
    expect(legalActions(s, 0).some((a) => a.type === 'seafarers/movePirate')).toBe(true);
  });

  it('the pirate may take a cloth chit instead of a card', () => {
    const s = clothGame();
    seaSlice(s).cloth!.links[W9] = [0];
    s.phase = { kind: 'moveRobber', resume: 'main' };
    const hex = H(2, 4);
    const edge = (graph(s).hexEdges.get(hex) ?? []).find(
      (e) => e !== LINK && isShipEdge(s, e),
    ) as EdgeId;
    ship(s, 1, edge);
    seaSlice(s).cloth!.held[1] = 2;
    seaSlice(s).cloth!.supply -= 2;
    const t = expectOk(applyAction(s, act({ type: 'seafarers/movePirate', player: 0, hex })));
    expect(t.phase.kind).toBe('seafarers/pirateSteal');
    const u = expectOk(applyAction(t, act({ type: 'seafarers/stealCloth', player: 0, victim: 1 })));
    expect(seaSlice(u).cloth?.held.slice(0, 2)).toEqual([1, 1]);
  });

  it('no Longest Trade Route', () => {
    const s = clothGame();
    for (let i = 0; i < 6; i++) s.pieces.roads[graph(s).edges[i] as EdgeId] = 0;
    const t = expectOk(applyAction(s, { type: 'endTurn', player: 0 }));
    expect(t.awards.longestRoad).toBeNull();
  });

  it('the game ends when 3 or fewer villages hold cloth: most VP wins, then most cloth', () => {
    const s = clothGame();
    const c = seaSlice(s).cloth!;
    const vs = Object.values(c.villages);
    let moved = 0;
    vs.slice(0, 5).forEach((v) => {
      moved += v.cloth;
      v.cloth = 0;
    });
    c.held[1] = moved;
    const t = expectOk(applyAction(s, { type: 'endTurn', player: 0 }));
    expect(t.phase.kind).toBe('gameOver');
    expect(t.winner).toBe(1); // the cloth VP decide
  });
});

describe('The Pirate Islands (§2.8, §4.10, E12-E15)', () => {
  it('each player starts with a settlement and a ship; 3 players drop white', () => {
    const s = seaGame('pirateIslands', 3);
    expect(pirateSeats('pirates3', 3).map((x) => x.colour)).toEqual(['orange', 'blue', 'red']);
    expect(Object.values(s.pieces.buildings)).toHaveLength(3);
    expect(Object.keys(seaSlice(s).ships)).toHaveLength(3);
    expect(s.robber).toBe(OFF_BOARD);
    expect(supplyOf(s).devDeck.victoryPoint).toBe(0);
    expect(supplyOf(seaGame('pirateIslands', 4)).devDeck.knight).toBe(19);
  });

  it('one line only: each new ship extends it one step towards the beachhead', () => {
    const s = mainPhase(seaGame('pirateIslands', 4));
    setHand(s, 0, { lumber: 3, wool: 3 });
    const spots = legalActions(s, 0).filter((a) => a.type === 'seafarers/buildShip');
    expect(spots.length).toBeGreaterThan(0);
    const head = lineOf(s, 0).head;
    for (const a of spots) {
      const e = (a as { edge: EdgeId }).edge;
      expect(graph(s).ends.get(e)).toContain(head);
    }
    expect(legalActions(s, 0).some((a) => a.type === 'seafarers/pickShip')).toBe(false);
  });

  it('a 7: no robber, the roller robs any other player', () => {
    const s = preRoll(seaGame('pirateIslands', 4));
    setHand(s, 2, { grain: 1 });
    s.rng = rngForDice(3, 4);
    const t = expectOk(applyAction(s, { type: 'rollDice', player: 0 }));
    expect(t.phase).toMatchObject({ kind: 'steal', candidates: [2] });
  });

  it('a Knight builds a warship of the hindmost ship; no Largest Army', () => {
    const s = mainPhase(seaGame('pirateIslands', 4));
    s.players[0]!.devCards.knight = 3;
    s.players[0]!.knightsPlayed = 2;
    const first = lineOf(s, 0).ships[0] as EdgeId;
    const t = expectOk(applyAction(s, { type: 'playKnight', player: 0 }));
    expect(seaSlice(t).ships[first]?.warship).toBe(true);
    expect(warships(t, 0)).toBe(1);
    expect(t.phase.kind).toBe('main');
    expect(t.awards.largestArmy).toBeNull();
  });

  it('the fleet sails the lower die and attacks where it stops', () => {
    const s = preRoll(seaGame('pirateIslands', 4));
    s.rng = rngForDice(5, 2);
    setHand(s, 0, { ore: 3 });
    const t = expectOk(applyAction(s, { type: 'rollDice', player: 0 }));
    expect(seaSlice(t).fleet?.at).toBe(2);
    expect(fleetHex(t)).toBe(H(1, 5));
  });

  it('the fortress: an attack ends the turn; a defeat costs 2 ships, a tie 1; 3 wins take it', () => {
    let s = mainPhase(seaGame('pirateIslands', 4));
    // Build the line to the fortress.
    for (let i = 0; i < 30; i++) {
      setHand(s, 0, { lumber: 1, wool: 1 });
      const a = legalActions(s, 0).find((x) => x.type === 'seafarers/buildShip');
      if (!a) break;
      s = mainPhase(expectOk(applyAction(s, a)));
    }
    const f = fortressOf(s, 0)!;
    expect(lineOf(s, 0).head).toBe(f.vertex);
    expect(legalActions(s, 0).some((a) => a.type === 'seafarers/attackFortress')).toBe(true);
    const ships = lineOf(s, 0).ships.length;
    // Defeat: 0 warships vs a 3.
    s.rng = rngForDie(3);
    let t = expectOk(applyAction(s, act({ type: 'seafarers/attackFortress', player: 0 })));
    expect(lineOf(t, 0).ships).toHaveLength(ships - 2);
    expect(t.turn.current).toBe(1);
    // Victory three times with warships everywhere.
    const w = mainPhase(structuredClone(s));
    for (const e of lineOf(w, 0).ships) seaSlice(w).ships[e] = { owner: 0, warship: true };
    for (let i = 0; i < 3; i++) {
      mainPhase(w);
      w.rng = rngForDie(1);
      t = expectOk(applyAction(w, act({ type: 'seafarers/attackFortress', player: 0 })));
      Object.assign(w, t);
    }
    expect(fortressOf(t, 0)?.chits).toBe(0);
    expect(t.pieces.buildings[f.vertex]).toEqual({ owner: 0, kind: 'settlement' });
  });

  it('you win only with your fortress taken and 10 VP', () => {
    const s = mainPhase(seaGame('pirateIslands', 4));
    // 1 starting settlement + 4 cities + ... = 10+ VP, but the fortress still stands: no win.
    const vs = graph(s)
      .vertices.filter((v) => canPlaceSettlement(s, 0, v, { requireRoad: false }))
      .slice(0, 5);
    for (const v of vs) s.pieces.buildings[v] = { owner: 0, kind: 'city' };
    expect(victoryPoints(s, 0)).toBeGreaterThanOrEqual(10);
    expect(trade4(structuredClone(s)).winner).toBeNull();
    seaSlice(s).fleet!.fortresses[0]!.chits = 0;
    s.pieces.buildings[fortressOf(s, 0)!.vertex] = { owner: 0, kind: 'settlement' };
    expect(trade4(s).winner).toBe(0);
  });
});

describe('The Wonders of Catan (§2.9, §4.11, E16-E18)', () => {
  it('starting settlements avoid the marked corners', () => {
    const s = seaGame('wondersOfCatan', 4);
    const marks = wonderMarks('wonders')!;
    const spots = new Set(
      legalActions(s, 0).flatMap((a) => (a.type === 'placeSetupSettlement' ? [a.vertex] : [])),
    );
    for (const v of [...marks.strait, ...marks.wasteland, ...marks.bang])
      expect(spots.has(v)).toBe(false);
  });

  it('start a wonder you qualify for; nobody else may take it; a level costs its 5 cards', () => {
    const s = mainPhase(seaGame('wondersOfCatan', 4));
    const cards = wonderCards('wonders');
    const theater = cards.findIndex((c) => c.id === 'theater');
    expectFail(
      applyAction(s, act({ type: 'seafarers/startWonder', player: 0, wonder: theater })),
      /2 cities/,
    );
    const vs = graph(s)
      .vertices.filter((v) => canPlaceSettlement(s, 0, v, { requireRoad: false }))
      .slice(0, 2);
    for (const v of vs) s.pieces.buildings[v] = { owner: 0, kind: 'city' };
    let t = expectOk(
      applyAction(s, act({ type: 'seafarers/startWonder', player: 0, wonder: theater })),
    );
    expect(shipsLeft(t, 0)).toBe(14); // a ship marks the card
    setHand(t, 0, { lumber: 2, brick: 2, wool: 6 });
    t = expectOk(applyAction(t, act({ type: 'seafarers/buildWonder', player: 0 })));
    t = expectOk(applyAction(t, act({ type: 'seafarers/buildWonder', player: 0 }))); // several per turn
    expect(seaSlice(t).wonders?.level[0]).toBe(2);
    expectConserved(t);
    const u = mainPhase(structuredClone(t), 1);
    for (const v of graph(u)
      .vertices.filter((v) => canPlaceSettlement(u, 1, v, { requireRoad: false }))
      .slice(0, 2)) {
      u.pieces.buildings[v] = { owner: 1, kind: 'city' };
    }
    expectFail(
      applyAction(u, act({ type: 'seafarers/startWonder', player: 1, wonder: theater })),
      /someone/,
    );
  });

  it('level 4 wins at once; 10 VP win only with a strictly higher level', () => {
    const s = mainPhase(seaGame('wondersOfCatan', 4));
    const w = seaSlice(s).wonders!;
    w.started[4] = 0;
    w.level[0] = 3;
    const card = wonderCards('wonders')[4]!;
    setHand(s, 0, card.cost);
    const t = expectOk(applyAction(s, act({ type: 'seafarers/buildWonder', player: 0 })));
    expect(t.winner).toBe(0);
    // 10 VP but a tie on levels: no win.
    const u = mainPhase(seaGame('wondersOfCatan', 4));
    const uw = seaSlice(u).wonders!;
    uw.started[0] = 0;
    uw.started[1] = 1;
    uw.level[0] = 1;
    uw.level[1] = 1;
    const vs = graph(u)
      .vertices.filter((v) => canPlaceSettlement(u, 0, v, { requireRoad: false }))
      .slice(0, 5);
    for (const v of vs) u.pieces.buildings[v] = { owner: 0, kind: 'city' };
    expect(victoryPoints(u, 0)).toBeGreaterThanOrEqual(10);
    expect(trade4(structuredClone(u)).winner).toBeNull();
    uw.level[0] = 2;
    expect(trade4(u).winner).toBe(0);
  });
});

describe('variant combinations createGame refuses', () => {
  const base = { seed: 1, players: players(4), mode: 'seafarers', startingPlayer: 0 } as const;
  it('Event Cards with the Pirate Islands; the 5+ rule set; map balance rules', () => {
    expect(() =>
      createGame({ ...base, scenario: 'seafarers/pirateIslands', eventCards: true }),
    ).toThrow(/Event Cards/);
    expect(() =>
      createGame({ ...base, players: players(5), scenario: 'seafarers/newShores', rules56: true }),
    ).toThrow();
    expect(() =>
      createGame({ ...base, scenario: 'seafarers/newShores', mapRules: { allowRedTouch: true } }),
    ).toThrow(/balance/);
  });

  it('Event Cards, the friendly robber and the chess clock work with the other scenarios', () => {
    expect(() =>
      createGame({
        ...base,
        scenario: 'seafarers/newShores',
        eventCards: true,
        robberMode: 'friendly',
        timer: { preset: 'blitz', bankSec: 300, incrementSec: 10 },
      }),
    ).not.toThrow();
  });

  it('the variable set-up option', () => {
    const a = createGame({
      ...base,
      scenario: 'seafarers/newShores',
      options: { seafarers: { layout: 'variable' } },
    });
    const b = createGame({ ...base, scenario: 'seafarers/newShores' });
    expect(a.board.hexes).not.toEqual(b.board.hexes);
    expect(run(a)).toBe(a);
  });
});
