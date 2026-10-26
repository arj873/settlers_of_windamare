import { describe, expect, it } from 'vitest';
import {
  emptyBoardGame,
  expectOk,
  place,
  rngForRoll,
  rollTotal,
  run,
  setHand,
} from './actions/testkit';
import { cloneState } from './clone';
import { createGame } from './createGame';
import { applyAction, legalActions } from './engine';
import { EVENT_CARDS } from './rules/events';
import { FIXTURE_PLAYERS, freshGame, midGame } from './fixtures';
import { emptyResources } from './resources';
import { emptyPlayerStats, emptyStats, statsOf, sumCounts } from './stats';
import { hexVertices, TOPOLOGY } from './topology';
import type { Action, EventKind, GameState, HexId, PlayerId, PlayerStats } from './types';

const N = (h: HexId) => hexVertices(TOPOLOGY, h)[0]!;
const S = (h: HexId) => hexVertices(TOPOLOGY, h)[3]!;

/** `s` with fresh, complete stats (so a test sees only what its actions record). */
function tracked(s: GameState): GameState {
  return { ...s, stats: emptyStats(s.players.length) };
}

const ps = (s: GameState, p: PlayerId): PlayerStats => statsOf(s).players[p]!;
const res = (bundle: Partial<Record<keyof ReturnType<typeof emptyResources>, number>>) => ({
  ...emptyResources(),
  ...bundle,
});

/** midGame (Blue, 1, in main) with fresh stats. */
const main = () => tracked(midGame());

function deepFreeze<T>(o: T): T {
  if (typeof o === 'object' && o !== null && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

describe('stats: lifecycle', () => {
  it('createGame starts empty, complete stats, one per player', () => {
    const s = freshGame(3);
    expect(s.stats).toEqual(emptyStats(3));
    expect(s.stats?.complete).toBe(true);
    expect(JSON.parse(JSON.stringify(s.stats))).toEqual(s.stats);
  });

  it('a state without stats (older save) starts recording on its next action, incomplete', () => {
    const s = midGame();
    expect(s.stats).toBeUndefined();
    expect(statsOf(s)).toEqual(emptyStats(4, false, 12));
    const after = run(s, { type: 'endTurn', player: 1 });
    expect(after.stats?.complete).toBe(false);
    expect(after.stats?.fromTurn).toBe(12);
  });

  it('stats are immutable: applyAction never mutates them, unchanged ones are shared', () => {
    const s = deepFreeze(rollTotal(tracked(emptyBoardGame()), 8));
    // endTurn adds a VP snapshot to a frozen state's stats: a new object, the old one intact.
    const ended = expectOk(applyAction(s, { type: 'endTurn', player: 0 }));
    expect(s.stats?.players[0]?.rolls[6]).toBe(1);
    expect(s.stats?.vpHistory).toEqual([]);
    expect(ended.stats).not.toBe(s.stats);
    expect(ended.stats?.players).toBe(s.stats?.players);
    expect(cloneState(s).stats).toBe(s.stats);
  });

  it('a whole setup: 2 settlements + 2 roads each, starting resources = hand', () => {
    let s = freshGame(4);
    while (s.phase.kind === 'setup') s = run(s, legalActions(s)[0]!);
    for (const p of s.players) {
      const st = ps(s, p.id);
      expect(st.built).toEqual({ road: 2, settlement: 2, city: 0 });
      expect(st.gained.setup).toEqual(p.resources);
    }
    expect(statsOf(s).vpHistory).toEqual([{ turn: 0, vp: [2, 2, 2, 2] }]);
  });

  it('a setup city (setupPlacement variant) counts as a city', () => {
    let s = createGame({
      seed: 's',
      players: FIXTURE_PLAYERS,
      map: 'base',
      startingPlayer: 0,
      setupPlacement: {
        first: { building: 'city', restriction: 'normal' },
        second: { building: 'settlement', restriction: 'normal' },
      },
    });
    s = run(s, legalActions(s)[0]!);
    expect(ps(s, 0).built).toEqual({ road: 0, settlement: 0, city: 1 });
  });
});

/** A land hex with a number token other than h:0,-2 (beginner board). */
const HEX = TOPOLOGY.landHexes.find((h) => h !== 'h:0,-2' && freshGame().board.hexes[h]?.token)!;

describe('stats: dice and production', () => {
  /** Player 0 has a settlement on HEX's N corner, player 1 a city on its S corner. */
  function producing(): GameState {
    const s = tracked(emptyBoardGame());
    place(s, 0, N(HEX));
    place(s, 1, S(HEX), 'city');
    s.robber = 'h:0,-2';
    return s;
  }
  const token = (s: GameState, h: HexId) => s.board.hexes[h]!.token!;
  const terrain = (s: GameState, h: HexId) => s.board.hexes[h]!.terrain;

  it('counts the roller’s total, production by type and expected production', () => {
    const s0 = producing();
    const roll = token(s0, HEX);
    const s = rollTotal(s0, roll);
    expect(ps(s, 0).rolls[roll - 2]).toBe(1);
    expect(ps(s, 0).rolls.reduce((a, b) => a + b)).toBe(1);
    expect(ps(s, 1).rolls.every((n) => n === 0)).toBe(true);
    const t = terrain(s0, HEX) as keyof ReturnType<typeof emptyResources>;
    expect(ps(s, 0).gained.production[t]).toBeGreaterThanOrEqual(1);
    expect(ps(s, 1).gained.production[t]).toBeGreaterThanOrEqual(2);
    // Expected: Σ pips × yield over each player's unblocked hexes (×36).
    const pips = (h: HexId) => 6 - Math.abs(7 - token(s0, h));
    const around = (v: ReturnType<typeof N>) =>
      TOPOLOGY.landHexes.filter(
        (h) =>
          hexVertices(TOPOLOGY, h).includes(v) &&
          s0.board.hexes[h]!.token !== null &&
          h !== s0.robber,
      );
    expect(ps(s, 0).expected36).toBe(around(N(HEX)).reduce((n, h) => n + pips(h), 0));
    expect(ps(s, 1).expected36).toBe(around(S(HEX)).reduce((n, h) => n + 2 * pips(h), 0));
  });

  it('counts what the robber blocked (settlement 1, city 2) and production stays honest', () => {
    const s0 = producing();
    s0.robber = HEX;
    const roll = token(s0, HEX);
    const t = terrain(s0, HEX) as keyof ReturnType<typeof emptyResources>;
    const s = rollTotal(s0, roll);
    expect(ps(s, 0).blocked).toEqual(res({ [t]: 1 }));
    expect(ps(s, 1).blocked).toEqual(res({ [t]: 2 }));
    for (const p of [0, 1]) {
      expect(sumCounts(ps(s, p).gained)).toEqual(s.players[p]!.resources);
    }
  });

  it('a 7: counted as a roll; discards count cards and times', () => {
    const s0 = tracked(emptyBoardGame());
    setHand(s0, 1, { ore: 9 });
    const s = rollTotal(s0, 7);
    expect(ps(s, 0).rolls[5]).toBe(1);
    const after = run(s, { type: 'discard', player: 1, resources: { ore: 4 } });
    expect(ps(after, 1).discards).toBe(1);
    expect(ps(after, 1).lost.discard).toEqual(res({ ore: 4 }));
  });

  it('rush mode: the automatic roll at the start of a turn is counted for the new player', () => {
    const s0 = tracked(emptyBoardGame());
    s0.phase = { kind: 'main' };
    const s1 = { ...s0, settings: { ...s0.settings, rushMode: true }, rng: rngForRoll(4) };
    const s = run(s1, { type: 'endTurn', player: 0 });
    expect(ps(s, 1).rolls.reduce((a, b) => a + b)).toBe(1);
    expect(ps(s, 0).rolls.reduce((a, b) => a + b)).toBe(0);
  });
});

describe('stats: robber', () => {
  it('moveRobber and steal: counts, and the stolen card on both sides', () => {
    const s0 = tracked(emptyBoardGame());
    s0.phase = { kind: 'moveRobber', resume: 'main' };
    place(s0, 1, N(HEX));
    setHand(s0, 1, { wool: 2 });
    const s = run(
      s0,
      { type: 'moveRobber', player: 0, hex: HEX },
      { type: 'steal', player: 0, victim: 1 },
    );
    expect(ps(s, 0).robberMoves).toBe(1);
    expect(ps(s, 0).steals).toBe(1);
    expect(ps(s, 1).robbed).toBe(1);
    expect(ps(s, 0).gained.steal).toEqual(res({ wool: 1 }));
    expect(ps(s, 1).lost.stolen).toEqual(res({ wool: 1 }));
  });
});

describe('stats: building and dev cards', () => {
  it('build road / settlement / city: pieces and resources spent', () => {
    const s0 = main();
    setHand(s0, 1, { brick: 2, lumber: 2, wool: 1, grain: 3, ore: 3 });
    const road = legalActions(s0, 1).find((a) => a.type === 'buildRoad')!;
    const city = legalActions(s0, 1).find((a) => a.type === 'buildCity')!;
    const s = run(s0, road, city);
    expect(ps(s, 1).built).toEqual({ road: 1, settlement: 0, city: 1 });
    expect(ps(s, 1).lost.build).toEqual(res({ brick: 1, lumber: 1, grain: 2, ore: 3 }));
    const s2 = { ...s0 };
    s2.pieces = {
      ...s0.pieces,
      roads: { ...s0.pieces.roads, 'e:1,-1,SE': 1, 'e:1,0,NE': 1 },
    };
    const settle = legalActions(s2, 1).find((a) => a.type === 'buildSettlement');
    if (settle) expect(ps(run(s2, settle), 1).built.settlement).toBe(1);
  });

  it('buyDevCard: the card type bought and its cost', () => {
    const s0 = main();
    const top = s0.devDeck.at(-1)!;
    const s = run(s0, { type: 'buyDevCard', player: 1 });
    expect(ps(s, 1).devBought).toEqual({ ...emptyPlayerStats().devBought, [top]: 1 });
    expect(ps(s, 1).lost.buyDev).toEqual(res({ wool: 1, grain: 1, ore: 1 }));
  });

  it('knight, Year of Plenty, Monopoly, Road Building: played counts and card flows', () => {
    const s0 = main();
    s0.players[1]!.devCards = { ...s0.players[1]!.devCards, yearOfPlenty: 1, roadBuilding: 1 };
    s0.players[1]!.devCards.monopoly = 1;
    const knight = run(s0, { type: 'playKnight', player: 1 });
    expect(ps(knight, 1).devPlayed.knight).toBe(1);

    const yop = run(s0, { type: 'playYearOfPlenty', player: 1, resources: ['brick', 'brick'] });
    expect(ps(yop, 1).devPlayed.yearOfPlenty).toBe(1);
    expect(ps(yop, 1).gained.devCard).toEqual(res({ brick: 2 }));

    // Orange holds 3 lumber, Red 1.
    const mono = run(s0, { type: 'playMonopoly', player: 1, resource: 'lumber' });
    expect(ps(mono, 1).gained.devCard).toEqual(res({ lumber: 4 }));
    expect(ps(mono, 3).lost.monopoly).toEqual(res({ lumber: 3 }));
    expect(ps(mono, 0).lost.monopoly).toEqual(res({ lumber: 1 }));
    expect(ps(mono, 1).lost.other).toEqual(emptyResources());

    let rb = run(s0, { type: 'playRoadBuilding', player: 1 });
    while (rb.phase.kind === 'roadBuilding') {
      rb = run(
        rb,
        legalActions(rb, 1).find((a) => a.type === 'placeFreeRoad')!,
      );
    }
    expect(ps(rb, 1).devPlayed.roadBuilding).toBe(1);
    expect(ps(rb, 1).freeRoads).toBe(2);
    expect(ps(rb, 1).built.road).toBe(2);
    expect(ps(rb, 1).lost.build).toEqual(emptyResources());
  });
});

describe('stats: trading', () => {
  it('player trade: offers, the deal on both sides', () => {
    const s0 = main();
    const s = run(
      s0,
      { type: 'offerTrade', player: 1, give: { ore: 1 }, want: { brick: 1 }, to: [3] },
      { type: 'acceptTrade', player: 3 },
      { type: 'confirmTrade', player: 1, partner: 3 },
    );
    expect(ps(s, 1).offersMade).toBe(1);
    expect(ps(s, 1).tradesAsOfferer).toBe(1);
    expect(ps(s, 3).tradesAsPartner).toBe(1);
    expect(ps(s, 1).gained.trade).toEqual(res({ brick: 1 }));
    expect(ps(s, 1).lost.trade).toEqual(res({ ore: 1 }));
    expect(ps(s, 3).gained.trade).toEqual(res({ ore: 1 }));
    expect(ps(s, 3).lost.trade).toEqual(res({ brick: 1 }));
    // A rejected offer counts as made, with no trade.
    const rejected = run(
      s0,
      { type: 'offerTrade', player: 1, give: { ore: 1 }, want: { brick: 1 }, to: [3] },
      { type: 'rejectTrade', player: 3 },
    );
    expect(ps(rejected, 1).offersMade).toBe(1);
    expect(ps(rejected, 1).tradesAsOfferer).toBe(0);
  });

  it('bank 4:1 vs harbor trades', () => {
    const inMain = () => {
      const s = tracked(emptyBoardGame());
      s.phase = { kind: 'main' };
      return s;
    };
    const s0 = inMain();
    setHand(s0, 0, { ore: 4 });
    const bank = run(s0, { type: 'bankTrade', player: 0, give: 'ore', receive: 'brick' });
    expect(ps(bank, 0).bankTrades).toBe(1);
    expect(ps(bank, 0).portTrades).toBe(0);
    expect(ps(bank, 0).lost.bank).toEqual(res({ ore: 4 }));
    expect(ps(bank, 0).gained.bank).toEqual(res({ brick: 1 }));

    const port = s0.board.ports.find((p) => p.kind === 'generic')!;
    const s1 = inMain();
    setHand(s1, 0, { ore: 3 });
    place(s1, 0, port.vertices[0]);
    const viaPort = run(s1, { type: 'bankTrade', player: 0, give: 'ore', receive: 'brick' });
    expect(ps(viaPort, 0).portTrades).toBe(1);
    expect(ps(viaPort, 0).lost.bank).toEqual(res({ ore: 3 }));
  });
});

describe('stats: awards and VP history', () => {
  it('Largest Army changes are logged with the turn', () => {
    const s0 = main();
    s0.players[1]!.knightsPlayed = 3;
    const s = run(s0, { type: 'playKnight', player: 1 });
    expect(statsOf(s).awardHistory).toEqual([{ turn: 12, award: 'largestArmy', player: 1 }]);
  });

  it('VP snapshot at each endTurn, and a final one at game over', () => {
    const s0 = main();
    const s = run(s0, { type: 'endTurn', player: 1 });
    // Red: settlement + city + Longest Road; Blue: 2 settlements + city + a VP card.
    expect(statsOf(s).vpHistory).toEqual([{ turn: 12, vp: [5, 5, 5, 2] }]);

    // White (turn 13, 5 VP) is one VP card short of winning: buys it.
    const r = rollTotal(s, 8);
    r.players[2]!.devCards.victoryPoint = 4;
    r.devDeck = [...r.devDeck, 'victoryPoint'];
    setHand(r, 2, { wool: 1, grain: 1, ore: 1 });
    const over = run(r, { type: 'buyDevCard', player: 2 });
    expect(over.phase.kind).toBe('gameOver');
    expect(statsOf(over).vpHistory.at(-1)).toEqual({ turn: 13, vp: [5, 5, 10, 2] });
  });
});

describe('stats: event cards', () => {
  /** midGame with event cards and fresh stats; Blue (1) to draw `event` next. */
  function drawing(event: EventKind): GameState {
    const s = tracked(midGame());
    const settings = { ...s.settings, eventCards: true };
    const id = EVENT_CARDS.findIndex((c) => c.event === event);
    return {
      ...s,
      settings,
      eventDeck: [0, 1, 2, 3, 4, 5, 6].filter((i) => i !== id).concat(id),
      lastEvent: null,
      damagedRoads: [null, null, null, null],
      phase: { kind: 'preRoll' },
    };
  }

  it('counts the event drawn and the card’s number as the roll', () => {
    const s = run(drawing('none'), { type: 'rollDice', player: 1 });
    expect(statsOf(s).events).toEqual({ none: 1 });
    expect(ps(s, 1).rolls.reduce((a, b) => a + b)).toBe(1);
  });

  it('gain / give / steal tasks are classified, production after them too', () => {
    let s = run(drawing('plentifulYear'), { type: 'rollDice', player: 1 });
    for (let p = 0; p < 4; p++) s = run(s, { type: 'eventGain', player: p, resource: 'wool' });
    expect(s.phase.kind).toBe('main');
    for (let p = 0; p < 4; p++) {
      expect(ps(s, p).gained.event).toEqual(res({ wool: 1 }));
      expect(ps(s, p).gained.other).toEqual(emptyResources());
    }

    let g = run(drawing('goodNeighbors'), { type: 'rollDice', player: 1 });
    const gives = legalActions(g).filter((a) => a.type === 'eventGive');
    const first = gives.find((a) => a.player === 1)! as Extract<Action, { type: 'eventGive' }>;
    g = run(g, first);
    expect(ps(g, 1).lost.event).toEqual(res({ [first.resource]: 1 }));
    expect(ps(g, first.to).gained.event).toEqual(res({ [first.resource]: 1 }));

    const t = run(drawing('tradeAdvantage'), { type: 'rollDice', player: 1 });
    const steal = legalActions(t).find((a) => a.type === 'eventSteal' && a.victim !== null)!;
    const after = run(t, steal);
    if (steal.type !== 'eventSteal' || steal.victim === null) throw new Error('no steal');
    const total = (c: ReturnType<typeof emptyResources>) =>
      Object.values(c).reduce((a, b) => a + b);
    expect(ps(after, steal.player).steals).toBe(1);
    expect(ps(after, steal.victim).robbed).toBe(1);
    expect(total(ps(after, steal.player).gained.steal)).toBe(1);
    expect(ps(after, steal.victim).lost.stolen).toEqual(ps(after, steal.player).gained.steal);
  });
});
