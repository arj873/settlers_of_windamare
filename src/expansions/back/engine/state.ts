/**
 * Barbarian Attack + Cities & Knights: ids, the slice, phases and actions (docs/rules/combos.md
 * §10). Nothing here runs at module top level except constants.
 */
import type { EdgeId, GameState, HexId, Phase, PlayerId } from '../../../engine/types';
import type { Knight } from '../../ck/engine';

export const BACK = 'back';
export const BACK_MODE = 'ba+ck';
/** "If you have 13 or more VPs at any point during your turn" (the sheet). */
export const BACK_VP = 13;

export interface BackSlice {
  v: 1;
  /** C&K knights on paths (edges). */
  knights: Record<EdgeId, Knight>;
  /** Knights that moved this turn (the paths they stopped on). */
  moved: EdgeId[];
  /** VP tokens taken for 3 prisoners when the barbarian supply ran out (the sheet). */
  tokens: number[];
}

export const backSlice = (state: Pick<GameState, 'ext'>): BackSlice => state.ext[BACK] as BackSlice;

export type BackPhase =
  /** End of turn: knight actions (no more trade or build); `from` = the selected knight. */
  | { kind: 'back/knights'; from: EdgeId | null }
  /** A displaced knight's owner puts it on one of the nearest free paths. */
  | { kind: 'back/relocate'; knight: Knight; spots: EdgeId[] }
  /** Intrigue: take a barbarian prisoner from a hex of your choice. */
  | { kind: 'back/intrigue' }
  /** Taxation (the Bishop): pick a hex; rob each player with an unconquered building there. */
  | { kind: 'back/taxation' }
  /** Treason (the Deserter): pick an opponent; they remove a knight; yours takes its path. */
  | { kind: 'back/deserter'; victim: PlayerId | null }
  /** Smith: promote up to 2 knights for free. */
  | { kind: 'back/smith'; left: number; done: EdgeId[] };

export type BackAction =
  | { type: 'back/recruit'; player: PlayerId; edge: EdgeId }
  | { type: 'back/activate'; player: PlayerId; edge: EdgeId }
  | { type: 'back/promote'; player: PlayerId; edge: EdgeId }
  | { type: 'back/startKnights'; player: PlayerId; edge: EdgeId }
  | { type: 'back/selectKnight'; player: PlayerId; edge: EdgeId }
  | { type: 'back/moveKnight'; player: PlayerId; edge: EdgeId }
  | { type: 'back/displace'; player: PlayerId; edge: EdgeId }
  | { type: 'back/relocate'; player: PlayerId; edge: EdgeId }
  | { type: 'back/intrigueHex'; player: PlayerId; hex: HexId }
  | { type: 'back/taxHex'; player: PlayerId; hex: HexId }
  | { type: 'back/deserterPlayer'; player: PlayerId; victim: PlayerId }
  | { type: 'back/deserterKnight'; player: PlayerId; edge: EdgeId }
  | { type: 'back/smithKnight'; player: PlayerId; edge: EdgeId }
  | { type: 'back/smithDone'; player: PlayerId };

export const phaseOf = (state: GameState): BackPhase | Phase =>
  state.phase as unknown as BackPhase | Phase;
export const asPhase = (p: BackPhase): Phase => p as unknown as Phase;
