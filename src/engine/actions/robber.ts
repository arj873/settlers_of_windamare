/**
 * OWNER: T2 (rules-core).
 * discard (phase discard, any player with pending > 0): exactly pending[player] cards at once,
 *   returned to the bank. When all pending are 0 -> moveRobber{resume:'main'}.
 * moveRobber (phase moveRobber, current player): must move to a DIFFERENT land hex.
 *   Candidates = other players with a building on that hex and >= 1 card.
 *   none -> phase = resume; otherwise -> steal{candidates, resume}.
 * steal (phase steal): victim in candidates; take one random card via Rng -> phase = resume.
 */
import { RESOURCES } from '../constants';
import { hookDiscardLimit, hookSevenPhase } from '../expansions/hooks';
import { describeBundle, playerName } from '../rules/text';
import { Rng } from '../rng';
import { hasResources, isValidBundle, totalResources } from '../resources';
import { cardsInHand } from '../selectors';
import { hexVertices, isLandHex, topologyOf } from '../topology';
import { hasRobber, isRobberProtected, robberTargets } from '../variants';
import type {
  Action,
  GameState,
  HexId,
  PlayerId,
  Resource,
  ResourceBundle,
  ResourceCounts,
  ResumePhase,
} from '../types';
import {
  type HandlerMap,
  type LegalGenerator,
  fail,
  isCurrent,
  log,
  ok,
  resumePhase,
} from './common';

/** Opponents of `player` with a building on `hex` and at least one card, ascending. */
export function stealCandidates(state: GameState, player: PlayerId, hex: HexId): PlayerId[] {
  const owners = new Set<PlayerId>();
  for (const v of hexVertices(topologyOf(state), hex)) {
    const b = state.pieces.buildings[v];
    if (b && b.owner !== player) owners.add(b.owner);
  }
  return [...owners]
    .filter((p) => {
      const pl = state.players[p];
      return pl !== undefined && cardsInHand(state, p) > 0 && !isRobberProtected(state, p);
    })
    .sort((a, b) => a - b);
}

/**
 * Cards each player must discard on a 7 (half, rounded down, if holding > settings.discardLimit).
 * Expansions change the count and the limit through the handSize / discardLimit hooks.
 */
export function discardAmounts(state: GameState): number[] {
  return state.players.map((p) => {
    const n = cardsInHand(state, p.id);
    const limit = hookDiscardLimit(state, p.id, state.settings.discardLimit);
    return n > limit ? Math.floor(n / 2) : 0;
  });
}

/**
 * A 7 (rolled, or the Robber Attacks event card): an expansion's onSeven phase, else discards
 * if anyone is over, then the robber.
 */
export function resolveSeven(draft: GameState): void {
  const pending = discardAmounts(draft);
  const custom = hookSevenPhase(draft, pending);
  if (custom) draft.phase = custom;
  else if (pending.some((n) => n > 0)) draft.phase = { kind: 'discard', pending };
  else startRobber(draft, 'main');
}

/**
 * After a 7 (once discards are done) or a knight: move the robber, then `resume`. Without a
 * robber (settings.robberMode 'none') go straight to `resume`.
 */
export function startRobber(draft: GameState, resume: ResumePhase): void {
  draft.phase = hasRobber(draft.settings)
    ? { kind: 'moveRobber', resume }
    : resumePhase(draft, resume);
}

/** Every distinct way to choose `count` cards from `hand`. */
export function discardOptions(hand: ResourceCounts, count: number): ResourceBundle[] {
  const out: ResourceBundle[] = [];
  const walk = (i: number, left: number, pick: ResourceBundle): void => {
    const r = RESOURCES[i];
    if (r === undefined) {
      if (left === 0) out.push(pick);
      return;
    }
    const remainingAfter = RESOURCES.slice(i + 1).reduce((s, x) => s + hand[x], 0);
    const min = Math.max(0, left - remainingAfter);
    const max = Math.min(hand[r], left);
    for (let k = min; k <= max; k++) walk(i + 1, left - k, k > 0 ? { ...pick, [r]: k } : pick);
  };
  walk(0, count, {});
  return out;
}

export const robberHandlers: HandlerMap<'discard' | 'moveRobber' | 'steal'> = {
  discard: (draft, action) => {
    const phase = draft.phase;
    if (phase.kind !== 'discard') return fail('nobody needs to discard now');
    const owed = phase.pending[action.player] ?? 0;
    if (owed <= 0) return fail('you do not need to discard');
    if (!isValidBundle(action.resources)) return fail('invalid resources');
    const count = totalResources(action.resources);
    if (count !== owed) return fail(`must discard exactly ${owed} cards, got ${count}`);
    const player = draft.players[action.player];
    if (!player || !hasResources(player.resources, action.resources)) {
      return fail('you do not have those cards');
    }

    for (const r of RESOURCES) {
      const n = action.resources[r] ?? 0;
      player.resources[r] -= n;
      draft.bank[r] += n;
    }
    phase.pending[action.player] = 0;
    log(
      draft,
      action.player,
      `${playerName(draft, action.player)} discarded ${describeBundle(action.resources)}`,
    );
    if (phase.pending.every((n) => n === 0)) startRobber(draft, 'main');
    return ok(draft);
  },

  moveRobber: (draft, action) => {
    const phase = draft.phase;
    if (phase.kind !== 'moveRobber') return fail('cannot move the robber now');
    if (!isCurrent(draft, action.player)) return fail('not your turn');
    if (!isLandHex(topologyOf(draft), action.hex)) return fail('invalid hex');
    const targets = robberTargets(draft, action.player);
    // The friendly robber may have to stay on its desert (robberTargets); otherwise it must move.
    if (action.hex === draft.robber && !targets.includes(action.hex)) {
      return fail('the robber must move to a different hex');
    }
    if (!targets.includes(action.hex)) {
      return fail('friendly robber: that hex touches a player with 2 or fewer points');
    }

    draft.robber = action.hex;
    log(draft, action.player, `${playerName(draft, action.player)} moved the robber`);
    const candidates = stealCandidates(draft, action.player, action.hex);
    draft.phase =
      candidates.length > 0
        ? { kind: 'steal', candidates, resume: phase.resume }
        : resumePhase(draft, phase.resume);
    return ok(draft);
  },

  steal: (draft, action) => {
    const phase = draft.phase;
    if (phase.kind !== 'steal') return fail('cannot steal now');
    if (!isCurrent(draft, action.player)) return fail('not your turn');
    if (!phase.candidates.includes(action.victim)) return fail('cannot steal from that player');
    const thief = draft.players[action.player];
    const victim = draft.players[action.victim];
    if (!thief || !victim) return fail('invalid victim');

    const cards: Resource[] = RESOURCES.flatMap((r) =>
      Array.from({ length: victim.resources[r] }, () => r),
    );
    let text = `${playerName(draft, action.player)} stole from ${playerName(draft, action.victim)}`;
    if (cards.length > 0) {
      const rng = new Rng(draft.rng);
      const card = rng.pick(cards);
      draft.rng = rng.state;
      victim.resources[card] -= 1;
      thief.resources[card] += 1;
    } else {
      text += ' (no cards)';
    }
    log(draft, action.player, text);
    draft.phase = resumePhase(draft, phase.resume);
    return ok(draft);
  },
};

export const robberLegal: LegalGenerator = (state: GameState): Action[] => {
  const phase = state.phase;
  const player = state.turn.current;
  switch (phase.kind) {
    case 'discard':
      return phase.pending.flatMap((count, p) => {
        const hand = state.players[p]?.resources;
        if (count <= 0 || !hand) return [];
        return discardOptions(hand, count).map((resources): Action => ({
          type: 'discard',
          player: p,
          resources,
        }));
      });
    case 'moveRobber':
      return robberTargets(state, player).map((hex): Action => ({
        type: 'moveRobber',
        player,
        hex,
      }));
    case 'steal':
      return phase.candidates.map((victim): Action => ({ type: 'steal', player, victim }));
    default:
      return [];
  }
};
