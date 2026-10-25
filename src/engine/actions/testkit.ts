/**
 * OWNER: T2 (rules-core). Test-only helpers for the rules tests (imported by *.test.ts only).
 * Direct state edits keep the bank conserved, so tests can assert resource conservation.
 */
import { expect } from 'vitest';
import { BANK_PER_RESOURCE, RESOURCES } from '../constants';
import { applyAction } from '../engine';
import { freshGame } from '../fixtures';
import { Rng } from '../rng';
import type {
  Action,
  ActionResult,
  BuildingKind,
  EdgeId,
  GameState,
  PlayerId,
  ResourceBundle,
  VertexId,
} from '../types';

export function expectOk(r: ActionResult): GameState {
  if (!r.ok) throw new Error(`expected ok, got error: ${r.error}`);
  return r.state;
}

export function expectFail(r: ActionResult, match?: string | RegExp): string {
  if (r.ok) throw new Error('expected failure, got ok');
  if (match !== undefined) expect(r.error).toMatch(match);
  return r.error;
}

/** Apply actions in order, throwing on the first failure. */
export function run(state: GameState, ...actions: Action[]): GameState {
  return actions.reduce((s, a) => {
    const r = applyAction(s, a);
    if (!r.ok) throw new Error(`${JSON.stringify(a)} failed: ${r.error}`);
    return r.state;
  }, state);
}

/** Beginner board, no pieces, turn 1, player 0 to roll. */
export function emptyBoardGame(n: 3 | 4 = 4): GameState {
  const s = freshGame(n);
  s.turn = { number: 1, current: 0, devCardPlayed: false };
  s.phase = { kind: 'preRoll' };
  return s;
}

export function place(s: GameState, p: PlayerId, v: VertexId, kind: BuildingKind = 'settlement') {
  s.pieces.buildings[v] = { owner: p, kind };
}

export function road(s: GameState, p: PlayerId, ...edges: EdgeId[]) {
  for (const e of edges) s.pieces.roads[e] = p;
}

/** Set a player's hand exactly, moving the difference to/from the bank. */
export function setHand(s: GameState, p: PlayerId, bundle: ResourceBundle) {
  const hand = s.players[p]?.resources;
  if (!hand) throw new Error(`no player ${p}`);
  for (const r of RESOURCES) {
    const want = bundle[r] ?? 0;
    s.bank[r] -= want - hand[r];
    hand[r] = want;
  }
}

/** An RNG state whose next two dice sum to `total`. */
export function rngForRoll(total: number): number {
  for (let seed = 0; seed < 100_000; seed++) {
    const rng = new Rng(seed);
    if (rng.die() + rng.die() === total) return seed;
  }
  throw new Error(`no seed rolls ${total}`);
}

/** Roll a specific total with the current player. */
export function rollTotal(s: GameState, total: number): GameState {
  const copy = structuredClone(s);
  copy.rng = rngForRoll(total);
  return run(copy, { type: 'rollDice', player: copy.turn.current });
}

/** Bank + hands = 19 of each resource; nothing negative. */
export function expectConserved(s: GameState) {
  for (const r of RESOURCES) {
    const held = s.players.reduce((sum, p) => sum + p.resources[r], 0);
    expect(s.bank[r] + held, r).toBe(BANK_PER_RESOURCE);
    expect(s.bank[r]).toBeGreaterThanOrEqual(0);
    for (const p of s.players) expect(p.resources[r]).toBeGreaterThanOrEqual(0);
  }
}
