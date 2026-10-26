/**
 * OWNER: T2 (rules-core); special build phase + balanced dice: T13.
 * rollDice (phase preRoll): two dice (rules/dice.ts: plain, or the balanced dice deck), set
 *   state.dice, then
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
 */
import { DEV_CARD_TYPES } from '../constants';
import { produce } from '../rules/production';
import { rollTwoDice } from '../rules/dice';
import { describeBundle, playerName } from '../rules/text';
import { emptyDevCards, totalResources } from '../resources';
import { handSize } from '../selectors';
import type { Action, GameState, PlayerId } from '../types';
import { buildLegal } from './build';
import { type HandlerMap, type LegalGenerator, fail, isCurrent, log, ok } from './common';
import { canBuyDevCard } from './dev';

/** Cards each player must discard on a 7 (half, rounded down, if holding > settings.discardLimit). */
export function discardAmounts(state: GameState): number[] {
  return state.players.map((p) => {
    const n = handSize(p);
    return n > state.settings.discardLimit ? Math.floor(n / 2) : 0;
  });
}

/** In a specialBuild phase for `state.turn.current`: can they build or buy anything? */
function canSpecialBuild(state: GameState): boolean {
  return canBuyDevCard(state, state.turn.current) === null || buildLegal(state).length > 0;
}

/**
 * Hand the special build step to the next player after `from` (clockwise, stopping before
 * `owner`) who can do something; when there is none, start owner+1's turn.
 */
function advanceSpecialBuild(draft: GameState, owner: PlayerId, from: PlayerId): void {
  const n = draft.players.length;
  for (let b = (from + 1) % n; b !== owner; b = (b + 1) % n) {
    draft.turn.current = b;
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
  draft.phase = { kind: 'preRoll' };
}

export const turnHandlers: HandlerMap<'rollDice' | 'endTurn' | 'passSpecialBuild'> = {
  rollDice: (draft, action) => {
    if (draft.phase.kind !== 'preRoll') return fail('cannot roll now');
    if (!isCurrent(draft, action.player)) return fail('not your turn');

    const { dice, reshuffled } = rollTwoDice(draft);
    draft.dice = dice;
    const roll = dice[0] + dice[1];
    if (reshuffled) log(draft, null, 'The dice deck was shuffled');
    log(draft, action.player, `${playerName(draft, action.player)} rolled ${roll}`);

    if (roll === 7) {
      const pending = discardAmounts(draft);
      draft.phase = pending.some((n) => n > 0)
        ? { kind: 'discard', pending }
        : { kind: 'moveRobber', resume: 'main' };
      return ok(draft);
    }

    produce(draft, roll).forEach((gain, p) => {
      if (totalResources(gain) > 0) {
        log(draft, p, `${playerName(draft, p)} received ${describeBundle(gain)}`);
      }
    });
    draft.phase = { kind: 'main' };
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
    if (draft.settings.specialBuildPhase) {
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
