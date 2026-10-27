/**
 * T&B scenario pairs for the simulator: the pair's invariants (Fishing pairs: the lake only with
 * the Caravans, six fishing grounds; the other sheets: their boards; Barbarian Attack + T&B: the
 * barbarians by paths). The T&B bot extension runs too.
 */
import type { BotExtension } from '../../bots/expansions';
import type { Violation } from '../../bots/invariants';
import type { GameState } from '../../engine';
import { baOf, has, tbBoard, tradersOf } from '../tb/engine';
import { hexPaths, pathBarbarians, SHEETS, TBPAIR } from './engine';

function check(state: GameState): Violation[] {
  const out: Violation[] = [];
  const bad = (message: string) => out.push({ code: 'expansion', message: `tbpair: ${message}` });
  const b = tbBoard(state);
  const lakes = b.lakes?.length ?? 0;
  const grounds = b.grounds?.length ?? 0;
  if (has(state, 'fish')) {
    if (lakes !== (has(state, 'caravans') ? 1 : 0)) bad(`${lakes} lakes`);
    if (grounds !== 6) bad(`${grounds} fishing grounds`);
  } else if (lakes + grounds > 0) bad('fishing on a sheet without Fishing');
  const sheet = SHEETS.find((x) => x.id === state.settings.scenario);
  if (sheet) {
    const trade = b.tradeHexes ?? [];
    if (trade.length !== (has(state, 'traders') ? 3 : 0)) bad(`${trade.length} trade hexes`);
    // BA + T&B: the quarry on BA's desert spot has no number.
    const numbered = trade.filter((t) => state.board.hexes[t.hex]?.token != null).length;
    if (sheet.tradeYield && numbered !== (has(state, 'ba') ? 2 : 3)) {
      bad(`${numbered} numbered trade hexes`);
    }
    if (has(state, 'rivers') && (b.rivers?.length ?? 0) !== 7) bad('not 7 river hexes');
    const starts = b.caravanStarts?.length ?? 0;
    if (has(state, 'caravans') && starts !== (has(state, 'ba') ? 2 : 3)) {
      bad(`${starts} caravan starts`);
    }
  }
  if (pathBarbarians(state)) {
    const s = baOf(state);
    for (const [e, h] of Object.entries(s.paths ?? {})) {
      if (!hexPaths(state, h).includes(e as never)) bad(`a barbarian by ${e}, not a path of ${h}`);
    }
    if (tradersOf(state).barbarians.length > 0) bad('wagon barbarians beside BA’s');
  }
  return out;
}

export const tbpairBots: BotExtension = { id: TBPAIR, invariants: check };
