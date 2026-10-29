/** Test-only helpers for the T&B rules tests (imported by *.test.ts only). */
import { expect } from 'vitest';
import { RESOURCES } from '../../../engine/constants';
import { applyAction, legalActions } from '../../../engine/engine';
import { createGame } from '../../../engine/createGame';
import { cornerVertex, sideEdge, type Corner, type Side } from '../../../engine/hex';
import { Rng, expandState, type RngState } from '../../../engine/rng';
import type {
  Action,
  ActionResult,
  BuildingKind,
  EdgeId,
  GameState,
  PlayerId,
  ResourceBundle,
  VertexId,
} from '../../../engine/types';
import { TB, tbSlice, type TbAction } from '.';

export const players = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ name: `P${i}`, color: `#20202${i}` }));

/** A T&B game of `scenario` ('fishermen', 'rivers', ...), still in setup, seat 0 first. */
export function tbGame(scenario: string, n = 4, opts: Record<string, unknown> = {}): GameState {
  return createGame({
    seed: 7,
    players: players(n),
    mode: TB,
    scenario: `tb/${scenario}`,
    startingPlayer: 0,
    ...opts,
  });
}

/** Turn 3, player 0 in the main phase, no pieces on the board. */
export function tbMain(scenario: string, n = 4, opts: Record<string, unknown> = {}): GameState {
  const s = tbGame(scenario, n, opts);
  s.turn = { number: 3, current: 0, devCardPlayed: false, tradeOffers: 0 };
  s.phase = { kind: 'main' };
  return s;
}

export const V = (q: number, r: number, c: Corner): VertexId => cornerVertex(q, r, c);
export const E = (q: number, r: number, side: Side): EdgeId => sideEdge(q, r, side);

export function build(s: GameState, p: PlayerId, v: VertexId, kind: BuildingKind = 'settlement') {
  s.pieces.buildings[v] = { owner: p, kind };
}

export function roads(s: GameState, p: PlayerId, ...edges: EdgeId[]) {
  for (const e of edges) s.pieces.roads[e] = p;
}

/** Set a player's resource hand exactly (the bank keeps the difference). */
export function setHand(s: GameState, p: PlayerId, hand: ResourceBundle) {
  const pl = s.players[p];
  if (!pl) throw new Error(`no player ${p}`);
  for (const r of RESOURCES) {
    const want = hand[r] ?? 0;
    s.bank[r] -= want - pl.resources[r];
    pl.resources[r] = want;
  }
}

export function setGold(s: GameState, p: PlayerId, n: number) {
  tbSlice(s).gold[p] = n;
}

export function act(s: GameState, a: TbAction | Action): ActionResult {
  return applyAction(s, a as Action);
}

export function ok(s: GameState, ...actions: (TbAction | Action)[]): GameState {
  return actions.reduce((st, a) => {
    const r = applyAction(st, a as Action);
    if (!r.ok) throw new Error(`${JSON.stringify(a)} failed: ${r.error}`);
    return r.state;
  }, s);
}

export function bad(s: GameState, a: TbAction | Action, match?: string | RegExp): string {
  const r = applyAction(s, a as Action);
  if (r.ok) throw new Error(`expected ${JSON.stringify(a)} to fail`);
  if (match !== undefined) expect(r.error).toMatch(match);
  return r.error;
}

/** Legal actions of `type` (for `player`). */
export const legalOf = (s: GameState, type: string, player?: PlayerId): Action[] =>
  legalActions(s, player).filter((a) => a.type === type);

/** An RNG state whose next two dice are d1, d2 (then anything). */
export function rngFor(...dice: number[]): RngState {
  for (let seed = 0; seed < 5_000_000; seed++) {
    const rng = new Rng(seed);
    if (dice.every((d) => rng.die() === d)) return expandState(seed);
  }
  throw new Error('no such seed');
}

/** Roll d1 + d2 for the current player (phase preRoll). */
export function roll(s: GameState, d1: number, d2: number): GameState {
  const copy = structuredClone(s);
  copy.phase = { kind: 'preRoll' };
  copy.rng = rngFor(d1, d2);
  return ok(copy, { type: 'rollDice', player: copy.turn.current });
}

/** Resources conserved (bank + hands = the map's bank size). */
export function expectConserved(s: GameState, bank = s.players.length >= 5 ? 24 : 19) {
  for (const r of RESOURCES) {
    const held = s.players.reduce((sum, p) => sum + p.resources[r], 0);
    expect(s.bank[r] + held, r).toBe(bank);
  }
}

export { TB };
