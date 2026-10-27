/**
 * Catan for Two + Cities & Knights (catan.com 2025 sheet "CATAN for Two — Combining with Cities
 * & Knights"; docs/rules/combos.md §11, engine status per rule). C&K at 2 players with T&B's
 * Catan for Two (neutral players, trade tokens, two rolls a turn) and the sheet's changes:
 * neutral knights, knights turned in for tokens, the two Forced Trades, Alchemy before the first
 * roll, Treason against a neutral.
 *
 * Composition order (`before`): twock, ck, tb. The second Roll Dice phase is T&B's (its
 * `rollDice` re-rolls the production dice until they differ from the first roll; C&K rolls the
 * event die in both). Neutral knights are C&K knights whose owner is no seat (2 and 3: neutral
 * 0 and 1): C&K's own rules then treat them as "another player's knight" (they block routes, are
 * displaced and Intrigue'd); `routeEdges` gives them the neutral's roads (where a displaced one
 * retreats), and the current player moves them for the neutral.
 */
import { RESOURCES } from '../../../engine/constants';
import { fail, isCurrent, log, ok } from '../../../engine/actions/common';
import { stealSecret } from '../../../engine/rules/text';
import { cloneJson } from '../../../engine/expansions/ext';
import type { ExpansionModule, ExtHandler, ExtWrap } from '../../../engine/expansions/types';
import { touchesLand } from '../../../engine/rules/placement';
import { cardsInHand } from '../../../engine/selectors';
import { topologyOf, vertexEdges } from '../../../engine/topology';
import type { Action, GameState, Phase, PlayerId, VertexId } from '../../../engine/types';
import {
  CK,
  COMMODITIES,
  KNIGHTS_PER_LEVEL,
  bundleSize,
  ckSlice,
  deserterLevel,
  deserterSpots,
  holdsGoods,
  isEmptyVertex,
  isGoodsBundle,
  moveBundle,
  moveTargets,
  phaseOf as ckPhaseOf,
  stealRandom,
  type CommodityBundle,
  type Good,
  type Knight,
  type KnightLevel,
} from '../../ck/engine';
import { NEUTRAL_NAMES, SC_BASE, TB, tbSlice, tokenPrice, twoOf } from '../../tb/engine';
import { earnTokens, neutralFollowUp } from '../../tb/engine/two';
import { pn } from '../../tb/engine/common';

export const TWOCK = 'twock';
export const TWOCK_MODE = 'two+ck';
export const TWOCK_VP = 13;
/** The resource-and-commodity Forced Trade costs twice the normal price (the sheet). */
export const GOODS_TRADE_FACTOR = 2;

export interface TwockSlice {
  v: 1;
}

export type TwockPhase =
  /** Build the neutral knight that follows a recruit, or promote one after a promotion. */
  | { kind: 'twock/neutral'; step: 'recruit' | 'promote'; resume: Phase }
  /** The resource-and-commodity Forced Trade: give `count` cards back. */
  | { kind: 'twock/forcedGive'; count: number; resume: 'preRoll' | 'main' };

export type TwockAction =
  | { type: 'twock/neutralKnight'; player: PlayerId; vertex: VertexId; neutral: 0 | 1 }
  | { type: 'twock/neutralPromote'; player: PlayerId; vertex: VertexId }
  | { type: 'twock/relocate'; player: PlayerId; vertex: VertexId }
  | { type: 'twock/deserterNeutral'; player: PlayerId; neutral: 0 | 1 }
  | { type: 'twock/knightForTokens'; player: PlayerId; vertex: VertexId }
  | { type: 'twock/forcedTrade'; player: PlayerId }
  | {
      type: 'twock/forcedGive';
      player: PlayerId;
      resources: Partial<Record<string, number>>;
      commodities: CommodityBundle;
    };

const asPhase = (p: TwockPhase): Phase => p as unknown as Phase;
/** The phase as one of ours (other kinds: check `kind` first). */
const twockPhase = (state: GameState) => state.phase as unknown as TwockPhase;

// ---------------------------------------------------------------------------------------------
// Neutral knights
// ---------------------------------------------------------------------------------------------

/** The C&K owner id of neutral `i` (no seat: after the two players). */
export const neutralOwner = (state: Pick<GameState, 'players'>, i: 0 | 1): PlayerId =>
  state.players.length + i;
/** Which neutral owns a knight of owner `o` (null: a player). */
export function neutralOf(state: Pick<GameState, 'players'>, o: PlayerId): 0 | 1 | null {
  const i = o - state.players.length;
  return i === 0 || i === 1 ? i : null;
}

const knightsOf = (state: GameState, owner: PlayerId) =>
  (Object.entries(ckSlice(state).knights) as [VertexId, Knight][]).filter(
    ([, k]) => k.owner === owner,
  );
const onBoard = (state: GameState, owner: PlayerId, level: KnightLevel) =>
  knightsOf(state, owner).filter(([, k]) => k.level === level).length;

/**
 * Where neutral `i` may recruit a knight: an empty land intersection on one of its roads (C&K's
 * placement for the neutral's network: its roads always join its settlements).
 */
export function neutralKnightSpots(state: GameState, i: 0 | 1): VertexId[] {
  if (onBoard(state, neutralOwner(state, i), 1) >= KNIGHTS_PER_LEVEL) return [];
  const roads = new Set(twoOf(state).neutrals[i].roads);
  const t = topologyOf(state);
  return t.vertices
    .filter(
      (v) =>
        isEmptyVertex(state, v) &&
        touchesLand(state, v) &&
        vertexEdges(t, v).some((e) => roads.has(e)),
    )
    .sort();
}

/** Neutral basic knights that may become strong (a strong one left in that neutral's supply). */
export function neutralPromotions(state: GameState): VertexId[] {
  const out: VertexId[] = [];
  for (const i of [0, 1] as const) {
    const o = neutralOwner(state, i);
    if (onBoard(state, o, 2) >= KNIGHTS_PER_LEVEL) continue;
    for (const [v, k] of knightsOf(state, o)) if (k.level === 1) out.push(v);
  }
  return out.sort();
}

/** After `p`'s recruit / promotion: the neutral step, a neutral road instead, or nothing. */
function neutralStep(draft: GameState, step: 'recruit' | 'promote'): void {
  const resume = draft.phase;
  if (step === 'promote') {
    if (neutralPromotions(draft).length > 0) {
      draft.phase = asPhase({ kind: 'twock/neutral', step, resume });
    }
    return;
  }
  if (neutralKnightSpots(draft, 0).length + neutralKnightSpots(draft, 1).length > 0) {
    draft.phase = asPhase({ kind: 'twock/neutral', step, resume });
    return;
  }
  // "If there are no valid placements for a neutral knight, then build a neutral road instead."
  const road = neutralFollowUp(draft, 'road', resume);
  if (road) draft.phase = road as unknown as Phase;
}

const neutralKnight: ExtHandler = (draft, action) => {
  const ph = twockPhase(draft);
  const a = action as unknown as Extract<TwockAction, { type: 'twock/neutralKnight' }>;
  if (ph.kind !== 'twock/neutral' || ph.step !== 'recruit') return fail('no neutral knight now');
  if (!isCurrent(draft, a.player)) return fail('not your turn');
  if (
    (a.neutral !== 0 && a.neutral !== 1) ||
    !neutralKnightSpots(draft, a.neutral).includes(a.vertex)
  ) {
    return fail('the neutral knight cannot go there');
  }
  ckSlice(draft).knights[a.vertex] = {
    owner: neutralOwner(draft, a.neutral),
    level: 1,
    active: false,
    activatedOn: null,
    promotedOn: null,
  };
  log(draft, a.player, `${NEUTRAL_NAMES[a.neutral]} got a knight`);
  draft.phase = ph.resume;
  return ok(draft);
};

const neutralPromote: ExtHandler = (draft, action) => {
  const ph = twockPhase(draft);
  const v = action['vertex'];
  if (ph.kind !== 'twock/neutral' || ph.step !== 'promote') return fail('no neutral promotion now');
  if (!isCurrent(draft, action.player)) return fail('not your turn');
  if (typeof v !== 'string' || !neutralPromotions(draft).includes(v as VertexId)) {
    return fail('that neutral knight cannot be promoted');
  }
  const k = ckSlice(draft).knights[v as VertexId] as Knight;
  k.level = 2;
  log(draft, action.player, `${NEUTRAL_NAMES[neutralOf(draft, k.owner) ?? 0]} got a strong knight`);
  draft.phase = ph.resume;
  return ok(draft);
};

/** C&K's relocation of a displaced neutral knight (its owner is no seat): the current player. */
function neutralRelocation(
  state: GameState,
): { from: VertexId; knight: Knight; spots: VertexId[] } | null {
  const ph = ckPhaseOf(state) as unknown as {
    kind: string;
    player?: PlayerId;
    from?: VertexId;
    knight?: Knight;
  };
  if (
    ph.kind !== 'ck/relocate' ||
    ph.player === undefined ||
    neutralOf(state, ph.player) === null
  ) {
    return null;
  }
  const from = ph.from as VertexId;
  return { from, knight: ph.knight as Knight, spots: moveTargets(state, ph.player, from) };
}

const relocate: ExtHandler = (draft, action) => {
  const r = neutralRelocation(draft);
  const v = action['vertex'];
  if (!r) return fail('no neutral knight to move');
  if (!isCurrent(draft, action.player)) return fail('not your turn');
  if (typeof v !== 'string' || !r.spots.includes(v as VertexId)) return fail('it cannot go there');
  ckSlice(draft).knights[v as VertexId] = { ...r.knight };
  log(
    draft,
    action.player,
    `${NEUTRAL_NAMES[neutralOf(draft, r.knight.owner) ?? 0]}'s knight retreated`,
  );
  draft.phase = { kind: 'main' };
  return ok(draft);
};

// ---------------------------------------------------------------------------------------------
// Treason (the Deserter) against a neutral: its weakest knight
// ---------------------------------------------------------------------------------------------

type DeserterPhase = {
  kind: 'ck/card';
  card: 'deserter';
  victim: PlayerId | null;
  removed: Knight | null;
};
const deserterPhase = (state: GameState): DeserterPhase | null => {
  const ph = ckPhaseOf(state) as unknown as { kind: string; card?: string };
  return ph.kind === 'ck/card' && ph.card === 'deserter' ? (ph as DeserterPhase) : null;
};

/** The weakest knight of neutral `i` (the sheet), first by vertex on a tie. */
function weakest(state: GameState, i: 0 | 1): [VertexId, Knight] | null {
  const list = knightsOf(state, neutralOwner(state, i)).sort(
    ([a, x], [b, y]) => x.level - y.level || (a < b ? -1 : 1),
  );
  return list[0] ?? null;
}

const deserterNeutral: ExtHandler = (draft, action) => {
  const ph = deserterPhase(draft);
  const i = action['neutral'];
  if (!ph || ph.victim !== null) return fail('no Treason step');
  if (!isCurrent(draft, action.player)) return fail('not your turn');
  const w = i === 0 || i === 1 ? weakest(draft, i) : null;
  if (!w) return fail('that neutral player has no knight');
  const [v, k] = w;
  Reflect.deleteProperty(ckSlice(draft).knights, v);
  log(draft, action.player, `${NEUTRAL_NAMES[i as 0 | 1]}'s knight deserted`);
  const level = deserterLevel(draft, action.player, k.level);
  if (level === null || deserterSpots(draft, action.player).length === 0) {
    draft.phase = { kind: 'main' };
    return ok(draft);
  }
  draft.phase = {
    ...ph,
    victim: k.owner,
    removed: { ...k, owner: action.player, level },
  } as unknown as Phase;
  return ok(draft);
};

// ---------------------------------------------------------------------------------------------
// Trade tokens: a knight turned in; the resource-and-commodity Forced Trade
// ---------------------------------------------------------------------------------------------

function tokenTurn(state: GameState, p: PlayerId): string | null {
  const k = state.phase.kind;
  if (k !== 'preRoll' && k !== 'main')
    return 'only on your turn, before rolling or in the main phase';
  if (!isCurrent(state, p)) return 'not your turn';
  return null;
}

export function knightForTokensBlocker(state: GameState, p: PlayerId, v: unknown): string | null {
  const t = tokenTurn(state, p);
  if (t) return t;
  const two = twoOf(state);
  if (two.knightTraded) return 'one knight a turn';
  if (two.supply < 1) return 'no trade tokens left in the supply';
  const k = typeof v === 'string' ? ckSlice(state).knights[v as VertexId] : undefined;
  return k && k.owner === p ? null : 'pick one of your knights';
}

const knightForTokens: ExtHandler = (draft, action) => {
  const v = action['vertex'];
  const err = knightForTokensBlocker(draft, action.player, v);
  if (err) return fail(err);
  const k = ckSlice(draft).knights[v as VertexId] as Knight;
  Reflect.deleteProperty(ckSlice(draft).knights, v as VertexId);
  twoOf(draft).knightTraded = true;
  // A basic knight 1 token, strong 2, mighty 3 (what the supply still has).
  earnTokens(draft, action.player, k.level, 'removed a knight');
  return ok(draft);
};

export const goodsTradePrice = (state: GameState, p: PlayerId): number =>
  GOODS_TRADE_FACTOR * tokenPrice(state, p);

export function goodsTradeBlocker(state: GameState, p: PlayerId): string | null {
  const t = tokenTurn(state, p);
  if (t) return t;
  const two = twoOf(state);
  if (two.tokenUsed) return 'one token action per turn';
  const price = goodsTradePrice(state, p);
  if ((two.tokens[p] ?? 0) < price) return `needs ${price} tokens`;
  return cardsInHand(state, 1 - p) > 0 ? null : 'your opponent has no cards';
}

const forcedTrade: ExtHandler = (draft, action) => {
  const p = action.player;
  const err = goodsTradeBlocker(draft, p);
  if (err) return fail(err);
  const two = twoOf(draft);
  const price = goodsTradePrice(draft, p);
  two.tokens[p] = (two.tokens[p] ?? 0) - price;
  two.supply += price;
  two.tokenUsed = true;
  const cards = [stealRandom(draft, p, 1 - p), stealRandom(draft, p, 1 - p)];
  const taken = cards.filter((c) => c !== null).length;
  log(
    draft,
    p,
    `${pn(draft, p)} forced a trade (resources and commodities): took ${taken} card${taken === 1 ? '' : 's'}`,
    stealSecret(draft, p, 1 - p, cards, ' (forced trade)'),
  );
  const count = Math.min(2, cardsInHand(draft, p));
  const resume = draft.phase.kind === 'preRoll' ? 'preRoll' : 'main';
  if (count > 0) draft.phase = asPhase({ kind: 'twock/forcedGive', count, resume });
  return ok(draft);
};

const forcedGive: ExtHandler = (draft, action) => {
  const ph = twockPhase(draft);
  const a = action as unknown as Extract<TwockAction, { type: 'twock/forcedGive' }>;
  if (ph.kind !== 'twock/forcedGive') return fail('nothing to give');
  if (!isCurrent(draft, a.player)) return fail('not your turn');
  const res = a.resources ?? {};
  const com = a.commodities ?? {};
  if (!isGoodsBundle(res, com) || bundleSize(res, com) !== ph.count) {
    return fail(`give exactly ${ph.count} cards`);
  }
  if (!holdsGoods(draft, a.player, res, com)) return fail('you do not have those cards');
  moveBundle(draft, a.player, 1 - a.player, res, com);
  log(
    draft,
    a.player,
    `${pn(draft, a.player)} gave ${ph.count} card${ph.count > 1 ? 's' : ''} back`,
  );
  draft.phase = { kind: ph.resume };
  return ok(draft);
};

/** Every way to give `count` (1-2) of `p`'s cards (resources and commodities). */
function giveOptions(state: GameState, p: PlayerId, count: number): Action[] {
  const goods: Good[] = [...RESOURCES, ...COMMODITIES];
  const have = (g: Good) =>
    (RESOURCES as readonly string[]).includes(g)
      ? (state.players[p]?.resources[g as (typeof RESOURCES)[number]] ?? 0)
      : (ckSlice(state).players[p]?.commodities[g as (typeof COMMODITIES)[number]] ?? 0);
  const picks: Good[][] = [];
  goods.forEach((a, i) => {
    if (have(a) < 1) return;
    if (count === 1) picks.push([a]);
    else
      for (const b of goods.slice(i)) if (a === b ? have(a) >= 2 : have(b) >= 1) picks.push([a, b]);
  });
  return picks.map((pick) => {
    const resources: Record<string, number> = {};
    const commodities: Record<string, number> = {};
    for (const g of pick) {
      const into = (RESOURCES as readonly string[]).includes(g) ? resources : commodities;
      into[g] = (into[g] ?? 0) + 1;
    }
    return { type: 'twock/forcedGive', player: p, resources, commodities } as unknown as Action;
  });
}

// ---------------------------------------------------------------------------------------------
// Wraps: neutral steps after a recruit / promotion, Alchemy before the first roll
// ---------------------------------------------------------------------------------------------

const firstRollDone = (state: GameState) => (tbSlice(state).two?.rolls ?? 0) >= 1;

/** Promotions of `p`'s basic knights to strong between `before` and `after`. */
const levelAt = (state: GameState, v: unknown) =>
  typeof v === 'string' ? ckSlice(state).knights[v as VertexId] : undefined;

function afterPromotion(draft: GameState, v: unknown, was: KnightLevel | undefined) {
  const k = levelAt(draft, v);
  if (was === 1 && k?.level === 2 && neutralOf(draft, k.owner) === null)
    neutralStep(draft, 'promote');
}

const wraps: Record<`${string}/${string}`, ExtWrap> = {
  'ck/buildKnight': (draft, action, next) => {
    const r = next(draft, action);
    if (r.ok) neutralStep(draft, 'recruit');
    return r;
  },
  'ck/promoteKnight': (draft, action, next) => {
    const was = levelAt(draft, action['vertex'])?.level;
    const r = next(draft, action);
    if (r.ok) afterPromotion(draft, action['vertex'], was);
    return r;
  },
  // The Smith's free promotions count as promotions (ours); other picks pass through.
  'ck/pickVertex': (draft, action, next) => {
    const ph = ckPhaseOf(draft) as unknown as { kind: string; card?: string };
    const smith = ph.kind === 'ck/card' && ph.card === 'smith';
    const was = levelAt(draft, action['vertex'])?.level;
    const r = next(draft, action);
    if (r.ok && smith) afterPromotion(draft, action['vertex'], was);
    return r;
  },
  // "Alchemy: You may only play this card at the beginning of your turn, before the first of
  // your Roll Dice phases."
  'ck/alchemist': (draft, action, next) =>
    firstRollDone(draft)
      ? fail('Alchemy is played before the first roll only')
      : next(draft, action),
};

// ---------------------------------------------------------------------------------------------
// Legal actions
// ---------------------------------------------------------------------------------------------

function legal(state: GameState): Action[] {
  const p = state.turn.current;
  const out: Action[] = [];
  const add = (a: TwockAction) => out.push(a as unknown as Action);
  const ph = twockPhase(state);
  if (ph.kind === 'twock/neutral') {
    if (ph.step === 'recruit') {
      for (const neutral of [0, 1] as const) {
        for (const vertex of neutralKnightSpots(state, neutral)) {
          add({ type: 'twock/neutralKnight', player: p, vertex, neutral });
        }
      }
    } else {
      for (const vertex of neutralPromotions(state))
        add({ type: 'twock/neutralPromote', player: p, vertex });
    }
    return out;
  }
  if (ph.kind === 'twock/forcedGive') return giveOptions(state, p, ph.count);
  const r = neutralRelocation(state);
  if (r) {
    for (const vertex of r.spots) add({ type: 'twock/relocate', player: p, vertex });
    return out;
  }
  const d = deserterPhase(state);
  if (d && d.victim === null) {
    for (const neutral of [0, 1] as const) {
      if (weakest(state, neutral)) add({ type: 'twock/deserterNeutral', player: p, neutral });
    }
  }
  if (goodsTradeBlocker(state, p) === null) add({ type: 'twock/forcedTrade', player: p });
  for (const [vertex] of knightsOf(state, p)) {
    if (knightForTokensBlocker(state, p, vertex) === null) {
      add({ type: 'twock/knightForTokens', player: p, vertex });
    }
  }
  return out;
}

function filterLegal(state: GameState, actions: Action[]): Action[] {
  const relocating = neutralRelocation(state) !== null;
  return actions.filter((a) => {
    if (relocating) return a.type.startsWith('twock/');
    switch (a.type) {
      case 'ck/alchemist':
        return !firstRollDone(state);
      default:
        return true;
    }
  });
}

// ---------------------------------------------------------------------------------------------
// The module
// ---------------------------------------------------------------------------------------------

export const twockModule: ExpansionModule = {
  id: TWOCK,
  name: 'Catan for Two + Cities & Knights',
  requires: [CK, TB],
  before: [CK, TB],
  players: { min: 2, max: 2 },
  modes: [
    {
      id: TWOCK_MODE,
      name: 'Catan for Two + Cities & Knights',
      blurb: 'Two players and two neutrals: neutral knights, trade tokens, two rolls a turn',
      status: 'ready',
      expansions: [TWOCK],
      scenarios: [SC_BASE],
      players: { min: 2, max: 2 },
      scenarioVp: { [SC_BASE]: TWOCK_VP },
    },
  ],

  validate(settings) {
    if (settings.scenario !== SC_BASE) return 'Catan for Two + C&K plays on the base board';
    return null;
  },

  init(draft) {
    const slice: TwockSlice = { v: 1 };
    draft.ext[TWOCK] = slice;
  },
  cloneExt: (slice) => cloneJson(slice),

  actions: {
    'twock/neutralKnight': neutralKnight,
    'twock/neutralPromote': neutralPromote,
    'twock/relocate': relocate,
    'twock/deserterNeutral': deserterNeutral,
    'twock/knightForTokens': knightForTokens,
    'twock/forcedTrade': forcedTrade,
    'twock/forcedGive': forcedGive,
  },
  wraps,
  legal,
  filterLegal,
  changesRoads: [
    'twock/neutralKnight',
    'twock/relocate',
    'twock/deserterNeutral',
    'twock/knightForTokens',
  ],

  actors(state) {
    const k = state.phase.kind;
    if (k.startsWith('twock/') || neutralRelocation(state)) return [state.turn.current];
    return undefined;
  },

  hooks: {
    // Neutral knights walk their neutral's roads (where a displaced one may retreat).
    routeEdges(state, p) {
      const i = neutralOf(state, p);
      return i === null ? [] : twoOf(state).neutrals[i].roads;
    },
    statsCategory: (_state, action, p) => {
      switch (action.type) {
        case 'twock/forcedTrade':
          return p === action.player ? { gain: 'trade' } : { loss: 'trade' };
        case 'twock/forcedGive':
          return p === action.player ? { loss: 'trade' } : { gain: 'trade' };
        default:
          return undefined;
      }
    },
  },
};
