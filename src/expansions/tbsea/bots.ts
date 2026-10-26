/**
 * T&B + Seafarers for the simulator: the pair's own invariants (no pirate in Traders & Barbarians
 * and Barbarian Attack, no ship on a bridge site, wagons / camels / barbarians on paths of the
 * board). The T&B and Seafarers bot extensions run too; the random bot needs no steer of its own.
 */
import type { BotExtension } from '../../bots/expansions';
import type { Violation } from '../../bots/invariants';
import type { EdgeId, GameState } from '../../engine';
import { seaSlice } from '../seafarers/engine';
import { has, tbBoard } from '../tb/engine';
import { TBSEA, TBSEA_SCENARIOS } from './engine';

function check(state: GameState): Violation[] {
  const out: Violation[] = [];
  const bad = (message: string) => out.push({ code: 'expansion', message: `tbsea: ${message}` });
  if (!TBSEA_SCENARIOS.includes(state.settings.scenario ?? ''))
    bad('not a T&B + Seafarers scenario');
  if ((has(state, 'traders') || has(state, 'ba')) && seaSlice(state).pirate !== null) {
    bad('a pirate in a game without one');
  }
  if (has(state, 'rivers')) {
    const sites = new Set(tbBoard(state).bridgeSites ?? []);
    for (const e of Object.keys(seaSlice(state).ships) as EdgeId[]) {
      if (sites.has(e)) bad(`a ship on the bridge site ${e}`);
    }
  }
  return out;
}

export const tbseaBots: BotExtension = {
  id: TBSEA,
  invariants: check,
};
