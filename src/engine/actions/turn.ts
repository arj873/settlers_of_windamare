/**
 * OWNER: T2 (rules-core); special build phase + balanced dice: T13.
 * rollDice (phase preRoll): two dice (rules/dice.ts: plain, or the balanced dice deck), set
 *   state.dice, log "Blue rolled 8 (3+5)" (before T14 the log had no faces: "Blue rolled 8"), then
 *   - 7  -> discard phase if anyone holds > settings.discardLimit cards, else moveRobber{resume:'main'}
 *   - else production: each settlement 1 / city 2 of the hex's resource, skipping the robber hex.
 *     If the bank can't pay a resource to everyone owed, nobody gets it — unless only one player
 *     is owed, who then gets what's left.
 *   -> main
 * endTurn (phase main): merge newDevCards into devCards, devCardPlayed=false, tradeOffers=0, then
 *   - settings.specialBuildPhase: specialBuild{builder, owner} for the first player after the
 *     owner (clockwise) who could build or buy something; turn.current = builder,
 *     turn.number unchanged. Nobody able to -> straight to the next turn.
 *   - otherwise / after the last builder: current = owner+1, turn.number++, phase = preRoll.
 *   Dice stay as the last roll.
 * passSpecialBuild (phase specialBuild, the builder): next builder, or the next turn as above.
 * V1 variants (RULES.md §18): rollFor draws an event card instead with settings.eventCards
 *   (actions/events.ts); settings.rushMode rolls automatically as each turn starts (beginTurn);
 *   settings.secondSettler: endTurn hands a `main` step to the third player to the left
 *   (turn.secondSettlerOf = owner), whose endTurn starts owner+1's turn.
 */
import { DEV_CARD_TYPES } from '../constants';
import { hookRollDice, runOnEndTurn, runOnRoll, runOnStartTurn } from '../expansions/hooks';
import { activeModules } from '../expansions/registry';
import { rollTwoDice } from '../rules/dice';
import { playerName } from '../rules/text';
import { emptyDevCards } from '../resources';
import { recordRoll } from '../stats';
import type { Action, GameState, PlayerId } from '../types';
import { eventCardsOn } from '../variants';
import { buildLegal } from './build';
import { type HandlerMap, type LegalGenerator, fail, isCurrent, log, ok } from './common';
import { canBuyDevCard, devLegal } from './dev';
import { drawEventRoll, produceAndContinue, resolveDrawnEvent } from './events';
import { discardAmounts, resolveSeven } from './robber';

export { discardAmounts };

/**
 * The roll of `player` (turn.current, phase preRoll): two dice (plain, balanced, or an
 * expansion's rollDice hook), then the onRoll hooks (an interrupt) or continueRoll; or an event
 * card (settings.eventCards, which ends in continueRoll's afterProduction step too). Sets the
 * next phase.
 */
export function rollFor(draft: GameState, player: PlayerId): void {
  if (eventCardsOn(draft.settings)) {
    // The card's number is the roll: the onRoll hooks run before its event (C&K event die).
    drawEventRoll(draft, player);
    const interrupt = runOnRoll(draft, draft.dice ? draft.dice[0] + draft.dice[1] : 0);
    if (interrupt) draft.phase = interrupt;
    else resolveDrawnEvent(draft);
    recordRoll(draft, player);
    return;
  }
  const custom = hookRollDice(draft);
  const { dice, reshuffled } = custom ? { dice: custom, reshuffled: false } : rollTwoDice(draft);
  draft.dice = dice;
  const roll = dice[0] + dice[1];
  if (reshuffled) log(draft, null, 'The dice deck was shuffled');
  log(draft, player, `${playerName(draft, player)} rolled ${roll} (${dice[0]}+${dice[1]})`);
  recordRoll(draft, player);
  const interrupt = runOnRoll(draft, roll);
  if (interrupt) {
    draft.phase = interrupt;
    return;
  }
  continueRoll(draft);
}

/**
 * A turn of turn.current begins: preRoll, the expansions' onStartTurn hooks, then (Rush Mode)
 * the automatic roll.
 */
export function beginTurn(draft: GameState): void {
  draft.phase = { kind: 'preRoll' };
  runOnStartTurn(draft, draft.turn.current);
  if (draft.settings.rushMode) rollFor(draft, draft.turn.current);
}

/** Second Settler (paired players' turn): Catanian 2 is the third player to the left. */
export function secondSettlerFor(state: GameState, owner: PlayerId): PlayerId {
  return (owner + 3) % state.players.length;
}

/**
 * The rest of a roll after the dice are set and logged (and after any onRoll interrupt): a 7
 * goes to discard / moveRobber (or an expansion's onSeven phase: resolveSeven), anything else
 * produces and goes to main (or an expansion's afterProduction phase). Expansions that
 * interrupted the roll call this when their phase is done.
 */
export function continueRoll(draft: GameState): void {
  // Event Cards: the drawn card's event (lastEvent), then its production.
  if (eventCardsOn(draft.settings)) {
    resolveDrawnEvent(draft);
    return;
  }
  const roll = draft.dice ? draft.dice[0] + draft.dice[1] : 0;
  if (roll === 7) {
    resolveSeven(draft);
    return;
  }
  produceAndContinue(draft, roll);
}

/** In a specialBuild phase for `state.turn.current`: can they build or buy anything? */
function canSpecialBuild(state: GameState): boolean {
  return (
    canBuyDevCard(state, state.turn.current) === null ||
    buildLegal(state).length > 0 ||
    // 5+ rule set: a playable development card is also something to do in the step.
    devLegal(state).some((a) => a.type !== 'buyDevCard') ||
    // An expansion's own builds (C&K knights, walls, improvements).
    activeModules(state).some((m) => (m.legal?.(state).length ?? 0) > 0)
  );
}

/**
 * Special building phase: the builders still to come after the current one, clockwise, as far
 * as can be told now (players who could build or buy in the current state). [] outside the phase.
 */
export function specialBuildQueue(state: GameState): PlayerId[] {
  const phase = state.phase;
  if (phase.kind !== 'specialBuild') return [];
  const n = state.players.length;
  const out: PlayerId[] = [];
  for (let b = (phase.builder + 1) % n; b !== phase.owner; b = (b + 1) % n) {
    const view: GameState = {
      ...state,
      turn: { ...state.turn, current: b, devCardPlayed: false },
      phase: { kind: 'specialBuild', builder: b, owner: phase.owner },
    };
    if (canSpecialBuild(view)) out.push(b);
  }
  return out;
}

/**
 * Hand the special build step to the next player after `from` (clockwise, stopping before
 * `owner`) who can do something; when there is none, start owner+1's turn.
 */
function advanceSpecialBuild(draft: GameState, owner: PlayerId, from: PlayerId): void {
  const n = draft.players.length;
  // A card bought in the step (5+ rule set) becomes playable for the builder's own turn.
  const leaving = draft.players[from];
  if (leaving) {
    for (const t of DEV_CARD_TYPES) leaving.devCards[t] += leaving.newDevCards[t];
    leaving.newDevCards = emptyDevCards();
  }
  for (let b = (from + 1) % n; b !== owner; b = (b + 1) % n) {
    draft.turn.current = b;
    draft.turn.devCardPlayed = false;
    draft.turn.specialOwner = owner;
    draft.phase = { kind: 'specialBuild', builder: b, owner };
    if (canSpecialBuild(draft)) return;
  }
  startTurn(draft, (owner + 1) % n);
}

function startTurn(draft: GameState, player: PlayerId): void {
  draft.turn = {
    number: draft.turn.number + 1,
    current: player,
    devCardPlayed: false,
    tradeOffers: 0,
  };
  beginTurn(draft);
}

export const turnHandlers: HandlerMap<'rollDice' | 'endTurn' | 'passSpecialBuild'> = {
  rollDice: (draft, action) => {
    if (draft.phase.kind !== 'preRoll') return fail('cannot roll now');
    if (!isCurrent(draft, action.player)) return fail('not your turn');
    rollFor(draft, action.player);
    return ok(draft);
  },

  endTurn: (draft, action) => {
    if (draft.phase.kind !== 'main') return fail('cannot end the turn now');
    if (!isCurrent(draft, action.player)) return fail('not your turn');

    const player = draft.players[action.player];
    if (player) {
      for (const t of DEV_CARD_TYPES) player.devCards[t] += player.newDevCards[t];
      player.newDevCards = emptyDevCards();
    }
    log(draft, action.player, `${playerName(draft, action.player)} ended the turn`);
    draft.turn.devCardPlayed = false;
    draft.turn.tradeOffers = 0;
    runOnEndTurn(draft, action.player);
    const pairedOwner = draft.turn.secondSettlerOf;
    if (pairedOwner !== undefined) {
      // Catanian 2 is done: the next player's turn starts.
      startTurn(draft, (pairedOwner + 1) % draft.players.length);
    } else if (draft.settings.secondSettler) {
      const second = secondSettlerFor(draft, action.player);
      draft.turn.current = second;
      draft.turn.secondSettlerOf = action.player;
      draft.phase = { kind: 'main' };
      log(draft, second, `${playerName(draft, second)} takes the second settler step`);
      // Catanian 2 is taking their turn too (RULES.md 18.6d): reset their per-turn flags.
      runOnStartTurn(draft, second);
    } else if (draft.settings.specialBuildPhase) {
      advanceSpecialBuild(draft, action.player, action.player);
    } else {
      startTurn(draft, (action.player + 1) % draft.players.length);
    }
    return ok(draft);
  },

  passSpecialBuild: (draft, action) => {
    const phase = draft.phase;
    if (phase.kind !== 'specialBuild') return fail('not in the special building phase');
    if (phase.builder !== action.player) return fail('not your special build step');
    advanceSpecialBuild(draft, phase.owner, phase.builder);
    return ok(draft);
  },
};

export const turnLegal: LegalGenerator = (state: GameState): Action[] => {
  const player = state.turn.current;
  switch (state.phase.kind) {
    case 'preRoll':
      return [{ type: 'rollDice', player }];
    case 'main':
      return [{ type: 'endTurn', player }];
    case 'specialBuild':
      return [{ type: 'passSpecialBuild', player: state.phase.builder }];
    default:
      return [];
  }
};
