/**
 * The C&K legal generator: builds (knights, walls, improvements), knight actions, progress
 * cards, trades with commodities, discards with commodities and every prompt answer. Sound by
 * construction: it calls the same blockers as the handlers.
 */
import { MAX_TRADE_OFFERS_PER_TURN } from '../../../engine/constants';
import { buildingsOf } from '../../../engine/selectors';
import type { Action, GameState, PlayerId, VertexId } from '../../../engine/types';
import { playBlocker } from './cards';
import { choiceAction, promptFor } from './prompts';
import { networkOf, touchesRoad, isEmptyVertex } from './routes';
import {
  activateBlocker,
  buildKnightBlocker,
  bundleOptions,
  canChase,
  goodCount,
  improveBlocker,
  knightActionBlocker,
  promoteBuildBlocker,
  wallBlocker,
  wallSpotOk,
} from './rules';
import {
  GOODS,
  MAX_KNIGHT_CANCELS,
  PROGRESS_HAND_MAX,
  TRACKS,
  ckSlice,
  commodityTotal,
  isCommodity,
  type CkAction,
  phaseOf,
} from './state';
import { bankTradeBlocker } from './trade';

const act = (a: CkAction) => a as unknown as Action;

/** Knight / wall / improvement builds of the builder (main or special build). */
function builds(state: GameState, p: PlayerId, out: Action[]): void {
  const s = ckSlice(state);
  if (buildKnightBlocker(state, p, null) === null) {
    for (const v of networkOf(state, p)) {
      if (isEmptyVertex(state, v) && touchesRoad(state, p, v)) {
        out.push(act({ type: 'ck/buildKnight', player: p, vertex: v }));
      }
    }
  }
  for (const [v, k] of Object.entries(s.knights) as [VertexId, (typeof s.knights)[VertexId]][]) {
    if (!k || k.owner !== p) continue;
    if (activateBlocker(state, p, v) === null) {
      out.push(act({ type: 'ck/activateKnight', player: p, vertex: v }));
    }
    if (promoteBuildBlocker(state, p, v) === null) {
      out.push(act({ type: 'ck/promoteKnight', player: p, vertex: v }));
    }
  }
  if (wallBlocker(state, p, null) === null) {
    for (const v of buildingsOf(state, p, 'city')) {
      if (wallSpotOk(state, p, v)) out.push(act({ type: 'ck/buildWall', player: p, vertex: v }));
    }
  }
  for (const track of TRACKS) {
    if (improveBlocker(state, p, track) === null) {
      out.push(act({ type: 'ck/improve', player: p, track }));
    }
  }
}

function mainActions(state: GameState, p: PlayerId, out: Action[]): void {
  const s = ckSlice(state);
  const pl = s.players[p];
  if (!pl) return;
  // Knight actions.
  if (s.turn.cancels < MAX_KNIGHT_CANCELS) {
    for (const [v, k] of Object.entries(s.knights) as [VertexId, (typeof s.knights)[VertexId]][]) {
      if (k?.owner === p && knightActionBlocker(state, p, v) === null) {
        out.push(act({ type: 'ck/selectKnight', player: p, vertex: v }));
      }
    }
  }
  // Progress cards.
  for (const card of new Set(pl.progress)) {
    if (playBlocker(state, p, card) === null) out.push(act({ type: 'ck/play', player: p, card }));
  }
  if (pl.progress.length > PROGRESS_HAND_MAX) {
    for (const card of new Set(pl.progress)) {
      out.push(act({ type: 'ck/discardProgress', player: p, card }));
    }
  }
  // Bank trades involving a commodity.
  for (const give of GOODS) {
    if (goodCount(state, p, give) === 0) continue;
    for (const receive of GOODS) {
      if (!isCommodity(give) && !isCommodity(receive)) continue;
      if (bankTradeBlocker(state, p, give, receive) === null) {
        out.push(act({ type: 'ck/bankTrade', player: p, give, receive }));
      }
    }
  }
  // A sample of player offers with commodities: 1 for 1 to everyone.
  if (
    state.turn.tradeOffers < MAX_TRADE_OFFERS_PER_TURN &&
    state.turn.secondSettlerOf === undefined
  ) {
    const to = state.players.filter((q) => q.id !== p).map((q) => q.id);
    for (const give of GOODS) {
      if (goodCount(state, p, give) === 0) continue;
      for (const want of GOODS) {
        if (want === give || (!isCommodity(give) && !isCommodity(want))) continue;
        out.push(
          act({ type: 'ck/offerTrade', player: p, give: { [give]: 1 }, want: { [want]: 1 }, to }),
        );
      }
    }
  }
}

function discards(state: GameState, pending: readonly number[], all: boolean, out: Action[]): void {
  const s = ckSlice(state);
  pending.forEach((owed, p) => {
    if (owed <= 0) return;
    // In the 7's discard phase, players without commodities use the base discard action.
    if (!all && commodityTotal(s.players[p]?.commodities ?? {}) === 0) return;
    for (const b of bundleOptions(state, p, owed)) {
      out.push(
        act({ type: 'ck/discard', player: p, resources: b.resources, commodities: b.commodities }),
      );
    }
  });
}

export function ckLegal(state: GameState): Action[] {
  const out: Action[] = [];
  const phase = phaseOf(state);
  const p = state.turn.current;
  switch (phase.kind) {
    case 'preRoll': {
      if (ckSlice(state).players[p]?.progress.includes('alchemist')) {
        for (let yellow = 1; yellow <= 6; yellow++) {
          for (let red = 1; red <= 6; red++) {
            out.push(act({ type: 'ck/alchemist', player: p, yellow, red }));
          }
        }
      }
      return out;
    }
    case 'main':
      builds(state, p, out);
      mainActions(state, p, out);
      return out;
    case 'specialBuild':
      builds(state, p, out);
      return out;
    case 'discard':
      discards(state, phase.pending, false, out);
      return out;
    case 'ck/sabotage':
    case 'ck/wedding':
      discards(state, phase.pending, true, out);
      return out;
    case 'ck/knight': {
      if (canChase(state, p, phase.vertex)) out.push(act({ type: 'ck/chaseRobber', player: p }));
      out.push(act({ type: 'ck/cancel', player: p }));
      break;
    }
    default:
      break;
  }
  const prompt = promptFor(state);
  if (prompt) for (const c of prompt.options) out.push(choiceAction(prompt.actor, c));
  return out;
}
