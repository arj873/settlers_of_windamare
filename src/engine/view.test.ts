import { describe, expect, it } from 'vitest';
import { createGame } from './createGame';
import { freshGame, gameOverGame, midGame } from './fixtures';
import { totalResources } from './resources';
import { specialBuildQueue } from './actions/turn';
import type { GameState } from './types';
import {
  devCardCount,
  handCount,
  HIDDEN_DEV_CARD,
  HIDDEN_SEED,
  isGameView,
  viewFor,
  visibleSpecialBuildQueue,
} from './view';

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object') {
    for (const v of Object.values(o)) deepFreeze(v);
    Object.freeze(o);
  }
  return o;
}

describe('viewFor', () => {
  it('keeps the viewer hand and masks the others, with public counts', () => {
    const s = midGame();
    const v = viewFor(s, 1);
    expect(v.view.viewer).toBe(1);
    expect(v.players[1]).toEqual(s.players[1]);
    for (const p of [0, 2, 3]) {
      expect(totalResources(v.players[p]!.resources)).toBe(0);
      expect(v.players[p]!.devCards).toEqual(v.players[p]!.newDevCards);
      expect(Object.values(v.players[p]!.devCards).every((n) => n === 0)).toBe(true);
      expect(v.view.handCounts[p]).toBe(totalResources(s.players[p]!.resources));
      // Played cards are public.
      expect(v.players[p]!.knightsPlayed).toBe(s.players[p]!.knightsPlayed);
      expect(v.players[p]!.progressCardsPlayed).toEqual(s.players[p]!.progressCardsPlayed);
    }
    expect(v.view.masked).toEqual([true, false, true, true]);
  });

  it('masks decks, rng and seed but keeps the deck sizes', () => {
    const s = createGame({ seed: 'secret-42', players: freshGame().players, balancedDice: true });
    const withDice: GameState = { ...s, diceDeck: [3, 17, 35] };
    const v = viewFor(withDice, 'spectator');
    expect(v.devDeck).toHaveLength(s.devDeck.length);
    expect(v.devDeck.every((c) => c === HIDDEN_DEV_CARD)).toBe(true);
    expect(v.diceDeck).toEqual([0, 0, 0]);
    expect(v.rng).toBe(0);
    expect(v.settings.seed).toBe(HIDDEN_SEED);
    expect(JSON.stringify(v)).not.toContain('secret-42');
    expect(v.log[0]!.text).toMatch(/^Game created \(.* map\)$/);
  });

  it('a spectator sees no hand at all', () => {
    const v = viewFor(midGame(), 'spectator');
    expect(v.view.viewer).toBeNull();
    expect(v.view.masked.every(Boolean)).toBe(true);
    expect(v.players.every((p) => totalResources(p.resources) === 0)).toBe(true);
  });

  it('reveals hands and dev cards once the game is over', () => {
    const s = gameOverGame();
    const v = viewFor(s, 'spectator');
    expect(v.players).toEqual(s.players);
    expect(v.view.masked.some(Boolean)).toBe(false);
    expect(v.rng).toBe(0);
  });

  it('does not mutate the state and is JSON-safe', () => {
    const s = deepFreeze(midGame());
    const v = viewFor(s, 0);
    expect(JSON.parse(JSON.stringify(v))).toEqual(v);
  });

  it('rejects a seat that does not exist', () => {
    expect(() => viewFor(midGame(), 9)).toThrow();
  });
});

describe('public-info helpers', () => {
  it('read counts from a view and from a full state alike', () => {
    const s = midGame();
    const v = viewFor(s, 0);
    expect(isGameView(v)).toBe(true);
    expect(isGameView(s)).toBe(false);
    for (const p of s.players) {
      expect(handCount(v, p.id)).toBe(handCount(s, p.id));
      expect(devCardCount(v, p.id)).toBe(devCardCount(s, p.id));
    }
    expect(s.players.some((p) => devCardCount(s, p.id) > 0)).toBe(true);
  });

  it('special build queue: exact on a full state, unfiltered on a view', () => {
    const s: GameState = {
      ...midGame(),
      settings: { ...midGame().settings, specialBuildPhase: true },
      phase: { kind: 'specialBuild', builder: 2, owner: 1 },
      turn: { ...midGame().turn, current: 2 },
    };
    expect(visibleSpecialBuildQueue(s)).toEqual(specialBuildQueue(s));
    expect(visibleSpecialBuildQueue(viewFor(s, 2))).toEqual([3, 0]);
  });
});
