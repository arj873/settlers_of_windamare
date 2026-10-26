/** Read-only derived queries over GameState. Safe for render/ui/bots to call. */
import { AWARD_VP } from './constants';
import {
  expansionActors,
  expansionVictoryPoints,
  hookHandSize,
  hookSetupOrder,
  pieceLimit,
} from './expansions/hooks';
import type { SetupOrder } from './expansions/types';
import { totalResources } from './resources';
import type {
  BuildingKind,
  EdgeId,
  GameState,
  Player,
  PlayerId,
  PortKind,
  VertexId,
} from './types';

/**
 * Snake order from the starting player `first` (settings.startingPlayer): with first = 0,
 * 0,1,..,n-1,n-1,..,1,0; with first = 2 of 4, 2,3,0,1,1,0,3,2. `index` in 0..2n-1.
 */
export function setupPlayerAt(index: number, playerCount: number, first: PlayerId = 0): PlayerId {
  const seat = index < playerCount ? index : 2 * playerCount - 1 - index;
  return (seat + first) % playerCount;
}

/**
 * Every setup placement of the game: who places step i, and whether that settlement pays
 * starting resources. Default: the snake order (setupPlayerAt), the second round pays; an
 * expansion's setupOrder hook may change it (Cloth for Catan: a third round, which pays).
 */
export function setupOrderOf(state: GameState): SetupOrder {
  const custom = hookSetupOrder(state);
  if (custom) return custom;
  const n = state.players.length;
  const order = Array.from({ length: 2 * n }, (_, i) =>
    setupPlayerAt(i, n, state.settings.startingPlayer),
  );
  return { order, pays: order.map((_, i) => i >= n) };
}

export function getPlayer(state: GameState, id: PlayerId): Player {
  const p = state.players[id];
  if (!p) throw new Error(`no player ${id}`);
  return p;
}

export function currentPlayer(state: GameState): Player {
  return getPlayer(state, state.turn.current);
}

export function buildingsOf(state: GameState, player: PlayerId, kind?: BuildingKind): VertexId[] {
  return (Object.keys(state.pieces.buildings) as VertexId[]).filter((v) => {
    const b = state.pieces.buildings[v];
    return b !== undefined && b.owner === player && (kind === undefined || b.kind === kind);
  });
}

export function roadsOf(state: GameState, player: PlayerId): EdgeId[] {
  return (Object.keys(state.pieces.roads) as EdgeId[]).filter(
    (e) => state.pieces.roads[e] === player,
  );
}

/** Unplaced pieces in the player's supply (limits: `pieceLimit`, i.e. 15/5/4 unless an expansion changes them). */
export function piecesLeft(
  state: GameState,
  player: PlayerId,
): { road: number; settlement: number; city: number } {
  return {
    road: pieceLimit(state, player, 'road') - roadsOf(state, player).length,
    settlement:
      pieceLimit(state, player, 'settlement') - buildingsOf(state, player, 'settlement').length,
    city: pieceLimit(state, player, 'city') - buildingsOf(state, player, 'city').length,
  };
}

/** VP visible to everyone: buildings + Longest Road + Largest Army + expansions' public VP. */
export function publicVictoryPoints(state: GameState, player: PlayerId): number {
  let vp =
    buildingsOf(state, player, 'settlement').length + 2 * buildingsOf(state, player, 'city').length;
  if (state.awards.longestRoad === player) vp += AWARD_VP;
  if (state.awards.largestArmy === player) vp += AWARD_VP;
  return vp + expansionVictoryPoints(state, player).public;
}

/** Total VP including hidden VP dev cards (also ones bought this turn) and expansions' hidden VP. */
export function victoryPoints(state: GameState, player: PlayerId): number {
  const p = getPlayer(state, player);
  return (
    publicVictoryPoints(state, player) +
    p.devCards.victoryPoint +
    p.newDevCards.victoryPoint +
    expansionVictoryPoints(state, player).hidden
  );
}

/** Resource cards in a hand (base). For the 7 rule and stealing use `cardsInHand`. */
export function handSize(player: Player): number {
  return totalResources(player.resources);
}

/** Cards in `player`'s hand as the rules count them: resources, plus expansion cards (handSize hook). */
export function cardsInHand(state: GameState, player: PlayerId): number {
  return hookHandSize(state, player, handSize(getPlayer(state, player)));
}

/** Port kinds the player can use (has a settlement/city on a port vertex). */
export function portsOf(state: GameState, player: PlayerId): PortKind[] {
  return state.board.ports
    .filter((port) => port.vertices.some((v) => state.pieces.buildings[v]?.owner === player))
    .map((port) => port.kind);
}

/**
 * Players who may submit an action right now. Usually just the current player;
 * several during `discard`; offerer + pending responders during `trade`.
 */
export function actingPlayers(state: GameState): PlayerId[] {
  const phase = state.phase;
  switch (phase.kind) {
    case 'gameOver':
      return [];
    case 'discard':
      return phase.pending.flatMap((n, p) => (n > 0 ? [p] : []));
    case 'trade': {
      const responders = phase.offer.responses.flatMap((r, p) => (r === 'pending' ? [p] : []));
      return [phase.offer.from, ...responders];
    }
    case 'event':
      return phase.tasks.map((t) => t.player);
    default:
      return expansionActors(state) ?? [state.turn.current];
  }
}
