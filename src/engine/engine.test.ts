import { describe, expect, it } from 'vitest';
import { HANDLERS } from './actions';
import { applyAction, legalActions } from './engine';
import { freshGame, gameOverGame, midGame } from './fixtures';
import type { Action, ActionType } from './types';

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object') {
    for (const v of Object.values(o)) deepFreeze(v);
    Object.freeze(o);
  }
  return o;
}

/** One sample of every action type — keep in sync with the Action union (TS enforces keys). */
const SAMPLES: { [K in ActionType]: Extract<Action, { type: K }> } = {
  placeSetupSettlement: { type: 'placeSetupSettlement', player: 0, vertex: 'v:0,0,N' },
  placeSetupRoad: { type: 'placeSetupRoad', player: 0, edge: 'e:0,0,NE' },
  rollDice: { type: 'rollDice', player: 0 },
  endTurn: { type: 'endTurn', player: 0 },
  buildRoad: { type: 'buildRoad', player: 0, edge: 'e:0,0,NE' },
  buildSettlement: { type: 'buildSettlement', player: 0, vertex: 'v:0,0,N' },
  buildCity: { type: 'buildCity', player: 0, vertex: 'v:0,0,N' },
  discard: { type: 'discard', player: 0, resources: { brick: 1 } },
  moveRobber: { type: 'moveRobber', player: 0, hex: 'h:1,0' },
  steal: { type: 'steal', player: 0, victim: 1 },
  buyDevCard: { type: 'buyDevCard', player: 0 },
  playKnight: { type: 'playKnight', player: 0 },
  playRoadBuilding: { type: 'playRoadBuilding', player: 0 },
  placeFreeRoad: { type: 'placeFreeRoad', player: 0, edge: 'e:0,0,NE' },
  playYearOfPlenty: { type: 'playYearOfPlenty', player: 0, resources: ['ore', 'grain'] },
  playMonopoly: { type: 'playMonopoly', player: 0, resource: 'wool' },
  bankTrade: { type: 'bankTrade', player: 0, give: 'brick', receive: 'ore' },
  offerTrade: { type: 'offerTrade', player: 0, give: { brick: 1 }, want: { ore: 1 }, to: [1] },
  acceptTrade: { type: 'acceptTrade', player: 1 },
  rejectTrade: { type: 'rejectTrade', player: 1 },
  cancelTrade: { type: 'cancelTrade', player: 0 },
  confirmTrade: { type: 'confirmTrade', player: 0, partner: 1 },
};

describe('applyAction', () => {
  it('has a handler for every action type', () => {
    for (const type of Object.keys(SAMPLES))
      expect(typeof HANDLERS[type as ActionType]).toBe('function');
  });

  it('never mutates the input state', () => {
    for (const make of [freshGame, midGame]) {
      const state = deepFreeze(make());
      const before = JSON.stringify(state);
      for (const action of Object.values(SAMPLES)) applyAction(state, action);
      expect(JSON.stringify(state)).toBe(before);
    }
  });

  it('rejects unknown action types', () => {
    const r = applyAction(freshGame(), { type: 'cheat', player: 0 } as unknown as Action);
    expect(r).toEqual({ ok: false, error: 'unknown action type: cheat' });
  });

  it('rejects inherited object keys as action types', () => {
    const r = applyAction(freshGame(), { type: 'toString', player: 0 } as unknown as Action);
    expect(r.ok).toBe(false);
  });

  it('rejects invalid players', () => {
    for (const player of [-1, 4, 1.5, '0']) {
      const r = applyAction(freshGame(), { type: 'rollDice', player } as unknown as Action);
      expect(r.ok).toBe(false);
    }
  });

  it('rejects everything once the game is over', () => {
    expect(applyAction(gameOverGame(), SAMPLES.endTurn)).toEqual({
      ok: false,
      error: 'game is over',
    });
    expect(legalActions(gameOverGame())).toEqual([]);
  });
});

describe('legalActions', () => {
  it('only returns actions that applyAction accepts', () => {
    for (const state of [freshGame(), midGame()]) {
      for (const action of legalActions(state)) {
        expect(applyAction(state, action).ok, JSON.stringify(action)).toBe(true);
      }
    }
  });

  it('filters by player', () => {
    const s = midGame();
    expect(legalActions(s, 2).every((a) => a.player === 2)).toBe(true);
  });
});
