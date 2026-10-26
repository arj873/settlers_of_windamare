/**
 * Soundness of legalActions over reachable states: random playouts (seeded) where, at every
 * state, EVERY legal action is applied and must be accepted. Also checks invariants on the way.
 */
import { describe, expect, it } from 'vitest';
import { PLAYER_COLORS } from '../constants';
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
import { isLandHex, topologyOf, vertexNeighbors } from '../topology';
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
  const t = topologyOf(s);
  expect(isLandHex(t, s.robber)).toBe(true);
  for (const p of s.players) {
    const left = piecesLeft(s, p.id);
    expect(Math.min(left.road, left.settlement, left.city)).toBeGreaterThanOrEqual(0);
  }
  for (const v of Object.keys(s.pieces.buildings) as VertexId[]) {
    for (const n of vertexNeighbors(t, v))
      expect(s.pieces.buildings[n], `${v}~${n}`).toBeUndefined();
  }
}

/**
 * A uniformly random action TYPE, then a random action of that type. Picking straight from the
 * flat list lets types with many variants (discard combos, trade offers, road spots) dominate,
 * so turns drag on and rolls (hence 7s and discards) become rare.
 */
function pickByType(actions: Action[], rng: Rng): Action {
  const types = [...new Set(actions.map((a) => a.type))];
  const type = rng.pick(types);
  return rng.pick(actions.filter((a) => a.type === type));
}

/**
 * Biased random playout: prefers anything over endTurn so the board fills up.
 * `checkAll`: apply every legal action at every state (true), or only in the listed phases.
 */
function playout(
  start: GameState,
  seed: number,
  steps: number,
  checkAll: boolean | readonly PhaseKind[] = true,
) {
  const rng = new Rng(seed);
  const phases = new Set<PhaseKind>();
  let s = start;
  for (let i = 0; i < steps && s.phase.kind !== 'gameOver'; i++) {
    phases.add(s.phase.kind);
    const actions = legalActions(s);
    expect(actions.length, `stuck in ${s.phase.kind}`).toBeGreaterThan(0);
    if (checkAll === true || (checkAll !== false && checkAll.includes(s.phase.kind))) {
      expectAllAccepted(s, actions);
    }
    const busy = actions.filter((a) => a.type !== 'endTurn');
    const pool = busy.length > 0 && rng.float() < 0.8 ? busy : actions;
    s = expectOk(applyAction(s, pickByType(pool, rng)));
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

  const bigMaps = [
    { seed: 5, n: 6, map: 'base56' },
    { seed: 6, n: 5, map: 'base56' },
    { seed: 7, n: 8, map: 'base78' },
    { seed: 8, n: 7, map: 'base78' },
  ] as const;

  for (const c of bigMaps) {
    it(`random playout: ${c.n} players, ${c.map}, seed ${c.seed}`, () => {
      const start = createGame({ seed: c.seed, players: PLAYER_COLORS.slice(0, c.n), map: c.map });
      const { s, phases } = playout(start, c.seed, 800);
      for (const k of ['setup', 'preRoll', 'main', 'moveRobber'] as const) {
        expect(phases.has(k), k).toBe(true);
      }
      expect(s.turn.number).toBeGreaterThan(5);
    });
  }

  it('full games to 10 VP finish, passing through discard and steal on the way', () => {
    // Real target: low targets end the game before anyone holds > 7 cards, so 7s never cause a
    // discard. Every legal action is still checked in the rare phases (discard, steal).
    const seen = new Set<PhaseKind>();
    for (let seed = 10; seed < 14; seed++) {
      const start = createGame({ seed, players: FIXTURE_PLAYERS, layout: 'random' });
      const { s, phases } = playout(start, seed, 5000, ['discard', 'steal']);
      expect(s.phase.kind, `seed ${seed}`).toBe('gameOver');
      for (const k of phases) seen.add(k);
    }
    for (const k of ['discard', 'steal', 'roadBuilding', 'trade'] as const) {
      expect(seen.has(k), k).toBe(true);
    }
  });
});
