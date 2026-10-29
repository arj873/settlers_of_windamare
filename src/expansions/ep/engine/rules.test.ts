import { describe, expect, it } from 'vitest';
import { applyAction, legalActions } from '../../../engine/engine';
import { expandState } from '../../../engine/rng';
import { costOf, pieceLimit } from '../../../engine/expansions/hooks';
import { bankTradeRatio } from '../../../engine/actions/trade';
import { piecesLeft, victoryPoints } from '../../../engine/selectors';
import { supplyOf } from '../../../engine/mapLookup';
import type { Action, GameState } from '../../../engine/types';
import { A } from './actions';
import { T } from './maps';
import { epSlice, ITEM } from './state';
import {
  blank,
  E,
  epGame,
  give,
  H,
  movement,
  openSea,
  R,
  reveal,
  run,
  settle,
  tryAct,
  V,
} from './testkit';

const types = (s: GameState, p = 0) => new Set<string>(legalActions(s, p).map((a) => a.type));

// A coastal corner of the island: SE of (5,0), between (5,0) and the sea hexes (7,0), (6,1).
const COAST = V(5, 0, 'SE');
// An inland corner: S of (3,0) = (3,0), (2,1), (4,1).
const INLAND = V(3, 0, 'S');

describe('costs, pieces, no base extras (§1.1, §4.1)', () => {
  it('costs: harbor 2 grain 2 ore, ship lumber wool, settler = settlement, crew ore wool, extra move 1 wool', () => {
    const s = blank();
    expect(costOf(s, ITEM.harbor)).toEqual(R({ grain: 2, ore: 2 }));
    expect(costOf(s, ITEM.ship)).toEqual(R({ lumber: 1, wool: 1 }));
    expect(costOf(s, ITEM.settler)).toEqual(costOf(s, 'settlement'));
    expect(costOf(s, ITEM.crew)).toEqual(R({ ore: 1, wool: 1 }));
    expect(costOf(s, ITEM.extraMove)).toEqual(R({ wool: 1 }));
  });

  it('pieces: 15 roads, 5 settlements, 4 harbors, 3 ships, 2 settlers, 9 crews; no cities', () => {
    const s = blank();
    expect(piecesLeft(s, 0)).toMatchObject({ road: 15, settlement: 5, city: 0 });
    expect(pieceLimit(s, 0, ITEM.harbor)).toBe(4);
    expect(pieceLimit(s, 0, ITEM.ship)).toBe(3);
    expect(pieceLimit(s, 0, ITEM.settler)).toBe(2);
    expect(pieceLimit(s, 0, ITEM.crew)).toBe(9);
    expect(pieceLimit(blank('landHo'), 0, ITEM.crew)).toBe(0);
  });

  it('no development cards, no robber, no ports, no Longest Road', () => {
    const s = blank();
    expect(s.devDeck).toEqual([]);
    expect(Object.values(supplyOf(s).devDeck).every((n) => n === 0)).toBe(true);
    expect(s.board.ports).toEqual([]);
    expect(s.robber).toBe('h:999,999');
    give(s, 0, { ore: 3, grain: 2 });
    settle(s, 0, COAST);
    expect(tryAct(s, 'buildCity', 0, { vertex: COAST }).ok).toBe(false);
    expect(types(s).has('buildCity')).toBe(false);
  });
});

describe('harbor settlements (§4.2)', () => {
  it('upgrade a coastal settlement for 2 grain + 2 ore: 2 VP, the settlement piece comes back', () => {
    const s = blank();
    settle(s, 0, COAST);
    give(s, 0, { grain: 2, ore: 2 });
    expect(piecesLeft(s, 0).settlement).toBe(4);
    const t = run(s, A.buildHarbor, 0, { vertex: COAST });
    expect(epSlice(t).harbors[COAST]).toEqual([]);
    expect(victoryPoints(t, 0)).toBe(2);
    expect(piecesLeft(t, 0).settlement).toBe(5);
    expect(t.players[0]?.resources).toEqual(R());
  });

  it('not inland, not twice, not someone else’s, not without the cards, at most 4', () => {
    const s = blank();
    settle(s, 0, INLAND);
    settle(s, 1, V(4, 3, 'SE'));
    give(s, 0, { grain: 4, ore: 4 });
    expect(tryAct(s, A.buildHarbor, 0, { vertex: INLAND }).ok).toBe(false);
    expect(tryAct(s, A.buildHarbor, 0, { vertex: V(4, 3, 'SE') }).ok).toBe(false);
    settle(s, 0, COAST, true);
    expect(tryAct(s, A.buildHarbor, 0, { vertex: COAST }).ok).toBe(false);
    const u = blank();
    settle(u, 0, COAST);
    give(u, 0, { grain: 2, ore: 1 });
    expect(tryAct(u, A.buildHarbor, 0, { vertex: COAST }).ok).toBe(false);
    const w = blank();
    for (const v of [V(5, 0, 'NE'), V(4, 1, 'SE'), V(3, 2, 'SE'), V(4, 3, 'SE')])
      settle(w, 0, v, true);
    settle(w, 0, COAST);
    give(w, 0, { grain: 2, ore: 2 });
    expect(tryAct(w, A.buildHarbor, 0, { vertex: COAST }).ok).toBe(false);
  });

  it('produces 1 card like a settlement (no city yield)', () => {
    const s = blank();
    settle(s, 0, COAST, true);
    s.phase = { kind: 'preRoll' };
    // Roll (5,0)'s number (9) by trying seeds.
    const token = s.board.hexes[H(5, 0)]?.token as number;
    for (let seed = 0; seed < 200; seed++) {
      const r = applyAction({ ...s, rng: expandState(seed) }, { type: 'rollDice', player: 0 });
      if (r.ok && r.state.dice && r.state.dice[0] + r.state.dice[1] === token) {
        const res = r.state.players[0]?.resources;
        const terrain = s.board.hexes[H(5, 0)]?.terrain as 'lumber';
        expect(res?.[terrain]).toBe(1);
        return;
      }
    }
    throw new Error('no roll found');
  });
});

describe('gold (§3.2, §3.3)', () => {
  function rollTo(s: GameState, total: number): GameState {
    for (let seed = 0; seed < 500; seed++) {
      const r = applyAction(
        { ...s, rng: expandState(seed) },
        { type: 'rollDice', player: s.turn.current },
      );
      if (r.ok && r.state.dice && r.state.dice[0] + r.state.dice[1] === total) return r.state;
    }
    throw new Error(`no roll of ${total}`);
  }

  it('a player who gets no resources from a roll takes 1 gold; not on a 7', () => {
    const s = blank();
    s.phase = { kind: 'preRoll' };
    settle(s, 0, COAST); // (5,0) 9, sea, sea
    settle(s, 1, INLAND);
    const t = rollTo(s, 12); // no 12 next to either
    expect(epSlice(t).gold).toEqual([1, 1, 1, 1]);
    const u = rollTo(s, 7);
    expect(epSlice(u).gold).toEqual([0, 0, 0, 0]);
  });

  it('a captured gold field pays 2 gold per building on its number; still compensates (FAQ-6)', () => {
    const s = blank();
    s.phase = { kind: 'preRoll' };
    const h = H(9, 2);
    reveal(s, h, 'gold', 10);
    epSlice(s).lairs[h] = { token: 10, crews: [], captured: true };
    settle(s, 1, V(9, 2, 'N'));
    const t = rollTo(s, 10);
    // 2 from the field + 1 (no resource cards from the roll).
    expect(epSlice(t).gold[1]).toBe(3);
  });

  it('3:1 with the supply (no 4:1, no ports); 3 cards for 1 gold', () => {
    const s = blank();
    expect(bankTradeRatio(s, 0, 'ore')).toBe(3);
    give(s, 0, { ore: 3 });
    const t = run(s, 'bankTrade', 0, { give: 'ore', receive: 'grain' });
    expect(t.players[0]?.resources).toEqual(R({ grain: 1 }));
    const u = run(s, A.sellForGold, 0, { resource: 'ore' });
    expect(epSlice(u).gold[0]).toBe(1);
    expect(u.bank.ore).toBe(s.bank.ore + 3);
  });

  it('2 gold for 1 resource, at most twice per turn', () => {
    let s = blank();
    epSlice(s).gold[0] = 10;
    s = run(s, A.buyWithGold, 0, { resource: 'brick' });
    s = run(s, A.buyWithGold, 0, { resource: 'wool' });
    expect(s.players[0]?.resources).toEqual(R({ brick: 1, wool: 1 }));
    expect(epSlice(s).gold[0]).toBe(6);
    expect(tryAct(s, A.buyWithGold, 0, { resource: 'ore' }).ok).toBe(false);
    expect(types(s).has(A.buyWithGold)).toBe(false);
    const poor = blank();
    epSlice(poor).gold[0] = 1;
    expect(tryAct(poor, A.buyWithGold, 0, { resource: 'ore' }).ok).toBe(false);
  });

  it('Fast Gold: 1 card for 1 gold, once per turn per befriended Fast Gold farm (§4.12, FAQ-1)', () => {
    const s = blank();
    give(s, 0, { wool: 3 });
    expect(tryAct(s, A.fastGold, 0, { resource: 'wool' }).ok).toBe(false);
    epSlice(s).spice[H(9, 2)] = { kind: 'fast', sacks: [], crews: [0] };
    const t = run(s, A.fastGold, 0, { resource: 'wool' });
    expect(epSlice(t).gold[0]).toBe(1);
    expect(tryAct(t, A.fastGold, 0, { resource: 'wool' }).ok).toBe(false);
    // Combines with the 2-gold purchase and 3:1.
    epSlice(t).gold[0] = 2;
    expect(tryAct(t, A.buyWithGold, 0, { resource: 'ore' }).ok).toBe(true);
  });
});

describe('where roads and settlements go (§3.3, §4.11)', () => {
  it('never on a corner or side of an unexplored hex', () => {
    const s = blank();
    reveal(s, H(9, 2), 'ore', 5);
    // (11,2) is still face down: the corner shared with it is closed.
    settle(s, 0, V(9, 2, 'N'));
    s.pieces.roads[E(9, 2, 'NE')] = 0;
    give(s, 0, { brick: 2, lumber: 2, wool: 1, grain: 1 });
    expect(s.board.hexes[H(11, 2)]?.terrain).toBe(T.parrot);
    expect(tryAct(s, 'buildRoad', 0, { edge: E(9, 2, 'E') }).ok).toBe(false);
    expect(tryAct(s, 'buildSettlement', 0, { vertex: V(9, 2, 'NE') }).ok).toBe(false);
  });

  it('not on an uncaptured pirate lair; allowed once it is captured', () => {
    const s = openSea(blank());
    const lair = H(9, 2);
    reveal(s, lair, 'gold');
    epSlice(s).lairs[lair] = { token: 4, crews: [], captured: false };
    reveal(s, H(10, 1), 'ore', 6);
    settle(s, 0, V(10, 1, 'N'));
    s.pieces.roads[E(10, 1, 'NW')] = 0;
    s.pieces.roads[E(10, 1, 'W')] = 0;
    give(s, 0, { brick: 2, lumber: 2, wool: 1, grain: 1 });
    // The SW side of (10,1) is a side of the lair (9,2); its SW corner a corner.
    expect(tryAct(s, 'buildRoad', 0, { edge: E(10, 1, 'SW') }).ok).toBe(false);
    expect(tryAct(s, 'buildSettlement', 0, { vertex: V(10, 1, 'SW') }).ok).toBe(false);
    epSlice(s).lairs[lair] = { token: 4, crews: [], captured: true };
    reveal(s, lair, 'gold', 4);
    expect(tryAct(s, 'buildRoad', 0, { edge: E(10, 1, 'SW') }).ok).toBe(true);
    expect(tryAct(s, 'buildSettlement', 0, { vertex: V(10, 1, 'SW') }).ok).toBe(true);
  });

  it('on a spice farm only for a player with a crew there (§4.10, FAQ-12)', () => {
    const s = openSea(blank());
    const farm = H(9, 2);
    reveal(s, farm, T.spice);
    epSlice(s).spice[farm] = { kind: 'swift', sacks: [0, 1], crews: [1] };
    reveal(s, H(10, 1), 'ore', 6);
    settle(s, 0, V(10, 1, 'N'));
    s.pieces.roads[E(10, 1, 'NW')] = 0;
    s.pieces.roads[E(10, 1, 'W')] = 0;
    give(s, 0, { brick: 2, lumber: 2, wool: 1, grain: 1 });
    const corner = V(10, 1, 'SW');
    expect(tryAct(s, 'buildSettlement', 0, { vertex: corner }).ok).toBe(false);
    expect(tryAct(s, 'buildRoad', 0, { edge: E(10, 1, 'SW') }).ok).toBe(false);
    expect(legalActions(s, 0).some((a) => a.type === 'buildSettlement')).toBe(false);
    epSlice(s).spice[farm]?.crews.push(0);
    expect(tryAct(s, 'buildSettlement', 0, { vertex: corner }).ok).toBe(true);
    expect(tryAct(s, 'buildRoad', 0, { edge: E(10, 1, 'SW') }).ok).toBe(true);
  });

  it('a free road (Road Building, fish in the combinations) obeys the farms too', () => {
    const s = openSea(blank());
    const farm = H(9, 2);
    reveal(s, farm, T.spice);
    epSlice(s).spice[farm] = { kind: 'swift', sacks: [0, 1], crews: [1] };
    reveal(s, H(10, 1), 'ore', 6);
    settle(s, 0, V(10, 1, 'N'));
    s.pieces.roads[E(10, 1, 'NW')] = 0;
    s.pieces.roads[E(10, 1, 'W')] = 0;
    s.phase = { kind: 'roadBuilding', remaining: 1, resume: 'main' };
    const edge = E(10, 1, 'SW');
    const free = () =>
      legalActions(s, 0).some((a) => a.type === 'placeFreeRoad' && a.edge === edge);
    expect(free()).toBe(false);
    expect(tryAct(s, 'placeFreeRoad', 0, { edge }).ok).toBe(false);
    epSlice(s).spice[farm]?.crews.push(0);
    expect(free()).toBe(true);
    expect(tryAct(s, 'placeFreeRoad', 0, { edge }).ok).toBe(true);
  });
});

describe('the turn: Action phase, then Movement phase (§3.1, §3.4)', () => {
  it('no trading or building once the Movement phase has begun; movement actions only then', () => {
    const s = blank();
    settle(s, 0, COAST, true);
    give(s, 0, { lumber: 2, wool: 2, ore: 3, brick: 1, grain: 1 });
    epSlice(s).gold[0] = 4;
    const before = types(s);
    expect(before.has(A.buildShip)).toBe(true);
    expect(before.has('bankTrade')).toBe(true);
    expect(before.has(A.startMovement)).toBe(true);
    expect(before.has(A.moveShip)).toBe(false);
    const t = run(s, A.startMovement, 0);
    const after = types(t);
    for (const x of [
      A.buildShip,
      'bankTrade',
      'offerTrade',
      'buildRoad',
      A.buyWithGold,
      A.startMovement,
    ]) {
      expect(after.has(x), x).toBe(false);
    }
    expect(tryAct(t, 'bankTrade', 0, { give: 'ore', receive: 'grain' }).ok).toBe(false);
    expect(tryAct(t, A.buildShip, 0, { edge: E(5, 0, 'SE') }).ok).toBe(false);
    expect(after.has('endTurn')).toBe(true);
  });

  it('a new turn resets the per-turn state', () => {
    let s = movement(blank());
    epSlice(s).turn.goldBuys = 2;
    s = run(s, 'endTurn', 0);
    expect(s.turn.current).toBe(1);
    expect(epSlice(s).turn).toMatchObject({ movement: false, goldBuys: 0, fishRolled: false });
  });

  it('paired players (5-6): player 2 gets an Action and a Movement phase, no trading with players', () => {
    let s = blank('full', 5);
    s = run(s, 'endTurn', 0);
    expect(s.turn).toMatchObject({ current: 3, secondSettlerOf: 0 });
    expect(s.phase.kind).toBe('main');
    const t = types(s, 3);
    expect(t.has('offerTrade')).toBe(false);
    expect(t.has(A.startMovement)).toBe(true);
    s = run(s, 'endTurn', 3);
    expect(s.turn.current).toBe(1);
    expect(s.phase.kind).toBe('preRoll');
  });

  it('wins at once mid-turn at the target', () => {
    const s = blank('landHo');
    s.settings = { ...s.settings, vpToWin: 3 };
    settle(s, 0, COAST);
    settle(s, 0, V(3, 6, 'S'));
    give(s, 0, { grain: 2, ore: 2 });
    const t = run(s, A.buildHarbor, 0, { vertex: COAST });
    expect(t.phase.kind).toBe('gameOver');
    expect(t.winner).toBe(0);
  });
});

describe('legal actions are all accepted (soundness)', () => {
  it('every legal action applies, over random play in each scenario', () => {
    for (const [scenario, n] of [
      ['landHo', 4],
      ['pirateLairs', 3],
      ['fish', 4],
      ['spices', 4],
      ['full', 4],
      ['full', 5],
    ] as const) {
      let state = epGame(scenario, n, { seed: n * 31 });
      let pick = 12345;
      for (let step = 0; step < 1500 && state.phase.kind !== 'gameOver'; step++) {
        const legal = legalActions(state);
        expect(legal.length, `${scenario} ${state.phase.kind}`).toBeGreaterThan(0);
        for (const a of legal.slice(0, 30)) {
          const r = applyAction(state, a);
          expect(r.ok, `${scenario}: ${JSON.stringify(a)} ${r.ok ? '' : r.error}`).toBe(true);
        }
        pick = (pick * 1103515245 + 12345) >>> 0;
        const progress = legal.filter((a) => a.type !== 'endTurn');
        const from = progress.length > 0 && pick % 4 !== 0 ? progress : legal;
        const r = applyAction(state, from[pick % from.length] as Action);
        if (!r.ok) throw new Error(r.error);
        state = r.state;
      }
    }
  }, 60_000);
});
