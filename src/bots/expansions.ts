/**
 * Bot / simulator extension points for expansions (docs/EXPANSIONS.md §9).
 *
 * ADDING A MODULE: one import below and one entry at the END of BOT_EXTENSIONS.
 */
import { cropBots } from '../expansions/crop/bots';
import { demoBots } from '../expansions/demo/bots';
import { oilBots } from '../expansions/oil/bots';
import { ckBots } from '../expansions/ck/bots';
import { tbBots } from '../expansions/tb/bots';
import type { Action, ExpansionId, GameState, PlayerId, Rng } from '../engine';
import type { Violation, ViolationCode } from './invariants';

export interface BotExtension {
  id: ExpansionId;
  /** Extra invariant checks, run after every sim step (use code 'expansion'). Must not throw. */
  invariants?(state: GameState): Violation[];
  /** Base invariant codes that do not hold under this module (e.g. 'award-mismatch'). */
  relax?: readonly ViolationCode[];
  /**
   * The random bot's sense of progress in this module (T&B wagons, knights): an action from
   * `options` to play instead of a random pick, or null for no opinion. Asked only when the
   * bot's progress bias triggers (bias 0 stays a plain random pick). Use `rng`, never the game's.
   */
  steer?(state: GameState, player: PlayerId, options: readonly Action[], rng: Rng): Action | null;
}

export const BOT_EXTENSIONS: readonly BotExtension[] = [
  demoBots,
  oilBots,
  cropBots,
  ckBots,
  tbBots,
  // new modules go here, one per line
];

/** The bot extensions of the expansions active in `state`, in settings order. */
export function botExtensionsFor(state: Pick<GameState, 'settings'>): BotExtension[] {
  const ids = state.settings.expansions as readonly ExpansionId[] | undefined;
  if (!ids || ids.length === 0) return [];
  return ids.flatMap((id) => BOT_EXTENSIONS.filter((x) => x.id === id));
}
