/**
 * Rule checks from the T8 audit (docs/RULES.md) that are not already covered by the per-area
 * tests. Each `it` names the RULES.md rule it pins down.
 */
import { describe, expect, it } from 'vitest';
import {
  emptyBoardGame,
  expectFail,
  expectOk,
  place,
  rollTotal,
  run,
  setHand,
} from './actions/testkit';
import { bankTradeRatio } from './actions/trade';
import { applyAction } from './engine';
import { discardGame, midGame } from './fixtures';
import { hexVertices, TOPOLOGY } from './topology';
import type { Action } from './types';

const DESERT = 'h:0,0'; // beginner board

describe('RULES.md audit', () => {
  it('5.3: development cards do not count toward the 7-card discard limit', () => {
    const s = emptyBoardGame();
    setHand(s, 0, { ore: 7 });
    for (let i = 0; i < 3; i++) s.devDeck.splice(s.devDeck.indexOf('knight'), 1);
    s.players[0]!.devCards.knight = 3;
    expect(rollTotal(s, 7).phase).toEqual({ kind: 'moveRobber', resume: 'main' });
  });

  it('5.5: a Knight never causes discards, even with more than 7 cards', () => {
    const s = midGame(); // Blue (current) holds 9 cards and a playable knight
    const after = run(s, { type: 'playKnight', player: 1 });
    expect(after.phase).toEqual({ kind: 'moveRobber', resume: 'main' });
  });

  it('5.9: moving the robber to the desert still steals from an adjacent opponent', () => {
    const s = emptyBoardGame();
    s.phase = { kind: 'moveRobber', resume: 'main' };
    s.robber = 'h:1,-1';
    place(s, 2, hexVertices(DESERT)[0]!);
    setHand(s, 2, { wool: 1 });
    const after = expectOk(applyAction(s, { type: 'moveRobber', player: 0, hex: DESERT }));
    expect(after.phase).toEqual({ kind: 'steal', candidates: [2], resume: 'main' });
  });

  it('5.16 / 8.10: no trading and no dev cards while a 7 is being resolved', () => {
    const s = discardGame(); // Blue has a playable knight and resources
    const blocked: Action[] = [
      { type: 'playKnight', player: 1 },
      { type: 'bankTrade', player: 1, give: 'grain', receive: 'brick' },
      { type: 'offerTrade', player: 1, give: { ore: 1 }, want: { brick: 1 }, to: [0] },
      { type: 'buildRoad', player: 1, edge: TOPOLOGY.edges[0]! },
    ];
    for (const a of blocked) expectFail(applyAction(s, a));
  });

  it('5.20: the robber may move twice in a turn (rolled 7, then a Knight)', () => {
    let s = emptyBoardGame();
    s.players[0]!.devCards.knight = 1;
    s.devDeck.splice(s.devDeck.indexOf('knight'), 1);
    s = rollTotal(s, 7);
    s = run(s, { type: 'moveRobber', player: 0, hex: 'h:1,-1' });
    expect(s.phase).toEqual({ kind: 'main' });
    s = run(s, { type: 'playKnight', player: 0 }, { type: 'moveRobber', player: 0, hex: DESERT });
    expect(s.robber).toBe(DESERT);
  });

  it('5.19: the robber does not block harbors', () => {
    const s = midGame(); // Blue has the ore and wool harbors
    const portHex = TOPOLOGY.portSlots
      .map((slot, i) => ({ slot, kind: s.board.ports[i]!.kind }))
      .find(({ kind }) => kind === 'ore')!;
    const land = TOPOLOGY.edge[portHex.slot.edge]!.hexes[0]!;
    const before = bankTradeRatio(s, 1, 'ore');
    s.robber = land;
    expect(bankTradeRatio(s, 1, 'ore')).toBe(before);
    expect(before).toBe(2);
  });

  it('6.13 / 8.9: other players cannot bank-trade or play cards on the active player’s turn', () => {
    const s = midGame();
    s.players[0]!.devCards.knight = 1;
    s.devDeck.splice(s.devDeck.indexOf('knight'), 1);
    setHand(s, 0, { ore: 4 });
    expectFail(applyAction(s, { type: 'bankTrade', player: 0, give: 'ore', receive: 'brick' }));
    expectFail(applyAction(s, { type: 'playKnight', player: 0 }));
  });
});
