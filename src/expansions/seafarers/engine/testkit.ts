/** Test helpers for the Seafarers engine tests (imported by *.test.ts only). */
import { createGame } from '../../../engine/createGame';
import type { GameConfig } from '../../../engine/createGame';
import type { EdgeId, GameState, HexId, PlayerId, VertexId } from '../../../engine/types';
import { cellEdge, cellHex, cellVertex, type BookCorner, type BookSide } from './coords';
import { seaSlice, type ScenarioKey } from './state';

export const players = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ name: `P${i}`, color: `#20202${i}` }));

export function seaGame(
  scenario: ScenarioKey = 'newShores',
  n = 4,
  extra: Partial<GameConfig> = {},
): GameState {
  return createGame({
    seed: 1,
    players: players(n),
    mode: 'seafarers',
    scenario: `seafarers/${scenario}`,
    startingPlayer: 0,
    ...extra,
  });
}

/** Player `p` in the main phase of turn 3. */
export function mainPhase(s: GameState, p: PlayerId = 0): GameState {
  s.turn = { number: 3, current: p, devCardPlayed: false, tradeOffers: 0 };
  s.phase = { kind: 'main' };
  return s;
}

export const V = (c: number, r: number, corner: BookCorner): VertexId => cellVertex([c, r], corner);
export const E = (c: number, r: number, side: BookSide): EdgeId => cellEdge([c, r], side);
export const H = (c: number, r: number): HexId => cellHex([c, r]);

export function ship(s: GameState, p: PlayerId, ...edges: EdgeId[]): void {
  for (const e of edges) seaSlice(s).ships[e] = { owner: p };
}
