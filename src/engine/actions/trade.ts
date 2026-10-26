/**
 * OWNER: T3 (rules-trade).
 * bankTrade (main): give `ratio` of one resource for 1 of another. ratio = 2 with that
 *   resource's port, else 3 with a generic port, else 4 (see portsOf()). Bank must have it.
 * Player trading (main, current player only offers):
 *   offerTrade   -> phase trade{offer}; responses[p] = 'pending' for addressed p, else null.
 *                   give/want non-empty, disjoint resources, offerer must hold `give`.
 *                   `to`: non-empty, distinct, other players.
 *                   House rule: at most MAX_TRADE_OFFERS_PER_TURN offers per turn
 *                   (turn.tradeOffers, reset on endTurn), so offer/reject loops end.
 *   acceptTrade  -> addressed pending player marks 'accepted' (must hold `want` at accept time)
 *   rejectTrade  -> addressed pending player marks 'rejected'; when every addressed player
 *                   has rejected, the offer closes automatically -> main
 *   confirmTrade -> offerer executes with one accepted partner (both must still hold their
 *                   side) -> main
 *   cancelTrade  -> offerer withdraws -> main
 * legalActions note: offerTrade is open-ended; we return 1:1 offers to all other players.
 */
import { MAX_TRADE_OFFERS_PER_TURN, RESOURCES } from '../constants';
import { hookTradeRatio } from '../expansions/hooks';
import {
  addResources,
  hasResources,
  isResource,
  isValidBundle,
  subtractResources,
  toCounts,
  totalResources,
} from '../resources';
import { getPlayer, portsOf } from '../selectors';
import type {
  Action,
  GameState,
  PlayerId,
  Resource,
  ResourceCounts,
  TradeOffer,
  TradeResponse,
} from '../types';
import { type HandlerMap, type LegalGenerator, fail, isCurrent, log, ok } from './common';

/** Bank trade ratio for giving `give`: 2 (matching port), 3 (generic port) or 4. */
/** 2 / 3 / 4 from harbors, then changed by expansions (bankTradeRatio hook). */
export function bankTradeRatio(state: GameState, player: PlayerId, give: Resource): number {
  const ports = portsOf(state, player);
  const base = ports.includes(give) ? 2 : ports.includes('generic') ? 3 : 4;
  return hookTradeRatio(state, player, give, base);
}

function canBankTrade(
  state: GameState,
  player: PlayerId,
  give: unknown,
  receive: unknown,
): string | null {
  if (state.phase.kind !== 'main') return 'can only trade in the main phase';
  if (!isCurrent(state, player)) return 'not your turn';
  if (!isResource(give) || !isResource(receive)) return 'invalid resource';
  if (give === receive) return 'must trade for a different resource';
  const ratio = bankTradeRatio(state, player, give);
  if (getPlayer(state, player).resources[give] < ratio) return `need ${ratio} ${give}`;
  if (state.bank[receive] < 1) return `the bank has no ${receive}`;
  return null;
}

function describe(counts: ResourceCounts): string {
  const parts = RESOURCES.filter((r) => counts[r] > 0).map((r) => `${counts[r]} ${r}`);
  return parts.join(', ');
}

/** House rule: the current player may make MAX_TRADE_OFFERS_PER_TURN offers per turn. */
function canOfferMore(state: GameState): boolean {
  return state.turn.tradeOffers < MAX_TRADE_OFFERS_PER_TURN;
}

function tradePhase(state: GameState): TradeOffer | null {
  return state.phase.kind === 'trade' ? state.phase.offer : null;
}

/** Offerer's side and partner's side are both still in hand. */
function canExecute(state: GameState, offer: TradeOffer, partner: PlayerId): boolean {
  return (
    hasResources(getPlayer(state, offer.from).resources, offer.give) &&
    hasResources(getPlayer(state, partner).resources, offer.want)
  );
}

function respond(
  draft: GameState,
  player: PlayerId,
  response: Exclude<TradeResponse, 'pending'>,
): string | null {
  const offer = tradePhase(draft);
  if (!offer) return 'no open trade offer';
  if (offer.responses[player] !== 'pending') return 'you have nothing to respond to';
  if (response === 'accepted' && !hasResources(getPlayer(draft, player).resources, offer.want)) {
    return 'you do not have the requested resources';
  }
  offer.responses[player] = response;
  return null;
}

export const tradeHandlers: HandlerMap<
  'bankTrade' | 'offerTrade' | 'acceptTrade' | 'rejectTrade' | 'cancelTrade' | 'confirmTrade'
> = {
  bankTrade: (draft, { player, give, receive }) => {
    const err = canBankTrade(draft, player, give, receive);
    if (err) return fail(err);
    const ratio = bankTradeRatio(draft, player, give);
    const p = getPlayer(draft, player);
    p.resources[give] -= ratio;
    p.resources[receive] += 1;
    draft.bank[give] += ratio;
    draft.bank[receive] -= 1;
    log(draft, player, `${p.name} traded ${ratio} ${give} for 1 ${receive} with the bank`);
    return ok(draft);
  },

  offerTrade: (draft, { player, give, want, to }) => {
    if (draft.phase.kind !== 'main') return fail('can only trade in the main phase');
    if (!isCurrent(draft, player)) return fail('not your turn');
    if (draft.turn.secondSettlerOf !== undefined) {
      return fail('the second settler may not trade with other players');
    }
    if (!canOfferMore(draft)) {
      return fail(`at most ${MAX_TRADE_OFFERS_PER_TURN} trade offers per turn`);
    }
    if (!isValidBundle(give) || !isValidBundle(want)) return fail('invalid resources');
    const giveC = toCounts(give);
    const wantC = toCounts(want);
    if (totalResources(giveC) === 0 || totalResources(wantC) === 0) {
      return fail('both sides of a trade must be non-empty');
    }
    if (RESOURCES.some((r) => giveC[r] > 0 && wantC[r] > 0)) {
      return fail('cannot give and want the same resource');
    }
    if (!hasResources(getPlayer(draft, player).resources, giveC)) {
      return fail('you do not have the offered resources');
    }
    const n = draft.players.length;
    if (
      !Array.isArray(to) ||
      to.length === 0 ||
      new Set(to).size !== to.length ||
      !to.every((p) => Number.isInteger(p) && p >= 0 && p < n && p !== player)
    ) {
      return fail('offer must be addressed to other players');
    }
    const responses: (TradeResponse | null)[] = draft.players.map((p) =>
      to.includes(p.id) ? 'pending' : null,
    );
    draft.phase = { kind: 'trade', offer: { from: player, give: giveC, want: wantC, responses } };
    draft.turn.tradeOffers += 1;
    log(
      draft,
      player,
      `${getPlayer(draft, player).name} offers ${describe(giveC)} for ${describe(wantC)}`,
    );
    return ok(draft);
  },

  acceptTrade: (draft, { player }) => {
    const err = respond(draft, player, 'accepted');
    if (err) return fail(err);
    log(draft, player, `${getPlayer(draft, player).name} accepted the offer`);
    return ok(draft);
  },

  rejectTrade: (draft, { player }) => {
    const err = respond(draft, player, 'rejected');
    if (err) return fail(err);
    log(draft, player, `${getPlayer(draft, player).name} rejected the offer`);
    const offer = tradePhase(draft) as TradeOffer;
    if (offer.responses.every((r) => r === null || r === 'rejected')) {
      draft.phase = { kind: 'main' };
      log(draft, null, 'Everyone rejected the offer');
    }
    return ok(draft);
  },

  cancelTrade: (draft, { player }) => {
    const offer = tradePhase(draft);
    if (!offer) return fail('no open trade offer');
    if (offer.from !== player) return fail('only the offerer can cancel');
    draft.phase = { kind: 'main' };
    log(draft, player, `${getPlayer(draft, player).name} withdrew the offer`);
    return ok(draft);
  },

  confirmTrade: (draft, { player, partner }) => {
    const offer = tradePhase(draft);
    if (!offer) return fail('no open trade offer');
    if (offer.from !== player) return fail('only the offerer can confirm');
    if (typeof partner !== 'number' || offer.responses[partner] !== 'accepted') {
      return fail('that player has not accepted');
    }
    if (!canExecute(draft, offer, partner)) return fail('a side no longer has the resources');
    const me = getPlayer(draft, player);
    const them = getPlayer(draft, partner);
    me.resources = addResources(subtractResources(me.resources, offer.give), offer.want);
    them.resources = addResources(subtractResources(them.resources, offer.want), offer.give);
    draft.phase = { kind: 'main' };
    log(
      draft,
      player,
      `${me.name} traded ${describe(offer.give)} to ${them.name} for ${describe(offer.want)}`,
    );
    return ok(draft);
  },
};

export const tradeLegal: LegalGenerator = (state: GameState): Action[] => {
  const out: Action[] = [];
  const offer = tradePhase(state);

  if (offer) {
    out.push({ type: 'cancelTrade', player: offer.from });
    offer.responses.forEach((r, p) => {
      if (r === 'accepted' && canExecute(state, offer, p)) {
        out.push({ type: 'confirmTrade', player: offer.from, partner: p });
      }
      if (r === 'pending') {
        if (hasResources(getPlayer(state, p).resources, offer.want)) {
          out.push({ type: 'acceptTrade', player: p });
        }
        out.push({ type: 'rejectTrade', player: p });
      }
    });
    return out;
  }

  if (state.phase.kind !== 'main') return out;
  const player = state.turn.current;
  const hand = getPlayer(state, player).resources;
  const others = state.players.filter((p) => p.id !== player).map((p) => p.id);
  const offers = canOfferMore(state) && state.turn.secondSettlerOf === undefined;
  for (const give of RESOURCES) {
    for (const receive of RESOURCES) {
      if (canBankTrade(state, player, give, receive) === null) {
        out.push({ type: 'bankTrade', player, give, receive });
      }
      if (offers && give !== receive && hand[give] > 0) {
        out.push({
          type: 'offerTrade',
          player,
          give: { [give]: 1 },
          want: { [receive]: 1 },
          to: others,
        });
      }
    }
  }
  return out;
};
