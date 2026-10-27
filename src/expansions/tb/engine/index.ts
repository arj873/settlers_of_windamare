/**
 * Catan: Traders & Barbarians (5th edition, with the 5-6 player extension) as an expansion
 * module: the variants (Harbormaster; Catan for Two = a 2-player game; Friendly Robber and Event
 * Cards are the core variants) and the five scenarios. Rules and engine status per rule:
 * docs/rules/traders-barbarians.md §11.
 *
 * Framework use: `setupBuilding` (BA / T&B second building is a city), `rollDice` (T&B re-rolls
 * 2 and 12, Catan for Two's second roll differs), `onRoll` (roll count, Robber Flees),
 * `onSeven` (no robber in BA / T&B), `production` (Rivers' 2-on-12, conquered hexes),
 * `afterProduction` (fish), `cost`, `pieceLimit` (bridges), `vertexBlocked` / `edgeBlocked` /
 * `blocksRoute` (neutral pieces, bridge sites, trade-hex sea sides, conquered hexes),
 * `victoryPoints`, `bankTradeRatio` (conquered harbours), `roadLength` (camels, neutrals, no
 * Longest Road in T&B), `supply` (BA deck), `onStartTurn` / `onEndTurn`, `afterAction`
 * (Harbormaster, Catan for Two's second roll), `statsCategory`, `maskFor` (online views,
 * mask.ts). Overrides add gold, tokens, neutral builds and barbarian landings to the base
 * builds, and the end-of-turn steps (knights and expulsion, the caravan vote, the wagon move)
 * to endTurn.
 */
import { COSTS, RESOURCES } from '../../../engine/constants';
import { fail, log, ok, resumePhase, isCurrent } from '../../../engine/actions/common';
import { rollFor, turnHandlers } from '../../../engine/actions/turn';
import { NO_ROBBER } from '../../../engine/expansions/ext';
import { costOf } from '../../../engine/expansions/hooks';
import type { ExpansionModule, ExtHandler } from '../../../engine/expansions/types';
import { isCentreVertex } from '../../../engine/hex';
import {
  emptyDevCards,
  hasResources,
  isResource,
  isValidBundle,
  totalResources,
} from '../../../engine/resources';
import { rollTwoDice } from '../../../engine/rules/dice';
import type { Rng } from '../../../engine/rng';
import { victoryPoints } from '../../../engine/selectors';
import { hexVertices, topologyOf } from '../../../engine/topology';
import type {
  Action,
  ActionResult,
  EdgeId,
  GameState,
  Phase,
  PlayerId,
  VertexId,
} from '../../../engine/types';
import {
  baLegal,
  baTradeRatio,
  baVictoryParts,
  buyCard,
  buyCardBlocker,
  canSelectKnight,
  castleKnightsToMove,
  conqueredProduction,
  edgeNextToConquered,
  expelBarbarians,
  initBa,
  knightSpots,
  knightTargets,
  knightsLeft,
  landBarbarians,
  moveKnight,
  takePrisoner,
  treasonDests,
  treasonMove,
  treasonSources,
  treasonStep,
  vertexNextToConquered,
} from './ba';
import {
  bid,
  bidBlocker,
  camelBlocker,
  camelOptions,
  camelRoadLength,
  caravanVictoryPoints,
  caravansLegal,
  initCaravans,
  noteBuilt,
  placeCamel,
  startVote,
  voteActors,
} from './caravans';
import {
  addGold,
  buyResourceBlocker,
  goldSaleRatio,
  handTotal,
  payBank,
  pn,
  sellBlocker,
  takeBank,
  updateHarbormaster,
} from './common';
import { isConqueredBuilding, isConqueredHex } from './conquest';
import {
  fishBlocker,
  fishLegal,
  giveBootBlocker,
  initFish,
  payFish,
  setupFish,
  useFish,
} from './fish';
import { TB_MAPS } from './maps';
import { swiftDevCards, tbMaskFor } from './mask';
import {
  bridgeBlocker,
  edgeOnRiver,
  isBridgeSite,
  riversLegal,
  riversVictoryParts,
  vertexOnRiver,
  bridgesBuilt,
} from './rivers';
import {
  BA_CARD_ITEM,
  BRIDGE_COST,
  BRIDGE_GOLD,
  BRIDGE_ITEM,
  GOLD_PER_RESOURCE,
  HARBORMASTER_VP,
  OASIS,
  SC_BA,
  SC_BASE,
  SC_CARAVANS,
  SC_FISH,
  SC_RIVERS,
  SC_TRADERS,
  TB,
  asPhase,
  asTb,
  baOf,
  caravansOf,
  extraNumbers,
  featuresOf,
  fishOf,
  harbormasterOn,
  has,
  isTwo,
  robberless,
  sheetRules,
  tbBoard,
  tbSlice,
  tradersOf,
  usesGold,
  type ResumeTo,
  type TbAction,
  type TbPhase,
  type TbSlice,
} from './state';
import {
  barbarianSpots,
  drawsSwift,
  driveOff,
  driveOffTargets,
  freshMove,
  grainBlocker,
  initTraders,
  moveBarbarian,
  payGrain,
  playSwift,
  startGold,
  swiftBlocker,
  tradersLegal,
  tradersVictoryParts,
  upgradeBlocker,
  upgradeWagon,
  wagonStep,
  wagonStepBlocker,
} from './traders';
import {
  earnTokens,
  forcedTrade,
  forcedTradeBlocker,
  initTwo,
  knightForTokens,
  knightForTokensBlocker,
  lengthAgainstNeutrals,
  neutralAt,
  neutralBlocksVertex,
  neutralFollowUp,
  neutralOptions,
  neutralRoadAt,
  placeNeutral,
  settlementTokens,
  payTokens,
  tokenPrice,
  tokenRobberBlocker,
  tokenRobberTarget,
  tokensInPlay,
  twoLegal,
} from './two';

export * from './state';
export * from './maps';
export { fishOwed, fishCost, fishBlocker } from './fish';
export { camelOptions, caravanVictoryPoints } from './caravans';
export { knightTargets, isCastleEdge, knightsOf, knightsLeft, barbariansOn } from './ba';
export { isConqueredHex, isConqueredBuilding } from './conquest';
export { stepCost, wagonSteps, plazaHex, upgradeBlocker } from './traders';
export { neutralAt, neutralRoadAt, tokenPrice, neutralRoadLength } from './two';
export { goldOf, harbourPoints, goldSaleRatio } from './common';
export { bridgesBuilt, isBridgeSite } from './rivers';

const phaseOf = (s: GameState) => s.phase as unknown as TbPhase;
const resumeOf = (s: GameState): ResumeTo =>
  s.phase.kind === 'preRoll'
    ? 'preRoll'
    : s.phase.kind === 'specialBuild'
      ? 'specialBuild'
      : 'main';

// ---------------------------------------------------------------------------
// Turn end: knights + expulsion (BA), the caravan vote, then the base endTurn
// ---------------------------------------------------------------------------

/** Run the base endTurn for `p` (after the module's end-of-turn steps). */
function finishTurn(draft: GameState, p: PlayerId): ActionResult {
  draft.phase = { kind: 'main' };
  return turnHandlers.endTurn(draft, { type: 'endTurn', player: p });
}

/** The vote is over: end the turn, or start the next one (vote after a special build phase). */
function endVote(draft: GameState, phase: Extract<TbPhase, { kind: 'tb/vote' }>): ActionResult {
  if (phase.then === 'endTurn') return finishTurn(draft, phase.ender);
  draft.phase = { kind: 'preRoll' };
  return ok(draft);
}

function endTurnBlocker(state: GameState, p: PlayerId): string | null {
  if (has(state, 'ba') && castleKnightsToMove(state, p).length > 0) {
    return 'move your knights off the castle first';
  }
  return null;
}

/** BA: expel the barbarians; a player at the target after it wins at once (own turn). */
function endOfTurnBattle(draft: GameState, p: PlayerId): boolean {
  if (!has(draft, 'ba') || draft.turn.secondSettlerOf !== undefined) return false;
  expelBarbarians(draft);
  const vp = victoryPoints(draft, p);
  if (vp < draft.settings.vpToWin || draft.turn.specialOwner !== undefined) return false;
  draft.winner = p;
  draft.phase = { kind: 'gameOver' };
  log(draft, p, `${pn(draft, p)} wins with ${vp} victory points!`);
  return true;
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/** Leave a tb/barbarian phase. */
function leaveBarbarian(draft: GameState, resume: ResumeTo | 'wagon'): void {
  draft.phase = resume === 'wagon' ? asPhase({ kind: 'tb/wagon' }) : resumePhase(draft, resume);
}

const actions: Record<`tb/${string}`, ExtHandler> = {
  'tb/buyResource': (draft, action) => {
    const a = asTb(action) as Extract<TbAction, { type: 'tb/buyResource' }>;
    if (!isResource(a.resource)) return fail('invalid resource');
    const err = buyResourceBlocker(draft, a.player, a.resource);
    if (err) return fail(err);
    addGold(draft, a.player, -GOLD_PER_RESOURCE);
    takeBank(draft, a.player, a.resource);
    tbSlice(draft).goldBuys += 1;
    log(
      draft,
      a.player,
      `${pn(draft, a.player)} paid ${GOLD_PER_RESOURCE} gold for 1 ${a.resource}`,
    );
    return ok(draft);
  },

  'tb/sellForGold': (draft, action) => {
    const a = asTb(action) as Extract<TbAction, { type: 'tb/sellForGold' }>;
    if (!isResource(a.resource)) return fail('invalid resource');
    const err = sellBlocker(draft, a.player, a.resource);
    if (err) return fail(err);
    const ratio = goldSaleRatio(draft, a.player);
    payBank(draft, a.player, { [a.resource]: ratio });
    addGold(draft, a.player, 1);
    log(draft, a.player, `${pn(draft, a.player)} traded ${ratio} ${a.resource} for 1 gold`);
    return ok(draft);
  },

  'tb/fish': (draft, action) => {
    const a = asTb(action) as Extract<TbAction, { type: 'tb/fish' }>;
    if (!has(draft, 'fish')) return fail('no fish in this game');
    if (!['robber', 'steal', 'resource', 'road', 'devCard'].includes(a.use))
      return fail('invalid use');
    const err = fishBlocker(draft, a.player, a.use, a.victim, a.resource);
    if (err) return fail(err);
    useFish(draft, a.player, a.use, a.victim, a.resource);
    return ok(draft);
  },

  'tb/giveBoot': (draft, action) => {
    const a = asTb(action) as Extract<TbAction, { type: 'tb/giveBoot' }>;
    if (!has(draft, 'fish')) return fail('no fish in this game');
    const err = giveBootBlocker(draft, a.player, a.to);
    if (err) return fail(err);
    fishOf(draft).boot = a.to;
    log(draft, a.player, `${pn(draft, a.player)} gave the old boot to ${pn(draft, a.to)}`);
    return ok(draft);
  },

  'tb/buildBridge': (draft, action) => {
    const a = asTb(action) as Extract<TbAction, { type: 'tb/buildBridge' }>;
    if (!has(draft, 'rivers')) return fail('no rivers in this game');
    const err = bridgeBlocker(draft, a.player, a.edge);
    if (err) return fail(err);
    payBank(draft, a.player, costOf(draft, BRIDGE_ITEM) ?? BRIDGE_COST);
    draft.pieces.roads[a.edge] = a.player;
    const s = tbSlice(draft);
    if (s.rivers) s.rivers.bridges[a.edge] = a.player;
    const gold = sheetRules(draft).bridgeGold ?? BRIDGE_GOLD;
    addGold(draft, a.player, gold);
    log(draft, a.player, `${pn(draft, a.player)} built a bridge (+${gold} gold)`);
    if (isTwo(draft)) {
      const next = neutralFollowUp(draft, 'road', draft.phase, true);
      if (next) draft.phase = asPhase(next);
    }
    return ok(draft);
  },

  'tb/bid': (draft, action) => {
    const a = asTb(action) as Extract<TbAction, { type: 'tb/bid' }>;
    const err = bidBlocker(draft, a.player, a.wool, a.grain);
    if (err) return fail(err);
    bid(draft, a.player, a.wool, a.grain);
    const phase = phaseOf(draft) as Extract<TbPhase, { kind: 'tb/vote' }>;
    if (phase.placer !== null && camelOptions(draft).length === 0) return endVote(draft, phase);
    return ok(draft);
  },

  'tb/placeCamel': (draft, action) => {
    const a = asTb(action) as Extract<TbAction, { type: 'tb/placeCamel' }>;
    const err = camelBlocker(draft, a.player, a.edge);
    if (err) return fail(err);
    const camel = camelOptions(draft).find((c) => c.edge === a.edge);
    if (!camel) return fail('a camel cannot go there');
    const phase = phaseOf(draft) as Extract<TbPhase, { kind: 'tb/vote' }>;
    // Catan for Two: the two camels of a round go to different caravans when possible.
    placeCamel(draft, camel);
    log(draft, a.player, `${pn(draft, a.player)} placed a camel`);
    phase.camels -= 1;
    if (phase.camels > 0 && camelOptions(draft).length > 0) return ok(draft);
    return endVote(draft, phase);
  },

  'tb/buyCard': (draft, action) => {
    if (!has(draft, 'ba')) return fail('no Barbarian Attack cards in this game');
    const err = buyCardBlocker(draft, action.player);
    if (err) return fail(err);
    const next = buyCard(draft, action.player, costOf(draft, BA_CARD_ITEM) ?? COSTS.devCard);
    if (next) draft.phase = asPhase(next);
    return ok(draft);
  },

  'tb/placeKnight': (draft, action) => {
    const a = asTb(action) as Extract<TbAction, { type: 'tb/placeKnight' }>;
    const phase = phaseOf(draft);
    if (phase.kind !== 'tb/placeKnight') return fail('no knight to place');
    if (!isCurrent(draft, a.player)) return fail('not your turn');
    if (!knightSpots(draft, phase.card).includes(a.edge)) return fail('a knight cannot go there');
    if (knightsLeft(draft, a.player) <= 0) return fail('no knights left');
    baOf(draft).knights[a.edge] = a.player;
    log(draft, a.player, `${pn(draft, a.player)} placed a knight`);
    draft.phase = resumePhase(draft, phase.resume);
    return ok(draft);
  },

  'tb/treasonHex': (draft, action) => {
    const a = asTb(action) as Extract<TbAction, { type: 'tb/treasonHex' }>;
    const phase = phaseOf(draft);
    if (phase.kind !== 'tb/treason') return fail('no Treason to resolve');
    if (!isCurrent(draft, a.player)) return fail('not your turn');
    if (phase.from === null) {
      if (!treasonSources(draft, phase.sources).includes(a.hex))
        return fail('no barbarian to take there');
      phase.from = a.hex;
    } else {
      if (!treasonDests(draft, phase.from, phase.dests).includes(a.hex))
        return fail('the barbarian cannot go there');
      treasonMove(draft, phase, a.hex);
    }
    const next = treasonStep(draft, phase);
    draft.phase = next ? asPhase(next) : resumePhase(draft, phase.resume);
    return ok(draft);
  },

  'tb/intrigueHex': (draft, action) => {
    const a = asTb(action) as Extract<TbAction, { type: 'tb/intrigueHex' }>;
    const phase = phaseOf(draft);
    if (phase.kind !== 'tb/intrigue') return fail('no Intrigue to resolve');
    if (!isCurrent(draft, a.player)) return fail('not your turn');
    if (!treasonSources(draft, []).includes(a.hex)) return fail('no barbarian there');
    takePrisoner(draft, a.player, a.hex);
    draft.phase = resumePhase(draft, phase.resume);
    return ok(draft);
  },

  'tb/startKnights': (draft, action) => {
    const a = asTb(action) as Extract<TbAction, { type: 'tb/startKnights' }>;
    if (!has(draft, 'ba')) return fail('no knights in this game');
    if (draft.phase.kind !== 'main' || draft.turn.secondSettlerOf !== undefined)
      return fail('move knights at the end of your turn');
    if (!isCurrent(draft, a.player)) return fail('not your turn');
    if (!canSelectKnight(draft, a.player, a.edge)) return fail('that knight cannot move');
    draft.phase = asPhase({ kind: 'tb/knights', from: a.edge });
    log(draft, a.player, `${pn(draft, a.player)} is moving knights`);
    return ok(draft);
  },

  'tb/selectKnight': (draft, action) => {
    const a = asTb(action) as Extract<TbAction, { type: 'tb/selectKnight' }>;
    const phase = phaseOf(draft);
    if (phase.kind !== 'tb/knights') return fail('not moving knights');
    if (!isCurrent(draft, a.player)) return fail('not your turn');
    if (!canSelectKnight(draft, a.player, a.edge)) return fail('that knight cannot move');
    phase.from = a.edge;
    return ok(draft);
  },

  'tb/moveKnight': (draft, action) => {
    const a = asTb(action) as Extract<TbAction, { type: 'tb/moveKnight' }>;
    const phase = phaseOf(draft);
    if (phase.kind !== 'tb/knights' || phase.from === null) return fail('pick a knight first');
    if (!isCurrent(draft, a.player)) return fail('not your turn');
    if (!knightTargets(draft, phase.from).has(a.edge))
      return fail('the knight cannot reach that path');
    moveKnight(draft, phase.from, a.edge);
    phase.from = null;
    return ok(draft);
  },

  'tb/startWagon': (draft, action) => wagonHandler(draft, action, true),
  'tb/wagonStep': (draft, action) => wagonHandler(draft, action, false),

  'tb/wagonGrain': (draft, action) => {
    if (!has(draft, 'traders')) return fail('no wagons in this game');
    const err = grainBlocker(draft, action.player);
    if (err) return fail(err);
    payGrain(draft, action.player);
    return ok(draft);
  },

  'tb/driveOff': (draft, action) => {
    const a = asTb(action) as Extract<TbAction, { type: 'tb/driveOff' }>;
    if (!has(draft, 'traders')) return fail('no wagons in this game');
    if (!driveOffTargets(draft, a.player).includes(a.edge))
      return fail('no barbarian to drive off there');
    if (driveOff(draft, a.player, a.edge)) {
      draft.phase = asPhase({ kind: 'tb/barbarian', from: a.edge, steal: false, resume: 'wagon' });
    }
    return ok(draft);
  },

  'tb/swiftJourney': (draft, action) => {
    if (!has(draft, 'traders')) return fail('no wagons in this game');
    const err = swiftBlocker(draft, action.player);
    if (err) return fail(err);
    playSwift(draft, action.player);
    return ok(draft);
  },

  'tb/upgradeWagon': (draft, action) => {
    if (!has(draft, 'traders')) return fail('no wagons in this game');
    const err = upgradeBlocker(draft, action.player);
    if (err) return fail(err);
    upgradeWagon(draft, action.player);
    return ok(draft);
  },

  'tb/placeBarbarian': (draft, action) => {
    const a = asTb(action) as Extract<TbAction, { type: 'tb/placeBarbarian' }>;
    const phase = phaseOf(draft);
    if (phase.kind !== 'tb/barbarian') return fail('no barbarian to move');
    if (!isCurrent(draft, a.player)) return fail('not your turn');
    if (phase.from === null) {
      if (!tradersOf(draft).barbarians.includes(a.edge)) return fail('no barbarian there');
      phase.from = a.edge;
      return ok(draft);
    }
    if (!barbarianSpots(draft, phase.noRoad === true).includes(a.edge)) {
      return fail('a barbarian cannot go there');
    }
    moveBarbarian(draft, a.player, phase.from, a.edge, phase.steal);
    leaveBarbarian(draft, phase.resume);
    return ok(draft);
  },

  'tb/neutralRoad': (draft, action) => neutralHandler(draft, action),
  'tb/neutralSettlement': (draft, action) => neutralHandler(draft, action),

  'tb/forcedTrade': (draft, action) => {
    if (!isTwo(draft)) return fail('only in Catan for Two');
    const err = forcedTradeBlocker(draft, action.player);
    if (err) return fail(err);
    const resume = resumeOf(draft);
    const count = forcedTrade(draft, action.player);
    if (count > 0) draft.phase = asPhase({ kind: 'tb/forcedGive', count, resume });
    return ok(draft);
  },

  'tb/forcedGive': (draft, action) => {
    const a = asTb(action) as Extract<TbAction, { type: 'tb/forcedGive' }>;
    const phase = phaseOf(draft);
    if (phase.kind !== 'tb/forcedGive') return fail('nothing to give');
    if (!isCurrent(draft, a.player)) return fail('not your turn');
    if (!isValidBundle(a.resources) || totalResources(a.resources) !== phase.count) {
      return fail(`give exactly ${phase.count} cards`);
    }
    const me = draft.players[a.player];
    const them = draft.players[1 - a.player];
    if (!me || !them || !hasResources(me.resources, a.resources))
      return fail('you do not have those cards');
    for (const r of RESOURCES) {
      const n = a.resources[r] ?? 0;
      me.resources[r] -= n;
      them.resources[r] += n;
    }
    log(
      draft,
      a.player,
      `${pn(draft, a.player)} gave ${phase.count} card${phase.count > 1 ? 's' : ''} back`,
    );
    draft.phase = resumePhase(draft, phase.resume);
    return ok(draft);
  },

  'tb/tokenRobber': (draft, action) => {
    if (!isTwo(draft)) return fail('only in Catan for Two');
    const err = tokenRobberBlocker(draft, action.player);
    if (err) return fail(err);
    const resume = resumeOf(draft);
    const price = tokenPrice(draft, action.player);
    payTokens(draft, action.player);
    // T&B: the token moves a barbarian instead (no theft).
    if (has(draft, 'traders')) {
      draft.phase = asPhase({
        kind: 'tb/barbarian',
        from: null,
        steal: false,
        noRoad: true,
        resume,
      });
      log(
        draft,
        action.player,
        `${pn(draft, action.player)} paid ${price} token${price > 1 ? 's' : ''} to move a barbarian`,
      );
    } else {
      draft.robber = tokenRobberTarget(draft) ?? draft.robber;
      log(
        draft,
        action.player,
        `${pn(draft, action.player)} paid ${price} token${price > 1 ? 's' : ''} to move the robber`,
      );
    }
    return ok(draft);
  },

  'tb/knightForTokens': (draft, action) => {
    if (!isTwo(draft)) return fail('only in Catan for Two');
    const err = knightForTokensBlocker(draft, action.player);
    if (err) return fail(err);
    knightForTokens(draft, action.player);
    return ok(draft);
  },
};

function wagonHandler(
  draft: GameState,
  action: { type: string; player: PlayerId },
  start: boolean,
): ActionResult {
  const a = action as unknown as { vertex?: unknown; player: PlayerId };
  if (!has(draft, 'traders')) return fail('no wagons in this game');
  const err = wagonStepBlocker(draft, a.player, a.vertex, start);
  if (err) return fail(err);
  if (start) {
    draft.phase = asPhase({ kind: 'tb/wagon' });
    log(draft, a.player, `${pn(draft, a.player)} sets off with the wagon`);
  }
  wagonStep(draft, a.player, a.vertex as VertexId);
  return ok(draft);
}

function neutralHandler(
  draft: GameState,
  action: { type: string; player: PlayerId },
): ActionResult {
  const a = action as unknown as {
    type: string;
    player: PlayerId;
    edge?: unknown;
    vertex?: unknown;
    neutral?: unknown;
  };
  const phase = phaseOf(draft);
  if (phase.kind !== 'tb/neutral') return fail('no neutral piece to build');
  if (!isCurrent(draft, a.player)) return fail('not your turn');
  if (a.neutral !== 0 && a.neutral !== 1) return fail('pick a neutral player');
  const piece = a.type === 'tb/neutralRoad' ? 'road' : 'settlement';
  if (piece !== phase.piece) return fail(`build a neutral ${phase.piece}`);
  const opt = neutralOptions(draft, piece, phase.bridge === true).find(
    (o) =>
      o.neutral === a.neutral && (piece === 'road' ? o.edge === a.edge : o.vertex === a.vertex),
  );
  if (!opt) return fail('the neutral player cannot build there');
  placeNeutral(draft, opt);
  draft.phase = phase.resume;
  return ok(draft);
}

// ---------------------------------------------------------------------------
// Statistics: where T&B hand changes go (not "Other")
// ---------------------------------------------------------------------------

function statsCategory(action: Action, p: PlayerId) {
  const a = asTb(action);
  const mine = p === action.player;
  switch (a.type) {
    case 'tb/buyResource':
      return { gain: 'bank' as const };
    case 'tb/sellForGold':
      return { loss: 'bank' as const };
    case 'tb/fish':
      if (a.use === 'steal') return mine ? { gain: 'steal' as const } : { loss: 'stolen' as const };
      return { gain: 'bank' as const };
    case 'tb/buildBridge':
    case 'tb/upgradeWagon':
    case 'tb/wagonGrain':
    case 'tb/moveKnight':
    case 'tb/bid':
      return { loss: 'build' as const };
    case 'tb/buyCard':
      return { loss: 'buyDev' as const };
    case 'tb/placeBarbarian':
      return mine ? { gain: 'steal' as const } : { loss: 'stolen' as const };
    case 'tb/forcedTrade':
    case 'tb/forcedGive':
      return { gain: 'trade' as const, loss: 'trade' as const };
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// The module
// ---------------------------------------------------------------------------

function init(draft: GameState, rng: Rng): void {
  const n = draft.players.length;
  const slice: TbSlice = {
    v: 1,
    gold: draft.players.map(() => 0),
    goldBuys: 0,
    harbormaster: null,
  };
  if (has(draft, 'fish')) slice.fish = initFish(n, rng);
  if (has(draft, 'rivers')) slice.rivers = { bridges: {} };
  if (has(draft, 'caravans')) slice.caravans = initCaravans(draft);
  if (has(draft, 'ba')) slice.ba = initBa(draft, rng);
  if (has(draft, 'traders')) {
    slice.traders = initTraders(draft, rng);
    slice.gold = startGold(n);
  }
  const gold = sheetRules(draft).startGold;
  if (gold !== undefined) slice.gold = draft.players.map(() => gold);
  if (n === 2) slice.two = initTwo();
  draft.ext[TB] = slice;
}

/** Second roll of Catan for Two: back to preRoll once the first roll is resolved. */
function secondRoll(draft: GameState): void {
  const two = tbSlice(draft).two;
  if (!two || two.rolls !== 1 || draft.phase.kind !== 'main') return;
  if (draft.turn.secondSettlerOf !== undefined) return;
  draft.phase = { kind: 'preRoll' };
  if (draft.settings.rushMode) rollFor(draft, draft.turn.current);
}

/** Gold, tokens and fish for a new settlement on `v` (setup or built). */
function settled(draft: GameState, p: PlayerId, v: VertexId, setup: boolean): void {
  const riverGold = setup || !sheetRules(draft).riverGoldSetupOnly;
  if (has(draft, 'rivers') && riverGold && vertexOnRiver(draft, v)) {
    addGold(draft, p, 1);
    log(draft, p, `${pn(draft, p)} got 1 gold (river)`);
  }
  if (isTwo(draft) && tokensInPlay(draft)) {
    const n = settlementTokens(draft, v);
    if (n > 0) earnTokens(draft, p, n, 'settlement');
  }
}

function roadBuilt(draft: GameState, p: PlayerId, e: EdgeId): void {
  if (has(draft, 'rivers') && edgeOnRiver(draft, e)) {
    addGold(draft, p, 1);
    log(draft, p, `${pn(draft, p)} got 1 gold (river)`);
  }
}

function neutralAfter(draft: GameState, piece: 'road' | 'settlement'): void {
  if (!isTwo(draft)) return;
  const next = neutralFollowUp(draft, piece, draft.phase);
  if (next) draft.phase = asPhase(next);
}

export const tbModule: ExpansionModule = {
  id: TB,
  name: 'Traders & Barbarians',
  players: { min: 2, max: 6 },
  terrains: {
    'tb/lake': { kind: 'land', name: 'Lake', color: '#4f8fb8' },
    'tb/swamp': { kind: 'land', name: 'Swamp', color: '#6b7a4a' },
    'tb/oasis': { kind: 'land', name: 'Oasis', color: '#d9c27a' },
    'tb/castle': { kind: 'land', name: 'Castle', color: '#9a8f86' },
    'tb/tradeCastle': { kind: 'land', name: 'Castle (trade)', color: '#a88f6a' },
    'tb/quarry': { kind: 'land', name: 'Quarry', color: '#b9b2a6' },
    'tb/glassworks': { kind: 'land', name: 'Glassworks', color: '#8fc3c9' },
  },
  maps: TB_MAPS,
  scenarios: [
    {
      id: SC_BASE,
      name: 'Variants only',
      blurb: 'The base game with the T&B variants: Catan for Two at 2 players, Harbormaster',
      players: { min: 2, max: 6 },
      maps: ['tb/base19', 'base56'],
      mapFor: (n) => (n <= 4 ? 'tb/base19' : 'base56'),
      vpToWin: 10,
    },
    {
      id: SC_FISH,
      name: 'Fishermen of Catan',
      blurb: 'Fish from the lake and the fishing grounds buy special actions; beware the old boot',
      players: { min: 2, max: 6 },
      maps: ['tb/fish19', 'tb/fish30'],
      mapFor: (n) => (n <= 4 ? 'tb/fish19' : 'tb/fish30'),
      vpToWin: 10,
    },
    {
      id: SC_RIVERS,
      name: 'Rivers of Catan',
      blurb: 'Bridges, gold, the Wealthiest and the Poor Settler',
      players: { min: 2, max: 6 },
      maps: ['tb/rivers19', 'tb/rivers30'],
      mapFor: (n) => (n <= 4 ? 'tb/rivers19' : 'tb/rivers30'),
      vpToWin: 10,
    },
    {
      id: SC_CARAVANS,
      name: 'The Caravans',
      blurb: 'Vote with wool and grain where the camels go; build between camels',
      players: { min: 2, max: 6 },
      maps: ['tb/caravans19', 'tb/caravans30'],
      mapFor: (n) => (n <= 4 ? 'tb/caravans19' : 'tb/caravans30'),
      vpToWin: 12,
    },
    {
      id: SC_BA,
      name: 'Barbarian Attack',
      blurb: 'Barbarians conquer the coast; knights drive them out and take prisoners',
      players: { min: 3, max: 6 },
      maps: ['tb/ba19', 'tb/ba30'],
      mapFor: (n) => (n <= 4 ? 'tb/ba19' : 'tb/ba30'),
      vpToWin: 12,
    },
    {
      id: SC_TRADERS,
      name: 'Traders & Barbarians',
      blurb: 'Wagons carry commodities between the castle, quarry and glassworks',
      players: { min: 2, max: 6 },
      maps: ['tb/traders19', 'tb/traders37'],
      mapFor: (n) => (n <= 4 ? 'tb/traders19' : 'tb/traders37'),
      vpToWin: 13,
    },
  ],
  modes: [
    {
      id: TB,
      name: 'Traders & Barbarians',
      blurb: 'Five scenarios and the variants, Catan for Two included',
      status: 'ready',
      expansions: [TB],
      scenarios: [SC_FISH, SC_RIVERS, SC_CARAVANS, SC_BA, SC_TRADERS, SC_BASE],
      players: { min: 2, max: 6 },
    },
  ],
  options: [
    {
      key: 'harbormaster',
      label: 'Harbormaster',
      description:
        'Harbour points (settlement 1, city 2): 3+ and the most take a 2 VP card. Goal +1',
      type: 'boolean',
      default: false,
      vpBonus: 1,
    },
  ],

  validate(settings) {
    const f = featuresOf(settings.scenario);
    const noRobber = f.includes('ba') || f.includes('traders');
    if (noRobber && (settings.robberMode ?? 'normal') !== 'normal') {
      return 'This scenario has no robber: the robber variants do not apply';
    }
    const endSteps = noRobber || f.includes('caravans');
    if (endSteps && settings.secondSettler) {
      return 'This scenario has an end-of-turn step: use the special building phase, not the paired turn';
    }
    return null;
  },

  init,
  actions,

  legal(state) {
    const out: Action[] = [];
    if (has(state, 'fish')) out.push(...fishLegal(state));
    if (has(state, 'rivers')) out.push(...riversLegal(state));
    if (has(state, 'caravans')) out.push(...caravansLegal(state));
    if (has(state, 'ba')) out.push(...baLegal(state));
    if (has(state, 'traders')) out.push(...tradersLegal(state));
    if (isTwo(state)) out.push(...twoLegal(state));
    const p = state.turn.current;
    if (usesGold(state)) {
      for (const r of RESOURCES) {
        if (buyResourceBlocker(state, p, r) === null) {
          out.push({ type: 'tb/buyResource', player: p, resource: r } as unknown as Action);
        }
        if (sellBlocker(state, p, r) === null) {
          out.push({ type: 'tb/sellForGold', player: p, resource: r } as unknown as Action);
        }
      }
    }
    const k = state.phase.kind;
    if ((k === 'tb/wagon' || k === 'tb/knights') && endTurnBlocker(state, p) === null) {
      out.push({ type: 'endTurn', player: p });
    }
    // T&B: the base deck is empty but Swift Journeys are left.
    if (has(state, 'traders') && state.devDeck.length === 0 && tradersOf(state).swift.deck > 0) {
      const hand = state.players[p]?.resources;
      if (
        (k === 'main' || k === 'specialBuild') &&
        hand &&
        hasResources(hand, costOf(state, 'devCard'))
      ) {
        out.push({ type: 'buyDevCard', player: p });
      }
    }
    return out;
  },

  filterLegal(state, list) {
    return list.filter((a) => {
      switch (a.type) {
        case 'moveRobber':
          return !(has(state, 'caravans') && state.board.hexes[a.hex]?.terrain === OASIS);
        case 'endTurn':
          return endTurnBlocker(state, a.player) === null;
        case 'buildCity':
          return !isConqueredBuilding(state, a.vertex);
        default:
          return true;
      }
    });
  },

  overrides: {
    placeSetupSettlement: (draft, action, next) => {
      const index = draft.phase.kind === 'setup' ? draft.phase.index : 0;
      const r = next(draft, action);
      if (!r.ok) return r;
      settled(draft, action.player, action.vertex, true);
      if (index >= draft.players.length) {
        if (has(draft, 'fish')) setupFish(draft, action.player, action.vertex);
        if (has(draft, 'traders')) tradersOf(draft).wagons[action.player] = action.vertex;
      }
      return r;
    },
    placeSetupRoad: (draft, action, next) => {
      const r = next(draft, action);
      if (r.ok) roadBuilt(draft, action.player, action.edge);
      return r;
    },
    buildRoad: (draft, action, next) => {
      const r = next(draft, action);
      if (!r.ok) return r;
      roadBuilt(draft, action.player, action.edge);
      neutralAfter(draft, 'road');
      return r;
    },
    placeFreeRoad: (draft, action, next) => {
      const r = next(draft, action);
      if (!r.ok) return r;
      roadBuilt(draft, action.player, action.edge);
      neutralAfter(draft, 'road');
      return r;
    },
    buildSettlement: (draft, action, next) => {
      const r = next(draft, action);
      if (!r.ok) return r;
      settled(draft, action.player, action.vertex, false);
      if (has(draft, 'caravans')) noteBuilt(draft, action.player);
      if (has(draft, 'ba')) landBarbarians(draft);
      neutralAfter(draft, 'settlement');
      return r;
    },
    buildCity: (draft, action, next) => {
      if (isConqueredBuilding(draft, action.vertex))
        return fail('a conquered settlement cannot be upgraded');
      const r = next(draft, action);
      if (!r.ok) return r;
      if (has(draft, 'caravans')) noteBuilt(draft, action.player);
      if (has(draft, 'ba')) landBarbarians(draft);
      return r;
    },
    discard: (draft, action, next) => {
      const r = next(draft, action);
      if (!r.ok || draft.phase.kind !== 'moveRobber' || !robberless(draft)) return r;
      draft.phase = sevenPhase(draft);
      return r;
    },
    playKnight: (draft, action, next) => {
      const r = next(draft, action);
      if (r.ok && has(draft, 'traders') && draft.phase.kind === 'moveRobber') {
        draft.phase = asPhase({
          kind: 'tb/barbarian',
          from: null,
          steal: true,
          resume: draft.phase.resume,
        });
      }
      return r;
    },
    moveRobber: (draft, action, next) => {
      if (has(draft, 'caravans') && draft.board.hexes[action.hex]?.terrain === OASIS) {
        return fail('the robber may not stand on the oasis');
      }
      return next(draft, action);
    },
    buyDevCard: (draft, action, next) => {
      if (!has(draft, 'traders') || !drawsSwiftFor(draft, action.player))
        return next(draft, action);
      const p = action.player;
      const s = tradersOf(draft);
      payBank(draft, p, costOf(draft, 'devCard'));
      s.swift.deck -= 1;
      if (draft.phase.kind === 'specialBuild') s.swift.held[p] = (s.swift.held[p] ?? 0) + 1;
      else s.swift.fresh[p] = (s.swift.fresh[p] ?? 0) + 1;
      log(draft, p, `${pn(draft, p)} bought a development card`);
      return ok(draft);
    },
    endTurn: (draft, action, next) => {
      const k = draft.phase.kind;
      if (k === 'tb/wagon' || k === 'tb/knights') {
        if (!isCurrent(draft, action.player)) return fail('not your turn');
        draft.phase = { kind: 'main' };
      }
      if (draft.phase.kind !== 'main') return next(draft, action);
      if (!isCurrent(draft, action.player)) return fail('not your turn');
      const err = endTurnBlocker(draft, action.player);
      if (err) return fail(err);
      if (endOfTurnBattle(draft, action.player)) return ok(draft);
      if (
        has(draft, 'caravans') &&
        caravansOf(draft).built &&
        draft.turn.secondSettlerOf === undefined
      ) {
        caravansOf(draft).built = false;
        const vote = startVote(draft, action.player);
        if (vote) {
          log(
            draft,
            action.player,
            `${pn(draft, action.player)} ended the building: the camel vote begins`,
          );
          draft.phase = asPhase(vote);
          return ok(draft);
        }
      }
      return next(draft, action);
    },
  },

  changesRoads: ['tb/buildBridge', 'tb/neutralRoad', 'tb/neutralSettlement', 'tb/placeCamel'],

  actors(state) {
    return (
      voteActors(state) ?? (state.phase.kind.startsWith('tb/') ? [state.turn.current] : undefined)
    );
  },

  hooks: {
    extraDevCards: swiftDevCards,

    setupBuilding: (state, index) =>
      (has(state, 'ba') || has(state, 'traders')) && index >= state.players.length
        ? 'city'
        : undefined,

    rollDice(draft) {
      // T&B re-rolls a 2 or 12 when no hex carries them (5-6 and the sheets with those discs: no).
      const reroll212 = has(draft, 'traders') && !carries212(draft);
      const two = tbSlice(draft).two;
      const avoid = two && two.rolls === 1 ? two.firstRoll : null;
      if (!reroll212 && avoid === null) return undefined;
      let dice: [number, number] = [1, 1];
      for (let i = 0; i < 200; i++) {
        dice = rollTwoDice(draft).dice;
        const sum = dice[0] + dice[1];
        if (reroll212 && (sum === 2 || sum === 12)) continue;
        if (sum === avoid) continue;
        break;
      }
      return dice;
    },

    onRoll(draft, roll) {
      const two = tbSlice(draft).two;
      if (two) {
        two.rolls += 1;
        if (two.rolls === 1) two.firstRoll = roll;
      }
      // Robber Flees on a board without a desert: the robber leaves the board.
      if (draft.settings.eventCards && draft.lastEvent === 'robberFlees' && !robberless(draft)) {
        if (has(draft, 'fish') || has(draft, 'rivers') || has(draft, 'caravans'))
          draft.robber = NO_ROBBER;
      }
      return undefined;
    },

    onSeven(draft, pending) {
      if (!robberless(draft)) return undefined;
      if (pending.some((n) => n > 0)) return { kind: 'discard', pending: [...pending] };
      return sevenPhase(draft);
    },

    production(state, roll, owed, ctx) {
      // Rivers (and Fishing + Caravans): the 12 hex produces on a 2 as well; a sheet's alsoOn.
      for (const { hex: h, number } of extraNumbers(state)) {
        const tile = state.board.hexes[h];
        if (number !== roll || !tile || h === ctx.blocked || isConqueredHex(state, h)) continue;
        if (!isResource(tile.terrain)) continue;
        const r = tile.terrain;
        for (const v of hexVertices(topologyOf(state), h)) {
          const b = state.pieces.buildings[v];
          const hand = b && owed[b.owner];
          if (hand) hand[r] += b.kind === 'city' ? ctx.cityYield : 1;
        }
      }
      if (has(state, 'ba')) conqueredProduction(state, roll, owed, ctx.cityYield);
    },

    afterProduction(draft, roll) {
      if (has(draft, 'fish')) payFish(draft, roll);
      return undefined;
    },

    cost(_state, item, base) {
      if (item === BRIDGE_ITEM) return BRIDGE_COST;
      if (item === BA_CARD_ITEM) return COSTS.devCard;
      return base;
    },

    pieceLimit(state, p, kind, base) {
      if (kind === 'road' && has(state, 'rivers')) return base + bridgesBuilt(state, p);
      return base;
    },

    vertexBlocked(state, v) {
      if (isTwo(state) && neutralBlocksVertex(state, v)) return true;
      if (
        has(state, 'traders') &&
        (isCentreVertex(v) || (tbBoard(state).noBuild ?? []).includes(v))
      )
        return true;
      return has(state, 'ba') && vertexNextToConquered(state, v);
    },

    edgeBlocked(state, e) {
      if (isTwo(state) && neutralRoadAt(state, e) !== null) return true;
      if (has(state, 'rivers') && isBridgeSite(state, e)) return true;
      if (has(state, 'traders') && (tbBoard(state).noRoad ?? []).includes(e)) return true;
      return has(state, 'ba') && edgeNextToConquered(state, e);
    },

    blocksRoute: (state, v) => isTwo(state) && neutralAt(state, v) !== null,

    victoryPoints(state, p) {
      const parts: { label: string; vp: number }[] = [];
      if (harbormasterOn(state) && tbSlice(state).harbormaster === p) {
        parts.push({ label: 'Harbormaster', vp: HARBORMASTER_VP });
      }
      if (has(state, 'rivers')) parts.push(...riversVictoryParts(state, p));
      if (has(state, 'caravans')) {
        const n = caravanVictoryPoints(state, p);
        if (n > 0) parts.push({ label: 'Between camels', vp: n });
      }
      if (has(state, 'ba')) parts.push(...baVictoryParts(state, p));
      if (has(state, 'traders')) parts.push(...tradersVictoryParts(state, p));
      // The old boot: its owner needs one more VP (not a negative VP on the table, FAQ 47).
      const hidden = has(state, 'fish') && tbSlice(state).fish?.boot === p ? -1 : 0;
      return { public: parts.reduce((n, x) => n + x.vp, 0), hidden, parts };
    },

    bankTradeRatio: (state, p, r, base) => (has(state, 'ba') ? baTradeRatio(state, p, r) : base),

    roadLength(state, p, base) {
      if (has(state, 'traders')) return 0;
      // max: a combination's longer route (camels on ships, T&B + Seafarers) is kept.
      let n = has(state, 'caravans') ? Math.max(base, camelRoadLength(state, p)) : base;
      if (isTwo(state)) n = lengthAgainstNeutrals(state, p, n);
      return n;
    },

    supply: (state, base) => (has(state, 'ba') ? { ...base, devDeck: emptyDevCards() } : base),

    onStartTurn(draft, p) {
      const s = tbSlice(draft);
      s.goldBuys = 0;
      if (s.two) {
        s.two.rolls = 0;
        s.two.firstRoll = null;
        s.two.tokenUsed = false;
        s.two.knightTraded = false;
      }
      if (s.traders) s.traders.move = freshMove(s.traders.level[p] ?? 1);
      if (s.ba) s.ba.moved = [];
      if (s.caravans) {
        s.caravans.built = false;
        // 5-6: a settlement / city built in the special build phase calls one more camel; the
        // player whose turn it was starts the vote and breaks ties. (Not with Rush mode, which
        // rolls right away.)
        if (s.caravans.sbpBuilt && !draft.settings.rushMode) {
          s.caravans.sbpBuilt = false;
          const owner = (p - 1 + draft.players.length) % draft.players.length;
          const vote = startVote(draft, owner, 'preRoll');
          if (vote) draft.phase = asPhase(vote);
        }
      }
    },

    onEndTurn(draft, p) {
      const t = tbSlice(draft).traders;
      if (t) {
        t.swift.held[p] = (t.swift.held[p] ?? 0) + (t.swift.fresh[p] ?? 0);
        t.swift.fresh[p] = 0;
      }
    },

    afterAction(draft) {
      // No robber in BA / T&B: Robber Flees (Event Cards) must not bring one to the desert.
      if (robberless(draft) && draft.robber !== NO_ROBBER) draft.robber = NO_ROBBER;
      if (harbormasterOn(draft)) updateHarbormaster(draft);
      if (isTwo(draft)) secondRoll(draft);
    },

    statsCategory: (_state, action, p) => statsCategory(action as Action, p),

    maskFor: tbMaskFor,
  },
};

/** After a 7 without a robber: BA steals from any player (BA + T&B too), T&B moves a barbarian. */
function sevenPhase(draft: GameState): Phase {
  if (has(draft, 'traders') && !has(draft, 'ba')) {
    return asPhase({ kind: 'tb/barbarian', from: null, steal: true, resume: 'main' });
  }
  const p = draft.turn.current;
  const candidates = draft.players
    .map((x) => x.id)
    .filter((o) => o !== p && handTotal(draft, o) > 0);
  return candidates.length > 0 ? { kind: 'steal', candidates, resume: 'main' } : { kind: 'main' };
}

/** A hex carries a 2 or a 12 (token or extra number). */
const carries212 = (state: GameState): boolean =>
  Object.values(state.board.hexes).some((h) => h.token === 2 || h.token === 12) ||
  extraNumbers(state).some((x) => x.number === 2 || x.number === 12);

/** buyDevCard draws a Swift Journey (by its share of the remaining cards). */
function drawsSwiftFor(draft: GameState, p: PlayerId): boolean {
  const k = draft.phase.kind;
  if ((k !== 'main' && k !== 'specialBuild') || !isCurrent(draft, p)) return false;
  const hand = draft.players[p]?.resources;
  if (!hand || !hasResources(hand, costOf(draft, 'devCard'))) return false;
  return drawsSwift(draft);
}
