/** Test helpers for the Explorers & Pirates engine tests (imported by *.test.ts only). */
import { createGame, type GameConfig } from '../../../engine/createGame';
import { applyAction } from '../../../engine/engine';
import { doubledToHexId } from '../../../engine/expansions/ext';
import { legalActions } from '../../../engine/engine';
import { cornerVertex, parseHexId, sideEdge, type Corner, type Side } from '../../../engine/hex';
import type {
  Action,
  ActionResult,
  EdgeId,
  GameState,
  HexId,
  PlayerId,
  ResourceCounts,
  VertexId,
} from '../../../engine/types';
import { epSlice, freshTurn, type Cargo, type ScenarioKey, type Ship } from './state';

export const players = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ name: `P${i}`, color: `#20202${i}` }));

export function epGame(
  scenario: ScenarioKey = 'full',
  n = 4,
  extra: Partial<GameConfig> = {},
): GameState {
  return createGame({
    seed: 1,
    players: players(n),
    mode: 'ep',
    scenario: `ep/${scenario}`,
    startingPlayer: 0,
    ...extra,
  });
}

export function expectOk(r: ActionResult): GameState {
  if (!r.ok) throw new Error(r.error);
  return r.state;
}

export const act = (s: GameState, a: Action): GameState => expectOk(applyAction(s, a));

/** Apply `type` for `player` with the payload; returns the result (ok or not). */
export const tryAct = (s: GameState, type: string, player: PlayerId, payload: object = {}) =>
  applyAction(s, { type, player, ...payload } as Action);

export const run = (s: GameState, type: string, player: PlayerId, payload: object = {}) =>
  expectOk(tryAct(s, type, player, payload));

/** Doubled board coordinates (3-4 player maps: p = 1). */
export const H = (c: number, r: number, p: 0 | 1 = 1): HexId => doubledToHexId(c, r, p);
export const V = (c: number, r: number, corner: Corner, p: 0 | 1 = 1): VertexId => {
  const { q } = parseHexId(H(c, r, p));
  return cornerVertex(q, r, corner);
};
export const E = (c: number, r: number, side: Side, p: 0 | 1 = 1): EdgeId => {
  const { q } = parseHexId(H(c, r, p));
  return sideEdge(q, r, side);
};

export const R = (b: Partial<ResourceCounts> = {}): ResourceCounts => ({
  brick: 0,
  lumber: 0,
  wool: 0,
  grain: 0,
  ore: 0,
  ...b,
});

/** Run the whole variable setup with the first legal choice of every step. */
export function afterSetup(s: GameState): GameState {
  let st = s;
  for (let i = 0; i < 100 && st.turn.number === 0; i++) {
    const a = legalActions(st)[0];
    if (!a) throw new Error(`no legal setup action in ${st.phase.kind}`);
    st = act(st, a);
  }
  return st;
}

/**
 * A blank main-phase state for player `p` (turn 3): no pieces, empty hands, fresh turn. Build the
 * situation by hand with the helpers below.
 */
export function blank(scenario: ScenarioKey = 'full', n = 4, p: PlayerId = 0): GameState {
  const s = epGame(scenario, n);
  s.pieces = { buildings: {}, roads: {} };
  for (const pl of s.players) pl.resources = R();
  const e = epSlice(s);
  e.harbors = {};
  e.ships = [];
  e.gold = s.players.map(() => 0);
  e.turn = freshTurn();
  s.turn = { number: 3, current: p, devCardPlayed: false, tradeOffers: 0 };
  s.phase = { kind: 'main' };
  delete s.stats;
  return s;
}

export function settle(s: GameState, p: PlayerId, v: VertexId, harbor = false): void {
  s.pieces.buildings[v] = { owner: p, kind: 'settlement' };
  if (harbor) epSlice(s).harbors[v] = [];
}

export function addShip(s: GameState, p: PlayerId, edge: EdgeId, cargo: Cargo[] = []): Ship {
  const e = epSlice(s);
  const ship = { id: e.nextShip++, owner: p, edge, cargo };
  e.ships.push(ship);
  return ship;
}

export function give(s: GameState, p: PlayerId, b: Partial<ResourceCounts>): void {
  const pl = s.players[p];
  if (!pl) return;
  for (const [r, k] of Object.entries(b) as [keyof ResourceCounts, number][]) pl.resources[r] += k;
}

/** Turn a face-down hex face up as `terrain` (no reward), for tests. */
export function reveal(s: GameState, h: HexId, terrain: string, token: number | null = null): void {
  const tile = s.board.hexes[h];
  if (!tile) throw new Error(`no hex ${h}`);
  s.board = {
    ...s.board,
    hexes: { ...s.board.hexes, [h]: { ...tile, terrain: terrain as never, token } },
  };
  Reflect.deleteProperty(epSlice(s).hidden, h);
}

export const movement = (s: GameState): GameState => {
  epSlice(s).turn.movement = true;
  return s;
};

/** Turn every face-down hex into open sea (a clean board for geometry tests). */
export function openSea(s: GameState): GameState {
  for (const [h, tile] of Object.entries(s.board.hexes)) {
    if (tile.terrain === 'ep/parrot' || tile.terrain === 'ep/goose') reveal(s, h as HexId, 'sea');
  }
  return s;
}
