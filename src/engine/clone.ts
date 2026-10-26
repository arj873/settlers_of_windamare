/**
 * Fast copy of a GameState for applyAction's draft (structuredClone was ~85% of sim time).
 * Structural sharing, by contract (see ARCHITECTURE.md §7):
 *  - `board` and `settings` are fixed after createGame and shared, never copied;
 *  - log entries are immutable once written: the array is copied, the entries are shared.
 * Everything else is copied, so a handler may mutate any other part of its draft.
 * If you add a field to GameState, copy it here (clone.test.ts checks nothing else is shared).
 */
import type { Building, GameState, Phase, Player, VertexId } from './types';

function clonePlayer(p: Player): Player {
  return {
    ...p,
    resources: { ...p.resources },
    devCards: { ...p.devCards },
    newDevCards: { ...p.newDevCards },
    progressCardsPlayed: { ...p.progressCardsPlayed },
  };
}

function clonePhase(phase: Phase): Phase {
  switch (phase.kind) {
    case 'discard':
      return { kind: 'discard', pending: [...phase.pending] };
    case 'steal':
      return { ...phase, candidates: [...phase.candidates] };
    case 'trade': {
      const o = phase.offer;
      return {
        kind: 'trade',
        offer: {
          from: o.from,
          give: { ...o.give },
          want: { ...o.want },
          responses: [...o.responses],
        },
      };
    }
    default:
      return { ...phase };
  }
}

export function cloneState(s: GameState): GameState {
  const buildings: Record<VertexId, Building> = {};
  for (const v of Object.keys(s.pieces.buildings) as VertexId[]) {
    const b = s.pieces.buildings[v];
    if (b) buildings[v] = { owner: b.owner, kind: b.kind };
  }
  return {
    schemaVersion: s.schemaVersion,
    settings: s.settings,
    board: s.board,
    pieces: { buildings, roads: { ...s.pieces.roads } },
    robber: s.robber,
    players: s.players.map(clonePlayer),
    bank: { ...s.bank },
    devDeck: [...s.devDeck],
    turn: { ...s.turn },
    phase: clonePhase(s.phase),
    dice: s.dice === null ? null : [s.dice[0], s.dice[1]],
    diceDeck: [...s.diceDeck],
    awards: { ...s.awards },
    log: [...s.log],
    rng: s.rng,
    winner: s.winner,
  };
}
