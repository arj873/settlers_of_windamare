import { describe, expect, it } from 'vitest';
import { cornerVertex } from '../hex';
import { applyAction } from '../engine';
import { freshGame, midGame } from '../fixtures';
import { victoryPoints } from '../selectors';
import { expectOk, rollTotal, run, setHand } from '../actions/testkit';
import type { GameState } from '../types';
import { checkVictory } from './victory';

const BLUE_SETTLEMENT = cornerVertex(2, -1, 'N');
const RICH = { brick: 3, lumber: 3, wool: 3, grain: 3, ore: 3 };

/** midGame: Blue (current) has 5 VP (2 settlements, 1 city, 1 hidden VP card). */
function game(vpToWin: number): GameState {
  const s = midGame();
  s.settings.vpToWin = vpToWin;
  setHand(s, 1, RICH);
  return s;
}

describe('checkVictory', () => {
  it('the current player wins when reaching vpToWin on their turn', () => {
    const s = game(6);
    expect(victoryPoints(s, 1)).toBe(5);
    const after = run(s, { type: 'buildCity', player: 1, vertex: BLUE_SETTLEMENT });
    expect(after.winner).toBe(1);
    expect(after.phase).toEqual({ kind: 'gameOver' });
    expect(after.log.at(-1)).toEqual({
      turn: 12,
      player: 1,
      text: 'Blue wins with 6 victory points!',
    });
    expect(applyAction(after, { type: 'endTurn', player: 1 }).ok).toBe(false);
  });

  it('below vpToWin nothing happens', () => {
    const after = run(game(7), { type: 'buildCity', player: 1, vertex: BLUE_SETTLEMENT });
    expect(after.winner).toBeNull();
    expect(after.phase).toEqual({ kind: 'main' });
  });

  it('hidden VP cards count, including ones bought this turn', () => {
    const s = game(7);
    s.players[1]!.newDevCards.victoryPoint = 1;
    s.devDeck.splice(s.devDeck.indexOf('victoryPoint'), 1);
    const after = run(s, { type: 'buildCity', player: 1, vertex: BLUE_SETTLEMENT });
    expect(after.winner).toBe(1);
  });

  it("another player's VP do not end the game on someone else's turn", () => {
    const s = game(6);
    s.players[0]!.devCards.victoryPoint = 1; // Red: 5 + 1 = 6
    s.devDeck.splice(s.devDeck.indexOf('victoryPoint'), 1);
    expect(victoryPoints(s, 0)).toBe(6);
    // Blue, White and Orange act: Red is not current, nobody wins.
    let g = run(s, { type: 'endTurn', player: 1 });
    g = run(rollTotal(g, 8), { type: 'endTurn', player: 2 });
    g = rollTotal(g, 8);
    expect(g.winner).toBeNull();
    // As soon as Red's turn starts, Red wins.
    g = expectOk(applyAction(g, { type: 'endTurn', player: 3 }));
    expect(g.winner).toBe(0);
    expect(g.phase).toEqual({ kind: 'gameOver' });
  });

  it('only checks the current player (direct)', () => {
    const s = midGame(); // Red 5 VP, Blue (current) 5 VP
    s.players[0]!.devCards.victoryPoint = 1; // Red 6
    s.settings.vpToWin = 6;
    checkVictory(s);
    expect(s.winner).toBeNull();
    s.turn.current = 0;
    checkVictory(s);
    expect(s.winner).toBe(0);
  });

  it('is not checked during setup', () => {
    const s = freshGame();
    s.settings.vpToWin = 1;
    const after = run(s, {
      type: 'placeSetupSettlement',
      player: 0,
      vertex: cornerVertex(0, 0, 'N'),
    });
    expect(after.winner).toBeNull();
    expect(after.phase.kind).toBe('setup');
  });

  it('does nothing once the game is over', () => {
    const s = game(5);
    s.phase = { kind: 'gameOver' };
    s.winner = 0;
    checkVictory(s);
    expect(s.winner).toBe(0);
  });
});
