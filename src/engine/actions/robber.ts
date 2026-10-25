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
import { describeBundle, playerName } from '../rules/text';
import { Rng } from '../rng';
import { hasResources, isValidBundle, totalResources } from '../resources';
import { handSize } from '../selectors';
import { hexVertices, isLandHex, TOPOLOGY } from '../topology';
import type {
  Action,
  GameState,
  HexId,
  PlayerId,
  Resource,
  ResourceBundle,
  ResourceCounts,
} from '../types';
import { type HandlerMap, type LegalGenerator, fail, isCurrent, log, ok } from './common';

/** Opponents of `player` with a building on `hex` and at least one card, ascending. */
export function stealCandidates(state: GameState, player: PlayerId, hex: HexId): PlayerId[] {
  const owners = new Set<PlayerId>();
  for (const v of hexVertices(hex)) {
    const b = state.pieces.buildings[v];
    if (b && b.owner !== player) owners.add(b.owner);
  }
  return [...owners]
    .filter((p) => {
      const pl = state.players[p];
      return pl !== undefined && handSize(pl) > 0;
    })
    .sort((a, b) => a - b);
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
    if (phase.pending.every((n) => n === 0)) draft.phase = { kind: 'moveRobber', resume: 'main' };
    return ok(draft);
  },

  moveRobber: (draft, action) => {
    const phase = draft.phase;
    if (phase.kind !== 'moveRobber') return fail('cannot move the robber now');
    if (!isCurrent(draft, action.player)) return fail('not your turn');
    if (!isLandHex(action.hex)) return fail('invalid hex');
    if (action.hex === draft.robber) return fail('the robber must move to a different hex');

    draft.robber = action.hex;
    log(draft, action.player, `${playerName(draft, action.player)} moved the robber`);
    const candidates = stealCandidates(draft, action.player, action.hex);
    draft.phase =
      candidates.length > 0
        ? { kind: 'steal', candidates, resume: phase.resume }
        : { kind: phase.resume };
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
    draft.phase = { kind: phase.resume };
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
        return discardOptions(hand, count).map(
          (resources): Action => ({ type: 'discard', player: p, resources }),
        );
      });
    case 'moveRobber':
      return TOPOLOGY.landHexes
        .filter((h) => h !== state.robber)
        .map((hex): Action => ({ type: 'moveRobber', player, hex }));
    case 'steal':
      return phase.candidates.map((victim): Action => ({ type: 'steal', player, victim }));
    default:
      return [];
  }
};
