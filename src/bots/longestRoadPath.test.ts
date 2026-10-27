/**
 * #51: the board draws `longestRoadPath`, the route the Longest Road award counts. Across real
 * games of every route-changing module it is one trail of the player's own pieces, as long as the
 * award's length (camels count an edge twice, so there it is at most that long).
 */
import { describe, expect, it } from 'vitest';
import {
  edgeVertices,
  longestRoadLengths,
  longestRoadPath,
  topologyOf,
  type EdgeId,
  type GameState,
} from '../engine';
import { seaSlice } from '../expansions/seafarers/engine';
import { graph } from '../expansions/seafarers/engine/geometry';
import { TBSEA_MODE } from '../expansions/tbsea/engine';
import { seatSource } from './bench';
import { newGame, runGame, type GameSetup } from './runner';
import { normalBot } from './smart';

const GAMES: [string, GameSetup, { weighted?: boolean }][] = [
  ['base', { seed: 'lrp:base', players: 4 }, {}],
  [
    'Seafarers',
    { seed: 'lrp:sea', players: 4, mode: 'seafarers', scenario: 'seafarers/newShores' },
    {},
  ],
  [
    'T&B Caravans',
    { seed: 'lrp:tb', players: 4, mode: 'tb', scenario: 'tb/caravans' },
    { weighted: true },
  ],
  [
    'T&B + Seafarers Caravans',
    { seed: 'lrp:tbsea', players: 4, mode: TBSEA_MODE, scenario: 'tbsea/caravans' },
    { weighted: true },
  ],
];

function check(state: GameState, weighted: boolean): number {
  const t = topologyOf(state);
  const sea = state.ext?.seafarers !== undefined;
  const ships = sea ? seaSlice(state).ships : {};
  // Ships sail sea edges, which only the Seafarers graph knows.
  const ends = (e: EdgeId): readonly string[] =>
    (sea ? graph(state).ends.get(e) : undefined) ?? edgeVertices(t, e);
  const lengths = longestRoadLengths(state);
  let longest = 0;
  for (const p of state.players) {
    const len = lengths[p.id] ?? 0;
    const path = longestRoadPath(state, p.id);
    longest = Math.max(longest, path.length);
    if (weighted) expect(path.length).toBeLessThanOrEqual(len);
    else expect(path.length).toBe(len);
    expect(path.length === 0).toBe(len === 0);
    expect(new Set(path).size).toBe(path.length);
    for (const e of path) {
      expect(state.pieces.roads[e] === p.id || ships[e]?.owner === p.id).toBe(true);
    }
    path.forEach((e: EdgeId, i) => {
      const prev = path[i - 1];
      if (prev === undefined) return;
      const a = ends(prev);
      expect(ends(e).some((v) => a.includes(v))).toBe(true);
    });
  }
  return longest;
}

describe('longestRoadPath in real games', () => {
  it.each(GAMES)('%s: one trail of own pieces, the counted length', (_name, setup, opts) => {
    let longest = 0;
    const r = runGame({
      initial: newGame(setup),
      maxSteps: 6000,
      source: seatSource([normalBot, normalBot, normalBot, normalBot], String(setup.seed)),
      onStep: ({ step, state }) => {
        if (step % 40 === 0) longest = Math.max(longest, check(state, opts.weighted === true));
      },
    });
    expect(r.failure?.message ?? null).toBeNull();
    longest = Math.max(longest, check(r.finalState, opts.weighted === true));
    expect(longest).toBeGreaterThanOrEqual(4);
  });
});
