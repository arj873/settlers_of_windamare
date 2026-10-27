/**
 * Catan: Cities & Knights (5th edition, with the 5-6 player extension) as an expansion module.
 * Rules and engine status per rule: docs/rules/cities-knights.md.
 *
 * Framework use: `setupBuilding` (the second setup building is a city), `onRoll` (event die,
 * barbarians, progress draws: may interrupt, then continueRoll), `production` + `afterProduction`
 * (commodities, Aqueduct), `onSeven` (the robber sleeps until the first attack), `handSize` /
 * `discardLimit` (commodities count, +2 per wall), `vertexBlocked` / `blocksRoute` (knights),
 * `supply` (no development cards), `victoryPoints`, `bankTradeRatio` (merchant, Merchant Fleet),
 * `pieceLimit` (knights, walls, a pillaged city on its side), `statsCategory`. Overrides: discard
 * (sleeping robber), steal (commodities), endTurn (progress hand limit), accept / confirm trade
 * (commodity parts). Choices of the C&K phases are answered by the generic pick actions
 * (prompts.ts).
 */
import { fail, log, ok, resumePhase } from '../../../engine/actions/common';
import { extendTradeLog } from '../../../engine/actions/trade';
import { continueRoll } from '../../../engine/actions/turn';
import { runOnRoll } from '../../../engine/expansions/hooks';
import type { ExpansionModule, ExtHandler } from '../../../engine/expansions/types';
import { emptyDevCards } from '../../../engine/resources';
import { playerName, stealSecret } from '../../../engine/rules/text';
import { Rng } from '../../../engine/rng';
import { DICE_CARDS } from '../../../engine/rules/dice';
import { DICE_DECK_RESHUFFLE_AT, RESOURCES } from '../../../engine/constants';
import { buildingsOf } from '../../../engine/selectors';
import { recordRoll } from '../../../engine/stats';
import type {
  Action,
  GameState,
  Phase,
  PlayerId,
  ResourceBundle,
  VertexId,
} from '../../../engine/types';
import { playBlocker, startCard } from './cards';
import { ckLegal } from './legal';
import { CK_STARTER19 } from './maps';
import { ckMaskFor } from './mask';
import { answer, choiceOf, promptFor } from './prompts';
import {
  ACTIVATE_COST,
  ACTIVATE_ITEM,
  KNIGHT_COST,
  KNIGHT_ITEM,
  MEDICINE_COST,
  MEDICINE_ITEM,
  PROMOTE_COST,
  PROMOTE_ITEM,
  WALL_COST,
  WALL_ITEM,
  activateBlocker,
  buildKnightBlocker,
  bundleSize,
  canChase,
  claimMetropolis,
  commodityProduction,
  rollStep,
  finishDiscards,
  holdsGoods,
  improveBlocker,
  improvementCost,
  isGoodsBundle,
  knightActionBlocker,
  selectKnightBlocker,
  knightKind,
  moveBundle,
  moveGood,
  payCommodities,
  payResources,
  pillageOverflow,
  measuringPieces,
  settlementPieces,
  promote,
  promoteBuildBlocker,
  stealRandom,
  wallBlocker,
  wallsOf,
} from './rules';
import {
  bankTradeBlocker,
  giveRatio,
  holdsCommodities,
  offerResponses,
  parseOffer,
  resourceRatio,
  splitBundle,
} from './trade';
import {
  CK,
  COMMODITIES,
  KNIGHTS_PER_LEVEL,
  PROGRESS_HAND_MAX,
  TRACKS,
  TRACK_COMMODITY,
  WALLS_PER_PLAYER,
  WALL_BONUS,
  DECKS,
  ckPlayer,
  ckSlice,
  ckVictoryParts,
  commodityCount,
  commoditySupply,
  commodityTotal,
  emptyCommodities,
  isProgressCard,
  isRobberActive,
  isTrack,
  type CkAction,
  type Commodity,
  asPhase,
  phaseOf,
  type CkSlice,
  type ProgressCard,
  type Track,
} from './state';

export * from './state';
export { CK_STARTER19 } from './maps';
export * from './rules';
export * from './routes';
export * from './cards';
export * from './prompts';
export * from './trade';
export { ckLegal } from './legal';
export { HIDDEN_PROGRESS_CARD, ckMaskFor } from './mask';

const pn = playerName;

/** "1 brick, 2 paper": a trade side's resources, then its commodities. */
function describeGoods(res: ResourceBundle, com: Partial<Record<Commodity, number>>): string {
  return [
    ...RESOURCES.filter((r) => (res[r] ?? 0) > 0).map((r) => `${res[r]} ${r}`),
    ...COMMODITIES.filter((c) => (com[c] ?? 0) > 0).map((c) => `${com[c]} ${c}`),
  ].join(', ');
}
const asCk = (a: { type: string }) => a as unknown as CkAction;
const isInt = (x: unknown, lo: number, hi: number): x is number =>
  typeof x === 'number' && Number.isInteger(x) && x >= lo && x <= hi;

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/** Remove the card of the outcome yellow + red from the balanced dice deck (refill as a draw). */
function takeDiceCard(draft: GameState, yellow: number, red: number): void {
  if (draft.diceDeck.length <= DICE_DECK_RESHUFFLE_AT) {
    const rng = new Rng(draft.rng);
    draft.diceDeck = rng.shuffle(DICE_CARDS);
    draft.rng = rng.state;
  }
  const i = draft.diceDeck.indexOf((yellow - 1) * 6 + (red - 1));
  if (i >= 0) draft.diceDeck.splice(i, 1);
}

/** After activating / promoting from the knight command dialog: back to the turn. */
function leaveCommand(draft: GameState): void {
  const phase = phaseOf(draft);
  if (phase.kind === 'ck/knight') draft.phase = resumePhase(draft, phase.resume);
}

/** A pick action (prompt answer). */
const pick: ExtHandler = (draft, action) => {
  const choice = choiceOf(asCk(action));
  if (!choice) return fail('invalid choice');
  const err = answer(draft, action.player, choice);
  return err ? fail(err) : ok(draft);
};

/** Discard / give exactly the owed cards (7, Saboteur, Wedding). */
const discard: ExtHandler = (draft, action) => {
  const a = asCk(action) as Extract<CkAction, { type: 'ck/discard' }>;
  const phase = phaseOf(draft);
  const pending =
    phase.kind === 'discard' || phase.kind === 'ck/sabotage' || phase.kind === 'ck/wedding'
      ? phase.pending
      : null;
  if (!pending) return fail('nothing to discard now');
  const owed = pending[a.player] ?? 0;
  if (owed <= 0) return fail('you owe no cards');
  if (!isGoodsBundle(a.resources, a.commodities)) return fail('invalid cards');
  if (bundleSize(a.resources, a.commodities) !== owed)
    return fail(`must give exactly ${owed} cards`);
  if (!holdsGoods(draft, a.player, a.resources, a.commodities))
    return fail('you do not have those cards');
  const to = phase.kind === 'ck/wedding' ? phase.to : 'bank';
  moveBundle(draft, a.player, to, a.resources, a.commodities);
  pending[a.player] = 0;
  log(
    draft,
    a.player,
    to === 'bank'
      ? `${pn(draft, a.player)} discarded ${owed} cards`
      : `${pn(draft, a.player)} gave ${owed} cards to ${pn(draft, to)}`,
  );
  if (pending.every((n) => n === 0)) {
    if (phase.kind === 'discard') finishDiscards(draft);
    else draft.phase = { kind: 'main' };
  }
  return ok(draft);
};

const actions: Record<`ck/${string}`, ExtHandler> = {
  'ck/buildKnight': (draft, action) => {
    const v = action.vertex;
    if (typeof v !== 'string') return fail('invalid vertex');
    const err = buildKnightBlocker(draft, action.player, v);
    if (err) return fail(err);
    payResources(draft, action.player, KNIGHT_COST);
    ckSlice(draft).knights[v] = {
      owner: action.player,
      level: 1,
      active: false,
      activatedOn: null,
      promotedOn: null,
    };
    log(draft, action.player, `${pn(draft, action.player)} recruited a knight`);
    return ok(draft);
  },

  'ck/activateKnight': (draft, action) => {
    const v = action.vertex;
    if (typeof v !== 'string') return fail('invalid vertex');
    const err = activateBlocker(draft, action.player, v);
    if (err) return fail(err);
    payResources(draft, action.player, ACTIVATE_COST);
    const k = ckSlice(draft).knights[v];
    if (k) {
      k.active = true;
      k.activatedOn = draft.turn.number;
    }
    log(draft, action.player, `${pn(draft, action.player)} activated a knight`);
    leaveCommand(draft);
    return ok(draft);
  },

  'ck/promoteKnight': (draft, action) => {
    const v = action.vertex;
    if (typeof v !== 'string') return fail('invalid vertex');
    const err = promoteBuildBlocker(draft, action.player, v);
    if (err) return fail(err);
    payResources(draft, action.player, PROMOTE_COST);
    promote(draft, v);
    leaveCommand(draft);
    return ok(draft);
  },

  'ck/selectKnight': (draft, action) => {
    const v = action.vertex;
    if (typeof v !== 'string') return fail('invalid vertex');
    const err = selectKnightBlocker(draft, action.player, v);
    if (err) return fail(err);
    const k = draft.phase.kind;
    const resume = k === 'specialBuild' ? 'specialBuild' : k === 'preRoll' ? 'preRoll' : 'main';
    draft.phase = asPhase({ kind: 'ck/knight', vertex: v, resume });
    return ok(draft);
  },

  'ck/chaseRobber': (draft, action) => {
    const phase = phaseOf(draft);
    if (phase.kind !== 'ck/knight') return fail('select a knight first');
    if (knightActionBlocker(draft, action.player, phase.vertex) !== null) {
      return fail('that knight cannot act now');
    }
    if (!canChase(draft, action.player, phase.vertex))
      return fail('that knight cannot chase the robber');
    const k = ckSlice(draft).knights[phase.vertex];
    if (k) k.active = false;
    log(draft, action.player, `${pn(draft, action.player)}'s knight chased the robber away`);
    // Knight-Errant: chased before the roll, the turn goes on with the roll.
    draft.phase = { kind: 'moveRobber', resume: phase.resume === 'preRoll' ? 'preRoll' : 'main' };
    return ok(draft);
  },

  'ck/cancel': (draft, action) => {
    const phase = phaseOf(draft);
    if (phase.kind !== 'ck/knight') return fail('nothing to cancel');
    if (draft.turn.current !== action.player) return fail('not your turn');
    ckSlice(draft).turn.cancels += 1;
    draft.phase = resumePhase(draft, phase.resume);
    return ok(draft);
  },

  'ck/buildWall': (draft, action) => {
    const v = action.vertex;
    if (typeof v !== 'string') return fail('invalid vertex');
    const err = wallBlocker(draft, action.player, v);
    if (err) return fail(err);
    payResources(draft, action.player, WALL_COST);
    ckSlice(draft).walls[v] = action.player;
    log(draft, action.player, `${pn(draft, action.player)} built a city wall`);
    return ok(draft);
  },

  'ck/improve': (draft, action) => {
    const t = action['track'];
    if (!isTrack(t)) return fail('invalid track');
    const err = improveBlocker(draft, action.player, t);
    if (err) return fail(err);
    const s = ckSlice(draft);
    const pl = ckPlayer(draft, action.player);
    const cost = improvementCost(draft, action.player, t);
    if (s.turn.cranes > 0) s.turn.cranes -= 1;
    moveGood(draft, action.player, 'bank', TRACK_COMMODITY[t], cost);
    pl.improvements[t] += 1;
    const level = pl.improvements[t];
    log(draft, action.player, `${pn(draft, action.player)} improved ${t} to level ${level}`);
    const next = claimMetropolis(draft, action.player, t, level);
    if (next) draft.phase = next as Phase;
    return ok(draft);
  },

  'ck/play': (draft, action) => {
    const card = action['card'];
    if (!isProgressCard(card)) return fail('invalid card');
    const err = playBlocker(draft, action.player, card);
    if (err) return fail(err);
    const next = startCard(draft, action.player, card);
    if (next) draft.phase = next;
    return ok(draft);
  },

  'ck/alchemist': (draft, action) => {
    const { yellow, red } = action as { yellow?: unknown; red?: unknown };
    if (draft.phase.kind !== 'preRoll') return fail('the Alchemist is played before rolling');
    if (draft.turn.current !== action.player) return fail('not your turn');
    if (!isInt(yellow, 1, 6) || !isInt(red, 1, 6)) return fail('choose two dice from 1 to 6');
    const hand = ckPlayer(draft, action.player).progress;
    const i = hand.indexOf('alchemist');
    if (i < 0) return fail('you have no Alchemist');
    hand.splice(i, 1);
    ckSlice(draft).decks.science.unshift('alchemist');
    draft.dice = [yellow, red];
    // Balanced dice (ours): the chosen outcome is used up like a drawn card.
    if (draft.settings.balancedDice) takeDiceCard(draft, yellow, red);
    // Event Cards: the Alchemist replaces revealing a card (T&B FAQ 15/16).
    if (draft.settings.eventCards) draft.lastEvent = null;
    log(
      draft,
      action.player,
      `${pn(draft, action.player)} played the Alchemist: ${yellow + red} (${yellow}+${red})`,
    );
    recordRoll(draft, action.player);
    ckSlice(draft).turn.alchemist = true;
    const interrupt = runOnRoll(draft, yellow + red);
    if (interrupt) draft.phase = interrupt;
    else continueRoll(draft);
    return ok(draft);
  },

  'ck/discardProgress': (draft, action) => {
    const card = action['card'];
    if (!isProgressCard(card)) return fail('invalid card');
    if (draft.phase.kind !== 'main' || draft.turn.current !== action.player) {
      return fail('only on your turn, in the main phase');
    }
    const hand = ckPlayer(draft, action.player).progress;
    if (hand.length <= PROGRESS_HAND_MAX) return fail('you may keep your cards');
    const i = hand.indexOf(card);
    if (i < 0) return fail('you do not have that card');
    hand.splice(i, 1);
    const track = TRACKS.find((t) => DECKS[t].some(([c]) => c === card)) as Track;
    ckSlice(draft).decks[track].unshift(card);
    log(draft, action.player, `${pn(draft, action.player)} discarded a progress card`);
    return ok(draft);
  },

  'ck/bankTrade': (draft, action) => {
    const { give, receive } = action as { give?: unknown; receive?: unknown };
    const err = bankTradeBlocker(draft, action.player, give, receive);
    if (err) return fail(err);
    const a = asCk(action) as Extract<CkAction, { type: 'ck/bankTrade' }>;
    const ratio = giveRatio(draft, a.player, a.give);
    moveGood(draft, a.player, 'bank', a.give, ratio);
    moveGood(draft, 'bank', a.player, a.receive, 1);
    log(
      draft,
      a.player,
      `${pn(draft, a.player)} traded ${ratio} ${a.give} for 1 ${a.receive} with the bank`,
    );
    return ok(draft);
  },

  'ck/offerTrade': (draft, action) => {
    const offer = parseOffer(draft, action.player, action['give'], action['want'], action['to']);
    if (typeof offer === 'string') return fail(offer);
    const give = splitBundle(offer.give);
    const want = splitBundle(offer.want);
    draft.phase = {
      kind: 'trade',
      offer: {
        from: action.player,
        give: give.res,
        want: want.res,
        responses: offerResponses(draft, offer.to),
      },
    };
    ckSlice(draft).trade = { give: give.com, want: want.com };
    draft.turn.tradeOffers += 1;
    log(
      draft,
      action.player,
      `${pn(draft, action.player)} offers ${describeGoods(give.res, give.com)} for ${describeGoods(want.res, want.com)}`,
    );
    return ok(draft);
  },

  'ck/discard': discard,
  'ck/pickVertex': pick,
  'ck/pickEdge': pick,
  'ck/pickHex': pick,
  'ck/pickPlayer': pick,
  'ck/pickGood': pick,
  'ck/pickTrack': pick,
  'ck/pickCard': pick,
  'ck/done': pick,
};

// ---------------------------------------------------------------------------
// Statistics: where C&K actions' resource changes go (not "Other")
// ---------------------------------------------------------------------------

function statsCategory(state: GameState, action: Action, p: PlayerId) {
  // C&K classifies its own actions only; base actions keep the base classification.
  if (!action.type.startsWith('ck/')) return undefined;
  const phase = phaseOf(state);
  const mine = p === action.player;
  switch (action.type) {
    case 'ck/buildKnight':
    case 'ck/activateKnight':
    case 'ck/promoteKnight':
    case 'ck/buildWall':
      return { loss: 'build' as const };
    case 'ck/bankTrade':
      return { gain: 'bank' as const, loss: 'bank' as const };
    case 'ck/discard':
      return phase.kind === 'ck/wedding'
        ? { gain: 'devCard' as const, loss: 'monopoly' as const }
        : { loss: 'discard' as const };
    case 'ck/play':
      return { gain: 'devCard' as const, loss: mine ? ('build' as const) : ('monopoly' as const) };
    default:
      break;
  }
  if (phase.kind === 'ck/aqueduct') return { gain: 'production' as const };
  if (phase.kind === 'ck/card') {
    const card = (phase as { card: ProgressCard }).card;
    if (card === 'commercialHarbor') return { gain: 'trade' as const, loss: 'trade' as const };
    if (card === 'bishop') return { gain: 'steal' as const, loss: 'stolen' as const };
    if (card === 'medicine') return { loss: 'build' as const };
    return mine || p === state.turn.current
      ? { gain: 'devCard' as const }
      : { loss: 'monopoly' as const };
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// The module
// ---------------------------------------------------------------------------

function init(draft: GameState, rng: Rng): void {
  const n = draft.players.length;
  const supply = commoditySupply(n);
  const decks = {} as CkSlice['decks'];
  for (const t of TRACKS) {
    decks[t] = rng.shuffle(DECKS[t].flatMap(([c, k]) => Array<ProgressCard>(k).fill(c)));
  }
  const slice: CkSlice = {
    v: 1,
    players: draft.players.map(() => ({
      commodities: emptyCommodities(),
      improvements: { trade: 0, politics: 0, science: 0 },
      progress: [],
      vpCards: [],
      defender: 0,
    })),
    bank: { paper: supply, cloth: supply, coin: supply },
    knights: {},
    walls: {},
    metropolis: { trade: null, politics: null, science: null },
    barbarian: 0,
    attacks: 0,
    merchant: null,
    decks,
    event: null,
    turn: { cranes: 0, fleet: [], cancels: 0, alchemist: false },
    turns: draft.players.map(() => 0),
    trade: null,
  };
  draft.ext[CK] = slice;
}

function cloneExt(slice: unknown): CkSlice {
  const s = slice as CkSlice;
  const knights: CkSlice['knights'] = {};
  for (const [v, k] of Object.entries(s.knights)) knights[v as VertexId] = { ...k };
  return {
    ...s,
    players: s.players.map((p) => ({
      commodities: { ...p.commodities },
      improvements: { ...p.improvements },
      progress: [...p.progress],
      vpCards: [...p.vpCards],
      defender: p.defender,
    })),
    bank: { ...s.bank },
    knights,
    walls: { ...s.walls },
    metropolis: { ...s.metropolis },
    merchant: s.merchant ? { ...s.merchant } : null,
    decks: {
      trade: [...s.decks.trade],
      politics: [...s.decks.politics],
      science: [...s.decks.science],
    },
    turn: { ...s.turn, fleet: [...s.turn.fleet] },
    turns: [...s.turns],
    trade: s.trade ? { give: { ...s.trade.give }, want: { ...s.trade.want } } : null,
  };
}

export const ckModule: ExpansionModule = {
  id: CK,
  name: 'Cities & Knights',
  icon: '🏰',
  // 2: Catan for Two + C&K (module `twock`); C&K's own mode and scenarios stay 3-6.
  players: { min: 2, max: 6 },
  maps: [CK_STARTER19],
  scenarios: [
    {
      id: 'ck/classic',
      name: 'Variable board',
      blurb: 'Variable board: commodities, knights, barbarians, progress cards',
      players: { min: 3, max: 6 },
      maps: ['baseRandom', 'base56'],
      mapFor: (n) => (n <= 4 ? 'baseRandom' : 'base56'),
      vpToWin: 13,
    },
    {
      id: 'ck/starter',
      name: 'Starter board',
      blurb: 'The rulebook’s fixed C&K board (3-4 players)',
      players: { min: 3, max: 4 },
      maps: [CK_STARTER19.id],
      mapFor: () => CK_STARTER19.id,
      vpToWin: 13,
    },
  ],
  modes: [
    {
      id: CK,
      name: 'Cities & Knights',
      blurb: 'Defend Catan from the barbarians; grow cities into metropolises',
      status: 'ready',
      expansions: [CK],
      scenarios: ['ck/classic', 'ck/starter'],
      players: { min: 3, max: 6 },
    },
  ],

  options: [
    {
      key: 'easyStart',
      label: 'Easy start',
      description:
        'In each player’s first two turns a 7 is re-rolled and the event die is not rolled',
      type: 'boolean',
      default: false,
    },
    {
      key: 'knightErrant',
      label: 'Knight-errant',
      description: 'An active knight may chase the robber before the roll',
      type: 'boolean',
      default: false,
    },
  ],

  validate(settings) {
    if (settings.rushMode) {
      return 'Cities & Knights needs a step before the roll (Alchemist): Rush mode is not supported';
    }
    if (settings.eventCards && settings.options[CK]?.['easyStart'] === true) {
      return 'Easy start re-rolls 7s: it cannot be combined with Event Cards';
    }
    return null;
  },

  init,
  cloneExt,
  actions,
  legal: ckLegal,

  overrides: {
    discard: (draft, action, next) => {
      const r = next(draft, action);
      if (r.ok && draft.phase.kind === 'moveRobber' && !isRobberActive(draft)) {
        draft.phase = { kind: 'main' };
      }
      return r;
    },
    steal: (draft, action) => {
      const phase = draft.phase;
      if (phase.kind !== 'steal') return fail('cannot steal now');
      if (draft.turn.current !== action.player) return fail('not your turn');
      if (!phase.candidates.includes(action.victim)) return fail('cannot steal from that player');
      const card = stealRandom(draft, action.player, action.victim);
      log(
        draft,
        action.player,
        `${pn(draft, action.player)} stole from ${pn(draft, action.victim)}${card ? '' : ' (no cards)'}`,
        stealSecret(draft, action.player, action.victim, [card]),
      );
      draft.phase = resumePhase(draft, phase.resume);
      return ok(draft);
    },
    endTurn: (draft, action, next) => {
      if ((ckSlice(draft).players[action.player]?.progress.length ?? 0) > PROGRESS_HAND_MAX) {
        return fail(`play or discard progress cards down to ${PROGRESS_HAND_MAX} first`);
      }
      return next(draft, action);
    },
    acceptTrade: (draft, action, next) => {
      const t = ckSlice(draft).trade;
      if (t && !holdsCommodities(draft, action.player, t.want)) {
        return fail('you do not have the requested commodities');
      }
      return next(draft, action);
    },
    confirmTrade: (draft, action, next) => {
      const t = ckSlice(draft).trade;
      if (t && draft.phase.kind === 'trade') {
        if (!holdsCommodities(draft, action.player, t.give))
          return fail('you no longer have the commodities');
        if (
          typeof action.partner !== 'number' ||
          !holdsCommodities(draft, action.partner, t.want)
        ) {
          return fail('your partner no longer has the commodities');
        }
      }
      const r = next(draft, action);
      if (r.ok && t) {
        for (const c of COMMODITIES) {
          if (t.give[c] > 0) moveGood(draft, action.player, action.partner, c, t.give[c]);
          if (t.want[c] > 0) moveGood(draft, action.partner, action.player, c, t.want[c]);
        }
        // The base line names the resources only: add the commodities.
        const g = describeGoods({}, t.give);
        extendTradeLog(draft, action.player, action.partner, g, describeGoods({}, t.want));
      }
      return r;
    },
  },

  filterLegal(state, list) {
    const s = ckSlice(state);
    const t = s.trade;
    return list.filter((a) => {
      switch (a.type) {
        case 'discard':
          return commodityTotal(s.players[a.player]?.commodities ?? {}) === 0;
        case 'endTurn':
          return (s.players[a.player]?.progress.length ?? 0) <= PROGRESS_HAND_MAX;
        case 'acceptTrade':
          return !t || holdsCommodities(state, a.player, t.want);
        case 'confirmTrade':
          return (
            !t ||
            (holdsCommodities(state, a.player, t.give) &&
              holdsCommodities(state, a.partner, t.want))
          );
        default:
          return true;
      }
    });
  },

  changesRoads: ['ck/buildKnight', 'ck/pickVertex', 'ck/pickEdge', 'ck/done'],

  actors(state) {
    const phase = phaseOf(state);
    switch (phase.kind) {
      case 'ck/sabotage':
      case 'ck/wedding':
        return phase.pending.flatMap((n, p) => (n > 0 ? [p] : []));
      case 'ck/knight':
        return [state.turn.current];
      default: {
        const prompt = promptFor(state);
        return prompt ? [prompt.actor] : undefined;
      }
    }
  },

  hooks: {
    setupBuilding: (state, index) => (index >= state.players.length ? 'city' : undefined),

    onRoll: (draft, roll) => rollStep(draft, roll),

    onSeven(draft, pending) {
      if (isRobberActive(draft)) return undefined;
      log(draft, null, 'The robber sleeps until the barbarians first attack');
      return pending.some((n) => n > 0)
        ? { kind: 'discard', pending: [...pending] }
        : { kind: 'main' };
    },

    production: commodityProduction,
    afterProduction: payCommodities,

    cost(_state, item, base) {
      switch (item) {
        case KNIGHT_ITEM:
          return KNIGHT_COST;
        case PROMOTE_ITEM:
          return PROMOTE_COST;
        case ACTIVATE_ITEM:
          return ACTIVATE_COST;
        case WALL_ITEM:
          return WALL_COST;
        case MEDICINE_ITEM:
          return MEDICINE_COST;
        default:
          return base;
      }
    },

    pieceLimit(state, p, kind, base) {
      if (kind === knightKind(1) || kind === knightKind(2) || kind === knightKind(3)) {
        return KNIGHTS_PER_LEVEL;
      }
      if (kind === WALL_ITEM) return WALLS_PER_PLAYER;
      // A pillaged city lying on its side (FAQ Q15): a settlement made of a city piece. Modules
      // after C&K may add settlement pieces (E&P: one per harbor settlement): `extra`.
      if (measuringPieces()) return base;
      if (kind === 'settlement') {
        const extra = settlementPieces(state, p) - base;
        return Math.max(base, buildingsOf(state, p, 'settlement').length - extra);
      }
      if (kind === 'city') return base - pillageOverflow(state, p);
      return base;
    },

    vertexBlocked: (state, v) => ckSlice(state).knights[v] !== undefined,
    blocksRoute(state, v, player) {
      const k = ckSlice(state).knights[v];
      return k !== undefined && k.owner !== player;
    },
    // commodityCount: on an online view the split is masked, the total is public.
    handSize: (state, p, base) => base + commodityCount(state, p),
    discardLimit: (state, p, base) => base + WALL_BONUS * wallsOf(state, p),
    supply: (_state, base) => ({ ...base, devDeck: emptyDevCards() }),

    victoryPoints(state, p) {
      const parts = ckVictoryParts(state, p);
      return { public: parts.reduce((n, x) => n + x.vp, 0), parts };
    },

    bankTradeRatio: resourceRatio,

    onStartTurn(draft, p) {
      const s = ckSlice(draft);
      s.turn = { cranes: 0, fleet: [], cancels: 0, alchemist: false };
      // Own turns started (Easy start); a second settler step is not one.
      if (draft.turn.secondSettlerOf === undefined) s.turns[p] = (s.turns[p] ?? 0) + 1;
    },

    afterAction(draft) {
      const s = ckSlice(draft);
      if (s.trade && draft.phase.kind !== 'trade') s.trade = null;
    },

    statsCategory,
    statsBankTradeRatio: (state, action) =>
      action.type === 'ck/bankTrade'
        ? giveRatio(state, action.player, action['give'] as Parameters<typeof giveRatio>[2])
        : undefined,

    maskFor: ckMaskFor,
  },
};
