/** V1 game-setting variants (RULES.md §18). Each rule gets a test; defaults must not change. */
import { describe, expect, it } from 'vitest';
import { expectFail, expectOk, run } from './actions/testkit';
import { secondSettlerFor } from './actions/turn';
import { MAP_VETO_CANDIDATES, vetoOrder } from './actions/veto';
import { cloneState } from './clone';
import { createGame, randomMapFor, randomSeatOrder, type GameConfig } from './createGame';
import { applyAction, legalActions } from './engine';
import { FIXTURE_PLAYERS, discardGame, freshGame, midGame } from './fixtures';
import { mapById } from './mapLookup';
import { EVENT_CARDS, EVENT_INFO } from './rules/events';
import { stealCandidates } from './actions/robber';
import { payableProduction } from './rules/production';
import { publicVictoryPoints, roadsOf } from './selectors';
import { hexVertices, topologyOf } from './topology';
import type { Action, EventKind, GameSettings, GameState } from './types';
import { FRIENDLY_ROBBER_MAX_VP, isRobberProtected, robberTargets } from './variants';

const PLAYERS = FIXTURE_PLAYERS;
const base = (extra: Partial<GameConfig> = {}): GameConfig => ({
  seed: 'v1',
  players: PLAYERS,
  map: 'base',
  startingPlayer: 0,
  ...extra,
});

/** A copy of `s` with extra settings (settings are shared between states: never mutate them). */
function withSettings(s: GameState, extra: Partial<GameSettings>): GameState {
  return { ...s, settings: { ...s.settings, ...extra } };
}

const types = (actions: Action[]) => [...new Set(actions.map((a) => a.type))].sort();

/** Play the whole setup with the first legal action each time. */
function playSetup(s: GameState): GameState {
  let state = s;
  while (state.phase.kind === 'setup' || state.phase.kind === 'mapVeto') {
    const a = legalActions(state)[0];
    if (!a) throw new Error('setup stalled');
    state = expectOk(applyAction(state, a));
  }
  return state;
}

describe('defaults keep the official rules', () => {
  it('default settings carry no variant keys', () => {
    const s = createGame(base());
    for (const k of [
      'robberMode',
      'eventCards',
      'setupPlacement',
      'seatOrder',
      'mapSelection',
      'rushMode',
      'turboMode',
      'secondSettler',
      'timer',
    ]) {
      expect(k in s.settings).toBe(false);
    }
    expect('eventDeck' in s).toBe(false);
    expect('damagedRoads' in s).toBe(false);
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });

  it('official options given explicitly are not written either', () => {
    const s = createGame(
      base({
        robberMode: 'normal',
        eventCards: false,
        mapSelection: 'fixed',
        setupPlacement: {
          first: { building: 'settlement', restriction: 'normal' },
          second: { building: 'settlement', restriction: 'normal' },
        },
      }),
    );
    expect(s.settings).toEqual(createGame(base()).settings);
  });
});

// ---------------------------------------------------------------------------------------------
describe('robber modes (§18.1)', () => {
  // midGame public VP: Red 5, Blue 4, White 5, Orange 2 (protected under the friendly robber).
  const friendly = () => withSettings(midGame(), { robberMode: 'friendly' });
  const orangeHexes = (s: GameState) =>
    topologyOf(s).landHexes.filter((h) =>
      hexVertices(topologyOf(s), h).some((v) => s.pieces.buildings[v]?.owner === 3),
    );

  it('friendly: players with ≤ 2 public VP are protected (VP cards do not count)', () => {
    const s = friendly();
    expect(publicVictoryPoints(s, 3)).toBe(FRIENDLY_ROBBER_MAX_VP);
    expect(isRobberProtected(s, 3)).toBe(true);
    expect(isRobberProtected(s, 1)).toBe(false);
    // Hidden VP cards do not lift the protection.
    s.players[3]!.devCards.victoryPoint = 2;
    expect(isRobberProtected(s, 3)).toBe(true);
    expect(isRobberProtected(midGame(), 3)).toBe(false); // normal mode
  });

  it('friendly: the robber may not go next to a protected player', () => {
    const s = friendly();
    s.phase = { kind: 'moveRobber', resume: 'main' };
    const targets = robberTargets(s, 1);
    for (const h of orangeHexes(s)) {
      expect(targets).not.toContain(h);
      if (h !== s.robber) expectFail(applyAction(s, { type: 'moveRobber', player: 1, hex: h }));
    }
    const legal = legalActions(s).filter((a) => a.type === 'moveRobber');
    expect(legal.length).toBe(targets.length);
    for (const a of legal) expectOk(applyAction(s, a));
  });

  it('friendly: protected players are never steal candidates', () => {
    const s = friendly();
    for (const h of orangeHexes(s)) expect(stealCandidates(s, 1, h)).not.toContain(3);
  });

  it('friendly: with no allowed hex the robber goes to (or stays on) the desert', () => {
    // Early game: every opponent has ≤ 2 points and their settlements touch every other hex.
    const s = withSettings(freshGame(), { robberMode: 'friendly' });
    const t = topologyOf(s);
    const desert = t.landHexes.find((h) => s.board.hexes[h]?.terrain === 'desert')!;
    const uncovered = new Set(t.landHexes.filter((h) => h !== desert));
    let placed = 0;
    while (uncovered.size > 0 && placed < 6) {
      // Greedy: the vertex touching the most uncovered hexes (distance rule irrelevant here).
      const best = [...t.vertices].sort(
        (a, b) =>
          t.vertex[b]!.hexes.filter((h) => uncovered.has(h)).length -
          t.vertex[a]!.hexes.filter((h) => uncovered.has(h)).length,
      )[0]!;
      s.pieces.buildings[best] = { owner: 1 + (placed % 3), kind: 'settlement' };
      for (const h of t.vertex[best]!.hexes) uncovered.delete(h);
      placed++;
    }
    expect(uncovered.size).toBe(0);
    s.robber = desert;
    expect(robberTargets(s, 0)).toEqual([desert]);
    s.turn.number = 3;
    s.phase = { kind: 'moveRobber', resume: 'main' };
    const next = expectOk(applyAction(s, { type: 'moveRobber', player: 0, hex: desert }));
    expect(next.robber).toBe(desert);
    expect(next.phase).toEqual({ kind: 'main' });
  });

  it('none: a 7 still makes players discard, then play goes straight on (no robber)', () => {
    const s = withSettings(discardGame(), { robberMode: 'none' });
    const after = run(
      s,
      { type: 'discard', player: 1, resources: { grain: 3, ore: 2 } },
      { type: 'discard', player: 3, resources: { lumber: 3, brick: 1 } },
    );
    expect(after.phase).toEqual({ kind: 'main' });
    expect(after.robber).toBe(s.robber);
  });

  it('none: a knight counts for Largest Army but moves no robber', () => {
    const s = withSettings(midGame(), { robberMode: 'none' });
    const after = run(s, { type: 'playKnight', player: 1 });
    expect(after.phase).toEqual({ kind: 'main' });
    expect(after.players[1]!.knightsPlayed).toBe(1);
  });

  it('none: the robber hex is not blocked', () => {
    const s = midGame();
    const t = topologyOf(s);
    const hex = t.landHexes.find(
      (h) =>
        s.board.hexes[h]?.token !== null && hexVertices(t, h).some((v) => s.pieces.buildings[v]),
    )!;
    s.robber = hex;
    const token = s.board.hexes[hex]!.token!;
    const sum = (rows: Record<string, number>[]) =>
      rows.reduce((n, r) => n + Object.values(r).reduce((a, b) => a + b, 0), 0);
    const blocked = sum(payableProduction(s, token));
    const open = sum(payableProduction(withSettings(s, { robberMode: 'none' }), token));
    expect(open).toBeGreaterThan(blocked);
  });
});

// ---------------------------------------------------------------------------------------------
describe('event cards (§18.2)', () => {
  it('the deck is the official 36 cards and matches the 2d6 distribution', () => {
    expect(EVENT_CARDS).toHaveLength(36);
    const ways = (n: number) => 6 - Math.abs(7 - n);
    for (let n = 2; n <= 12; n++) {
      expect(EVENT_CARDS.filter((c) => c.number === n)).toHaveLength(ways(n));
    }
    const count = (e: EventKind) => EVENT_CARDS.filter((c) => c.event === e).length;
    expect(count('robberAttacks')).toBe(6);
    expect(count('none')).toBe(16);
    expect(count('epidemic')).toBe(2);
    expect(count('robberFlees')).toBe(2);
    expect(count('calmSea')).toBe(2);
    expect(count('neighborlyAssistance')).toBe(2);
    for (const e of [
      'earthquake',
      'goodNeighbors',
      'tournament',
      'tradeAdvantage',
      'conflict',
      'plentifulYear',
    ] as const) {
      expect(count(e)).toBe(1);
    }
    expect(
      EVENT_CARDS.filter((c) => c.event === 'robberAttacks').every((c) => c.number === 7),
    ).toBe(true);
    for (const e of Object.keys(EVENT_INFO)) expect(EVENT_INFO[e as EventKind].name).toBeTruthy();
  });

  it('createGame starts an empty deck; balancedDice and eventCards exclude each other', () => {
    const s = createGame(base({ eventCards: true }));
    expect(s.eventDeck).toEqual([]);
    expect(s.lastEvent).toBeNull();
    expect(s.damagedRoads).toEqual([null, null, null, null]);
    expect(() => createGame(base({ eventCards: true, balancedDice: true }))).toThrow();
  });

  /** midGame with event cards, Blue (1) to draw `event` next (preRoll). */
  function drawing(event: EventKind, number?: number): GameState {
    const s = withSettings(midGame(), { eventCards: true });
    const id = EVENT_CARDS.findIndex(
      (c) => c.event === event && (number === undefined || c.number === number),
    );
    const others = EVENT_CARDS.map((_, i) => i)
      .filter((i) => i !== id)
      .slice(0, 6);
    s.eventDeck = [...others, id];
    s.lastEvent = null;
    s.damagedRoads = [null, null, null, null];
    s.phase = { kind: 'preRoll' };
    return s;
  }
  const roll = (s: GameState) => expectOk(applyAction(s, { type: 'rollDice', player: 1 }));

  it('a draw shows the number as dice, logs the event and pops the deck', () => {
    const s = drawing('none', 8);
    const after = roll(s);
    expect(after.dice).toEqual([4, 4]);
    expect(after.eventDeck).toHaveLength(6);
    expect(after.lastEvent).toBe('none');
    expect(after.phase).toEqual({ kind: 'main' });
    expect(after.log.some((l) => l.text === 'Blue rolled 8 (4+4)')).toBe(true);
  });

  it('reshuffles all 36 when 5 or fewer cards remain (New Year)', () => {
    const s = drawing('none', 8);
    s.eventDeck = [0, 1, 2, 3, 4];
    const after = roll(s);
    expect(after.eventDeck).toHaveLength(35);
    expect(after.log.some((l) => l.text.startsWith('New Year'))).toBe(true);
  });

  it('Robber Attacks! works as a rolled 7', () => {
    const after = roll(drawing('robberAttacks'));
    expect(after.dice).toEqual([3, 4]);
    // Blue holds 9 cards (> 7): discard.
    expect(after.phase.kind).toBe('discard');
  });

  it('Epidemic: cities produce only 1', () => {
    const s = drawing('epidemic', 8);
    const plain = drawing('none', 8);
    const a = roll(s);
    const b = roll(plain);
    const total = (x: GameState) =>
      x.players.reduce((n, p) => n + Object.values(p.resources).reduce((m, c) => m + c, 0), 0);
    expect(total(a)).toBeLessThanOrEqual(total(b));
  });

  it('Robber Flees: the robber returns to the desert', () => {
    const after = roll(drawing('robberFlees'));
    expect(after.board.hexes[after.robber]?.terrain).toBe('desert');
    expect(after.phase).toEqual({ kind: 'main' });
  });

  it('Plentiful Year: every player takes one resource of their choice, in any order', () => {
    let s = roll(drawing('plentifulYear'));
    expect(s.phase.kind).toBe('event');
    if (s.phase.kind !== 'event') return;
    expect(s.phase.tasks.map((t) => t.player)).toEqual([0, 1, 2, 3]);
    const before = s.players[2]!.resources.ore;
    s = run(s, { type: 'eventGain', player: 2, resource: 'ore' });
    expect(s.players[2]!.resources.ore).toBe(before + 1);
    expectFail(applyAction(s, { type: 'eventGain', player: 2, resource: 'ore' }));
    s = run(
      s,
      { type: 'eventGain', player: 0, resource: 'wool' },
      { type: 'eventGain', player: 3, resource: 'wool' },
      { type: 'eventGain', player: 1, resource: 'grain' },
    );
    expect(s.phase).toEqual({ kind: 'main' });
  });

  it('Good Neighbors: each player gives the next player one card', () => {
    let s = roll(drawing('goodNeighbors'));
    if (s.phase.kind !== 'event') throw new Error('expected event');
    expect(s.phase.tasks.find((t) => t.player === 3)?.targets).toEqual([0]);
    expectFail(applyAction(s, { type: 'eventGive', player: 3, to: 1, resource: 'ore' }));
    const ore0 = s.players[0]!.resources.ore;
    s = run(s, { type: 'eventGive', player: 3, to: 0, resource: 'ore' });
    expect(s.players[0]!.resources.ore).toBe(ore0 + 1);
  });

  it('Tournament: only the player(s) with the most knights take a resource', () => {
    const s = roll(drawing('tournament'));
    if (s.phase.kind !== 'event') throw new Error('expected event');
    expect(s.phase.tasks.map((t) => t.player)).toEqual([2]); // White, 3 knights
  });

  it('Trade Advantage: the Longest Road holder may take a card, or pass', () => {
    const s = roll(drawing('tradeAdvantage'));
    if (s.phase.kind !== 'event') throw new Error('expected event');
    expect(s.phase.tasks).toEqual([
      { player: 0, kind: 'steal', targets: [1, 2, 3], optional: true },
    ]);
    const passed = run(s, { type: 'eventSteal', player: 0, victim: null });
    expect(passed.phase).toEqual({ kind: 'main' });
    // The event resolves before the card's number produces, so check the steal itself.
    const r = applyAction(s, { type: 'eventSteal', player: 0, victim: 3 });
    const took = expectOk(r);
    expect(took.log.some((l) => l.text === 'Red stole from Orange (Trade Advantage)')).toBe(true);
    // Cards are conserved (the steal moves one; the production that follows comes from the bank).
    const all = (x: GameState) =>
      [...x.players.map((p) => p.resources), x.bank].reduce(
        (n, r) => n + Object.values(r).reduce((a, b) => a + b, 0),
        0,
      );
    expect(all(took)).toBe(all(s));
  });

  it('Conflict: the Largest Army holder must take a card; a tie without holder means nothing', () => {
    const s = roll(drawing('conflict'));
    if (s.phase.kind !== 'event') throw new Error('expected event');
    expect(s.phase.tasks[0]).toMatchObject({ player: 2, kind: 'steal', optional: false });
    expectFail(applyAction(s, { type: 'eventSteal', player: 2, victim: null }));
    const tie = drawing('conflict');
    tie.awards = { ...tie.awards, largestArmy: null };
    tie.players[0]!.knightsPlayed = 3;
    expect(roll(tie).phase).toEqual({ kind: 'main' });
  });

  it('Neighborly Assistance: the leaders give one card to a player with fewer points', () => {
    const s = roll(drawing('neighborlyAssistance', 10));
    if (s.phase.kind !== 'event') throw new Error('expected event');
    // Red and White lead with 5 public VP; Blue (4) and Orange (2) have fewer.
    expect(s.phase.tasks.map((t) => [t.player, t.targets])).toEqual([
      [0, [1, 3]],
      [2, [1, 3]],
    ]);
  });

  it('Calm Sea: the player(s) with the most harbors take a resource', () => {
    const s = roll(drawing('calmSea', 9));
    if (s.phase.kind === 'event') {
      for (const t of s.phase.tasks) expect(t.kind).toBe('gain');
    }
  });

  it('Earthquake: a damaged road blocks roads and settlements beside it until repaired', () => {
    let s = roll(drawing('earthquake'));
    if (s.phase.kind !== 'event') throw new Error('expected event');
    expect(s.phase.tasks).toHaveLength(4);
    const blueRoad = roadsOf(s, 1)[0]!;
    expectFail(applyAction(s, { type: 'eventDamageRoad', player: 1, edge: roadsOf(s, 0)[0]! }));
    s = run(s, { type: 'eventDamageRoad', player: 1, edge: blueRoad });
    for (const p of [0, 2, 3])
      s = run(s, { type: 'eventDamageRoad', player: p, edge: roadsOf(s, p)[0]! });
    expect(s.phase.kind).toBe('main');
    expect(s.damagedRoads?.[1]).toBe(blueRoad);
    // Roads still count for Longest Road; but no building of roads.
    s.players[1]!.resources = { brick: 3, lumber: 3, wool: 3, grain: 3, ore: 0 };
    s.bank.brick -= 3;
    s.bank.lumber -= 3;
    s.bank.wool += 0;
    expect(legalActions(s, 1).some((a) => a.type === 'buildRoad')).toBe(false);
    expect(legalActions(s, 1).some((a) => a.type === 'repairRoad')).toBe(true);
    const repaired = run(s, { type: 'repairRoad', player: 1 });
    expect(repaired.damagedRoads?.[1]).toBeNull();
    expect(repaired.players[1]!.resources.brick).toBe(2);
    expect(legalActions(repaired, 1).some((a) => a.type === 'buildRoad')).toBe(true);
    expectFail(applyAction(repaired, { type: 'repairRoad', player: 1 }), /no damaged road/);
  });

  it('every event phase is sound: each legal action applies', () => {
    for (const e of Object.keys(EVENT_INFO) as EventKind[]) {
      const s = roll(drawing(e));
      for (const a of legalActions(s)) expectOk(applyAction(s, a));
    }
  });
});

// ---------------------------------------------------------------------------------------------
describe('rush mode (§18.3)', () => {
  it('the dice roll automatically when a turn starts (no preRoll)', () => {
    let s = playSetup(createGame(base({ rushMode: true })));
    expect(s.phase.kind).not.toBe('preRoll');
    expect(s.dice).not.toBeNull();
    while (s.phase.kind !== 'main') s = expectOk(applyAction(s, legalActions(s)[0]!));
    const next = run(s, { type: 'endTurn', player: s.turn.current });
    expect(next.phase.kind).not.toBe('preRoll');
    expect(next.log.some((l) => l.turn === next.turn.number && l.text.includes('rolled'))).toBe(
      true,
    );
  });
});

describe('turbo mode (§18.4)', () => {
  it('the first setup settlement pays starting resources too', () => {
    const s = createGame(base({ turboMode: true }));
    const a = legalActions(s).find((x) => x.type === 'placeSetupSettlement')!;
    const after = run(s, a);
    const total = Object.values(after.players[0]!.resources).reduce((x, y) => x + y, 0);
    expect(total).toBeGreaterThan(0);
    const plain = run(createGame(base()), a);
    expect(Object.values(plain.players[0]!.resources).reduce((x, y) => x + y, 0)).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------
describe('second settler / paired players (§18.6)', () => {
  const paired = () => withSettings(midGame(), { secondSettler: true, specialBuildPhase: false });

  it('Catanian 2 is the third player to the left', () => {
    expect(secondSettlerFor(midGame(), 1)).toBe(0);
    expect(
      secondSettlerFor(
        createGame({
          ...base(),
          players: [...PLAYERS, ...PLAYERS.slice(0, 2)].map((p, i) => ({
            ...p,
            name: `${p.name}${i}`,
          })),
          map: 'base56',
        }),
        4,
      ),
    ).toBe(1);
  });

  it('after Catanian 1 ends, Catanian 2 may bank-trade, build and play a card, but not roll or trade with players', () => {
    const s = run(paired(), { type: 'endTurn', player: 1 });
    expect(s.turn.current).toBe(0);
    expect(s.turn.secondSettlerOf).toBe(1);
    expect(s.turn.number).toBe(12);
    expect(s.phase).toEqual({ kind: 'main' });
    const t = types(legalActions(s, 0));
    expect(t).not.toContain('offerTrade');
    expect(t).not.toContain('rollDice');
    expect(t).toContain('endTurn');
    expectFail(
      applyAction(s, {
        type: 'offerTrade',
        player: 0,
        give: { brick: 1 },
        want: { ore: 1 },
        to: [1],
      }),
      /second settler/,
    );
    const next = run(s, { type: 'endTurn', player: 0 });
    expect(next.turn).toEqual({ number: 13, current: 2, devCardPlayed: false, tradeOffers: 0 });
    expect(next.phase).toEqual({ kind: 'preRoll' });
  });

  it('needs 4+ players and replaces the special building phase', () => {
    expect(() => createGame(base({ secondSettler: true, players: PLAYERS.slice(0, 3) }))).toThrow();
    expect(() => createGame(base({ secondSettler: true, specialBuildPhase: true }))).toThrow();
    const six = createGame({
      seed: 1,
      players: [...PLAYERS, { name: 'Green', color: '#0f0' }, { name: 'Purple', color: '#f0f' }],
      map: 'base56',
      secondSettler: true,
    });
    expect(six.settings.specialBuildPhase).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
describe('setup placement (§18.8)', () => {
  it('a round may place a city (city piece, starting resources 1 per hex in round 2)', () => {
    const s = createGame(
      base({
        setupPlacement: {
          first: { building: 'city', restriction: 'normal' },
          second: { building: 'settlement', restriction: 'normal' },
        },
      }),
    );
    const a = legalActions(s).find((x) => x.type === 'placeSetupSettlement')!;
    const after = run(s, a);
    expect(Object.values(after.pieces.buildings)).toEqual([{ owner: 0, kind: 'city' }]);
    expect(after.log.at(-1)?.text).toBe('Red placed a city');
  });

  it("'anyVertex' drops the distance rule in that round only", () => {
    const s = createGame(
      base({
        setupPlacement: {
          first: { building: 'settlement', restriction: 'anyVertex' },
          second: { building: 'settlement', restriction: 'normal' },
        },
      }),
    );
    const v = 'v:0,0,N' as const;
    const t = topologyOf(s);
    const nb = t.vertex[v]!.vertices[0]!;
    let st = run(s, { type: 'placeSetupSettlement', player: 0, vertex: v });
    st = run(st, legalActions(st)[0]!);
    // Blue (round 1, anyVertex) may settle right next to Red.
    expectOk(applyAction(st, { type: 'placeSetupSettlement', player: 1, vertex: nb }));
  });

  it('rejects unknown buildings or restrictions', () => {
    expect(() =>
      createGame(
        base({
          setupPlacement: {
            first: { building: 'castle' as 'city', restriction: 'normal' },
            second: { building: 'city', restriction: 'normal' },
          },
        }),
      ),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------------------------
describe('randomize turn order (§18.6)', () => {
  it('shuffles the seats from its own stream; board and deck stay the same per seed', () => {
    const plain = createGame({ seed: 7, players: PLAYERS, map: 'baseRandom' });
    const shuffled = createGame({
      seed: 7,
      players: PLAYERS,
      map: 'baseRandom',
      randomTurnOrder: true,
    });
    const order = randomSeatOrder(7, 4);
    expect(shuffled.settings.seatOrder).toEqual(order);
    expect([...order].sort()).toEqual([0, 1, 2, 3]);
    expect(shuffled.players.map((p) => p.name)).toEqual(order.map((i) => PLAYERS[i]!.name));
    expect(shuffled.players.map((p) => p.id)).toEqual([0, 1, 2, 3]);
    expect(shuffled.board).toEqual(plain.board);
    expect(shuffled.devDeck).toEqual(plain.devDeck);
    expect(shuffled.settings.startingPlayer).toBe(0);
    expect(shuffled.log.some((l) => l.text.startsWith('Turn order:'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
describe('map selection (§18.7)', () => {
  it("'random' picks a seeded map that fits the player count", () => {
    for (let seed = 0; seed < 20; seed++) {
      const s = createGame({ seed, players: PLAYERS, mapSelection: 'random' });
      expect(s.settings.map).toBe(randomMapFor(seed, 4));
      expect(mapById(s.settings.map).maxPlayers).toBeGreaterThanOrEqual(4);
      expect(s.settings.mapSelection).toBe('random');
    }
  });

  it("'veto': candidates, counter-clockwise vetoers, the last map left is played", () => {
    const s = createGame(base({ mapSelection: 'veto' }));
    expect(s.settings.map).toBe('baseRandom'); // no veto between copies of the beginner map
    if (s.phase.kind !== 'mapVeto') throw new Error('expected mapVeto');
    expect(s.phase.candidates).toHaveLength(MAP_VETO_CANDIDATES);
    expect(s.phase.order).toEqual(vetoOrder(4, 0, 3));
    expect(s.phase.order).toEqual([3, 2]);
    expect(s.turn.current).toBe(3);
    expect(types(legalActions(s))).toEqual(['vetoMap']);
    expectFail(applyAction(s, { type: 'vetoMap', player: 0, candidate: 0 }), /not your veto/);
    const one = run(s, { type: 'vetoMap', player: 3, candidate: 0 });
    expectFail(applyAction(one, { type: 'vetoMap', player: 2, candidate: 0 }), /already vetoed/);
    const done = run(one, { type: 'vetoMap', player: 2, candidate: 2 });
    expect(done.phase).toEqual({
      kind: 'setup',
      index: 0,
      step: 'settlement',
      lastSettlement: null,
    });
    expect(done.turn.current).toBe(0);
    expect(done.board).toBe(s.phase.candidates[1]!.board);
    expect(done.robber).toBe(s.phase.candidates[1]!.robber);
    // Clone: vetoed is copied, candidate boards are shared like state.board.
    const c = cloneState(one);
    expect(c).toEqual(one);
    if (c.phase.kind === 'mapVeto' && one.phase.kind === 'mapVeto') {
      expect(c.phase.vetoed).not.toBe(one.phase.vetoed);
    }
  });

  it('a full veto game reaches setup and plays on', () => {
    const s = playSetup(createGame(base({ mapSelection: 'veto' })));
    expect(s.phase.kind).toBe('preRoll');
  });
});
