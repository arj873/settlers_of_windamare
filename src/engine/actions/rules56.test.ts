/**
 * The optional 5+ player rule set (settings.rules56, RULES.md §20):
 *  - 20.1 the special build step may also play ONE development card (no trading still)
 *  - 20.2 the robber starts on, and may never leave for, anything but the first desert
 * (The 12 VP preset is a setup-screen default, tested in ui/setup/setup.test.ts.)
 */
import { describe, expect, it } from 'vitest';
import { applyAction, legalActions } from '../engine';
import { createGame, type GameConfig } from '../createGame';
import { hexVertices, topologyOf } from '../topology';
import type { Action, DevCardType, GameState, HexId, PlayerId, VertexId } from '../types';
import { firstDesert, robberTargets } from '../variants';
import { expectFail, expectOk, place, run, setHand } from './testkit';

const players = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ name: `P${i}`, color: `c${i}` }));

function game(extra: Partial<GameConfig> = {}, n = 5): GameState {
  return createGame({
    seed: 11,
    players: players(n),
    map: 'base56',
    startingPlayer: 0,
    rules56: true,
    ...extra,
  });
}

/** Player 0 in `main` of turn 1 (setup skipped), cards given directly. */
function mainGame(extra: Partial<GameConfig> = {}, n = 5): GameState {
  const s = game(extra, n);
  s.turn = { number: 1, current: 0, devCardPlayed: false, tradeOffers: 0 };
  s.phase = { kind: 'main' };
  s.dice = [3, 4];
  return s;
}

const endTurn = (s: GameState): GameState =>
  expectOk(applyAction(s, { type: 'endTurn', player: s.turn.current }));
const pass = (s: GameState): GameState =>
  expectOk(applyAction(s, { type: 'passSpecialBuild', player: s.turn.current }));

function giveCard(s: GameState, p: PlayerId, card: DevCardType, n = 1) {
  const pl = s.players[p];
  if (!pl) throw new Error('no player');
  pl.devCards[card] += n;
}

const DEV = { ore: 1, wool: 1, grain: 1 };

const isPlay = (a: Action) => a.type.startsWith('play');

/** An opponent settlement on a hex the robber can go to, with a card to steal. */
function victimHex(s: GameState, victim: PlayerId): HexId {
  const hex = robberTargets(s, 0).find((h) => s.board.hexes[h]?.terrain !== 'desert') as HexId;
  place(s, victim, hexVertices(topologyOf(s), hex)[0] as VertexId);
  setHand(s, victim, { grain: 1 });
  return hex;
}

describe('rules56: settings', () => {
  it('stores the flag; default games do not have it', () => {
    expect(game().settings.rules56).toBe(true);
    expect(createGame({ seed: 1, players: players(5), map: 'base56' }).settings.rules56).toBe(
      undefined,
    );
  });

  it('needs 5+ players, no second settler, and the special building phase', () => {
    expect(() => game({}, 4)).toThrow(/5\+ players/);
    expect(() => game({ secondSettler: true })).toThrow(/second settler/);
    expect(() => game({ specialBuildPhase: false })).toThrow(/special building phase/);
    expect(game({ specialBuildPhase: true }).settings.specialBuildPhase).toBe(true);
  });

  it('works on all 5+ maps and with the rest of the variants (5, 6, 7, 8 players)', () => {
    for (const [n, map] of [
      [5, 'base56'],
      [6, 'base56'],
      [7, 'base78'],
      [8, 'base78'],
    ] as const) {
      const s = createGame({ seed: 4, players: players(n), map, rules56: true });
      expect(s.settings.specialBuildPhase).toBe(true);
      expect(s.robber).toBe(firstDesert(s));
    }
  });
});

describe('rules56 20.1: one development card in the special build step', () => {
  it('without the rule set the builder cannot play a card (official step)', () => {
    const s = mainGame({ rules56: false });
    giveCard(s, 1, 'knight');
    setHand(s, 1, DEV);
    const t = endTurn(s);
    expect(t.phase.kind).toBe('specialBuild');
    expectFail(applyAction(t, { type: 'playKnight', player: 1 }), /before rolling or in the main/);
    expect(legalActions(t).some(isPlay)).toBe(false);
  });

  it('a Knight: robber, steal, then back to the same step; no second card; pass goes on', () => {
    const s = mainGame();
    giveCard(s, 1, 'knight', 2);
    const hex = victimHex(s, 3);
    setHand(s, 2, DEV); // so player 2 is not skipped after player 1
    let t = endTurn(s);
    expect(t.phase).toEqual({ kind: 'specialBuild', builder: 1, owner: 0 });
    expect(legalActions(t).filter((a) => a.type === 'playKnight')).toHaveLength(1);

    t = run(t, { type: 'playKnight', player: 1 });
    expect(t.phase).toEqual({ kind: 'moveRobber', resume: 'specialBuild' });
    expect(t.players[1]?.knightsPlayed).toBe(1);
    t = run(t, { type: 'moveRobber', player: 1, hex });
    expect(t.phase).toMatchObject({ kind: 'steal', resume: 'specialBuild' });
    t = run(t, { type: 'steal', player: 1, victim: 3 });
    expect(t.phase).toEqual({ kind: 'specialBuild', builder: 1, owner: 0 });
    expect(t.turn.current).toBe(1);
    expect(t.players[1]?.resources.grain).toBe(1);

    // One card per step, even though a second knight is in hand.
    expectFail(applyAction(t, { type: 'playKnight', player: 1 }), /already played/);
    expect(legalActions(t).some(isPlay)).toBe(false);
    // Still buildable / passable.
    expect(legalActions(t).some((a) => a.type === 'passSpecialBuild')).toBe(true);

    // The next builder starts fresh and the second knight waits for player 1's own turn.
    t = pass(t);
    expect(t.turn.current).toBe(2);
    expect(t.turn.devCardPlayed).toBe(false);
    expect(t.players[1]?.devCards.knight).toBe(1);
  });

  it('a Knight with nobody to steal from resumes straight to the step', () => {
    const s = mainGame();
    giveCard(s, 1, 'knight');
    let t = endTurn(s);
    t = run(t, { type: 'playKnight', player: 1 });
    const hex = robberTargets(t, 1)[0] as HexId;
    t = run(t, { type: 'moveRobber', player: 1, hex });
    expect(t.phase).toEqual({ kind: 'specialBuild', builder: 1, owner: 0 });
  });

  it('Road Building places free roads and returns to the step', () => {
    const s = mainGame();
    const topo = topologyOf(s);
    // An outpost for player 1 so a road is placeable.
    const v = topo.vertices.find((x) => !s.pieces.buildings[x]) as VertexId;
    place(s, 1, v);
    giveCard(s, 1, 'roadBuilding');
    let t = endTurn(s);
    t = run(t, { type: 'playRoadBuilding', player: 1 });
    expect(t.phase).toMatchObject({ kind: 'roadBuilding', remaining: 2, resume: 'specialBuild' });
    for (let i = 0; i < 2; i++) {
      const edge = legalActions(t).find((a) => a.type === 'placeFreeRoad') as Action & {
        edge: string;
      };
      t = run(t, edge);
    }
    expect(t.phase).toEqual({ kind: 'specialBuild', builder: 1, owner: 0 });
    expect(Object.values(t.pieces.roads).filter((o) => o === 1)).toHaveLength(2);
  });

  it('Year of Plenty and Monopoly work in the step', () => {
    const s = mainGame();
    giveCard(s, 1, 'yearOfPlenty');
    giveCard(s, 2, 'monopoly');
    setHand(s, 3, { ore: 2 });
    let t = endTurn(s);
    t = run(t, { type: 'playYearOfPlenty', player: 1, resources: ['ore', 'brick'] });
    expect(t.players[1]?.resources).toMatchObject({ ore: 1, brick: 1 });
    expect(t.phase).toEqual({ kind: 'specialBuild', builder: 1, owner: 0 });
    t = pass(t);
    t = run(t, { type: 'playMonopoly', player: 2, resource: 'ore' });
    expect(t.players[2]?.resources.ore).toBe(3); // 2 from player 3 + 1 from player 1
    expect(t.phase).toEqual({ kind: 'specialBuild', builder: 2, owner: 0 });
  });

  it('only the builder, only from devCards, only the owner of the card', () => {
    const s = mainGame();
    giveCard(s, 2, 'knight');
    setHand(s, 1, DEV);
    const t = endTurn(s); // builder 1 has no knight
    expectFail(applyAction(t, { type: 'playKnight', player: 1 }), /no playable knight/);
    expectFail(applyAction(t, { type: 'playKnight', player: 2 }), /not your turn/);
    expectFail(applyAction(t, { type: 'playKnight', player: 0 }), /not your turn/);
  });

  it("a card bought in the step cannot be played in it, but on the buyer's own turn", () => {
    const s = mainGame();
    setHand(s, 1, { ore: 1, wool: 1, grain: 1 });
    let t = endTurn(s);
    t = run(t, { type: 'buyDevCard', player: 1 });
    const p1 = t.players[1];
    const bought = Object.entries(p1?.newDevCards ?? {}).find(([, n]) => n > 0)?.[0];
    expect(bought).toBeDefined();
    expect(Object.values(p1?.devCards ?? {}).reduce((a, b) => a + b, 0)).toBe(0);
    expect(legalActions(t).some(isPlay)).toBe(false);
    // After the pass it is a normal card: playable once player 1's own turn comes.
    t = pass(t);
    expect(t.players[1]?.newDevCards[bought as DevCardType]).toBe(0);
    expect(t.players[1]?.devCards[bought as DevCardType]).toBe(1);
  });

  it('buying dev cards stays allowed (the extension rulebook allows build and buy)', () => {
    const s = mainGame();
    setHand(s, 1, { ore: 1, wool: 1, grain: 1 });
    const t = endTurn(s);
    expect(legalActions(t).some((a) => a.type === 'buyDevCard')).toBe(true);
  });

  it('still no trading, no rolling, no ending the turn in the step', () => {
    const s = mainGame();
    giveCard(s, 1, 'knight');
    setHand(s, 1, { ore: 4, wool: 1 });
    const t = endTurn(s);
    expectFail(applyAction(t, { type: 'bankTrade', player: 1, give: 'ore', receive: 'wool' }));
    expectFail(
      applyAction(t, {
        type: 'offerTrade',
        player: 1,
        give: { ore: 1 },
        want: { wool: 1 },
        to: [2],
      }),
    );
    expectFail(applyAction(t, { type: 'rollDice', player: 1 }));
    expectFail(applyAction(t, { type: 'endTurn', player: 1 }));
  });

  it('a player whose only option is a dev card is not skipped; with nothing at all they are', () => {
    const s = mainGame();
    giveCard(s, 2, 'monopoly');
    const t = endTurn(s);
    // Player 1 can do nothing (skipped); player 2 can play the Monopoly.
    expect(t.phase).toEqual({ kind: 'specialBuild', builder: 2, owner: 0 });
    const idle = endTurn(mainGame());
    expect(idle.phase).toEqual({ kind: 'preRoll' });
  });

  it('nobody wins in the step, not even by a Knight taking Largest Army', () => {
    const s = mainGame({ vpToWin: 3 });
    giveCard(s, 1, 'knight');
    const p1 = s.players[1];
    if (!p1) throw new Error('no p1');
    p1.knightsPlayed = 2; // the next knight is the 3rd: Largest Army = 2 VP
    place(s, 1, topologyOf(s).vertices[0] as VertexId); // + 1 VP = 3
    let t = endTurn(s);
    t = run(t, { type: 'playKnight', player: 1 });
    t = run(t, { type: 'moveRobber', player: 1, hex: robberTargets(t, 1)[0] as HexId });
    expect(t.awards.largestArmy).toBe(1);
    expect(t.phase).toEqual({ kind: 'specialBuild', builder: 1, owner: 0 });
    expect(t.winner).toBeNull();
    // The win comes when player 1's own turn starts.
    while (t.phase.kind === 'specialBuild') t = pass(t);
    expect(t.winner).toBe(1);
  });
});

describe('rules56 20.2: the second desert is dead for the robber', () => {
  const desertsOf = (s: GameState) =>
    topologyOf(s).landHexes.filter((h) => s.board.hexes[h]?.terrain === 'desert');

  it('the robber starts on the first desert, for every seed', () => {
    for (let seed = 0; seed < 40; seed++) {
      const s = createGame({ seed, players: players(5), rules56: true });
      const [first] = desertsOf(s);
      expect(desertsOf(s)).toHaveLength(2);
      expect(s.robber).toBe(first);
    }
  });

  it('without the rule set the start desert is random (both occur)', () => {
    const starts = new Set<number>();
    for (let seed = 0; seed < 40; seed++) {
      const s = createGame({ seed, players: players(5), map: 'base56' });
      starts.add(desertsOf(s).indexOf(s.robber));
    }
    expect(starts).toEqual(new Set([0, 1]));
  });

  it('the second desert is never a robber target; every other hex is', () => {
    const s = game();
    const [first, second] = desertsOf(s) as [HexId, HexId];
    const targets = robberTargets(s, 0);
    expect(targets).not.toContain(second);
    expect(targets).not.toContain(first); // the robber is on it
    expect(targets).toHaveLength(topologyOf(s).landHexes.length - 2);

    // Moved away, the robber may come back to the first desert, still not the second.
    const away: GameState = { ...s, robber: targets[0] as HexId };
    const back = robberTargets(away, 0);
    expect(back).toContain(first);
    expect(back).not.toContain(second);
  });

  it('applyAction rejects moving there; the default rules allow it', () => {
    const on = mainGame();
    const [, second] = desertsOf(on) as [HexId, HexId];
    const moving = (s: GameState) =>
      ({ ...s, phase: { kind: 'moveRobber', resume: 'main' } }) as GameState;
    expectFail(applyAction(moving(on), { type: 'moveRobber', player: 0, hex: second }));
    const off = mainGame({ rules56: false });
    const [first2, second2] = desertsOf(off) as [HexId, HexId];
    off.robber = first2;
    expectOk(applyAction(moving(off), { type: 'moveRobber', player: 0, hex: second2 }));
  });

  it('legalActions offers no move to the second desert', () => {
    const s = game();
    const [, second] = desertsOf(s) as [HexId, HexId];
    s.turn = { number: 1, current: 0, devCardPlayed: false, tradeOffers: 0 };
    s.phase = { kind: 'moveRobber', resume: 'main' };
    const moves = legalActions(s).filter((a) => a.type === 'moveRobber');
    expect(moves.length).toBeGreaterThan(0);
    expect(moves.some((a) => a.type === 'moveRobber' && a.hex === second)).toBe(false);
  });

  it('the friendly robber keeps the second desert closed too', () => {
    const s = game({ robberMode: 'friendly' });
    const [, second] = desertsOf(s) as [HexId, HexId];
    expect(robberTargets(s, 0)).not.toContain(second);
    expect(robberTargets(s, 0).length).toBeGreaterThan(20);
  });
});
