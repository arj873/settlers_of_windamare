/**
 * Traders & Barbarians + Cities & Knights (docs/rules/scenarios-and-combos.md C4, T&B FAQ 3-5,
 * 43-44, 62-64): the T&B scenarios that have an official C&K combination, composed from the two
 * modules plus the rules only the pair has. Engine status per rule: docs/rules/combos.md §2.
 *
 * Composition order (`before`): tbck, ck, tb. Where both modules hook the same first-wins point:
 * - afterProduction: C&K's commodities (and Aqueduct players), then T&B's fish (never a phase);
 *   fish are no cards, so a player who only caught fish still gets the Aqueduct (FAQ 43);
 * - onSeven: C&K's first (the robber, and in Traders & Barbarians the barbarians' 7 move, sleep
 *   until the first barbarian attack), then T&B's (no robber in Traders & Barbarians);
 * - rollDice: T&B re-rolls a 2 / 12 of the production dice only (FAQ 62); C&K's event die is an
 *   onRoll step, so it is never re-rolled.
 * C&K's supply hook removes the development cards, so T&B's Knight / Swift Journey cards and the
 * fishermen's 7-fish card become progress cards or nothing (see below).
 */
import { RESOURCES } from '../../../engine/constants';
import { fail, log, ok } from '../../../engine/actions/common';
import { cloneJson } from '../../../engine/expansions/ext';
import type { ExpansionModule, ExtHandler, ExtWrap } from '../../../engine/expansions/types';
import { isCentreVertex } from '../../../engine/hex';
import type { Rng } from '../../../engine/rng';
import { playerName } from '../../../engine/rules/text';
import { topologyOf } from '../../../engine/topology';
import type { Action, EdgeId, GameState, HexId, PlayerId, VertexId } from '../../../engine/types';
import {
  CK,
  COMMODITIES,
  PROGRESS_HAND_MAX,
  TRACKS,
  ckModule,
  ckSlice,
  CARD_NAMES,
  giveRatio,
  goodCount,
  isCommodity,
  isProgressCard,
  isVpCard,
  moveGood,
  phaseOf,
  stealRandom,
  type Commodity,
  type ProgressCard,
  type Track,
} from '../../ck/engine';
import {
  OASIS,
  SC_CARAVANS,
  SC_FISH,
  SC_RIVERS,
  SC_TRADERS,
  TB,
  has,
  tbModule,
} from '../../tb/engine';
import { addGold, goldOf, payBank } from '../../tb/engine/common';
import { fishCost, fishPayment } from '../../tb/engine/fish';
import { edgeOnRiver, isBridgeSite } from '../../tb/engine/rivers';
import {
  noteCities,
  offerRansom,
  ransom,
  ransomActor,
  ransomLegal,
  type RansomSlice,
} from './ransom';

export { RANSOM_GOLD, type RansomPhase } from './ransom';
import { fishOf, tradersOf } from '../../tb/engine/state';

export const TBCK = 'tbck';
export const TBCK_MODE = 'tb+ck';
export const SC_VARIANTS = 'tb/variants';

/** The T&B scenarios with an official C&K combination and their VP targets (C4). */
export const TBCK_VP: Readonly<Record<string, number>> = {
  [SC_FISH]: 13,
  [SC_RIVERS]: 13,
  [SC_CARAVANS]: 15,
  [SC_TRADERS]: 15,
  [SC_VARIANTS]: 13,
};
export const TBCK_SCENARIOS = [SC_FISH, SC_RIVERS, SC_CARAVANS, SC_TRADERS, SC_VARIANTS] as const;

/** Rivers: Diplomat removing a road next to a river costs this much gold (C4). */
export const RIVER_ROAD_TOLL = 1;

export interface TbckSlice extends RansomSlice {
  v: 1;
}

export type TbckAction =
  | { type: 'tbck/chaseBarbarian'; player: PlayerId; edge: EdgeId }
  | { type: 'tbck/sellCommodity'; player: PlayerId; commodity: Commodity }
  | { type: 'tbck/fishProgress'; player: PlayerId; card: ProgressCard };

const pn = playerName;
export const tbckSlice = (state: Pick<GameState, 'ext'>): TbckSlice => state.ext[TBCK] as TbckSlice;

// ---------------------------------------------------------------------------------------------
// Fishermen + C&K: fish steal resources and commodities; 7 fish buy a progress card
// ---------------------------------------------------------------------------------------------

/** Pay `p`'s fish for `use` (smallest overpayment, as T&B does). */
function payFish(draft: GameState, p: PlayerId, use: 'steal' | 'devCard'): number {
  const s = fishOf(draft);
  const hand = s.hands[p] ?? [];
  const pay = fishPayment(hand, fishCost(draft, p, use)) ?? [];
  for (const t of pay) hand.splice(hand.indexOf(t), 1);
  s.spent.push(...pay);
  return pay.reduce((n, t) => n + t, 0);
}

const fishTotal = (state: GameState, p: PlayerId) =>
  (fishOf(state).hands[p] ?? []).reduce((n, t) => n + t, 0);

/** Cards (resources and commodities) in `p`'s hand. */
const goodsOf = (state: GameState, p: PlayerId) =>
  RESOURCES.reduce((n, r) => n + goodCount(state, p, r), 0) +
  COMMODITIES.reduce((n, c) => n + goodCount(state, p, c), 0);

function fishTurn(state: GameState, p: PlayerId): string | null {
  const k = state.phase.kind;
  if (k !== 'preRoll' && k !== 'main') return 'fish are used on your own turn';
  if (state.turn.current !== p || state.turn.secondSettlerOf !== undefined) return 'not your turn';
  return null;
}

/** The stack holding a `card` (null: none left). */
function stackOf(state: GameState, card: unknown): Track | null {
  if (!isProgressCard(card)) return null;
  return TRACKS.find((t) => ckSlice(state).decks[t].includes(card)) ?? null;
}

/** Why `p` cannot pay 7 fish for the progress card `card` of their choice (Fishing + C&K). */
export function fishProgressBlocker(state: GameState, p: PlayerId, card: unknown): string | null {
  if (!has(state, 'fish')) return 'no fish in this game';
  const t = fishTurn(state, p);
  if (t) return t;
  if (!isProgressCard(card)) return 'pick a progress card';
  const cost = fishCost(state, p, 'devCard');
  if (fishTotal(state, p) < cost) return `needs ${cost} fish`;
  return stackOf(state, card) !== null ? null : 'no such card left in the stacks';
}

/** Progress cards `p` may take for 7 fish: one of each kind still in a stack. */
export function fishProgressChoices(state: GameState, p: PlayerId): ProgressCard[] {
  const kinds = new Set(TRACKS.flatMap((t) => ckSlice(state).decks[t]));
  return [...kinds].filter((c) => fishProgressBlocker(state, p, c) === null).sort();
}

const fishProgress: ExtHandler = (draft, action) => {
  const card = action['card'];
  const err = fishProgressBlocker(draft, action.player, card);
  if (err) return fail(err);
  const c = card as ProgressCard;
  const deck = ckSlice(draft).decks[stackOf(draft, c) as Track];
  deck.splice(deck.lastIndexOf(c), 1);
  const paid = payFish(draft, action.player, 'devCard');
  const pl = ckSlice(draft).players[action.player];
  if (isVpCard(c)) pl?.vpCards.push(c);
  else pl?.progress.push(c);
  log(
    draft,
    action.player,
    `${pn(draft, action.player)} paid ${paid} fish for the ${CARD_NAMES[c]}${isVpCard(c) ? ' (1 victory point)' : ''}`,
  );
  return ok(draft);
};

// ---------------------------------------------------------------------------------------------
// Rivers + C&K: commodities for gold; the Diplomat and the rivers
// ---------------------------------------------------------------------------------------------

export function sellCommodityBlocker(state: GameState, p: PlayerId, c: unknown): string | null {
  if (!has(state, 'rivers')) return 'no gold in this game';
  if (state.phase.kind !== 'main') return 'trade with the bank in the main phase';
  if (state.turn.current !== p || state.turn.secondSettlerOf !== undefined) return 'not your turn';
  if (!isCommodity(c)) return 'pick a commodity';
  const ratio = giveRatio(state, p, c);
  return goodCount(state, p, c) >= ratio ? null : `needs ${ratio} ${c}`;
}

const sellCommodity: ExtHandler = (draft, action) => {
  const c = action['commodity'];
  const err = sellCommodityBlocker(draft, action.player, c);
  if (err) return fail(err);
  const ratio = giveRatio(draft, action.player, c as Commodity);
  moveGood(draft, action.player, 'bank', c as Commodity, ratio);
  addGold(draft, action.player, 1);
  log(draft, action.player, `${pn(draft, action.player)} traded ${ratio} ${String(c)} for 1 gold`);
  return ok(draft);
};

type DiplomatPhase = { kind: 'ck/card'; card: 'diplomat'; removed: EdgeId | null };
const diplomatPhase = (state: GameState): DiplomatPhase | null => {
  const ph = phaseOf(state) as unknown as { kind: string; card?: string };
  return ph.kind === 'ck/card' && ph.card === 'diplomat' ? (ph as DiplomatPhase) : null;
};

/**
 * Why the Diplomat may not take the road on `e` (Rivers + C&K): never a bridge; a road next to a
 * river costs 1 gold (own roads too).
 */
export function riverDiplomatBlocker(state: GameState, p: PlayerId, e: EdgeId): string | null {
  if (!has(state, 'rivers')) return null;
  if (isBridgeSite(state, e)) return 'the Diplomat cannot remove a bridge';
  if (edgeOnRiver(state, e) && goldOf(state, p) < RIVER_ROAD_TOLL) {
    return `removing a road at a river costs ${RIVER_ROAD_TOLL} gold`;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Caravans + C&K: the vote is bid with brick and lumber (C4)
// ---------------------------------------------------------------------------------------------

type VotePhase = {
  kind: 'tb/vote';
  ender: PlayerId;
  order: PlayerId[];
  bids: number[];
  placer: PlayerId | null;
};

const isCount = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x) && x >= 0;

export function bidBlocker(state: GameState, p: PlayerId, brick: unknown, lumber: unknown) {
  const phase = state.phase as unknown as VotePhase;
  if (phase.kind !== 'tb/vote' || phase.placer !== null) return 'no vote now';
  if (phase.order[0] !== p) return 'not your bid';
  if (!isCount(brick) || !isCount(lumber)) return 'bid whole brick and lumber cards';
  const hand = state.players[p]?.resources;
  if (!hand || hand.brick < brick || hand.lumber < lumber) return 'you do not have those cards';
  return null;
}

/** Record a brick / lumber bid; after the last one the placer is decided (as T&B's vote). */
function bid(draft: GameState, p: PlayerId, brick: number, lumber: number): void {
  const phase = draft.phase as unknown as VotePhase;
  payBank(draft, p, { brick, lumber });
  phase.bids[p] = brick + lumber;
  phase.order.shift();
  const n = brick + lumber;
  log(draft, p, `${pn(draft, p)} voted with ${n} card${n === 1 ? '' : 's'}`);
  if (phase.order.length > 0) return;
  const max = Math.max(...phase.bids);
  const top = phase.bids.flatMap((b, i) => (b === max ? [i] : []));
  phase.placer = max > 0 && top.length === 1 ? (top[0] as PlayerId) : phase.ender;
  log(draft, phase.placer, `${pn(draft, phase.placer)} decides where the camel goes`);
}

// ---------------------------------------------------------------------------------------------
// Traders & Barbarians + C&K: knights chase barbarians (C4)
// ---------------------------------------------------------------------------------------------

/** Barbarians on a path that ends at the knight on `v`. */
export function barbariansNextTo(state: GameState, v: VertexId): EdgeId[] {
  if (!has(state, 'traders')) return [];
  const t = topologyOf(state);
  return tradersOf(state).barbarians.filter((e) => t.edge[e]?.vertices.includes(v) ?? false);
}

export function chaseBarbarianBlocker(state: GameState, p: PlayerId, edge: unknown): string | null {
  const phase = phaseOf(state);
  if (phase.kind !== 'ck/knight') return 'select a knight first';
  if (phase.resume !== 'main') return 'knights act in your main phase';
  if (state.turn.current !== p) return 'not your turn';
  const k = ckSlice(state).knights[phase.vertex];
  if (!k || k.owner !== p) return 'not your knight';
  if (!k.active) return 'only an active knight can act';
  if (k.activatedOn === state.turn.number) return 'a knight activated this turn cannot act yet';
  if (typeof edge !== 'string' || !barbariansNextTo(state, phase.vertex).includes(edge as EdgeId)) {
    return 'no barbarian next to this knight there';
  }
  return null;
}

const chaseBarbarian: ExtHandler = (draft, action) => {
  const phase = phaseOf(draft);
  const err = chaseBarbarianBlocker(draft, action.player, action['edge']);
  if (err || phase.kind !== 'ck/knight') return fail(err ?? 'select a knight first');
  const k = ckSlice(draft).knights[phase.vertex];
  if (k) k.active = false;
  log(draft, action.player, `${pn(draft, action.player)}'s knight chased a barbarian away`);
  draft.phase = {
    kind: 'tb/barbarian',
    from: action['edge'] as EdgeId,
    steal: true,
    resume: 'main',
  } as unknown as GameState['phase'];
  return ok(draft);
};

function bishopOnOasis(state: GameState, h: unknown): boolean {
  const ph = phaseOf(state) as unknown as { kind: string; card?: string };
  return (
    ph.kind === 'ck/card' &&
    ph.card === 'bishop' &&
    typeof h === 'string' &&
    state.board.hexes[h as HexId]?.terrain === OASIS
  );
}

/** A knight may not stand on a trade hex's plaza (no intersection for buildings). */
const plazaKnight = (state: GameState, v: unknown): boolean =>
  has(state, 'traders') && typeof v === 'string' && isCentreVertex(v as VertexId);

// ---------------------------------------------------------------------------------------------
// Wraps of the composed modules' actions
// ---------------------------------------------------------------------------------------------

/** `p` holds more progress cards than C&K allows at the end of the building (CK-50). */
const overHand = (state: GameState, p: PlayerId) =>
  (ckSlice(state).players[p]?.progress.length ?? 0) > PROGRESS_HAND_MAX;

const wraps: Record<`${string}/${string}`, ExtWrap> = {
  // The wagon move ends the building: the progress hand must be down to 4 first.
  'tb/startWagon': (draft, action, next) =>
    overHand(draft, action.player)
      ? fail(`play or discard progress cards down to ${PROGRESS_HAND_MAX} first`)
      : next(draft, action),

  // Fish: 3 steal a resource or a commodity (C4); 7 buy a progress card (tbck/fishProgress).
  'tb/fish': (draft, action, next) => {
    const use = action['use'];
    if (use === 'devCard') return fail('7 fish buy a progress card: pick a stack');
    if (use !== 'steal') return next(draft, action);
    const p = action.player;
    const v = action['victim'];
    const t = fishTurn(draft, p);
    if (t) return fail(t);
    const cost = fishCost(draft, p, 'steal');
    if (fishTotal(draft, p) < cost) return fail(`needs ${cost} fish`);
    if (typeof v !== 'number' || v === p || !draft.players[v]) return fail('pick another player');
    if (goodsOf(draft, v) === 0) return fail('that player has no cards');
    payFish(draft, p, 'steal');
    const card = stealRandom(draft, p, v);
    log(
      draft,
      p,
      `${pn(draft, p)} paid fish to steal from ${pn(draft, v)}${card ? '' : ' (no cards)'}`,
    );
    return ok(draft);
  },

  'tb/bid': (draft, action, next) => {
    if (!has(draft, 'caravans')) return next(draft, action);
    if ((action['wool'] ?? 0) !== 0 || (action['grain'] ?? 0) !== 0) {
      return fail('with Cities & Knights the vote is bid with brick and lumber');
    }
    const brick = action['brick'] ?? 0;
    const lumber = action['lumber'] ?? 0;
    const err = bidBlocker(draft, action.player, brick, lumber);
    if (err) return fail(err);
    bid(draft, action.player, brick as number, lumber as number);
    return ok(draft);
  },

  // A barbarian moved by a 7 or a knight robs a resource or a commodity (C&K stealing).
  'tb/placeBarbarian': (draft, action, next) => {
    const ph = draft.phase as unknown as { kind: string; from?: EdgeId | null; steal?: boolean };
    if (ph.kind !== 'tb/barbarian' || ph.from === null || !ph.steal) return next(draft, action);
    ph.steal = false;
    const r = next(draft, action);
    if (!r.ok) {
      ph.steal = true;
      return r;
    }
    const e = action['edge'] as EdgeId;
    const owner = draft.pieces.roads[e];
    if (owner !== undefined && owner !== action.player) {
      const card = stealRandom(draft, action.player, owner);
      log(
        draft,
        action.player,
        `${pn(draft, action.player)} stole from ${pn(draft, owner)}${card ? '' : ' (no cards)'}`,
      );
    }
    return ok(draft);
  },

  'ck/buildKnight': (draft, action, next) =>
    plazaKnight(draft, action['vertex'])
      ? fail('a knight cannot stand on a trade hex')
      : next(draft, action),
  'ck/pickVertex': (draft, action, next) =>
    phaseOf(draft).kind === 'ck/knight' && plazaKnight(draft, action['vertex'])
      ? fail('a knight cannot stand on a trade hex')
      : next(draft, action),

  // Traders & Barbarians re-rolls a 2 or 12: the Alchemist cannot set one either.
  // The Bishop moves the robber where a 7 could: never onto the Caravans oasis.
  'ck/pickHex': (draft, action, next) =>
    bishopOnOasis(draft, action['hex'])
      ? fail('the robber may not stand on the oasis')
      : next(draft, action),

  'ck/alchemist': (draft, action, next) => {
    const sum = Number(action['yellow']) + Number(action['red']);
    if (has(draft, 'traders') && (sum === 2 || sum === 12)) {
      return fail('2 and 12 are rolled again in this scenario');
    }
    return next(draft, action);
  },

  'ck/pickEdge': (draft, action, next) => {
    const ph = diplomatPhase(draft);
    const e = action['edge'];
    if (!ph || typeof e !== 'string' || !has(draft, 'rivers')) return next(draft, action);
    if (ph.removed !== null) {
      // An own road built again at no cost: 1 gold if it lies on a river hex.
      const r = next(draft, action);
      if (r.ok && edgeOnRiver(draft, e as EdgeId)) {
        addGold(draft, action.player, 1);
        log(draft, action.player, `${pn(draft, action.player)} received 1 gold`);
      }
      return r;
    }
    const err = riverDiplomatBlocker(draft, action.player, e as EdgeId);
    if (err) return fail(err);
    const toll = edgeOnRiver(draft, e as EdgeId);
    const r = next(draft, action);
    if (r.ok && toll) {
      addGold(draft, action.player, -RIVER_ROAD_TOLL);
      log(draft, action.player, `${pn(draft, action.player)} paid ${RIVER_ROAD_TOLL} gold`);
    }
    return r;
  },
};

// ---------------------------------------------------------------------------------------------
// Legal actions
// ---------------------------------------------------------------------------------------------

function legal(state: GameState): Action[] {
  const p = state.turn.current;
  const out: Action[] = ransomLegal(state) as unknown as Action[];
  const add = (a: TbckAction) => out.push(a as unknown as Action);
  if (has(state, 'fish')) {
    for (const card of fishProgressChoices(state, p)) {
      add({ type: 'tbck/fishProgress', player: p, card });
    }
    for (const victim of state.players.map((x) => x.id)) {
      // Victims holding commodities only (T&B's legal offers resource holders).
      if (
        victim !== p &&
        fishTurn(state, p) === null &&
        fishTotal(state, p) >= fishCost(state, p, 'steal') &&
        RESOURCES.every((r) => goodCount(state, victim, r) === 0) &&
        goodsOf(state, victim) > 0
      ) {
        out.push({ type: 'tb/fish', player: p, use: 'steal', victim } as unknown as Action);
      }
    }
  }
  if (has(state, 'rivers')) {
    for (const commodity of COMMODITIES) {
      if (sellCommodityBlocker(state, p, commodity) === null) {
        add({ type: 'tbck/sellCommodity', player: p, commodity });
      }
    }
  }
  if (has(state, 'caravans') && state.phase.kind === 'tb/vote') {
    const phase = state.phase as unknown as VotePhase;
    const bidder = phase.order[0];
    if (phase.placer === null && bidder !== undefined) {
      for (let brick = 0; brick <= 2; brick++) {
        for (let lumber = 0; lumber <= 2; lumber++) {
          if (brick + lumber === 0) continue; // T&B's own (0, 0) bid stays
          if (bidBlocker(state, bidder, brick, lumber) === null) {
            out.push({ type: 'tb/bid', player: bidder, brick, lumber } as unknown as Action);
          }
        }
      }
    }
  }
  const phase = phaseOf(state);
  if (phase.kind === 'ck/knight') {
    for (const edge of barbariansNextTo(state, phase.vertex)) {
      if (chaseBarbarianBlocker(state, p, edge) === null) {
        add({ type: 'tbck/chaseBarbarian', player: p, edge });
      }
    }
  }
  return out;
}

function filterLegal(state: GameState, actions: Action[]): Action[] {
  const caravans = has(state, 'caravans');
  const traders = has(state, 'traders');
  return actions.filter((a) => {
    const x = a as unknown as Record<string, unknown>;
    switch (a.type) {
      case 'tb/fish':
        return x['use'] !== 'devCard';
      case 'tb/bid':
        return !caravans || ((x['wool'] ?? 0) === 0 && (x['grain'] ?? 0) === 0);
      case 'buyDevCard':
        return false;
      case 'tb/startWagon':
        return !overHand(state, a.player);
      case 'ck/buildKnight':
        return !plazaKnight(state, x['vertex']);
      case 'ck/pickVertex':
        return phaseOf(state).kind !== 'ck/knight' || !plazaKnight(state, x['vertex']);
      case 'ck/pickHex':
        return !bishopOnOasis(state, x['hex']);
      case 'ck/alchemist': {
        const sum = Number(x['yellow']) + Number(x['red']);
        return !traders || (sum !== 2 && sum !== 12);
      }
      case 'ck/pickEdge': {
        const ph = diplomatPhase(state);
        if (!ph || ph.removed !== null) return true;
        return riverDiplomatBlocker(state, a.player, x['edge'] as EdgeId) === null;
      }
      default:
        return true;
    }
  });
}

// ---------------------------------------------------------------------------------------------
// Setup: Traders & Barbarians + C&K returns a forest instead of a field (C4)
// ---------------------------------------------------------------------------------------------

/** One forest hex of the board becomes a field (the C&K version of the T&B board). */
function forestToField(draft: GameState, rng: Rng): void {
  const forests = (Object.keys(draft.board.hexes) as HexId[]).filter(
    (h) => draft.board.hexes[h]?.terrain === 'lumber',
  );
  if (forests.length === 0) return;
  const h = rng.pick(forests);
  const tile = draft.board.hexes[h];
  if (!tile) return;
  draft.board = {
    ...draft.board,
    hexes: { ...draft.board.hexes, [h]: { ...tile, terrain: 'grain' } },
  };
}

// ---------------------------------------------------------------------------------------------
// The module
// ---------------------------------------------------------------------------------------------

export const tbckModule: ExpansionModule = {
  id: TBCK,
  name: 'Traders & Barbarians + Cities & Knights',
  requires: [CK, TB],
  before: [CK, TB],
  players: { min: 3, max: 6 },
  modes: [
    {
      id: TBCK_MODE,
      name: 'Traders & Barbarians + Cities & Knights',
      blurb: 'The T&B scenarios with commodities, knights and the barbarian ship',
      status: 'ready',
      expansions: [TBCK],
      scenarios: TBCK_SCENARIOS,
      players: { min: 3, max: 6 },
      scenarioVp: TBCK_VP,
    },
  ],

  validate(settings) {
    if (!(TBCK_SCENARIOS as readonly string[]).includes(String(settings.scenario))) {
      return 'This T&B scenario has no official Cities & Knights combination';
    }
    return null;
  },

  init(draft, rng) {
    if (has(draft, 'traders')) forestToField(draft, rng);
    const slice: TbckSlice = { v: 1, roll: null };
    draft.ext[TBCK] = slice;
  },
  cloneExt: (slice) => cloneJson(slice),

  actions: {
    'tbck/chaseBarbarian': chaseBarbarian,
    'tbck/sellCommodity': sellCommodity,
    'tbck/fishProgress': fishProgress,
    'tbck/ransom': ransom,
  },
  actors: (state) => ransomActor(state),
  wraps,
  overrides: {
    // C&K has no development cards: no T&B Swift Journey draws either.
    buyDevCard: () => fail('Cities & Knights has no development cards'),
    // C&K's progress hand limit before T&B's end-of-turn steps (wagon, knights, vote) begin.
    endTurn: (draft, action, next) =>
      draft.phase.kind === 'main' && overHand(draft, action.player)
        ? fail(`play or discard progress cards down to ${PROGRESS_HAND_MAX} first`)
        : next(draft, action),
  },
  legal,
  filterLegal,

  hooks: {
    // Rivers + C&K: note the cities before C&K's attack may pillage them (ransom.ts).
    onRoll(draft, roll) {
      noteCities(draft, tbckSlice(draft), roll);
      return undefined;
    },
    afterAction(draft) {
      offerRansom(draft, tbckSlice(draft));
    },
    statsCategory: (_state, action) =>
      action.type === 'tbck/ransom' ? { gain: 'production' } : undefined,

    afterProduction(draft, roll, paid) {
      const aqueduct = ckModule.hooks?.afterProduction?.(draft, roll, paid);
      tbModule.hooks?.afterProduction?.(draft, roll, paid);
      return aqueduct ?? { kind: 'main' };
    },
  },
};
