import { describe, expect, it } from 'vitest';
import { discardGame, freshGame, gameOverGame, midGame, tradeOfferGame } from './fixtures';
import {
  actingPlayers,
  piecesLeft,
  portsOf,
  publicVictoryPoints,
  setupPlayerAt,
  victoryPoints,
} from './selectors';

describe('selectors', () => {
  it('setup order snakes', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((i) => setupPlayerAt(i, 4))).toEqual([
      0, 1, 2, 3, 3, 2, 1, 0,
    ]);
    expect([0, 1, 2, 3, 4, 5].map((i) => setupPlayerAt(i, 3))).toEqual([0, 1, 2, 2, 1, 0]);
  });

  it('counts pieces left', () => {
    expect(piecesLeft(freshGame(), 0)).toEqual({ road: 15, settlement: 5, city: 4 });
    expect(piecesLeft(midGame(), 1)).toEqual({ road: 11, settlement: 3, city: 3 });
  });

  it('counts victory points', () => {
    const s = midGame();
    expect(publicVictoryPoints(s, 0)).toBe(1 + 2 + 2); // settlement, city, longest road
    expect(publicVictoryPoints(s, 1)).toBe(2 + 2);
    expect(victoryPoints(s, 1)).toBe(5); // + hidden VP card
    expect(publicVictoryPoints(s, 2)).toBe(2 + 1 + 2); // city, settlement, largest army
    expect(victoryPoints(gameOverGame(), 0)).toBe(10);
  });

  it('lists acting players per phase', () => {
    expect(actingPlayers(midGame())).toEqual([1]);
    expect(actingPlayers(discardGame())).toEqual([1, 3]);
    expect(actingPlayers(tradeOfferGame())).toEqual([1, 2]);
    expect(actingPlayers(gameOverGame())).toEqual([]);
  });

  it('finds ports', () => {
    const s = freshGame();
    const port = s.board.ports[0]!;
    s.pieces.buildings[port.vertices[1]] = { owner: 2, kind: 'settlement' };
    expect(portsOf(s, 2)).toEqual([port.kind]);
    expect(portsOf(s, 0)).toEqual([]);
  });
});
