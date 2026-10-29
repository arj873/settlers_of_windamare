/** Test-only helpers for the C&K rules tests (imported by *.test.ts only). */
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
  VertexId,
} from '../../../engine/types';
import {
  CK,
  COMMODITIES,
  EVENT_DIE,
  ckSlice,
  commoditySupply,
  type CkAction,
  type EventFace,
  type Good,
  type KnightLevel,
  type ProgressCard,
  type Track,
} from '.';

export const players = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ name: `P${i}`, color: `#20202${i}` }));

/** A C&K game on the fixed starter board (3-4) or the 5-6 board, still in setup. */
export function ckGame(n = 4, opts: Record<string, unknown> = {}): GameState {
  return createGame({
    seed: 7,
    players: players(n),
    mode: CK,
    scenario: n <= 4 ? 'ck/starter' : 'ck/classic',
    startingPlayer: 0,
    ...opts,
  });
}

/** Turn 3, player 0 in the main phase, no pieces on the board. */
export function ckMain(n = 4, opts: Record<string, unknown> = {}): GameState {
  const s = ckGame(n, opts);
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

export function knight(
  s: GameState,
  p: PlayerId,
  v: VertexId,
  level: KnightLevel = 1,
  active = false,
  activatedOn: number | null = null,
) {
  ckSlice(s).knights[v] = { owner: p, level, active, activatedOn, promotedOn: null };
}

/** Set a player's hand of resources and commodities exactly (banks keep the difference). */
export function setGoods(s: GameState, p: PlayerId, goods: Partial<Record<Good, number>>) {
  const pl = s.players[p];
  const c = ckSlice(s);
  const cp = c.players[p];
  if (!pl || !cp) throw new Error(`no player ${p}`);
  for (const r of RESOURCES) {
    const want = goods[r] ?? 0;
    s.bank[r] -= want - pl.resources[r];
    pl.resources[r] = want;
  }
  for (const k of COMMODITIES) {
    const want = goods[k] ?? 0;
    c.bank[k] -= want - cp.commodities[k];
    cp.commodities[k] = want;
  }
}

/** Give `p` progress cards (taken out of their stacks, so cards stay conserved). */
export function giveCards(s: GameState, p: PlayerId, ...cards: ProgressCard[]) {
  const c = ckSlice(s);
  for (const card of cards) {
    const deck = Object.values(c.decks).find((d) => d.includes(card));
    if (!deck) throw new Error(`no ${card} left`);
    deck.splice(deck.indexOf(card), 1);
    c.players[p]?.progress.push(card);
  }
}

export function setLevel(s: GameState, p: PlayerId, t: Track, level: number) {
  const pl = ckSlice(s).players[p];
  if (pl) pl.improvements[t] = level;
}

export function act(s: GameState, a: CkAction | Action): ActionResult {
  return applyAction(s, a as Action);
}

export function ok(s: GameState, ...actions: (CkAction | Action)[]): GameState {
  return actions.reduce((st, a) => {
    const r = applyAction(st, a as Action);
    if (!r.ok) throw new Error(`${JSON.stringify(a)} failed: ${r.error}`);
    return r.state;
  }, s);
}

export function bad(s: GameState, a: CkAction | Action, match?: string | RegExp): string {
  const r = applyAction(s, a as Action);
  if (r.ok) throw new Error(`expected ${JSON.stringify(a)} to fail`);
  if (match !== undefined) expect(r.error).toMatch(match);
  return r.error;
}

/** Legal actions of `type` (for `player`). */
export const legalOf = (s: GameState, type: string, player?: PlayerId): Action[] =>
  legalActions(s, player).filter((a) => a.type === type);

/** An RNG state whose next roll is yellow + red with the event die on `face`. */
export function rngFor(yellow: number, red: number, face: EventFace): RngState {
  for (let seed = 0; seed < 1_000_000; seed++) {
    const rng = new Rng(seed);
    if (rng.die() !== yellow || rng.die() !== red) continue;
    if (rng.pick(EVENT_DIE) === face) return expandState(seed);
  }
  throw new Error('no such seed');
}

/** Roll yellow + red with the event die on `face` (player = current, phase preRoll). */
export function roll(s: GameState, yellow: number, red: number, face: EventFace): GameState {
  const copy = structuredClone(s);
  copy.phase = { kind: 'preRoll' };
  copy.rng = rngFor(yellow, red, face);
  return ok(copy, { type: 'rollDice', player: copy.turn.current });
}

/** Resources + commodities conserved, nothing negative. */
export function expectConserved(s: GameState) {
  for (const r of RESOURCES) {
    const held = s.players.reduce((sum, p) => sum + p.resources[r], 0);
    expect(s.bank[r] + held, r).toBe(s.players.length >= 5 ? 24 : 19);
  }
  const c = ckSlice(s);
  for (const k of COMMODITIES) {
    const held = c.players.reduce((sum, p) => sum + p.commodities[k], 0);
    expect(c.bank[k] + held, k).toBe(commoditySupply(s.players.length));
    expect(c.bank[k]).toBeGreaterThanOrEqual(0);
  }
}
