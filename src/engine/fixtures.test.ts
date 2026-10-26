import { describe, expect, it } from 'vitest';
import { BANK_PER_RESOURCE, RESOURCES } from './constants';
import {
  discardGame,
  freshGame,
  gameOverGame,
  midGame,
  moveRobberGame,
  setupInProgressGame,
  tradeOfferGame,
} from './fixtures';
import { isVertexOpen, canPlaceRoad } from './rules/placement';
import { handSize, piecesLeft } from './selectors';
import { totalDevCards } from './resources';
import { isBoardEdge, isBoardVertex, isLandHex, topologyOf } from './topology';
import type { EdgeId, GameState, VertexId } from './types';

const ALL = {
  freshGame,
  setupInProgressGame,
  midGame,
  discardGame,
  moveRobberGame,
  tradeOfferGame,
  gameOverGame,
};

function checkConsistent(s: GameState) {
  // Pieces on the board, within limits.
  const t = topologyOf(s);
  for (const v of Object.keys(s.pieces.buildings)) expect(isBoardVertex(t, v)).toBe(true);
  for (const e of Object.keys(s.pieces.roads)) expect(isBoardEdge(t, e)).toBe(true);
  expect(isLandHex(t, s.robber)).toBe(true);
  for (const p of s.players) {
    const left = piecesLeft(s, p.id);
    expect(left.road).toBeGreaterThanOrEqual(0);
    expect(left.settlement).toBeGreaterThanOrEqual(0);
    expect(left.city).toBeGreaterThanOrEqual(0);
  }

  // Distance rule: remove each building and check its vertex would be open.
  for (const v of Object.keys(s.pieces.buildings) as VertexId[]) {
    const copy = structuredClone(s);
    delete copy.pieces.buildings[v];
    expect(isVertexOpen(copy, v), v).toBe(true);
  }

  // Every road connects to its owner's network: remove it and check it is re-placeable.
  for (const e of Object.keys(s.pieces.roads) as EdgeId[]) {
    const owner = s.pieces.roads[e]!;
    const copy = structuredClone(s);
    delete copy.pieces.roads[e];
    expect(canPlaceRoad(copy, owner, e), e).toBe(true);
  }

  // Conservation: bank + hands = 19 each; deck + all dev cards held/played = 25.
  for (const r of RESOURCES) {
    const held = s.players.reduce((sum, p) => sum + p.resources[r], 0);
    expect(s.bank[r] + held).toBe(BANK_PER_RESOURCE);
  }
  const devHeld = s.players.reduce(
    (sum, p) =>
      sum +
      totalDevCards(p.devCards) +
      totalDevCards(p.newDevCards) +
      p.knightsPlayed +
      Object.values(p.progressCardsPlayed).reduce((a, b) => a + b, 0),
    0,
  );
  expect(s.devDeck.length + devHeld).toBe(25);

  expect(JSON.parse(JSON.stringify(s))).toEqual(s);
}

describe('fixtures', () => {
  for (const [name, make] of Object.entries(ALL)) {
    it(`${name} is consistent`, () => checkConsistent(make()));
  }

  it('returns fresh objects', () => {
    expect(midGame()).not.toBe(midGame());
    expect(midGame()).toEqual(midGame());
  });

  it('discardGame pending counts are half of hands over 7', () => {
    const s = discardGame();
    if (s.phase.kind !== 'discard') throw new Error('wrong phase');
    s.players.forEach((p, i) => {
      const n = handSize(p);
      expect(s.phase.kind === 'discard' && s.phase.pending[i]).toBe(n > 7 ? Math.floor(n / 2) : 0);
    });
  });
});
