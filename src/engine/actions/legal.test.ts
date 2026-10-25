/**
 * Soundness of legalActions over reachable states: random playouts (seeded) where, at every
 * state, EVERY legal action is applied and must be accepted. Also checks invariants on the way.
 */
import { describe, expect, it } from 'vitest';
import { createGame } from '../createGame';
import { applyAction, legalActions } from '../engine';
import {
  discardGame,
  FIXTURE_PLAYERS,
  freshGame,
  midGame,
  moveRobberGame,
  setupInProgressGame,
} from '../fixtures';
import { Rng } from '../rng';
import { piecesLeft } from '../selectors';
import { isLandHex, vertexNeighbors } from '../topology';
import type { Action, GameState, PhaseKind, VertexId } from '../types';
import { expectConserved, expectOk } from './testkit';

function expectAllAccepted(s: GameState, actions: Action[]) {
  for (const a of actions) {
    const r = applyAction(s, a);
    if (!r.ok) throw new Error(`legal action rejected: ${JSON.stringify(a)}: ${r.error}`);
  }
}

function checkInvariants(s: GameState) {
  expectConserved(s);
  expect(isLandHex(s.robber)).toBe(true);
  for (const p of s.players) {
    const left = piecesLeft(s, p.id);
    expect(Math.min(left.road, left.settlement, left.city)).toBeGreaterThanOrEqual(0);
  }
  for (const v of Object.keys(s.pieces.buildings) as VertexId[]) {
    for (const n of vertexNeighbors(v)) expect(s.pieces.buildings[n], `${v}~${n}`).toBeUndefined();
  }
}

/** Biased random playout: prefers anything over endTurn so the board fills up. */
function playout(start: GameState, seed: number, steps: number, checkAll = true) {
  const rng = new Rng(seed);
  const phases = new Set<PhaseKind>();
  let s = start;
  for (let i = 0; i < steps && s.phase.kind !== 'gameOver'; i++) {
    phases.add(s.phase.kind);
    const actions = legalActions(s);
    expect(actions.length, `stuck in ${s.phase.kind}`).toBeGreaterThan(0);
    if (checkAll) expectAllAccepted(s, actions);
    const busy = actions.filter((a) => a.type !== 'endTurn');
    const pool = busy.length > 0 && rng.float() < 0.8 ? busy : actions;
    s = expectOk(applyAction(s, rng.pick(pool)));
    checkInvariants(s);
  }
  phases.add(s.phase.kind);
  return { s, phases };
}

describe('legalActions soundness', () => {
  it('fixtures: every legal action is accepted', () => {
    for (const s of [
      freshGame(3),
      setupInProgressGame(),
      midGame(),
      discardGame(),
      moveRobberGame(),
    ]) {
      const actions = legalActions(s);
      expect(actions.length).toBeGreaterThan(0);
      expectAllAccepted(s, actions);
    }
  });

  const configs = [
    { seed: 1, n: 3, layout: 'beginner', vpToWin: 10 },
    { seed: 2, n: 4, layout: 'random', vpToWin: 10 },
    { seed: 3, n: 4, layout: 'beginner', vpToWin: 5 },
    { seed: 4, n: 3, layout: 'random', vpToWin: 5 },
  ] as const;

  for (const c of configs) {
    it(`random playout: ${c.n} players, ${c.layout}, seed ${c.seed}`, () => {
      const start = createGame({
        seed: c.seed,
        players: FIXTURE_PLAYERS.slice(0, c.n),
        layout: c.layout,
        vpToWin: c.vpToWin,
      });
      const { s, phases } = playout(start, c.seed, 600);
      for (const k of ['setup', 'preRoll', 'main', 'moveRobber'] as const) {
        expect(phases.has(k), k).toBe(true);
      }
      expect(s.turn.number).toBeGreaterThan(5);
    });
  }

  it('playouts reach discard, steal and gameOver somewhere', () => {
    const seen = new Set<PhaseKind>();
    for (let seed = 10; seed < 14; seed++) {
      const start = createGame({
        seed,
        players: FIXTURE_PLAYERS,
        layout: 'random',
        vpToWin: 3, // no trading yet (T3), so random play builds slowly
      });
      for (const k of playout(start, seed, 800, false).phases) seen.add(k);
    }
    for (const k of ['discard', 'steal', 'gameOver'] as const) expect(seen.has(k), k).toBe(true);
  });
});
