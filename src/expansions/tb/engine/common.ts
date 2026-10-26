/**
 * Rules shared by several T&B scenarios: gold coins (Rivers, Barbarian Attack, T&B), the
 * Harbormaster variant, dice and small hand helpers.
 */
import { RESOURCES } from '../../../engine/constants';
import { isCurrent, log } from '../../../engine/actions/common';
import { Rng } from '../../../engine/rng';
import { playerName } from '../../../engine/rules/text';
import { buildingsOf } from '../../../engine/selectors';
import type {
  GameState,
  PlayerId,
  Resource,
  ResourceCounts,
  VertexId,
} from '../../../engine/types';
import { isConqueredBuilding } from './conquest';
import {
  GOLD_BUYS_PER_TURN,
  GOLD_PER_RESOURCE,
  GOLD_SALE_RATIO,
  HARBORMASTER_MIN,
  tbSlice,
  usesGold,
} from './state';

export const pn = playerName;

/** One six-sided die from the game RNG (barbarian landings, drive-offs, prisoner rolls). */
export function rollDie(draft: GameState): number {
  const rng = new Rng(draft.rng);
  const d = rng.die();
  draft.rng = rng.state;
  return d;
}

export function rollTwo(draft: GameState): number {
  const rng = new Rng(draft.rng);
  const d = rng.die() + rng.die();
  draft.rng = rng.state;
  return d;
}

/** Pay `cost` from `p`'s hand into the bank. */
export function payBank(draft: GameState, p: PlayerId, cost: Partial<ResourceCounts>): void {
  const hand = draft.players[p]?.resources;
  if (!hand) return;
  for (const r of RESOURCES) {
    const n = cost[r] ?? 0;
    hand[r] -= n;
    draft.bank[r] += n;
  }
}

/** Take `n` of `r` from the bank (as much as it has). Returns what was taken. */
export function takeBank(draft: GameState, p: PlayerId, r: Resource, n = 1): number {
  const hand = draft.players[p]?.resources;
  if (!hand) return 0;
  const k = Math.min(n, draft.bank[r]);
  hand[r] += k;
  draft.bank[r] -= k;
  return k;
}

/** One random resource card from `victim` to `thief` (null if the victim has none). */
export function stealResource(
  draft: GameState,
  thief: PlayerId,
  victim: PlayerId,
): Resource | null {
  const from = draft.players[victim]?.resources;
  const to = draft.players[thief]?.resources;
  if (!from || !to) return null;
  const cards: Resource[] = RESOURCES.flatMap((r) => Array<Resource>(from[r]).fill(r));
  if (cards.length === 0) return null;
  const rng = new Rng(draft.rng);
  const card = rng.pick(cards);
  draft.rng = rng.state;
  from[card] -= 1;
  to[card] += 1;
  return card;
}

export const handTotal = (state: GameState, p: PlayerId): number => {
  const h = state.players[p]?.resources;
  return h ? RESOURCES.reduce((n, r) => n + h[r], 0) : 0;
};

// ---------------------------------------------------------------------------
// Gold coins
// ---------------------------------------------------------------------------

export const goldOf = (state: GameState, p: PlayerId): number => tbSlice(state).gold[p] ?? 0;

export function addGold(draft: GameState, p: PlayerId, n: number): void {
  const g = tbSlice(draft).gold;
  g[p] = (g[p] ?? 0) + n;
}

/** Why `p` cannot buy one `r` for gold now (2 gold, twice per turn, own turn, not in the SBP). */
export function buyResourceBlocker(state: GameState, p: PlayerId, r: Resource): string | null {
  if (!usesGold(state)) return 'no gold in this game';
  const k = state.phase.kind;
  if (k !== 'main' && k !== 'preRoll') return 'gold buys a card only on your turn';
  if (!isCurrent(state, p) || state.turn.secondSettlerOf !== undefined) return 'not your turn';
  if (tbSlice(state).goldBuys >= GOLD_BUYS_PER_TURN) return 'at most 2 cards for gold per turn';
  if (goldOf(state, p) < GOLD_PER_RESOURCE) return `needs ${GOLD_PER_RESOURCE} gold`;
  if (state.bank[r] < 1) return `the bank has no ${r}`;
  return null;
}

/** Maritime trade into gold: 4 identical resources (3 with a 3:1 harbour; 2:1 harbours do not help). */
export function goldSaleRatio(state: GameState, p: PlayerId): number {
  const generic = state.board.ports.some(
    (port) => port.kind === 'generic' && port.vertices.some((v) => usableBuilding(state, v, p)),
  );
  return generic ? 3 : GOLD_SALE_RATIO;
}

/** A building of `p` on `v` that counts (Barbarian Attack: conquered buildings lose their harbour). */
export function usableBuilding(state: GameState, v: VertexId, p: PlayerId): boolean {
  return state.pieces.buildings[v]?.owner === p && !isConqueredBuilding(state, v);
}

export function sellBlocker(state: GameState, p: PlayerId, r: Resource): string | null {
  if (!usesGold(state)) return 'no gold in this game';
  if (state.phase.kind !== 'main') return 'trade with the bank in the main phase';
  if (!isCurrent(state, p) || state.turn.secondSettlerOf !== undefined) return 'not your turn';
  const ratio = goldSaleRatio(state, p);
  if ((state.players[p]?.resources[r] ?? 0) < ratio) return `needs ${ratio} ${r}`;
  return null;
}

// ---------------------------------------------------------------------------
// Harbormaster (T5 p.6): harbour points, 2 VP card
// ---------------------------------------------------------------------------

/** Settlements on a harbour count 1, cities 2 (conquered buildings count nothing). */
export function harbourPoints(state: GameState, p: PlayerId): number {
  const portVertices = new Set(state.board.ports.flatMap((port) => port.vertices));
  let n = 0;
  for (const kind of ['settlement', 'city'] as const) {
    for (const v of buildingsOf(state, p, kind)) {
      if (portVertices.has(v) && usableBuilding(state, v, p)) n += kind === 'city' ? 2 : 1;
    }
  }
  return n;
}

/** Recompute the Harbormaster card: the holder keeps it while not beaten; a unique leader with 3+ takes it. */
export function updateHarbormaster(draft: GameState): void {
  const s = tbSlice(draft);
  const pts = draft.players.map((p) => harbourPoints(draft, p.id));
  const max = Math.max(...pts);
  const holder = s.harbormaster;
  if (holder !== null && (pts[holder] ?? 0) >= HARBORMASTER_MIN && (pts[holder] ?? 0) >= max)
    return;
  const top = pts.flatMap((n, p) => (n === max ? [p] : []));
  const next = max >= HARBORMASTER_MIN && top.length === 1 ? (top[0] as PlayerId) : null;
  if (next !== holder) {
    s.harbormaster = next;
    if (next !== null) log(draft, next, `${pn(draft, next)} became Harbormaster`);
  }
}
