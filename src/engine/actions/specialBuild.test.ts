/**
 * Special Building Phase (T13, RULES.md §16.10): after a turn ends, the other players in
 * clockwise order may build and buy dev cards (no trading, no dev card play, no rolling), then
 * pass. Nobody wins during it.
 */
import { describe, expect, it } from 'vitest';
import { COSTS, DEV_CARD_TYPES } from '../constants';
import { applyAction, legalActions } from '../engine';
import { createGame } from '../createGame';
import { supplyOf } from '../mapLookup';
import { emptyDevCards } from '../resources';
import { piecesLeft, victoryPoints } from '../selectors';
import { edgeVertices, TOPOLOGY, vertexEdges } from '../topology';
import type { Action, ActionType, EdgeId, GameState, PlayerId, VertexId } from '../types';
import {
  emptyBoardGame,
  expectConserved,
  expectFail,
  expectOk,
  place,
  road,
  run,
  setHand,
} from './testkit';

const DEV = { ore: 1, wool: 1, grain: 1 };
const EVERYTHING = { brick: 2, lumber: 2, wool: 2, grain: 4, ore: 4 };
const SBP_TYPES: ActionType[] = [
  'buildRoad',
  'buildSettlement',
  'buildCity',
  'buyDevCard',
  'passSpecialBuild',
];

/** Base board, 4 players, SBP on, player `current` in main. */
function sbpGame(current: PlayerId = 0, sbp = true): GameState {
  const s = emptyBoardGame();
  s.settings = { ...s.settings, specialBuildPhase: sbp };
  s.turn.current = current;
  s.phase = { kind: 'main' };
  s.dice = [3, 4];
  return s;
}

const endTurn = (s: GameState): GameState =>
  expectOk(applyAction(s, { type: 'endTurn', player: s.turn.current }));
const pass = (s: GameState): GameState =>
  expectOk(applyAction(s, { type: 'passSpecialBuild', player: s.turn.current }));

/** Settlement at v0 plus roads v0-v1-v2, so v2 is a legal settlement site. Returns [v0, v2]. */
function outpost(s: GameState, p: PlayerId, v0: VertexId): [VertexId, VertexId] {
  const e1 = vertexEdges(TOPOLOGY, v0)[0] as EdgeId;
  const v1 = edgeVertices(TOPOLOGY, e1).find((v) => v !== v0)!;
  const e2 = vertexEdges(TOPOLOGY, v1).find((e) => e !== e1)!;
  const v2 = edgeVertices(TOPOLOGY, e2).find((v) => v !== v1)!;
  place(s, p, v0);
  road(s, p, e1, e2);
  return [v0, v2];
}

const SITES: VertexId[] = ['v:0,-2,N', 'v:2,-2,S', 'v:-2,2,N', 'v:0,2,S'];

/** sbpGame where every player owns an outpost (so builds are possible). */
function builtUpGame(current: PlayerId = 0): GameState {
  const s = sbpGame(current);
  SITES.forEach((v, p) => outpost(s, p, v));
  return s;
}

describe('special building phase: order', () => {
  it('runs clockwise from the next player, skipping the owner, then the next turn starts', () => {
    const s = sbpGame(1);
    for (let p = 0; p < 4; p++) setHand(s, p, DEV);
    let t = endTurn(s);
    const seen: PlayerId[] = [];
    while (t.phase.kind === 'specialBuild') {
      expect(t.phase.owner).toBe(1);
      expect(t.phase.builder).toBe(t.turn.current);
      expect(t.turn.number).toBe(s.turn.number); // still the turn that just ended
      seen.push(t.phase.builder);
      t = pass(t);
    }
    expect(seen).toEqual([2, 3, 0]);
    expect(t.phase).toEqual({ kind: 'preRoll' });
    expect(t.turn).toEqual({
      number: s.turn.number + 1,
      current: 2,
      devCardPlayed: false,
      tradeOffers: 0,
    });
  });

  it('works for 6 players on the 5-6 board (default on with 5+ players)', () => {
    const players = Array.from({ length: 6 }, (_, i) => ({ name: `P${i}`, color: '#000' }));
    const s = createGame({ seed: 1, players, map: 'base56' });
    expect(s.settings.specialBuildPhase).toBe(true);
    s.turn = { number: 5, current: 4, devCardPlayed: false, tradeOffers: 0 };
    s.phase = { kind: 'main' };
    for (let p = 0; p < 6; p++) setHand(s, p, DEV);
    let t = endTurn(s);
    const seen: PlayerId[] = [];
    while (t.phase.kind === 'specialBuild') {
      seen.push(t.phase.builder);
      t = pass(t);
    }
    expect(seen).toEqual([5, 0, 1, 2, 3]);
    expect(t.turn.current).toBe(5);
    expect(t.turn.number).toBe(6);
  });

  it('skips players who can neither build nor buy; nobody able -> straight to the next turn', () => {
    const s = sbpGame(0);
    setHand(s, 2, DEV); // only player 2 can do anything
    const t = endTurn(s);
    expect(t.phase).toEqual({ kind: 'specialBuild', builder: 2, owner: 0 });
    expect(pass(t).phase).toEqual({ kind: 'preRoll' });
    expect(pass(t).turn.current).toBe(1);

    const none = endTurn(sbpGame(0));
    expect(none.phase).toEqual({ kind: 'preRoll' });
    expect(none.turn.current).toBe(1);
  });

  it('happens even if the owner built nothing, and the owner gets no step (FAQ)', () => {
    const s = sbpGame(3);
    setHand(s, 3, EVERYTHING);
    setHand(s, 0, DEV);
    const t = endTurn(s);
    expect(t.phase).toEqual({ kind: 'specialBuild', builder: 0, owner: 3 });
    const after = pass(t);
    expect(after.phase).toEqual({ kind: 'preRoll' });
    expect(after.turn.current).toBe(0);
  });

  it('SBP off: endTurn goes straight to the next preRoll even with rich hands', () => {
    const s = sbpGame(0, false);
    for (let p = 0; p < 4; p++) setHand(s, p, EVERYTHING);
    const t = endTurn(s);
    expect(t.phase).toEqual({ kind: 'preRoll' });
    expect(t.turn.current).toBe(1);
    expect(legalActions(t).some((a) => a.type === 'passSpecialBuild')).toBe(false);
  });
});

describe('special building phase: permissions', () => {
  /** Player 0 ended; builder 1 holds everything, playable dev cards included. */
  function step(): GameState {
    const s = builtUpGame(0);
    for (let p = 0; p < 4; p++) setHand(s, p, EVERYTHING);
    s.players[1]!.devCards = {
      ...emptyDevCards(),
      knight: 1,
      monopoly: 1,
      yearOfPlenty: 1,
      roadBuilding: 1,
    };
    for (const t of DEV_CARD_TYPES) {
      const n = s.players[1]!.devCards[t];
      for (let i = 0; i < n; i++) s.devDeck.splice(s.devDeck.lastIndexOf(t), 1);
    }
    const t = endTurn(s);
    expect(t.phase).toEqual({ kind: 'specialBuild', builder: 1, owner: 0 });
    return t;
  }

  it('the builder may build roads, settlements, cities and buy dev cards', () => {
    const s = step();
    const [v0, v2] = [SITES[1]!, outpostSite(1)];
    const legal = legalActions(s);
    expect(new Set(legal.map((a) => a.type))).toEqual(new Set(SBP_TYPES));
    const roadA = legal.find((a) => a.type === 'buildRoad')!;
    const after = run(
      s,
      roadA,
      { type: 'buildSettlement', player: 1, vertex: v2 },
      { type: 'buildCity', player: 1, vertex: v0 },
      { type: 'buyDevCard', player: 1 },
    );
    expect(after.phase).toEqual(s.phase);
    expect(piecesLeft(after, 1)).toEqual({ road: 12, settlement: 4, city: 3 });
    expectConserved(after);
  });

  it('forbids rolling, ending the turn, trading and playing dev cards', () => {
    const s = step();
    const forbidden: Action[] = [
      { type: 'rollDice', player: 1 },
      { type: 'endTurn', player: 1 },
      { type: 'bankTrade', player: 1, give: 'ore', receive: 'brick' },
      { type: 'offerTrade', player: 1, give: { ore: 1 }, want: { brick: 1 }, to: [2] },
      { type: 'playKnight', player: 1 },
      { type: 'playRoadBuilding', player: 1 },
      { type: 'playMonopoly', player: 1, resource: 'ore' },
      { type: 'playYearOfPlenty', player: 1, resources: ['ore', 'ore'] },
      { type: 'placeFreeRoad', player: 1, edge: legalActions(s).find(isRoad)!.edge },
    ];
    for (const a of forbidden) expect(applyAction(s, a).ok, a.type).toBe(false);
  });

  it('nobody but the builder may act, the owner included', () => {
    const s = step();
    const road0 = legalActions(s, 1).find(isRoad)!;
    for (const p of [0, 2, 3]) {
      expectFail(applyAction(s, { type: 'passSpecialBuild', player: p }), /not your/);
      expectFail(applyAction(s, { type: 'buyDevCard', player: p }), /not your turn/);
    }
    expectFail(applyAction(s, { ...road0, player: 0 }), /not your turn/);
    expect(legalActions(s).every((a) => a.player === 1)).toBe(true);
    expect(legalActions(s, 0)).toEqual([]);
  });

  it('passSpecialBuild is rejected outside the phase', () => {
    expectFail(
      applyAction(sbpGame(0), { type: 'passSpecialBuild', player: 0 }),
      /not in the special building phase/,
    );
  });

  it('every legal action is accepted and keeps resources, pieces and dev cards conserved', () => {
    const s = step();
    for (const a of legalActions(s)) {
      const after = expectOk(applyAction(s, a));
      expectConserved(after);
      expectDevConserved(after);
    }
  });

  it('a dev card bought in the phase is playable on the buyer’s next turn', () => {
    const s = sbpGame(3);
    setHand(s, 0, DEV);
    const knight = s.devDeck.lastIndexOf('knight');
    s.devDeck.push(s.devDeck.splice(knight, 1)[0]!); // knight on top
    let t = endTurn(s);
    expect(t.phase).toMatchObject({ kind: 'specialBuild', builder: 0 });
    t = run(t, { type: 'buyDevCard', player: 0 });
    expect(t.players[0]!.devCards.knight).toBe(1);
    expect(t.players[0]!.newDevCards).toEqual(emptyDevCards());
    t = pass(t); // player 0's own turn starts
    expect(t.phase).toEqual({ kind: 'preRoll' });
    expectOk(applyAction(t, { type: 'playKnight', player: 0 }));
  });
});

describe('special building phase: victory', () => {
  /** Player 0 ended; `builder` is one point short and can build a settlement. */
  function nearWin(builder: PlayerId): { s: GameState; site: VertexId } {
    const s = builtUpGame(0);
    s.settings = { ...s.settings, vpToWin: 3 };
    s.devDeck.splice(s.devDeck.lastIndexOf('victoryPoint'), 1);
    s.players[builder]!.devCards.victoryPoint = 1; // outpost + VP card = 2 VP
    setHand(s, builder, COSTS.settlement);
    return { s: endTurnUntil(s, builder), site: outpostSite(builder) };
  }

  /** endTurn from player 0, then pass until `builder` has the step. */
  function endTurnUntil(s: GameState, builder: PlayerId): GameState {
    let t = endTurn(s);
    while (t.phase.kind === 'specialBuild' && t.phase.builder !== builder) t = pass(t);
    expect(t.phase).toMatchObject({ kind: 'specialBuild', builder });
    return t;
  }

  it('reaching vpToWin during your step does not win; you win as your own turn starts', () => {
    const { s, site } = nearWin(1);
    const built = run(s, { type: 'buildSettlement', player: 1, vertex: site });
    expect(victoryPoints(built, 1)).toBe(3);
    expect(built.phase.kind).toBe('specialBuild');
    expect(built.winner).toBeNull();
    const next = pass(built); // nobody else can build -> player 1's turn
    expect(next.turn.current).toBe(1);
    expect(next.winner).toBe(1);
    expect(next.phase).toEqual({ kind: 'gameOver' });
  });

  it('a builder at vpToWin who is not next waits for their own turn', () => {
    const { s, site } = nearWin(2);
    const built = run(s, { type: 'buildSettlement', player: 2, vertex: site });
    const next = pass(built);
    expect(next.turn.current).toBe(1);
    expect(next.phase).toEqual({ kind: 'preRoll' });
    expect(next.winner).toBeNull();
    let t = run(next, { type: 'rollDice', player: 1 });
    while (t.phase.kind !== 'main') {
      const a = legalActions(t)[0]!;
      t = run(t, a);
    }
    t = endTurn(t);
    while (t.phase.kind === 'specialBuild') t = pass(t);
    expect(t.winner).toBe(2);
  });
});

// --- helpers ---------------------------------------------------------------------------------

const isRoad = (a: Action): a is Extract<Action, { type: 'buildRoad' }> => a.type === 'buildRoad';

/** The open settlement site at the end of `p`'s outpost roads. */
function outpostSite(p: PlayerId): VertexId {
  return outpost(sbpGame(0), p, SITES[p]!)[1];
}

/** Deck + hands = the map's dev deck (nothing is played in these tests). */
function expectDevConserved(s: GameState) {
  for (const t of DEV_CARD_TYPES) {
    const held = s.players.reduce((n, p) => n + p.devCards[t] + p.newDevCards[t], 0);
    expect(s.devDeck.filter((c) => c === t).length + held, t).toBe(supplyOf(s).devDeck[t]);
  }
}
