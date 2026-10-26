/**
 * OWNER: T2 (rules-core).
 * Dice production. Pure computation (`computeProduction`) + application to a draft (`produce`).
 * Rules: every settlement yields 1, every city 2 of each adjacent hex whose token was rolled,
 * except the robber's hex. Bank shortage: if the bank can't pay a resource to everyone owed,
 * nobody gets it — unless only one player is owed, who then gets what's left.
 */
import { RESOURCES } from '../constants';
import { runProductionHooks } from '../expansions/hooks';
import { emptyResources, isResource } from '../resources';
import { hexVertices, topologyOf } from '../topology';
import type { GameState, HexId, ResourceCounts } from '../types';

/** What each player is owed for `roll` before the bank-shortage rule. Indexed by PlayerId. */
export function computeProduction(state: GameState, roll: number): ResourceCounts[] {
  const owed = state.players.map(() => emptyResources());
  const t = topologyOf(state);
  for (const id of Object.keys(state.board.hexes) as HexId[]) {
    const hex = state.board.hexes[id];
    if (!hex || hex.token !== roll || id === state.robber) continue;
    const terrain = hex.terrain;
    // Only resource terrains produce in the core (gold etc.: expansion production hooks).
    if (!isResource(terrain)) continue;
    for (const v of hexVertices(t, id)) {
      const b = state.pieces.buildings[v];
      const hand = b && owed[b.owner];
      if (hand) hand[terrain] += b.kind === 'city' ? 2 : 1;
    }
  }
  runProductionHooks(state, roll, owed);
  return owed;
}

/** What each player actually receives after applying the bank-shortage rule. */
export function payableProduction(state: GameState, roll: number): ResourceCounts[] {
  const owed = computeProduction(state, roll);
  for (const r of RESOURCES) {
    const total = owed.reduce((sum, h) => sum + h[r], 0);
    if (total <= state.bank[r]) continue;
    const owedPlayers = owed.filter((h) => h[r] > 0);
    if (owedPlayers.length === 1 && owedPlayers[0]) owedPlayers[0][r] = state.bank[r];
    else for (const h of owed) h[r] = 0;
  }
  return owed;
}

/** Pay production for `roll` from the bank into hands. Mutates the draft. */
export function produce(draft: GameState, roll: number): ResourceCounts[] {
  const pay = payableProduction(draft, roll);
  pay.forEach((gain, p) => {
    const player = draft.players[p];
    if (!player) return;
    for (const r of RESOURCES) {
      player.resources[r] += gain[r];
      draft.bank[r] -= gain[r];
    }
  });
  return pay;
}
