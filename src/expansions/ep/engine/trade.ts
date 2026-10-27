/**
 * Player trades with gold (docs/rules/explorers-pirates.md §3.3; M6 p. 5: "When trading with
 * other players, you may trade any combination of resources and coins"). `ep/offerTrade` opens
 * the base trade phase with the resource parts; the gold parts wait in the slice (`trade`) and
 * move when the base confirmTrade executes (overrides below), like C&K's commodity offers.
 */
import { MAX_TRADE_OFFERS_PER_TURN, RESOURCES } from '../../../engine/constants';
import { fail, log, ok } from '../../../engine/actions/common';
import type { Override } from '../../../engine/expansions/types';
import { playerName } from '../../../engine/rules/text';
import { hasResources, isValidBundle, toCounts, totalResources } from '../../../engine/resources';
import type {
  Action,
  ActionResult,
  GameState,
  PlayerId,
  ResourceCounts,
  TradeResponse,
} from '../../../engine/types';
import { epSlice, type GoldOffer } from './state';

export const OFFER_TRADE = 'ep/offerTrade';

const isCount = (x: unknown): x is number =>
  typeof x === 'number' && Number.isInteger(x) && x >= 0 && x <= 99;

const goldOf = (state: GameState, p: PlayerId) => epSlice(state).gold[p] ?? 0;

/** The gold of the open offer (null: none, or the offer carries no gold). */
export function goldOffer(state: Pick<GameState, 'ext' | 'phase'>): GoldOffer | null {
  if (state.phase.kind !== 'trade') return null;
  return epSlice(state).trade ?? null;
}

/** Why `p` may not make a player trade offer now (the base rules), or null. */
export function offerTurnBlocker(state: GameState, p: PlayerId): string | null {
  if (state.phase.kind !== 'main') return 'can only trade in the main phase';
  if (state.turn.current !== p) return 'not your turn';
  if (epSlice(state).turn.movement) return 'no trading in the Movement phase';
  if (state.turn.secondSettlerOf !== undefined) {
    return 'the second player of a pair may not trade with other players';
  }
  if (state.turn.tradeOffers >= MAX_TRADE_OFFERS_PER_TURN) {
    return `at most ${MAX_TRADE_OFFERS_PER_TURN} trade offers per turn`;
  }
  return null;
}

/** Validate the addressees of an offer by `p`. */
export function offerTargets(state: GameState, p: PlayerId, to: unknown): PlayerId[] | null {
  const n = state.players.length;
  if (
    !Array.isArray(to) ||
    to.length === 0 ||
    new Set(to).size !== to.length ||
    !to.every((q) => Number.isInteger(q) && q >= 0 && q < n && q !== p)
  ) {
    return null;
  }
  return to as PlayerId[];
}

export const offerResponses = (state: GameState, to: readonly PlayerId[]) =>
  state.players.map((pl): TradeResponse | null => (to.includes(pl.id) ? 'pending' : null));

interface ParsedOffer {
  give: ResourceCounts;
  want: ResourceCounts;
  gold: GoldOffer;
  to: PlayerId[];
}

/** Validate an `ep/offerTrade`: resources and gold on either side, gold on at least one. */
export function parseGoldOffer(state: GameState, a: Record<string, unknown>): string | ParsedOffer {
  const p = a['player'] as PlayerId;
  const t = offerTurnBlocker(state, p);
  if (t) return t;
  const give = a['give'] ?? {};
  const want = a['want'] ?? {};
  const giveGold = a['giveGold'] ?? 0;
  const wantGold = a['wantGold'] ?? 0;
  if (!isValidBundle(give) || !isValidBundle(want)) return 'invalid resources';
  if (!isCount(giveGold) || !isCount(wantGold)) return 'invalid gold';
  if (giveGold === 0 && wantGold === 0) return 'use the normal trade offer';
  if (giveGold > 0 && wantGold > 0) return 'cannot give and want gold';
  const g = toCounts(give);
  const w = toCounts(want);
  if (totalResources(g) + giveGold === 0 || totalResources(w) + wantGold === 0) {
    return 'both sides of a trade must be non-empty';
  }
  if (RESOURCES.some((r) => g[r] > 0 && w[r] > 0)) return 'cannot give and want the same resource';
  const hand = state.players[p]?.resources;
  if (!hand || !hasResources(hand, g) || goldOf(state, p) < giveGold) {
    return 'you do not have what you offer';
  }
  const to = offerTargets(state, p, a['to']);
  if (!to) return 'offer must be addressed to other players';
  return { give: g, want: w, gold: { give: giveGold, want: wantGold }, to };
}

const describe = (c: ResourceCounts, gold: number): string =>
  [
    ...RESOURCES.filter((r) => c[r] > 0).map((r) => `${c[r]} ${r}`),
    ...(gold > 0 ? [`${gold} gold`] : []),
  ].join(', ');

export function offerGoldTrade(draft: GameState, a: Record<string, unknown>): ActionResult {
  const offer = parseGoldOffer(draft, a);
  if (typeof offer === 'string') return fail(offer);
  const p = a['player'] as PlayerId;
  draft.phase = {
    kind: 'trade',
    offer: {
      from: p,
      give: offer.give,
      want: offer.want,
      responses: offerResponses(draft, offer.to),
    },
  };
  epSlice(draft).trade = offer.gold;
  draft.turn.tradeOffers += 1;
  log(
    draft,
    p,
    `${playerName(draft, p)} offers ${describe(offer.give, offer.gold.give)} for ${describe(offer.want, offer.gold.want)}`,
  );
  return ok(draft);
}

/** A few representative gold offers for the legal list (the UI composes any offer). */
export function goldOfferLegal(state: GameState, p: PlayerId): Action[] {
  if (offerTurnBlocker(state, p) !== null) return [];
  const hand = state.players[p]?.resources;
  if (!hand) return [];
  const to = state.players.filter((x) => x.id !== p).map((x) => x.id);
  const out: Action[] = [];
  const act = (x: Record<string, unknown>) =>
    ({ type: OFFER_TRADE, player: p, to, ...x }) as Action;
  for (const r of RESOURCES) {
    if (goldOf(state, p) > 0) out.push(act({ giveGold: 1, want: { [r]: 1 } }));
    if (hand[r] > 0) out.push(act({ give: { [r]: 1 }, wantGold: 1 }));
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// The base trade phase with gold parts
// ---------------------------------------------------------------------------------------------

export const tradeOverrides: {
  acceptTrade: Override<'acceptTrade'>;
  confirmTrade: Override<'confirmTrade'>;
} = {
  acceptTrade: (draft, action, next) => {
    const g = goldOffer(draft);
    if (g && goldOf(draft, action.player) < g.want)
      return fail('you do not have the gold asked for');
    return next(draft, action);
  },
  confirmTrade: (draft, action, next) => {
    const g = goldOffer(draft);
    if (g) {
      if (goldOf(draft, action.player) < g.give) return fail('you no longer have the gold');
      if (typeof action.partner !== 'number' || goldOf(draft, action.partner) < g.want) {
        return fail('your partner no longer has the gold');
      }
    }
    const offer = draft.phase.kind === 'trade' ? draft.phase.offer : null;
    const r = next(draft, action);
    if (r.ok && g && offer) {
      const gold = epSlice(draft).gold;
      const net = g.want - g.give;
      gold[action.player] = (gold[action.player] ?? 0) + net;
      gold[action.partner] = (gold[action.partner] ?? 0) - net;
      // The base line names the resources only ("traded  to X for "): add the gold.
      const line = draft.log.at(-1);
      if (line) {
        line.text = `${playerName(draft, action.player)} traded ${describe(offer.give, g.give)} to ${playerName(draft, action.partner)} for ${describe(offer.want, g.want)}`;
      }
    }
    return r;
  },
};

/** Drop accept / confirm answers the gold parts make impossible. */
export function goldTradeAllowed(state: GameState, a: Action): boolean {
  const g = goldOffer(state);
  if (!g) return true;
  if (a.type === 'acceptTrade') return goldOf(state, a.player) >= g.want;
  if (a.type === 'confirmTrade') {
    return goldOf(state, a.player) >= g.give && goldOf(state, a.partner) >= g.want;
  }
  return true;
}
