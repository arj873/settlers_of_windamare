/**
 * The Council of Catan's missions (docs/rules/explorers-pirates.md §4.8-4.10, §4.13): mission
 * tracks, bonus tiles, victory points, and resolving captured pirate lairs.
 */
import { log } from '../../../engine/actions/common';
import { Rng } from '../../../engine/rng';
import { playerName } from '../../../engine/rules/text';
import type { GameState, HexId, PlayerId } from '../../../engine/types';
import { harborsOf } from './ships';
import {
  epSlice,
  MISSION_NAME,
  MISSIONS,
  rulesOf,
  TILE_NAME,
  TRACK_VP,
  type EpSlice,
  type Mission,
  type Rules,
  type Track,
} from './state';

const name = (s: GameState, p: PlayerId) => playerName(s, p);

/** The missions a scenario plays. */
export function missionsOf(rules: Rules): Mission[] {
  return MISSIONS.filter((m) =>
    m === 'lairs' ? rules.lairs : m === 'fish' ? rules.fish : rules.spice,
  );
}

export function newTrack(players: number): Track {
  return { pos: Array<number>(players).fill(0), arrived: Array<number>(players).fill(0) };
}

/** VP of a marker on space `pos` (0 = start). */
export const spaceVp = (m: Mission, pos: number): number =>
  pos <= 0 ? 0 : (TRACK_VP[m][Math.min(pos, TRACK_VP[m].length) - 1] ?? 0);

/**
 * Holder of a mission's bonus tile: the marker furthest along (off the start space); on a tie
 * the one that got there first (lowest in the stack), so the tile moves only when passed.
 */
export function tileHolder(track: Track | undefined): PlayerId | null {
  if (!track) return null;
  let best: PlayerId | null = null;
  track.pos.forEach((pos, p) => {
    if (pos <= 0) return;
    if (best === null) {
      best = p;
      return;
    }
    const bp = track.pos[best] ?? 0;
    if (pos > bp || (pos === bp && (track.arrived[p] ?? 0) < (track.arrived[best] ?? 0))) best = p;
  });
  return best;
}

/** Move `p`'s marker `steps` spaces (it stays on the last space). Returns the spaces moved. */
export function advance(s: EpSlice, m: Mission, p: PlayerId, steps: number): number {
  const track = s.tracks[m];
  if (!track || steps <= 0) return 0;
  const from = track.pos[p] ?? 0;
  const to = Math.min(TRACK_VP[m].length, from + steps);
  if (to === from) return 0;
  track.pos[p] = to;
  s.clock += 1;
  track.arrived[p] = s.clock;
  return to - from;
}

export interface MissionVp {
  harbors: number;
  tracks: Partial<Record<Mission, number>>;
  tiles: number;
}

/** E&P's extra VP of `p`: harbor settlements (+1 over a settlement), tracks and tiles. */
export function missionVp(state: GameState, p: PlayerId): MissionVp {
  const s = epSlice(state);
  const tracks: Partial<Record<Mission, number>> = {};
  let tiles = 0;
  for (const m of MISSIONS) {
    const t = s.tracks[m];
    if (!t) continue;
    tracks[m] = spaceVp(m, t.pos[p] ?? 0);
    if (tileHolder(t) === p) tiles += 1;
  }
  return { harbors: harborsOf(state, p).length, tracks, tiles };
}

export function totalMissionVp(v: MissionVp): number {
  return v.harbors + Object.values(v.tracks).reduce((a, b) => a + b, 0) + v.tiles;
}

/** The VP parts for the statistics screen. */
export function vpParts(v: MissionVp): { label: string; vp: number }[] {
  return [
    { label: 'Harbors', vp: v.harbors },
    ...MISSIONS.map((m) => ({ label: MISSION_NAME[m], vp: v.tracks[m] ?? 0 })),
    { label: 'Bonus tiles', vp: v.tiles },
  ].filter((x) => x.vp > 0);
}

// ---------------------------------------------------------------------------------------------
// Pirate lairs (§4.8)
// ---------------------------------------------------------------------------------------------

/** Players with crews on the lair, the active player first and then clockwise. */
function involved(state: GameState, crews: readonly PlayerId[]): PlayerId[] {
  const n = state.players.length;
  const cur = state.turn.current;
  const out: PlayerId[] = [];
  for (let i = 0; i < n; i++) {
    const p = (cur + i) % n;
    if (crews.includes(p)) out.push(p);
  }
  return out;
}

/** The hero of the battle: highest die + crews; ties: more crews, then reroll (§4.8 step 2). */
function hero(
  draft: GameState,
  players: PlayerId[],
  crews: readonly PlayerId[],
  rng: Rng,
): PlayerId {
  const count = (p: PlayerId) => crews.filter((c) => c === p).length;
  let tied = players;
  for (let round = 0; tied.length > 1 && round < 50; round++) {
    const score = new Map<PlayerId, number>();
    for (const p of tied) {
      const die = rng.die();
      score.set(p, die + count(p));
      log(draft, p, `${name(draft, p)} rolled ${die} (+${count(p)} crews)`);
    }
    const best = Math.max(...tied.map((p) => score.get(p) ?? 0));
    let top = tied.filter((p) => score.get(p) === best);
    if (top.length > 1) {
      const most = Math.max(...top.map(count));
      top = top.filter((p) => count(p) === most);
    }
    tied = top;
  }
  return tied[0] as PlayerId;
}

/**
 * Resolve the lairs captured this turn, in capture order (§4.8, §10 Q10): every involved player
 * gets 2 gold and 1 space on the Lairs track, the hero 1 more space and 1 crew back; the lair
 * token flips: its number now stands on the gold field.
 */
export function resolveLairs(draft: GameState): void {
  const s = epSlice(draft);
  const queue = s.turn.captured;
  if (queue.length === 0) return;
  s.turn.captured = [];
  const rng = new Rng(draft.rng);
  for (const h of queue) {
    const lair = s.lairs[h];
    const tile = draft.board.hexes[h];
    if (!lair || lair.captured || !tile) continue;
    const who = involved(draft, lair.crews);
    log(draft, null, `The pirate lair is captured!`);
    for (const p of who) {
      s.gold[p] = (s.gold[p] ?? 0) + 2;
      advance(s, 'lairs', p, 1);
      log(draft, p, `${name(draft, p)} received 2 gold`);
    }
    const champion = who.length === 1 ? (who[0] as PlayerId) : hero(draft, who, lair.crews, rng);
    advance(s, 'lairs', champion, 1);
    const i = lair.crews.indexOf(champion);
    if (i >= 0) lair.crews.splice(i, 1);
    log(draft, champion, `${name(draft, champion)} is the hero of the battle`);
    lair.captured = true;
    draft.board = {
      ...draft.board,
      hexes: { ...draft.board.hexes, [h]: { ...tile, token: lair.token } },
    };
    log(draft, null, `The gold field produces on ${lair.token}`);
  }
  draft.rng = rng.state;
}

/** Captured lairs waiting for resolution (UI). */
export const pendingLairs = (state: GameState): HexId[] => epSlice(state).turn.captured;

export { TILE_NAME, rulesOf };
