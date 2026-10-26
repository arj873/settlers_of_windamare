/** Test helpers for T&B + Seafarers (not part of the module). */
import { expect } from 'vitest';
import { applyAction, legalActions } from '../../../engine/engine';
import { createGame } from '../../../engine/createGame';
import type { Action, GameState, PlayerId, Resource } from '../../../engine/types';
import { TBSEA_MODE } from '.';

export const players = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ name: `P${i}`, color: `#30303${i}` }));

export function game(scenario: string, n = 4, extra: Record<string, unknown> = {}): GameState {
  return createGame({
    seed: 3,
    players: players(n),
    mode: TBSEA_MODE,
    scenario,
    startingPlayer: 0,
    ...extra,
  });
}

/** Player 0 in the main phase of turn 3, nothing built yet (the slices as created). */
export function main(scenario: string, n = 4): GameState {
  const s = game(scenario, n);
  s.pieces.buildings = {};
  s.pieces.roads = {};
  s.turn = { number: 3, current: 0, devCardPlayed: false, tradeOffers: 0 };
  s.phase = { kind: 'main' };
  return s;
}

export const run = (s: GameState, ...actions: Action[]): GameState =>
  actions.reduce((st, a) => {
    const r = applyAction(st, a);
    if (!r.ok) throw new Error(`${JSON.stringify(a)}: ${r.error}`);
    return r.state;
  }, s);

export const fails = (s: GameState, a: Action, match?: RegExp): void => {
  const r = applyAction(s, a);
  expect(r.ok, JSON.stringify(a)).toBe(false);
  if (!r.ok && match) expect(r.error).toMatch(match);
};

export const legalOf = (s: GameState, type: string): Action[] =>
  legalActions(s).filter((a) => a.type === type);

export const act = (type: string, player: PlayerId, rest: Record<string, unknown> = {}): Action =>
  ({ type, player, ...rest }) as unknown as Action;

/** Give `p` cards from the bank. */
export function give(s: GameState, p: PlayerId, cards: Partial<Record<Resource, number>>): void {
  const hand = s.players[p]?.resources;
  if (!hand) return;
  for (const [r, n] of Object.entries(cards) as [Resource, number][]) {
    hand[r] += n;
    s.bank[r] -= n;
  }
}
