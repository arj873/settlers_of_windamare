/**
 * Oil Springs invariants for the simulator: oil is conserved, the caps and the Disaster Track
 * hold, metropolises sit on their owners' cities, destroyed hexes lost their tokens, the Champion
 * token is where the rules put it. The random bot needs nothing else: it plays `legalActions`.
 */
import { victoryPoints, type GameState, type VertexId } from '../../engine';
import type { BotExtension } from '../../bots/expansions';
import type { Violation } from '../../bots/invariants';
import { DISASTER_AT, OIL, oilScale, type OilSlice } from './engine';

function check(state: GameState): Violation[] {
  const out: Violation[] = [];
  const bad = (message: string, player?: number) =>
    out.push({
      code: 'expansion',
      message: `oil: ${message}`,
      ...(player === undefined ? {} : { player }),
    });
  const s = state.ext[OIL] as OilSlice | undefined;
  const n = state.players.length;
  if (!s || s.v !== 1 || !Array.isArray(s.oil) || !Array.isArray(s.sequestered)) {
    return [{ code: 'expansion', message: 'oil: missing or malformed slice' }];
  }
  const scale = oilScale(state);
  const isCount = (x: unknown): x is number =>
    typeof x === 'number' && Number.isInteger(x) && x >= 0;
  if (s.oil.length !== n || s.sequestered.length !== n)
    bad('per-player arrays have the wrong length');
  if (![...s.oil, ...s.sequestered, s.supply, s.lost].every(isCount)) {
    bad('negative or fractional oil count');
  }
  const held = s.oil.reduce((a, b) => a + b, 0);
  const flipped = s.sequestered.reduce((a, b) => a + b, 0);
  if (s.supply + s.lost + held + flipped !== scale.oil) {
    bad(`oil total ${s.supply + s.lost + held + flipped}, expected ${scale.oil}`);
  }
  s.oil.forEach((o, p) => {
    if (o > scale.cap) bad(`player ${p} holds ${o} oil (cap ${scale.cap})`, p);
  });
  if (!Number.isInteger(s.marker) || s.marker < 0 || s.marker > DISASTER_AT) {
    bad(`Disaster Track marker ${s.marker}`);
  }
  // The disaster is resolved before the next turn can begin.
  if (s.marker === DISASTER_AT && state.phase.kind === 'preRoll') {
    bad('a triggered disaster was not resolved at the end of the turn');
  }

  const owners = Object.entries(s.metropolis) as [VertexId, number][];
  if (owners.length > scale.metropolises)
    bad(`${owners.length} metropolises (max ${scale.metropolises})`);
  for (const [v, owner] of owners) {
    const b = state.pieces.buildings[v];
    if (b?.kind !== 'city' || b.owner !== owner)
      bad(`metropolis on ${v} without a city of ${owner}`);
  }

  if (new Set(s.destroyed).size !== s.destroyed.length) bad('a hex was destroyed twice');
  for (const h of s.destroyed) {
    const tile = state.board.hexes[h];
    if (!tile || tile.token !== null) bad(`destroyed hex ${h} still has its token`);
    if (tile && tile.terrain.startsWith('oil/')) bad(`oil spring ${h} was destroyed`);
  }
  const over = state.phase.kind === 'gameOver';
  if (s.destroyed.length >= scale.ruin && !over) bad('the island is lost but the game goes on');

  const most = Math.max(0, ...s.sequestered);
  if (s.champion === null) {
    if (most >= 3) bad('someone sequestered 3 oil but nobody is Champion of the Environment');
  } else if ((s.sequestered[s.champion] ?? 0) < Math.max(3, most)) {
    bad(`Champion ${s.champion} does not have the most sequestered oil`, s.champion);
  }

  // Winners: 12 VP at the end of their turn, or the Champion after the island is lost (or nobody).
  if (over && state.winner !== null) {
    const ruin = s.destroyed.length >= scale.ruin;
    if (
      ruin
        ? state.winner !== s.champion
        : victoryPoints(state, state.winner) < state.settings.vpToWin
    ) {
      bad(`winner ${state.winner} is not entitled to win`, state.winner);
    }
  }
  if (over !== (state.winner !== null) && !(over && s.destroyed.length >= scale.ruin)) {
    bad(`phase ${state.phase.kind} but winner = ${String(state.winner)}`);
  }
  return out;
}

export const oilBots: BotExtension = {
  id: OIL,
  invariants: check,
  // The robber starts off the board; the win is decided at the end of the turn (or by the ruin);
  // a flood removes buildings but leaves roads, so a road may end up touching nothing of its owner.
  relax: ['robber-position', 'winner', 'road-disconnected'],
};
