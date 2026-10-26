/**
 * The Fishermen of Catan (docs/rules/traders-barbarians.md §2.2, §3.3, §4.5): the lake and the
 * fishing grounds pay fish tokens (settlement 1, city 2); fish buy actions; the old boot makes
 * its owner need 1 more VP.
 *
 * Choices made: fish are paid at random from the face-down pool; if the pool cannot cover the
 * whole roll, nobody gets fish (T5). At the 7-token cap a drawn token replaces the smallest held
 * one if it is bigger (the T5 "exchange", made automatic); the T6 once-per-turn wording is not
 * modelled. Fish are paid with whole tokens, the engine picks the smallest overpayment.
 */
import { RESOURCES } from '../../../engine/constants';
import { isCurrent, log } from '../../../engine/actions/common';
import { NO_ROBBER } from '../../../engine/expansions/ext';
import { canPlaceRoad } from '../../../engine/rules/placement';
import { Rng } from '../../../engine/rng';
import { piecesLeft, publicVictoryPoints } from '../../../engine/selectors';
import { hexVertices, topologyOf } from '../../../engine/topology';
import { hasRobber, roadsBlocked } from '../../../engine/variants';
import type {
  Action,
  DevCardType,
  GameState,
  HexId,
  PlayerId,
  Resource,
  VertexId,
} from '../../../engine/types';
import { handTotal, pn, stealResource, takeBank } from './common';
import {
  FISH_CAP,
  FISH_COST,
  FISH_TOKENS_34,
  FISH_TOKENS_56,
  FISH_USES,
  OLD_BOOT,
  fishOf,
  fishTotal,
  isTwo,
  tbBoard,
  type FishSlice,
  type FishUse,
} from './state';

export function initFish(n: number, rng: Rng): FishSlice {
  const tokens = n > 4 ? [...FISH_TOKENS_34, ...FISH_TOKENS_56] : [...FISH_TOKENS_34];
  // Catan for Two: each player starts with 5 fish (2x1, 2x2, 1x3) taken from the pool.
  const hands = Array.from({ length: n }, (): number[] => (n === 2 ? [1, 1, 2, 2, 3] : []));
  for (const h of hands) {
    for (const t of h) tokens.splice(tokens.indexOf(t), 1);
  }
  return { pool: rng.shuffle([...tokens, OLD_BOOT]), spent: [], hands, boot: null };
}

/**
 * Fish each player is owed for `roll`: fishing grounds and lakes (the robber blocks a lake; a
 * ground lying on a `blocked` water hex pays nothing: the pirate, T&B + Seafarers).
 */
export function fishOwed(state: GameState, roll: number, blocked: readonly HexId[] = []): number[] {
  const owed = state.players.map(() => 0);
  const b = state.pieces.buildings;
  const add = (v: VertexId) => {
    const bld = b[v];
    if (bld) owed[bld.owner] = (owed[bld.owner] ?? 0) + (bld.kind === 'city' ? 2 : 1);
  };
  const board = tbBoard(state);
  for (const g of board.grounds ?? []) {
    if (g.number !== roll || (g.hex !== undefined && blocked.includes(g.hex))) continue;
    for (const v of g.vertices) add(v);
  }
  const robber = hasRobber(state.settings) ? state.robber : null;
  for (const lake of board.lakes ?? []) {
    if (lake.hex === robber || !lake.numbers.includes(roll)) continue;
    for (const v of hexVertices(topologyOf(state), lake.hex)) add(v);
  }
  return owed;
}

/** Draw one token from the pool for `p` (refilling the pool from the spent tokens when it empties). */
function drawFish(draft: GameState, s: FishSlice, p: PlayerId, rng: Rng): void {
  const t = s.pool.pop();
  if (t === undefined) return;
  if (t === OLD_BOOT) {
    s.boot = p;
    log(draft, p, `${pn(draft, p)} fished up the old boot!`);
  } else {
    const hand = s.hands[p] ?? [];
    if (hand.length < FISH_CAP) {
      hand.push(t);
    } else {
      const low = Math.min(...hand);
      if (t > low) {
        hand.splice(hand.indexOf(low), 1, t);
        s.spent.push(low);
      } else {
        s.spent.push(t);
      }
    }
    s.hands[p] = hand;
  }
  if (s.pool.length === 0 && s.spent.length > 0) {
    s.pool = rng.shuffle(s.spent);
    s.spent = [];
  }
}

/** Pay the fish of a production roll; nobody gets fish if the pool cannot cover them all. */
export function payFish(draft: GameState, roll: number, blocked: readonly HexId[] = []): void {
  const owed = fishOwed(draft, roll, blocked);
  const total = owed.reduce((a, b) => a + b, 0);
  if (total === 0) return;
  const s = fishOf(draft);
  if (total > s.pool.length) {
    log(draft, null, 'Not enough fish in the pool: nobody gets fish');
    return;
  }
  const rng = new Rng(draft.rng);
  const n = draft.players.length;
  for (let i = 0; i < n; i++) {
    const p = (draft.turn.current + i) % n;
    for (let k = 0; k < (owed[p] ?? 0); k++) drawFish(draft, s, p, rng);
    if ((owed[p] ?? 0) > 0) log(draft, p, `${pn(draft, p)} caught ${owed[p]} fish`);
  }
  draft.rng = rng.state;
}

/** Second setup settlement on a fishing ground or the lake: 1 fish. */
export function setupFish(draft: GameState, p: PlayerId, v: VertexId): void {
  const board = tbBoard(draft);
  const t = topologyOf(draft);
  const onGround = (board.grounds ?? []).some((g) => g.vertices.includes(v));
  const onLake = (board.lakes ?? []).some((l) => hexVertices(t, l.hex).includes(v));
  if (!onGround && !onLake) return;
  const s = fishOf(draft);
  const rng = new Rng(draft.rng);
  drawFish(draft, s, p, rng);
  draft.rng = rng.state;
  log(draft, p, `${pn(draft, p)} caught a fish`);
}

// ---------------------------------------------------------------------------
// Fish actions
// ---------------------------------------------------------------------------

/** Catan for Two: the player with fewer VP pays 1 fish less per action. */
export function fishCost(state: GameState, p: PlayerId, use: FishUse): number {
  const base = FISH_COST[use];
  if (!isTwo(state)) return base;
  const other = 1 - p;
  return publicVictoryPoints(state, p) < publicVictoryPoints(state, other) ? base - 1 : base;
}

/** The tokens to pay `cost` with: smallest total ≥ cost, then fewest tokens. null if unaffordable. */
export function fishPayment(hand: readonly number[], cost: number): number[] | null {
  let best: number[] | null = null;
  let bestSum = Infinity;
  const n = hand.length;
  for (let mask = 1; mask < 1 << n; mask++) {
    const pick: number[] = [];
    for (let i = 0; i < n; i++) if (mask & (1 << i)) pick.push(hand[i] as number);
    const sum = fishTotal(pick);
    if (sum < cost) continue;
    if (sum < bestSum || (sum === bestSum && best !== null && pick.length < best.length)) {
      best = pick;
      bestSum = sum;
    }
  }
  return best;
}

function canAnyRoad(state: GameState, p: PlayerId): boolean {
  if (piecesLeft(state, p).road < 1 || roadsBlocked(state, p)) return false;
  return topologyOf(state).edges.some((e) => canPlaceRoad(state, p, e));
}

/** Why `p` cannot use fish for `use` now (victim / resource checked when given). */
export function fishBlocker(
  state: GameState,
  p: PlayerId,
  use: FishUse,
  victim?: unknown,
  resource?: unknown,
): string | null {
  const k = state.phase.kind;
  if (k !== 'preRoll' && k !== 'main') return 'fish are used on your own turn';
  if (!isCurrent(state, p) || state.turn.secondSettlerOf !== undefined) return 'not your turn';
  const cost = fishCost(state, p, use);
  if (fishTotal(fishOf(state).hands[p] ?? []) < cost) return `needs ${cost} fish`;
  switch (use) {
    case 'robber':
      return state.robber === NO_ROBBER ? 'the robber is not on the board' : null;
    case 'steal':
      if (typeof victim !== 'number' || victim === p || !state.players[victim]) {
        return 'pick another player';
      }
      return handTotal(state, victim) > 0 ? null : 'that player has no cards';
    case 'resource':
      if (!RESOURCES.includes(resource as Resource)) return 'pick a resource';
      return state.bank[resource as Resource] > 0 ? null : 'the bank has none';
    case 'road':
      return canAnyRoad(state, p) ? null : 'no road can be placed';
    case 'devCard':
      return state.devDeck.length > 0 ? null : 'no development cards left';
  }
}

export function useFish(
  draft: GameState,
  p: PlayerId,
  use: FishUse,
  victim?: PlayerId,
  resource?: Resource,
): void {
  const s = fishOf(draft);
  const hand = s.hands[p] ?? [];
  const pay = fishPayment(hand, fishCost(draft, p, use)) ?? [];
  for (const t of pay) hand.splice(hand.indexOf(t), 1);
  s.spent.push(...pay);
  const name = pn(draft, p);
  const resume = draft.phase.kind === 'preRoll' ? 'preRoll' : 'main';
  switch (use) {
    case 'robber':
      draft.robber = NO_ROBBER;
      log(draft, p, `${name} paid ${fishTotal(pay)} fish to chase the robber off the board`);
      break;
    case 'steal': {
      const v = victim as PlayerId;
      stealResource(draft, p, v);
      log(draft, p, `${name} paid fish to steal from ${pn(draft, v)}`);
      break;
    }
    case 'resource':
      takeBank(draft, p, resource as Resource);
      log(draft, p, `${name} paid fish for 1 ${resource as Resource}`);
      break;
    case 'road':
      draft.phase = { kind: 'roadBuilding', remaining: 1, resume };
      log(draft, p, `${name} paid fish for a free road`);
      break;
    case 'devCard': {
      const card = draft.devDeck.pop() as DevCardType;
      const pl = draft.players[p];
      if (pl) pl.newDevCards[card] += 1;
      log(draft, p, `${name} paid fish for a development card`);
      break;
    }
  }
}

export function giveBootBlocker(state: GameState, p: PlayerId, to: unknown): string | null {
  if (state.phase.kind !== 'main') return 'the boot is given away after your roll';
  if (!isCurrent(state, p) || state.turn.secondSettlerOf !== undefined) return 'not your turn';
  if (fishOf(state).boot !== p) return 'you do not have the old boot';
  if (typeof to !== 'number' || to === p || !state.players[to]) return 'pick another player';
  if (publicVictoryPoints(state, to) < publicVictoryPoints(state, p)) {
    return 'only to a player with at least as many points as you';
  }
  return null;
}

export function fishLegal(state: GameState): Action[] {
  const p = state.turn.current;
  const out: Action[] = [];
  const k = state.phase.kind;
  if ((k !== 'preRoll' && k !== 'main') || state.turn.secondSettlerOf !== undefined) return out;
  for (const use of FISH_USES) {
    if (use === 'steal') {
      for (const victim of state.players.map((x) => x.id)) {
        if (fishBlocker(state, p, use, victim) === null) {
          out.push({ type: 'tb/fish', player: p, use, victim } as unknown as Action);
        }
      }
    } else if (use === 'resource') {
      for (const resource of RESOURCES) {
        if (fishBlocker(state, p, use, undefined, resource) === null) {
          out.push({ type: 'tb/fish', player: p, use, resource } as unknown as Action);
        }
      }
    } else if (fishBlocker(state, p, use) === null) {
      out.push({ type: 'tb/fish', player: p, use } as unknown as Action);
    }
  }
  for (const to of state.players.map((x) => x.id)) {
    if (giveBootBlocker(state, p, to) === null) {
      out.push({ type: 'tb/giveBoot', player: p, to } as unknown as Action);
    }
  }
  return out;
}
