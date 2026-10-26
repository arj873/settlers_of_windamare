/**
 * Trading with commodities (§3.7): bank / harbour ratios for every card kind, the Trade level-3
 * ability and Merchant Fleet (2:1), the merchant (2:1 for its hex's resource), and player trades
 * whose offer includes commodities (the commodity part rides along the base `trade` phase).
 */
import { MAX_TRADE_OFFERS_PER_TURN, RESOURCES } from '../../../engine/constants';
import { bankTradeRatio } from '../../../engine/actions/trade';
import { portsOf } from '../../../engine/selectors';
import type {
  GameState,
  PlayerId,
  Resource,
  ResourceCounts,
  TradeResponse,
} from '../../../engine/types';
import { bankCount, goodCount, levelOf, mainTurn } from './rules';
import {
  ABILITY_LEVEL,
  COMMODITIES,
  ckSlice,
  emptyCommodities,
  isCommodity,
  isGood,
  type CommodityCounts,
  type Good,
} from './state';

/** bankTradeRatio hook (resources): the merchant's hex resource and Merchant Fleet are 2:1. */
export function resourceRatio(state: GameState, p: PlayerId, r: Resource, base: number): number {
  const s = ckSlice(state);
  let ratio = base;
  const m = s.merchant;
  if (m && m.owner === p && state.board.hexes[m.hex]?.terrain === r) ratio = Math.min(ratio, 2);
  if (s.turn.fleet.includes(r)) ratio = Math.min(ratio, 2);
  return ratio;
}

/** Cards of `g` given per card received from the bank. */
export function giveRatio(state: GameState, p: PlayerId, g: Good): number {
  if (!isCommodity(g)) return bankTradeRatio(state, p, g);
  let ratio = portsOf(state, p).includes('generic') ? 3 : 4;
  if (levelOf(state, p, 'trade') >= ABILITY_LEVEL) ratio = 2;
  if (ckSlice(state).turn.fleet.includes(g)) ratio = 2;
  return ratio;
}

/** A bank trade involving a commodity (resource-only trades use the base bankTrade). */
export function bankTradeBlocker(state: GameState, p: PlayerId, give: unknown, receive: unknown) {
  const m = mainTurn(state, p);
  if (m) return m;
  if (!isGood(give) || !isGood(receive)) return 'invalid card';
  if (give === receive) return 'must trade for a different card';
  if (!isCommodity(give) && !isCommodity(receive)) return 'use the normal bank trade';
  const ratio = giveRatio(state, p, give);
  if (goodCount(state, p, give) < ratio) return `need ${ratio} ${give}`;
  if (bankCount(state, receive) < 1) return `the bank has no ${receive}`;
  return null;
}

// ---------------------------------------------------------------------------
// Player trades with commodities
// ---------------------------------------------------------------------------

export type GoodsBundle = Partial<Record<Good, number>>;

function isGoodsBundle(x: unknown): x is GoodsBundle {
  return (
    typeof x === 'object' &&
    x !== null &&
    !Array.isArray(x) &&
    Object.entries(x).every(
      ([k, v]) => isGood(k) && typeof v === 'number' && Number.isInteger(v) && v >= 0,
    )
  );
}

export function splitBundle(b: GoodsBundle): { res: ResourceCounts; com: CommodityCounts } {
  const res = { brick: 0, lumber: 0, wool: 0, grain: 0, ore: 0 };
  const com = emptyCommodities();
  for (const r of RESOURCES) res[r] = b[r] ?? 0;
  for (const c of COMMODITIES) com[c] = b[c] ?? 0;
  return { res, com };
}

export const holdsCommodities = (state: GameState, p: PlayerId, c: CommodityCounts): boolean =>
  COMMODITIES.every((k) => goodCount(state, p, k) >= c[k]);

/** Validate a commodity offer; returns the error or the parsed parts. */
export function parseOffer(
  state: GameState,
  p: PlayerId,
  give: unknown,
  want: unknown,
  to: unknown,
): string | { give: GoodsBundle; want: GoodsBundle; to: PlayerId[] } {
  const m = mainTurn(state, p);
  if (m) return m;
  if (state.turn.secondSettlerOf !== undefined)
    return 'the second settler may not trade with players';
  if (state.turn.tradeOffers >= MAX_TRADE_OFFERS_PER_TURN) {
    return `at most ${MAX_TRADE_OFFERS_PER_TURN} trade offers per turn`;
  }
  if (!isGoodsBundle(give) || !isGoodsBundle(want)) return 'invalid cards';
  const total = (b: GoodsBundle) => Object.values(b).reduce((a, n) => a + (n ?? 0), 0);
  if (total(give) === 0 || total(want) === 0) return 'both sides of a trade must be non-empty';
  const kinds = (b: GoodsBundle) => (Object.keys(b) as Good[]).filter((g) => (b[g] ?? 0) > 0);
  if (kinds(give).some((g) => kinds(want).includes(g))) return 'cannot give and want the same card';
  if (![...kinds(give), ...kinds(want)].some(isCommodity)) return 'use the normal trade offer';
  if (kinds(give).some((g) => goodCount(state, p, g) < (give[g] ?? 0))) {
    return 'you do not have the offered cards';
  }
  const n = state.players.length;
  if (
    !Array.isArray(to) ||
    to.length === 0 ||
    new Set(to).size !== to.length ||
    !to.every((q) => Number.isInteger(q) && q >= 0 && q < n && q !== p)
  ) {
    return 'offer must be addressed to other players';
  }
  return { give, want, to: to as PlayerId[] };
}

export function offerResponses(
  state: GameState,
  to: readonly PlayerId[],
): (TradeResponse | null)[] {
  return state.players.map((pl) => (to.includes(pl.id) ? 'pending' : null));
}
