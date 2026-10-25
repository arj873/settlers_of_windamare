import { describe, expect, it } from 'vitest';
import { applyAction, legalActions } from '../engine';
import { midGame } from '../fixtures';
import { cornerVertex, sideEdge } from '../hex';
import { totalResources } from '../resources';
import { addRoads, settle, zigzag } from '../rules/roadTestBoard';
import type { Action, DevCardType, GameState, Phase } from '../types';

/** midGame: Blue (1) to act in main, devCards knight 1 + VP 1, newDevCards monopoly 1. */
function blue(phase: Phase = { kind: 'main' }): GameState {
  const s = midGame();
  s.phase = phase;
  return s;
}

function withCard(s: GameState, card: DevCardType, n = 1): GameState {
  s.players[1]!.devCards[card] += n;
  return s;
}

function apply(s: GameState, action: Action): GameState {
  const r = applyAction(s, action);
  if (!r.ok) throw new Error(r.error);
  return r.state;
}

function err(s: GameState, action: Action): string {
  const r = applyAction(s, action);
  return r.ok ? 'ok' : r.error;
}

function devActions(s: GameState): Action[] {
  const types = new Set([
    'buyDevCard',
    'playKnight',
    'playRoadBuilding',
    'placeFreeRoad',
    'playYearOfPlenty',
    'playMonopoly',
  ]);
  return legalActions(s).filter((a) => types.has(a.type));
}

function expectSound(s: GameState): void {
  for (const a of legalActions(s)) expect(applyAction(s, a).ok, JSON.stringify(a)).toBe(true);
}

describe('buyDevCard', () => {
  it('pays wool+grain+ore to the bank and draws the top card into newDevCards', () => {
    const s = blue();
    const top = s.devDeck.at(-1)!;
    const out = apply(s, { type: 'buyDevCard', player: 1 });
    const p = out.players[1]!;
    expect(p.resources).toEqual({ brick: 0, lumber: 1, wool: 1, grain: 2, ore: 2 });
    expect(out.bank.wool).toBe(s.bank.wool + 1);
    expect(out.bank.ore).toBe(s.bank.ore + 1);
    expect(out.devDeck).toHaveLength(s.devDeck.length - 1);
    expect(p.newDevCards[top]).toBe(s.players[1]!.newDevCards[top] + 1);
    expect(p.devCards).toEqual(s.players[1]!.devCards);
    expect(out.log.at(-1)?.text).toBe('Blue bought a development card');
  });

  it('requires the main phase, the current player, resources and a non-empty deck', () => {
    expect(err(blue({ kind: 'preRoll' }), { type: 'buyDevCard', player: 1 })).toMatch(/main/);
    expect(err(blue(), { type: 'buyDevCard', player: 0 })).toBe('not your turn');
    const poor = blue();
    poor.players[1]!.resources.ore = 0;
    expect(err(poor, { type: 'buyDevCard', player: 1 })).toBe('not enough resources');
    const empty = blue();
    empty.devDeck = [];
    expect(err(empty, { type: 'buyDevCard', player: 1 })).toBe('no development cards left');
    expect(devActions(empty).some((a) => a.type === 'buyDevCard')).toBe(false);
  });

  it('a card bought this turn cannot be played this turn', () => {
    const s = blue();
    s.devDeck.push('yearOfPlenty');
    const out = apply(s, { type: 'buyDevCard', player: 1 });
    expect(out.players[1]!.newDevCards.yearOfPlenty).toBe(1);
    expect(err(out, { type: 'playYearOfPlenty', player: 1, resources: ['ore', 'ore'] })).toMatch(
      /no playable/,
    );
  });
});

describe('playing development cards', () => {
  it('only from devCards, never newDevCards (Blue holds a fresh Monopoly)', () => {
    expect(err(blue(), { type: 'playMonopoly', player: 1, resource: 'ore' })).toMatch(
      /no playable/,
    );
  });

  it('at most one per turn', () => {
    const s = withCard(blue(), 'knight');
    const out = apply(s, { type: 'playKnight', player: 1 });
    out.phase = { kind: 'main' }; // pretend the robber was moved
    expect(err(out, { type: 'playKnight', player: 1 })).toMatch(/already played/);
    expect(devActions(out).filter((a) => a.type !== 'buyDevCard')).toEqual([]);
  });

  it('only by the current player, only in preRoll or main', () => {
    const s = midGame();
    s.players[3]!.devCards.knight = 1;
    expect(err(s, { type: 'playKnight', player: 3 })).toBe('not your turn');
    for (const phase of [
      { kind: 'discard', pending: [0, 0, 0, 0] },
      { kind: 'moveRobber', resume: 'main' },
      { kind: 'roadBuilding', remaining: 1, resume: 'main' },
    ] as Phase[]) {
      expect(err(blue(phase), { type: 'playKnight', player: 1 })).toMatch(/can only play/);
    }
  });

  it('VP cards have no play action and still count', () => {
    const acts = devActions(blue()).map((a) => a.type);
    expect(acts).not.toContain('playMonopoly');
    expect(acts).toContain('playKnight');
  });
});

describe('Knight', () => {
  it('in main: knightsPlayed++, card spent, moveRobber resumes to main', () => {
    const out = apply(blue(), { type: 'playKnight', player: 1 });
    expect(out.players[1]!.knightsPlayed).toBe(1);
    expect(out.players[1]!.devCards.knight).toBe(0);
    expect(out.turn.devCardPlayed).toBe(true);
    expect(out.phase).toEqual({ kind: 'moveRobber', resume: 'main' });
    expect(out.log.at(-1)?.text).toBe('Blue played a Knight');
  });

  it('before rolling: moveRobber resumes to preRoll', () => {
    const out = apply(blue({ kind: 'preRoll' }), { type: 'playKnight', player: 1 });
    expect(out.phase).toEqual({ kind: 'moveRobber', resume: 'preRoll' });
  });

  it('takes Largest Army from White by exceeding 3 knights', () => {
    const s = blue();
    s.players[1]!.knightsPlayed = 2;
    const tie = apply(s, { type: 'playKnight', player: 1 });
    expect(tie.awards.largestArmy).toBe(2);

    const s2 = blue();
    s2.players[1]!.knightsPlayed = 3;
    const win = apply(s2, { type: 'playKnight', player: 1 });
    expect(win.awards.largestArmy).toBe(1);
  });
});

describe('Road Building', () => {
  it('enters roadBuilding with 2 roads and places them for free', () => {
    const s = withCard(blue({ kind: 'preRoll' }), 'roadBuilding');
    const res = { ...s.players[1]!.resources };
    let out = apply(s, { type: 'playRoadBuilding', player: 1 });
    expect(out.phase).toEqual({ kind: 'roadBuilding', remaining: 2, resume: 'preRoll' });
    expectSound(out);

    const e1 = sideEdge(2, -1, 'W');
    out = apply(out, { type: 'placeFreeRoad', player: 1, edge: e1 });
    expect(out.phase).toEqual({ kind: 'roadBuilding', remaining: 1, resume: 'preRoll' });
    const e2 = sideEdge(1, -1, 'NE');
    out = apply(out, { type: 'placeFreeRoad', player: 1, edge: e2 });
    expect(out.phase).toEqual({ kind: 'preRoll' });
    expect(out.pieces.roads[e1]).toBe(1);
    expect(out.pieces.roads[e2]).toBe(1);
    expect(out.players[1]!.resources).toEqual(res);
  });

  it('rejects disconnected, occupied or invalid edges and other players', () => {
    const s = apply(withCard(blue(), 'roadBuilding'), { type: 'playRoadBuilding', player: 1 });
    expect(err(s, { type: 'placeFreeRoad', player: 1, edge: sideEdge(-2, 2, 'W') })).toMatch(
      /cannot place/,
    );
    expect(err(s, { type: 'placeFreeRoad', player: 1, edge: sideEdge(2, -1, 'NW') })).toMatch(
      /cannot place/,
    );
    expect(err(s, { type: 'placeFreeRoad', player: 1, edge: 'e:9,9,NE' })).toMatch(/cannot place/);
    expect(err(s, { type: 'placeFreeRoad', player: 0, edge: sideEdge(2, -1, 'W') })).toBe(
      'not your turn',
    );
    expect(err(blue(), { type: 'placeFreeRoad', player: 1, edge: sideEdge(2, -1, 'W') })).toMatch(
      /not placing/,
    );
  });

  it('only one road when only one piece is left', () => {
    const s = withCard(blue(), 'roadBuilding');
    // Give Blue 14 roads in total (has 4): 10 more along row 1.
    addRoads(s, 1, zigzag(-2, 1, 8));
    addRoads(s, 1, [sideEdge(-2, 2, 'NW'), sideEdge(-2, 2, 'NE')]);
    let out = apply(s, { type: 'playRoadBuilding', player: 1 });
    expect(out.phase).toEqual({ kind: 'roadBuilding', remaining: 1, resume: 'main' });
    out = apply(out, { type: 'placeFreeRoad', player: 1, edge: sideEdge(2, -1, 'W') });
    expect(out.phase).toEqual({ kind: 'main' });
  });

  it('cannot be played with no road pieces left', () => {
    const s = withCard(blue(), 'roadBuilding');
    addRoads(s, 1, zigzag(-2, 1, 8));
    addRoads(s, 1, [sideEdge(-2, 2, 'NW'), sideEdge(-2, 2, 'NE'), sideEdge(-2, 2, 'E')]);
    expect(err(s, { type: 'playRoadBuilding', player: 1 })).toBe('no road can be placed');
    expect(devActions(s).some((a) => a.type === 'playRoadBuilding')).toBe(false);
  });

  /**
   * Blue owns only a settlement on the coastal N corner of h:0,-2 (2 edges). Red blocks the
   * NW side and both onward edges from the NE side, so exactly one free road fits.
   */
  function hemmedIn(): GameState {
    const s = withCard(blue(), 'roadBuilding');
    for (const [e, owner] of Object.entries(s.pieces.roads)) {
      if (owner === 1) delete s.pieces.roads[e as keyof typeof s.pieces.roads];
    }
    for (const [v, b] of Object.entries(s.pieces.buildings)) {
      if (b.owner === 1) delete s.pieces.buildings[v as keyof typeof s.pieces.buildings];
    }
    settle(s, 1, cornerVertex(0, -2, 'N'));
    addRoads(s, 0, [sideEdge(0, -2, 'NW'), sideEdge(0, -2, 'E'), sideEdge(1, -2, 'NW')]);
    return s;
  }

  it('ends early when no legal spot remains (never gets stuck)', () => {
    const s = hemmedIn();
    let out = apply(s, { type: 'playRoadBuilding', player: 1 });
    expect(devActions(out)).toEqual([
      { type: 'placeFreeRoad', player: 1, edge: sideEdge(0, -2, 'NE') },
    ]);
    out = apply(out, { type: 'placeFreeRoad', player: 1, edge: sideEdge(0, -2, 'NE') });
    expect(out.phase).toEqual({ kind: 'main' });
  });

  it('cannot be played when no spot exists at all', () => {
    const s = hemmedIn();
    addRoads(s, 0, [sideEdge(0, -2, 'NE')]);
    expect(err(s, { type: 'playRoadBuilding', player: 1 })).toBe('no road can be placed');
  });

  it('free roads update Longest Road', () => {
    const s = withCard(blue(), 'roadBuilding');
    // Blue: 4-road chain along row 1 ending next to open edges; Red holds LR with 5.
    addRoads(s, 1, zigzag(-2, 1, 4));
    settle(s, 1, cornerVertex(-2, 1, 'NW'));
    let out = apply(s, { type: 'playRoadBuilding', player: 1 });
    out = apply(out, { type: 'placeFreeRoad', player: 1, edge: sideEdge(0, 1, 'NW') });
    expect(out.awards.longestRoad).toBe(0); // 5 ties Red's 5: holder keeps
    out = apply(out, { type: 'placeFreeRoad', player: 1, edge: sideEdge(0, 1, 'NE') });
    expect(out.awards.longestRoad).toBe(1);
  });
});

describe('Year of Plenty', () => {
  it('takes two different or two identical resources from the bank', () => {
    const s = withCard(blue(), 'yearOfPlenty');
    const out = apply(s, { type: 'playYearOfPlenty', player: 1, resources: ['brick', 'wool'] });
    expect(out.players[1]!.resources.brick).toBe(s.players[1]!.resources.brick + 1);
    expect(out.players[1]!.resources.wool).toBe(s.players[1]!.resources.wool + 1);
    expect(out.bank.brick).toBe(s.bank.brick - 1);
    expect(out.bank.wool).toBe(s.bank.wool - 1);

    const twice = apply(s, { type: 'playYearOfPlenty', player: 1, resources: ['ore', 'ore'] });
    expect(twice.players[1]!.resources.ore).toBe(s.players[1]!.resources.ore + 2);
    expect(twice.bank.ore).toBe(s.bank.ore - 2);
  });

  it('the bank must have them', () => {
    const s = withCard(blue(), 'yearOfPlenty');
    s.bank.ore = 1;
    expect(err(s, { type: 'playYearOfPlenty', player: 1, resources: ['ore', 'ore'] })).toMatch(
      /bank/,
    );
    expect(
      apply(s, { type: 'playYearOfPlenty', player: 1, resources: ['ore', 'wool'] }),
    ).toBeTruthy();
    s.bank.grain = 0;
    const offered = devActions(s).filter((a) => a.type === 'playYearOfPlenty');
    expect(offered).toHaveLength(15 - 5 - 1); // no grain pairs (5), no ore+ore
  });

  it('rejects malformed payloads', () => {
    const s = withCard(blue(), 'yearOfPlenty');
    for (const resources of [['ore'], ['ore', 'gold'], 'ore', ['ore', 'ore', 'ore']]) {
      const a = { type: 'playYearOfPlenty', player: 1, resources } as unknown as Action;
      expect(err(s, a)).toBe('pick exactly two resources');
    }
  });
});

describe('Monopoly', () => {
  it('takes every card of that resource from all other players', () => {
    const s = withCard(blue(), 'monopoly');
    const totalBefore = s.players.reduce((n, p) => n + totalResources(p.resources), 0);
    const out = apply(s, { type: 'playMonopoly', player: 1, resource: 'lumber' });
    // Red 1, White 0, Orange 3 lumber; Blue had 1.
    expect(out.players.map((p) => p.resources.lumber)).toEqual([0, 5, 0, 0]);
    expect(out.players.reduce((n, p) => n + totalResources(p.resources), 0)).toBe(totalBefore);
    expect(out.bank).toEqual(s.bank);
    expect(out.log.at(-1)?.text).toBe('Blue took 4 lumber');
  });

  it('rejects an invalid resource', () => {
    const s = withCard(blue(), 'monopoly');
    const a = { type: 'playMonopoly', player: 1, resource: 'gold' } as unknown as Action;
    expect(err(s, a)).toBe('invalid resource');
  });
});

describe('devLegal', () => {
  it('is sound across phases and hands', () => {
    const states = [blue(), blue({ kind: 'preRoll' })];
    const rich = blue();
    for (const c of ['knight', 'roadBuilding', 'yearOfPlenty', 'monopoly'] as const) {
      withCard(rich, c);
    }
    states.push(rich);
    states.push(apply(rich, { type: 'playRoadBuilding', player: 1 }));
    for (const s of states) expectSound(s);
  });

  it('lists every playable card for the current player', () => {
    const s = blue();
    for (const c of ['roadBuilding', 'yearOfPlenty', 'monopoly'] as const) withCard(s, c);
    const types = new Set(devActions(s).map((a) => a.type));
    expect(types).toEqual(
      new Set(['buyDevCard', 'playKnight', 'playRoadBuilding', 'playYearOfPlenty', 'playMonopoly']),
    );
    expect(devActions(s).every((a) => a.player === 1)).toBe(true);
  });
});
