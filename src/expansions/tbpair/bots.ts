/**
 * T&B scenario pairs for the simulator: the pair's invariants (the lake only with the Caravans,
 * six fishing grounds). The T&B bot extension runs too.
 */
import type { BotExtension } from '../../bots/expansions';
import type { Violation } from '../../bots/invariants';
import type { GameState } from '../../engine';
import { has, tbBoard } from '../tb/engine';
import { TBPAIR } from './engine';

function check(state: GameState): Violation[] {
  const out: Violation[] = [];
  const bad = (message: string) => out.push({ code: 'expansion', message: `tbpair: ${message}` });
  const b = tbBoard(state);
  const lakes = b.lakes?.length ?? 0;
  if (lakes !== (has(state, 'caravans') ? 1 : 0)) bad(`${lakes} lakes`);
  if ((b.grounds?.length ?? 0) !== 6) bad(`${b.grounds?.length ?? 0} fishing grounds`);
  return out;
}

export const tbpairBots: BotExtension = { id: TBPAIR, invariants: check };
