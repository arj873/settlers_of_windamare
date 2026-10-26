/**
 * Fast copy of a GameState for applyAction's draft (structuredClone was ~85% of sim time).
 * Structural sharing, by contract (see ARCHITECTURE.md §7):
 *  - `board` and `settings` are fixed after createGame and shared, never copied;
 *  - log entries are immutable once written: the array is copied, the entries are shared.
 *  - expansion slices (`ext`) and expansion phases are deep-copied (or by `module.cloneExt`).
 *    An expansion may REPLACE `draft.board` copy-on-write (fog reveal), never mutate it.
 * Everything else is copied, so a handler may mutate any other part of its draft.
 * If you add a field to GameState, copy it here (clone.test.ts checks nothing else is shared).
 */
import { cloneJson } from './expansions/ext';
import { expansionById } from './expansions/registry';
import type { Building, ExpansionId, GameState, Phase, Player, VertexId } from './types';

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
      // Expansion phases carry arbitrary JSON: copy deeply. Base phases here are flat.
      return phase.kind.includes('/') ? cloneJson(phase) : { ...phase };
  }
}

/** Expansion slices: the module's own copier if it has one, else a deep JSON copy. */
function cloneExt(s: GameState): Record<ExpansionId, unknown> {
  const out: Record<ExpansionId, unknown> = {};
  const ext = s.ext as Record<ExpansionId, unknown> | undefined;
  if (!ext) return out;
  for (const id of Object.keys(ext)) {
    const copy = expansionById(id)?.cloneExt;
    out[id] = copy ? copy(ext[id]) : cloneJson(ext[id]);
  }
  return out;
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
    ext: cloneExt(s),
  };
}
