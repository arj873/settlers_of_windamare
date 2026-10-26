/** Demo expansion invariants (F1 example): wells sit on their owner's buildings, within the limit. */
import { pieceLimit, type GameState, type VertexId } from '../../engine';
import type { BotExtension } from '../../bots/expansions';
import type { Violation } from '../../bots/invariants';
import { DEMO, WELL, type DemoSlice } from './engine';

function check(state: GameState): Violation[] {
  const out: Violation[] = [];
  const slice = state.ext[DEMO] as DemoSlice | undefined;
  if (!slice || slice.v !== 1 || typeof slice.wells !== 'object') {
    return [{ code: 'expansion', message: 'demo: missing or malformed slice' }];
  }
  const count = state.players.map(() => 0);
  for (const [v, owner] of Object.entries(slice.wells) as [VertexId, number][]) {
    if (state.pieces.buildings[v]?.owner !== owner) {
      out.push({ code: 'expansion', message: `demo: well on ${v} without a building of ${owner}` });
    }
    if (count[owner] === undefined) {
      out.push({ code: 'expansion', message: `demo: well owner ${owner} is not a player` });
    } else count[owner] += 1;
  }
  count.forEach((n, p) => {
    if (n > pieceLimit(state, p, WELL)) {
      out.push({ code: 'expansion', message: `demo: player ${p} has ${n} wells`, player: p });
    }
  });
  if (state.phase.kind === 'demo/bloom' && state.winner !== null) {
    out.push({ code: 'expansion', message: 'demo: bloom phase after the game ended' });
  }
  return out;
}

export const demoBots: BotExtension = { id: DEMO, invariants: check };
