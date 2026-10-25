import { describe, expect, it } from 'vitest';
import { applyAction } from '../engine';
import { discardGame, midGame, moveRobberGame } from '../fixtures';
import { emptyResources, totalResources } from '../resources';
import { handSize } from '../selectors';
import { hexVertices, TOPOLOGY } from '../topology';
import type { GameState, HexId, ResourceBundle } from '../types';
import { discardOptions, robberLegal, stealCandidates } from './robber';
import {
  emptyBoardGame,
  expectConserved,
  expectFail,
  expectOk,
  place,
  rollTotal,
  run,
  setHand,
} from './testkit';

const HEX: HexId = 'h:0,0';
const N = (h: HexId) => hexVertices(h)[0]!;
const S = (h: HexId) => hexVertices(h)[3]!;

/** Player 0 must move the robber (resume main); robber away from HEX. */
function robberGame(): GameState {
  const s = emptyBoardGame();
  s.phase = { kind: 'moveRobber', resume: 'main' };
  s.robber = TOPOLOGY.landHexes.find((h) => h !== HEX && !hexVertices(h).includes(N(HEX)))!;
  return s;
}

/** Player 0 about to steal from player 1, who holds `hand`. */
function stealGame(hand: ResourceBundle): GameState {
  const s = robberGame();
  place(s, 1, N(HEX));
  setHand(s, 1, hand);
  return run(s, { type: 'moveRobber', player: 0, hex: HEX });
}

describe('discard', () => {
  it('returns exactly the pending count to the bank', () => {
    const s = discardGame();
    const before = s.players[1]!.resources;
    const after = expectOk(
      applyAction(s, { type: 'discard', player: 1, resources: { grain: 3, ore: 2 } }),
    );
    expect(after.players[1]!.resources).toEqual({ ...before, grain: 0, ore: 1 });
    expect(after.bank.grain).toBe(s.bank.grain + 3);
    expect(after.phase).toEqual({ kind: 'discard', pending: [0, 0, 0, 4] });
    expectConserved(after);
    expect(after.log.at(-1)?.text).toBe('Blue discarded 3 grain, 2 ore');
  });

  it('any order; after the last discard -> moveRobber (resume main)', () => {
    const s = run(
      discardGame(),
      { type: 'discard', player: 3, resources: { lumber: 3, ore: 1 } },
      { type: 'discard', player: 1, resources: { wool: 2, grain: 3 } },
    );
    expect(s.phase).toEqual({ kind: 'moveRobber', resume: 'main' });
    expect(handSize(s.players[1]!)).toBe(5);
    expect(handSize(s.players[3]!)).toBe(4);
  });

  it('rejects the wrong count', () => {
    const s = discardGame();
    expectFail(
      applyAction(s, { type: 'discard', player: 1, resources: { grain: 3 } }),
      /exactly 5/,
    );
    expectFail(
      applyAction(s, { type: 'discard', player: 1, resources: { grain: 3, ore: 3 } }),
      /exactly 5/,
    );
  });

  it('rejects cards the player does not have', () => {
    expectFail(
      applyAction(discardGame(), { type: 'discard', player: 1, resources: { brick: 5 } }),
      /do not have/,
    );
  });

  it('rejects malformed bundles', () => {
    const bad = [{ ore: -1, grain: 6 }, { ore: 2.5, grain: 2.5 }, { gold: 5 }, null, [1, 2]];
    for (const resources of bad) {
      expectFail(
        applyAction(discardGame(), {
          type: 'discard',
          player: 1,
          resources: resources as ResourceBundle,
        }),
        /invalid resources/,
      );
    }
  });

  it('rejects players who owe nothing, and a second discard', () => {
    const s = discardGame();
    expectFail(applyAction(s, { type: 'discard', player: 0, resources: {} }), /do not need/);
    const once = run(s, { type: 'discard', player: 3, resources: { lumber: 3, ore: 1 } });
    expectFail(
      applyAction(once, { type: 'discard', player: 3, resources: { brick: 1, wool: 1, grain: 1 } }),
      /do not need/,
    );
  });

  it('only in the discard phase', () => {
    expectFail(
      applyAction(midGame(), { type: 'discard', player: 1, resources: { ore: 1 } }),
      /nobody needs/,
    );
  });
});

describe('discardOptions', () => {
  it('enumerates every distinct multiset of the right size', () => {
    const hand = { ...emptyResources(), brick: 2, ore: 1 };
    expect(discardOptions(hand, 2)).toEqual([{ brick: 1, ore: 1 }, { brick: 2 }]);
    expect(discardOptions(hand, 3)).toEqual([{ brick: 2, ore: 1 }]);
    expect(discardOptions(hand, 4)).toEqual([]);
  });

  it('every option has the right total and fits the hand', () => {
    const hand = { brick: 3, lumber: 2, wool: 4, grain: 1, ore: 5 };
    const opts = discardOptions(hand, 7);
    expect(opts.length).toBeGreaterThan(10);
    expect(new Set(opts.map((o) => JSON.stringify(o))).size).toBe(opts.length);
    for (const o of opts) {
      expect(totalResources(o)).toBe(7);
      for (const [r, n] of Object.entries(o)) expect(n).toBeLessThanOrEqual(hand[r as 'ore']);
    }
  });

  it('legal discards are all accepted and cover every pending player', () => {
    const s = discardGame();
    const actions = robberLegal(s);
    expect(new Set(actions.map((a) => a.player))).toEqual(new Set([1, 3]));
    for (const a of actions) expect(applyAction(s, a).ok, JSON.stringify(a)).toBe(true);
  });
});

describe('moveRobber', () => {
  it('moves the robber; no candidates -> resume phase', () => {
    const after = expectOk(applyAction(robberGame(), { type: 'moveRobber', player: 0, hex: HEX }));
    expect(after.robber).toBe(HEX);
    expect(after.phase).toEqual({ kind: 'main' });
  });

  it('knight played pre-roll resumes to preRoll', () => {
    const s = moveRobberGame();
    const lonely = TOPOLOGY.landHexes.find(
      (h) => h !== s.robber && stealCandidates(s, 1, h).length === 0,
    )!;
    const after = expectOk(applyAction(s, { type: 'moveRobber', player: 1, hex: lonely }));
    expect(after.phase).toEqual({ kind: 'preRoll' });
  });

  it('with candidates -> steal, keeping resume', () => {
    const s = moveRobberGame();
    const target = TOPOLOGY.landHexes.find(
      (h) => h !== s.robber && stealCandidates(s, 1, h).length > 0,
    )!;
    const after = expectOk(applyAction(s, { type: 'moveRobber', player: 1, hex: target }));
    expect(after.phase).toEqual({
      kind: 'steal',
      candidates: stealCandidates(s, 1, target),
      resume: 'preRoll',
    });
  });

  it('candidates: opponents with a building there and >= 1 card, sorted', () => {
    const s = robberGame();
    place(s, 3, N(HEX));
    place(s, 1, S(HEX), 'city');
    place(s, 0, hexVertices(HEX)[1]!); // own building: never a candidate
    setHand(s, 3, { ore: 1 });
    setHand(s, 1, { wool: 2 });
    setHand(s, 0, { wool: 2 });
    expect(stealCandidates(s, 0, HEX)).toEqual([1, 3]);
    setHand(s, 3, {});
    expect(stealCandidates(s, 0, HEX)).toEqual([1]);
    const after = expectOk(applyAction(s, { type: 'moveRobber', player: 0, hex: HEX }));
    expect(after.phase).toEqual({ kind: 'steal', candidates: [1], resume: 'main' });
  });

  it('may move to the desert', () => {
    const s = robberGame();
    const desert = TOPOLOGY.landHexes.find((h) => s.board.hexes[h]!.terrain === 'desert')!;
    if (s.robber === desert) s.robber = HEX;
    expectOk(applyAction(s, { type: 'moveRobber', player: 0, hex: desert }));
  });

  it('must move to a different land hex', () => {
    const s = robberGame();
    expectFail(applyAction(s, { type: 'moveRobber', player: 0, hex: s.robber }), /different/);
    for (const hex of ['h:0,-3', 'h:9,9', 'x'] as HexId[]) {
      expectFail(applyAction(s, { type: 'moveRobber', player: 0, hex }), /invalid hex/);
    }
  });

  it('only the current player, only in moveRobber', () => {
    expectFail(applyAction(robberGame(), { type: 'moveRobber', player: 2, hex: HEX }), /not your/);
    expectFail(applyAction(midGame(), { type: 'moveRobber', player: 1, hex: HEX }), /cannot move/);
    expectFail(applyAction(discardGame(), { type: 'moveRobber', player: 1, hex: HEX }), /cannot/);
  });

  it('legal: every land hex except the current one', () => {
    const s = robberGame();
    const hexes = robberLegal(s).map((a) => (a.type === 'moveRobber' ? a.hex : null));
    expect(hexes).toHaveLength(18);
    expect(hexes).not.toContain(s.robber);
  });
});

describe('steal', () => {
  it('takes one card the victim holds and resumes', () => {
    const s = stealGame({ ore: 3 });
    expect(s.phase).toEqual({ kind: 'steal', candidates: [1], resume: 'main' });
    const after = expectOk(applyAction(s, { type: 'steal', player: 0, victim: 1 }));
    expect(after.players[1]!.resources.ore).toBe(2);
    expect(after.players[0]!.resources).toEqual({ ...emptyResources(), ore: 1 });
    expect(after.phase).toEqual({ kind: 'main' });
    expectConserved(after);
    expect(after.log.at(-1)?.text).toBe('Red stole from Blue'); // card stays hidden
  });

  it('is seeded: same state -> same card; different RNG states vary', () => {
    const s = stealGame({ brick: 1, ore: 1 });
    const a = expectOk(applyAction(s, { type: 'steal', player: 0, victim: 1 }));
    const b = expectOk(applyAction(s, { type: 'steal', player: 0, victim: 1 }));
    expect(a.players[0]!.resources).toEqual(b.players[0]!.resources);
    expect(a.rng).not.toBe(s.rng);
    const seen = new Set<string>();
    for (let seed = 0; seed < 40; seed++) {
      const r = expectOk(applyAction({ ...s, rng: seed }, { type: 'steal', player: 0, victim: 1 }));
      seen.add(r.players[0]!.resources.brick === 1 ? 'brick' : 'ore');
    }
    expect(seen).toEqual(new Set(['brick', 'ore']));
  });

  it('resumes to preRoll after a pre-roll knight', () => {
    const s = moveRobberGame();
    const target = TOPOLOGY.landHexes.find(
      (h) => h !== s.robber && stealCandidates(s, 1, h).length > 0,
    )!;
    const [victim] = stealCandidates(s, 1, target);
    const after = run(
      s,
      { type: 'moveRobber', player: 1, hex: target },
      { type: 'steal', player: 1, victim: victim! },
    );
    expect(after.phase).toEqual({ kind: 'preRoll' });
    expect(handSize(after.players[1]!)).toBe(handSize(s.players[1]!) + 1);
  });

  it('rejects victims outside the candidates, wrong player, wrong phase', () => {
    const s = stealGame({ ore: 1 });
    expectFail(applyAction(s, { type: 'steal', player: 0, victim: 2 }), /cannot steal from/);
    expectFail(applyAction(s, { type: 'steal', player: 0, victim: 0 }), /cannot steal from/);
    expectFail(applyAction(s, { type: 'steal', player: 1, victim: 1 }), /not your turn/);
    expectFail(applyAction(midGame(), { type: 'steal', player: 1, victim: 0 }), /cannot steal/);
  });

  it('legal: one steal per candidate', () => {
    expect(robberLegal(stealGame({ ore: 1 }))).toEqual([{ type: 'steal', player: 0, victim: 1 }]);
  });
});

describe('full 7 sequence', () => {
  it('roll 7 -> discard -> moveRobber -> steal -> main', () => {
    const s = emptyBoardGame();
    setHand(s, 0, { ore: 9 });
    setHand(s, 2, { wool: 2 });
    place(s, 2, N(HEX));
    if (s.robber === HEX) s.robber = 'h:0,-2';
    let g = rollTotal(s, 7);
    expect(g.phase).toEqual({ kind: 'discard', pending: [4, 0, 0, 0] });
    g = run(g, { type: 'discard', player: 0, resources: { ore: 4 } });
    expect(g.phase).toEqual({ kind: 'moveRobber', resume: 'main' });
    g = run(g, { type: 'moveRobber', player: 0, hex: HEX });
    expect(g.phase).toEqual({ kind: 'steal', candidates: [2], resume: 'main' });
    g = run(g, { type: 'steal', player: 0, victim: 2 });
    expect(g.phase).toEqual({ kind: 'main' });
    expect(g.players[0]!.resources).toEqual({ ...emptyResources(), ore: 5, wool: 1 });
    expectConserved(g);
  });
});
