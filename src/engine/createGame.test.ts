import { describe, expect, it } from 'vitest';
import { BANK_PER_RESOURCE, DEV_DECK_COMPOSITION } from './constants';
import { createGame } from './createGame';
import { FIXTURE_PLAYERS } from './fixtures';

const config = { seed: 1, players: FIXTURE_PLAYERS, layout: 'random' as const };

describe('createGame', () => {
  it('builds a valid initial state', () => {
    const s = createGame(config);
    expect(s.players).toHaveLength(4);
    expect(s.players.map((p) => p.id)).toEqual([0, 1, 2, 3]);
    expect(Object.values(s.bank)).toEqual([19, 19, 19, 19, 19].map(() => BANK_PER_RESOURCE));
    expect(s.devDeck).toHaveLength(25);
    for (const [type, n] of Object.entries(DEV_DECK_COMPOSITION)) {
      expect(s.devDeck.filter((c) => c === type)).toHaveLength(n);
    }
    expect(s.phase).toEqual({ kind: 'setup', index: 0, step: 'settlement', lastSettlement: null });
    expect(s.turn).toEqual({ number: 0, current: 0, devCardPlayed: false, tradeOffers: 0 });
    for (const p of s.players) {
      expect(p.progressCardsPlayed).toEqual({ roadBuilding: 0, yearOfPlenty: 0, monopoly: 0 });
    }
    expect(s.board.hexes[s.robber]?.terrain).toBe('desert');
    expect(s.pieces).toEqual({ buildings: {}, roads: {} });
    expect(s.winner).toBeNull();
    expect(s.settings.vpToWin).toBe(10);
  });

  it('is deterministic per seed', () => {
    expect(createGame(config)).toEqual(createGame(config));
    expect(createGame(config).devDeck).not.toEqual(createGame({ ...config, seed: 2 }).devDeck);
  });

  it('is JSON-safe', () => {
    const s = createGame(config);
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });

  it('supports 3 players and rejects 2 or 5', () => {
    expect(createGame({ ...config, players: FIXTURE_PLAYERS.slice(0, 3) }).players).toHaveLength(3);
    expect(() => createGame({ ...config, players: FIXTURE_PLAYERS.slice(0, 2) })).toThrow();
    expect(() =>
      createGame({ ...config, players: [...FIXTURE_PLAYERS, { name: 'X', color: 'green' }] }),
    ).toThrow();
  });

  it('honors vpToWin and the beginner layout', () => {
    const s = createGame({ ...config, layout: 'beginner', vpToWin: 12 });
    expect(s.settings.vpToWin).toBe(12);
    expect(s.board.hexes['h:0,0']?.terrain).toBe('desert');
  });
});
