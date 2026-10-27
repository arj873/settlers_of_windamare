/** Controller decisions for multi-actor expansion phases (the module's `actors`). */
import { describe, expect, it } from 'vitest';
import { applyAction, createGame, hexVertices, legalActions, topologyOf } from '../engine';
import type { Action, GameState, HexId, VertexId } from '../engine';
import { rngForRoll } from '../engine/actions/testkit';
import { fieldsHexes } from '../expansions/crop/engine';
import { autoSteal, nextBot, obligated, pickViewer, type Seats } from './logic';

/** Crop Trust: P0 rolls a 6; P1 has a settlement on the 6 fields hex and P0 does not: P1 harvests. */
function harvestByOther(): { s: GameState; legal: Action[] } {
  const s = createGame({
    seed: 4,
    players: ['A', 'B', 'C', 'D'].map((name, i) => ({ name, color: `#20202${i}` })),
    mode: 'crop',
    startingPlayer: 0,
  });
  const f = fieldsHexes(s).find((h) => s.board.hexes[h]?.token === 6) as HexId;
  s.pieces.buildings[hexVertices(topologyOf(s), f)[0] as VertexId] = {
    owner: 1,
    kind: 'settlement',
  };
  s.turn = { number: 3, current: 0, devCardPlayed: false, tradeOffers: 0 };
  s.phase = { kind: 'preRoll' };
  s.rng = rngForRoll(6);
  const r = applyAction(s, { type: 'rollDice', player: 0 });
  if (!r.ok) throw new Error(r.error);
  return { s: r.state, legal: legalActions(r.state) };
}

describe('multi-actor expansion phases', () => {
  it('the actor who is not the current player owes the response', () => {
    const { s } = harvestByOther();
    expect(s.phase.kind).toBe('crop/harvest');
    expect(s.turn.current).toBe(0);
    expect(obligated(s)).toEqual([1]);
  });

  it('a human actor gets the screen; a bot actor moves next (a quick reaction)', () => {
    const { s, legal } = harvestByOther();
    const humanSeats: Seats = ['human', 'human', 'bot', 'bot'];
    expect(pickViewer(s, humanSeats, legal, 0)).toBe(1);
    expect(nextBot(s, humanSeats, legal)).toBeNull();
    const botSeats: Seats = ['human', 'bot', 'bot', 'bot'];
    expect(nextBot(s, botSeats, legal)).toEqual({ player: 1, fast: true });
  });

  it('base phases and expansion phases with only the current player acting are unchanged', () => {
    const base = createGame({
      seed: 1,
      players: ['A', 'B', 'C'].map((name, i) => ({ name, color: `#20202${i}` })),
    });
    expect(obligated(base)).toEqual([]);
    const { s } = harvestByOther();
    const own = {
      ...s,
      phase: { kind: 'crop/replant', species: 'rice', left: 1, used: [] } as const,
    };
    expect(obligated(own as unknown as GameState)).toEqual([]);
  });
});

describe('autoSteal (#34)', () => {
  const steal = (victim: number): Action => ({ type: 'steal', player: 1, victim });
  it('returns the only steal of the viewer', () => {
    expect(autoSteal([steal(2)], 1)).toEqual(steal(2));
    // Other players' actions do not count.
    expect(autoSteal([steal(2), { type: 'endTurn', player: 0 }], 1)).toEqual(steal(2));
  });
  it('asks when there is a real choice or no steal', () => {
    expect(autoSteal([steal(2), steal(3)], 1)).toBeNull();
    expect(autoSteal([steal(2)], 2)).toBeNull();
    expect(autoSteal([steal(2)], null)).toBeNull();
    expect(autoSteal([{ type: 'eventSteal', player: 1, victim: null }], 1)).toBeNull();
    expect(
      autoSteal(
        [
          { type: 'eventSteal', player: 1, victim: 2 },
          { type: 'eventSteal', player: 1, victim: null },
        ],
        1,
      ),
    ).toBeNull();
    expect(autoSteal([{ type: 'endTurn', player: 1 }], 1)).toBeNull();
  });
  it('covers module steals with a victim', () => {
    const a = { type: 'ep/pirateSteal', player: 1, victim: 0 } as unknown as Action;
    expect(autoSteal([a], 1)).toBe(a);
  });
});
