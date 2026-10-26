/**
 * E&P + T&B for the simulator: the pair's invariants (the six grounds and the lake where the
 * sheet puts them, the pirate pass only for this turn's paying players) and a steer that spends
 * fish on E&P's uses now and then (a free ship when short of ships). T&B's and E&P's bot
 * extensions run too (fish conservation, E&P's pieces and VP).
 */
import type { BotExtension } from '../../bots/expansions';
import type { Violation } from '../../bots/invariants';
import type { Action, GameState, PlayerId } from '../../engine';
import { epSlice } from '../ep/engine';
import { shipsOf } from '../ep/engine/ships';
import { LAKE, tbBoard } from '../tb/engine';
import { EPTB, GROUND_PLACES, LAKE_HEX, eptbSlice } from './engine';

function check(state: GameState): Violation[] {
  const out: Violation[] = [];
  const bad = (message: string) => out.push({ code: 'expansion', message: `eptb: ${message}` });
  const s = state.ext[EPTB] as { v?: number; freePassage?: unknown } | undefined;
  if (!s || s.v !== 1 || !Array.isArray(s.freePassage)) {
    return [{ code: 'expansion', message: 'eptb: missing or malformed slice' }];
  }
  const board = tbBoard(state);
  const grounds = board.grounds ?? [];
  if (grounds.length !== GROUND_PLACES.length) bad(`${grounds.length} fishing grounds`);
  const numbers = grounds.map((g) => g.number).sort((a, b) => a - b);
  if (numbers.join() !== '4,5,6,8,9,10') bad(`ground numbers ${numbers.join()}`);
  for (const l of board.lakes ?? []) {
    if (l.hex !== LAKE_HEX || state.board.hexes[l.hex]?.terrain !== LAKE) bad(`lake on ${l.hex}`);
  }
  for (const p of eptbSlice(state).freePassage) {
    if (p !== state.turn.current) bad(`player ${p} ignores the pirate out of turn`);
  }
  return out;
}

function steer(
  state: GameState,
  player: PlayerId,
  options: readonly Action[],
  rng: { pick<T>(xs: readonly T[]): T; float(): number },
): Action | null {
  const fish = options.filter((a) => a.type === 'eptb/fish' || a.type === 'eptb/fishShip');
  if (fish.length === 0) return null;
  const ships = fish.filter((a) => a.type === 'eptb/fishShip');
  if (ships.length > 0 && shipsOf(epSlice(state), player).length < 2) return rng.pick(ships);
  return rng.float() < 0.2 ? rng.pick(fish) : null;
}

export const eptbBots: BotExtension = {
  id: EPTB,
  invariants: check,
  steer,
};
