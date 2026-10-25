/**
 * OWNER: T2 (rules-core).
 * rollDice (phase preRoll): two dice via Rng, set state.dice, then
 *   - 7  -> discard phase if anyone holds > DISCARD_THRESHOLD cards, else moveRobber{resume:'main'}
 *   - else production: each settlement 1 / city 2 of the hex's resource, skipping the robber hex.
 *     If the bank can't pay a resource to everyone owed, nobody gets it — unless only one player
 *     is owed, who then gets what's left.
 *   -> main
 * endTurn (phase main): merge newDevCards into devCards, devCardPlayed=false,
 *   advance current, turn.number++, dice stay as last roll, phase = preRoll.
 */
import { DEV_CARD_TYPES, DISCARD_THRESHOLD } from '../constants';
import { produce } from '../rules/production';
import { describeBundle, playerName } from '../rules/text';
import { Rng } from '../rng';
import { emptyDevCards, totalResources } from '../resources';
import { handSize } from '../selectors';
import type { Action, GameState } from '../types';
import { type HandlerMap, type LegalGenerator, fail, isCurrent, log, ok } from './common';

/** Cards each player must discard on a 7 (half, rounded down, if holding > DISCARD_THRESHOLD). */
export function discardAmounts(state: GameState): number[] {
  return state.players.map((p) => {
    const n = handSize(p);
    return n > DISCARD_THRESHOLD ? Math.floor(n / 2) : 0;
  });
}

export const turnHandlers: HandlerMap<'rollDice' | 'endTurn'> = {
  rollDice: (draft, action) => {
    if (draft.phase.kind !== 'preRoll') return fail('cannot roll now');
    if (!isCurrent(draft, action.player)) return fail('not your turn');

    const rng = new Rng(draft.rng);
    const d1 = rng.die();
    const d2 = rng.die();
    draft.rng = rng.state;
    draft.dice = [d1, d2];
    const roll = d1 + d2;
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
    draft.turn = {
      number: draft.turn.number + 1,
      current: (draft.turn.current + 1) % draft.players.length,
      devCardPlayed: false,
    };
    draft.phase = { kind: 'preRoll' };
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
    default:
      return [];
  }
};
