/**
 * Catan for Two (docs/rules/traders-barbarians.md §2.1, §4.4): two real players, two neutral
 * players (pieces only, in the slice), two production rolls per turn (the second must differ),
 * trade tokens for settling on the coast / by the desert and for turning in a Knight, spent on a
 * Forced Trade or on moving the robber to the desert.
 *
 * Choices made (§10): one token action per turn (Q17); neutral piece limits are enforced and a
 * blocked neutral build is skipped (Q24); after a Knight is turned in, the Largest Army card is
 * set aside unless its holder is still strictly ahead with 3+ (Q25). With Event Cards the
 * second card is always used (T6 rule).
 */
import { RESOURCES } from '../../../engine/constants';
import { isCurrent, log } from '../../../engine/actions/common';
import { stealSecret } from '../../../engine/rules/text';
import { edgeBlocked } from '../../../engine/expansions/hooks';
import { NO_ROBBER } from '../../../engine/expansions/ext';
import { edgeTouchesLand, isVertexOpen, touchesLand } from '../../../engine/rules/placement';
import { publicVictoryPoints } from '../../../engine/selectors';
import { edgeVertices, topologyOf, vertexEdges } from '../../../engine/topology';
import type {
  Action,
  EdgeId,
  GameState,
  HexId,
  Phase,
  PlayerId,
  VertexId,
} from '../../../engine/types';
import { handTotal, pn, stealResource } from './common';
import { isBridgeSite } from './rivers';
import {
  KNIGHT_TOKENS,
  NEUTRAL_NAMES,
  NEUTRAL_ROADS,
  NEUTRAL_SETTLEMENTS,
  SWAMP,
  TOKENS_START,
  TOKENS_SUPPLY,
  TRADE_TERRAINS,
  has,
  tbSlice,
  twoOf,
  type Neutral,
  type TbPhase,
  type TwoSlice,
} from './state';

/** The two marked intersections of the neutral players' first settlements (T5 p.6). */
export const NEUTRAL_STARTS: readonly [VertexId, VertexId] = ['v:1,-2,S', 'v:-1,2,N'];

export function initTwo(): TwoSlice {
  return {
    tokens: [TOKENS_START, TOKENS_START],
    supply: TOKENS_SUPPLY,
    neutrals: [
      { roads: [], settlements: [NEUTRAL_STARTS[0]] },
      { roads: [], settlements: [NEUTRAL_STARTS[1]] },
    ],
    rolls: 0,
    firstRoll: null,
    tokenUsed: false,
    knightTraded: false,
    knightsDiscarded: 0,
    knightsTurnedIn: [0, 0],
  };
}

/** Trade tokens are not used in Fishermen (fish replace them). */
export const tokensInPlay = (state: GameState): boolean => !has(state, 'fish');

// ---------------------------------------------------------------------------
// Neutral pieces
// ---------------------------------------------------------------------------

export function neutralAt(state: GameState, v: VertexId): number | null {
  const two = tbSlice(state).two;
  if (!two) return null;
  const i = two.neutrals.findIndex((n) => n.settlements.includes(v));
  return i < 0 ? null : i;
}

export function neutralRoadAt(state: GameState, e: EdgeId): number | null {
  const two = tbSlice(state).two;
  if (!two) return null;
  const i = two.neutrals.findIndex((n) => n.roads.includes(e));
  return i < 0 ? null : i;
}

/** vertexBlocked: a neutral settlement on `v` or next to it (the distance rule). */
export function neutralBlocksVertex(state: GameState, v: VertexId): boolean {
  if (neutralAt(state, v) !== null) return true;
  return (topologyOf(state).vertex[v]?.vertices ?? []).some((n) => neutralAt(state, n) !== null);
}

function neutralRoadSpots(state: GameState, i: 0 | 1, bridge: boolean): EdgeId[] {
  const n = twoOf(state).neutrals[i];
  if (n.roads.length >= NEUTRAL_ROADS) return [];
  const t = topologyOf(state);
  const out: EdgeId[] = [];
  for (const e of t.edges) {
    if (state.pieces.roads[e] !== undefined || neutralRoadAt(state, e) !== null) continue;
    if (!edgeTouchesLand(state, e)) continue;
    // A bridge built by the player lets the neutral bridge a river too (FAQ 27).
    if (edgeBlocked(state, e) && !(bridge && isBridgeSite(state, e))) continue;
    const ok = edgeVertices(t, e).some((v) => {
      if (n.settlements.includes(v)) return true;
      if (state.pieces.buildings[v] !== undefined || neutralAt(state, v) !== null) return false;
      return vertexEdges(t, v).some((o) => o !== e && n.roads.includes(o));
    });
    if (ok) out.push(e);
  }
  return out;
}

function neutralSettlementSpots(state: GameState, i: 0 | 1): VertexId[] {
  const n = twoOf(state).neutrals[i];
  if (n.settlements.length >= NEUTRAL_SETTLEMENTS) return [];
  const t = topologyOf(state);
  return t.vertices.filter(
    (v) =>
      isVertexOpen(state, v) &&
      touchesLand(state, v) &&
      vertexEdges(t, v).some((e) => n.roads.includes(e)),
  );
}

export interface NeutralOption {
  neutral: 0 | 1;
  edge?: EdgeId;
  vertex?: VertexId;
}

export function neutralOptions(
  state: GameState,
  piece: 'road' | 'settlement',
  bridge = false,
): NeutralOption[] {
  const out: NeutralOption[] = [];
  for (const i of [0, 1] as const) {
    if (piece === 'road')
      for (const edge of neutralRoadSpots(state, i, bridge)) out.push({ neutral: i, edge });
    else for (const vertex of neutralSettlementSpots(state, i)) out.push({ neutral: i, vertex });
  }
  return out;
}

/**
 * The neutral build that follows the player's road / settlement: the phase to enter (resuming to
 * `resume`), or null when nothing can be built. A settlement falls back to a road.
 */
export function neutralFollowUp(
  state: GameState,
  piece: 'road' | 'settlement',
  resume: Phase,
  bridge = false,
): TbPhase | null {
  if (piece === 'settlement' && neutralOptions(state, 'settlement').length > 0) {
    return { kind: 'tb/neutral', piece: 'settlement', resume };
  }
  if (neutralOptions(state, 'road', bridge).length > 0) {
    return {
      kind: 'tb/neutral',
      piece: 'road',
      resume,
      ...(bridge ? { bridge: true } : {}),
    } as TbPhase;
  }
  return null;
}

export function placeNeutral(draft: GameState, opt: NeutralOption): void {
  const n: Neutral = twoOf(draft).neutrals[opt.neutral];
  if (opt.edge) n.roads.push(opt.edge);
  if (opt.vertex) n.settlements.push(opt.vertex);
  log(
    draft,
    draft.turn.current,
    `${NEUTRAL_NAMES[opt.neutral]} got a ${opt.edge ? 'road' : 'settlement'}`,
  );
}

/** Longest trail of neutral `i` (cut by every other building). */
export function neutralRoadLength(state: GameState, i: 0 | 1): number {
  const t = topologyOf(state);
  const n = twoOf(state).neutrals[i];
  const roads = new Set(n.roads);
  const blocked = (v: VertexId) =>
    state.pieces.buildings[v] !== undefined || (neutralAt(state, v) ?? i) !== i;
  const used = new Set<EdgeId>();
  let best = 0;
  const walk = (v: VertexId, len: number): void => {
    if (len > best) best = len;
    for (const e of vertexEdges(t, v)) {
      if (!roads.has(e) || used.has(e)) continue;
      const next = edgeVertices(t, e).find((x) => x !== v) as VertexId;
      if (blocked(next)) {
        best = Math.max(best, len + 1);
        continue;
      }
      used.add(e);
      walk(next, len + 1);
      used.delete(e);
    }
  };
  for (const e of n.roads) for (const v of edgeVertices(t, e)) walk(v, 0);
  return best;
}

/**
 * A neutral can hold Longest Road: a player's length counts only while it beats the best neutral
 * trail (a tie keeps the player who already holds the card).
 */
export function lengthAgainstNeutrals(state: GameState, p: PlayerId, base: number): number {
  const best = Math.max(neutralRoadLength(state, 0), neutralRoadLength(state, 1));
  if (best < 5) return base;
  if (base > best || (base === best && state.awards.longestRoad === p)) return base;
  return 0;
}

// ---------------------------------------------------------------------------
// Trade tokens
// ---------------------------------------------------------------------------

/** Tokens for a new settlement on `v`: 2 by the desert (Rivers: a swamp), 1 on the coast or by a trade hex. */
export function settlementTokens(state: GameState, v: VertexId): number {
  const info = topologyOf(state).vertex[v];
  if (!info) return 0;
  const terrains = info.hexes.map((h) => state.board.hexes[h]?.terrain);
  let n = 0;
  if (terrains.some((t) => t === 'desert' || t === SWAMP)) n += 2;
  if (info.coastal) n += 1;
  if (terrains.some((t) => t !== undefined && TRADE_TERRAINS.includes(t))) n += 1;
  return n;
}

export function earnTokens(draft: GameState, p: PlayerId, n: number, why: string): void {
  const two = twoOf(draft);
  const k = Math.min(n, two.supply);
  if (k <= 0) return;
  two.supply -= k;
  two.tokens[p] = (two.tokens[p] ?? 0) + k;
  log(draft, p, `${pn(draft, p)} got ${k} trade token${k > 1 ? 's' : ''} (${why})`);
}

/** 1 token while your public VP ≤ your opponent's, else 2. */
export function tokenPrice(state: GameState, p: PlayerId): number {
  return publicVictoryPoints(state, p) <= publicVictoryPoints(state, 1 - p) ? 1 : 2;
}

function tokenActionBlocker(state: GameState, p: PlayerId): string | null {
  if (!tokensInPlay(state)) return 'no trade tokens in this scenario';
  const k = state.phase.kind;
  if (k !== 'preRoll' && k !== 'main') return 'use tokens before rolling or in the main phase';
  if (!isCurrent(state, p)) return 'not your turn';
  const two = twoOf(state);
  if (two.tokenUsed) return 'one token action per turn';
  if ((two.tokens[p] ?? 0) < tokenPrice(state, p)) return `needs ${tokenPrice(state, p)} tokens`;
  return null;
}

export function payTokens(draft: GameState, p: PlayerId): void {
  const two = twoOf(draft);
  const price = tokenPrice(draft, p);
  two.tokens[p] = (two.tokens[p] ?? 0) - price;
  two.supply += price;
  two.tokenUsed = true;
}

export function forcedTradeBlocker(state: GameState, p: PlayerId): string | null {
  return (
    tokenActionBlocker(state, p) ??
    (handTotal(state, 1 - p) > 0 ? null : 'your opponent has no cards')
  );
}

/** Take 2 random cards (as many as there are), then give 2 back (forcedGive). */
export function forcedTrade(draft: GameState, p: PlayerId): number {
  payTokens(draft, p);
  const cards = [stealResource(draft, p, 1 - p), stealResource(draft, p, 1 - p)];
  const taken = cards.filter((c) => c !== null).length;
  log(
    draft,
    p,
    `${pn(draft, p)} forced a trade: took ${taken} card${taken > 1 ? 's' : ''}`,
    stealSecret(draft, p, 1 - p, cards, ' (forced trade)'),
  );
  return Math.min(2, handTotal(draft, p));
}

/** Where the robber goes with a token: the desert (Rivers: a swamp; Caravans: off the board). */
export function tokenRobberTarget(state: GameState): HexId | null {
  if (has(state, 'caravans')) return NO_ROBBER;
  const t = topologyOf(state);
  const spot = t.landHexes.find((h) => {
    const terr = state.board.hexes[h]?.terrain;
    return (terr === 'desert' || terr === SWAMP) && h !== state.robber;
  });
  return spot ?? null;
}

export function tokenRobberBlocker(state: GameState, p: PlayerId): string | null {
  const err = tokenActionBlocker(state, p);
  if (err) return err;
  if (has(state, 'traders')) return null;
  const to = tokenRobberTarget(state);
  if (to === null || to === state.robber) return 'the robber is already there';
  return null;
}

export function knightForTokensBlocker(state: GameState, p: PlayerId): string | null {
  if (!tokensInPlay(state)) return 'no trade tokens in this scenario';
  const k = state.phase.kind;
  if (k !== 'preRoll' && k !== 'main') return 'only on your turn';
  if (!isCurrent(state, p)) return 'not your turn';
  const two = twoOf(state);
  if (two.knightTraded) return 'once per turn';
  if ((state.players[p]?.knightsPlayed ?? 0) < 1) return 'no face-up Knight to turn in';
  if (two.supply < 1) return 'no tokens left in the supply';
  return null;
}

export function knightForTokens(draft: GameState, p: PlayerId): void {
  const two = twoOf(draft);
  const pl = draft.players[p];
  if (!pl) return;
  pl.knightsPlayed -= 1;
  two.knightsDiscarded += 1;
  two.knightsTurnedIn[p] = (two.knightsTurnedIn[p] ?? 0) + 1;
  two.knightTraded = true;
  const other = draft.players[1 - p]?.knightsPlayed ?? 0;
  if (draft.awards.largestArmy === p && (pl.knightsPlayed < 3 || pl.knightsPlayed <= other)) {
    draft.awards.largestArmy = null;
    log(draft, p, `${pn(draft, p)} set the Largest Army card aside`);
  }
  earnTokens(draft, p, KNIGHT_TOKENS, 'turned in a Knight');
}

// ---------------------------------------------------------------------------
// Legal actions
// ---------------------------------------------------------------------------

export function twoLegal(state: GameState): Action[] {
  const p = state.turn.current;
  const phase = state.phase as unknown as TbPhase | { kind: string };
  const out: Action[] = [];
  const act = (a: Record<string, unknown>) => out.push({ player: p, ...a } as unknown as Action);
  if (phase.kind === 'tb/neutral') {
    const ph = phase as Extract<TbPhase, { kind: 'tb/neutral' }> & { bridge?: boolean };
    for (const o of neutralOptions(state, ph.piece, ph.bridge === true)) {
      if (o.edge) act({ type: 'tb/neutralRoad', edge: o.edge, neutral: o.neutral });
      else act({ type: 'tb/neutralSettlement', vertex: o.vertex, neutral: o.neutral });
    }
    return out;
  }
  if (phase.kind === 'tb/forcedGive') {
    const count = (phase as Extract<TbPhase, { kind: 'tb/forcedGive' }>).count;
    const hand = state.players[p]?.resources;
    if (!hand) return out;
    // Every way to give `count` cards (at most 15 for 2 cards).
    const opts: Partial<Record<string, number>>[] = [];
    for (const a of RESOURCES) {
      if (hand[a] < 1) continue;
      if (count === 1) opts.push({ [a]: 1 });
      else
        for (const b of RESOURCES) {
          if (b < a) continue;
          if (a === b ? hand[a] >= 2 : hand[b] >= 1)
            opts.push(a === b ? { [a]: 2 } : { [a]: 1, [b]: 1 });
        }
    }
    for (const resources of opts) act({ type: 'tb/forcedGive', resources });
    return out;
  }
  if (forcedTradeBlocker(state, p) === null) act({ type: 'tb/forcedTrade' });
  if (tokenRobberBlocker(state, p) === null) act({ type: 'tb/tokenRobber' });
  if (knightForTokensBlocker(state, p) === null) act({ type: 'tb/knightForTokens' });
  return out;
}
