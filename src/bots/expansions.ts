/**
 * Bot / simulator extension points for expansions (docs/EXPANSIONS.md §9).
 *
 * ADDING A MODULE: one import below and one entry at the END of BOT_EXTENSIONS.
 */
import { cropBots } from '../expansions/crop/bots';
import { demoBots } from '../expansions/demo/bots';
import { oilBots } from '../expansions/oil/bots';
import { ckBots } from '../expansions/ck/bots';
import { seafarersBots } from '../expansions/seafarers/bots';
import { tbBots } from '../expansions/tb/bots';
import { epBots } from '../expansions/ep/bots';
import { seackBots } from '../expansions/seack/bots';
import { tbckBots } from '../expansions/tbck/bots';
import { tbseaBots } from '../expansions/tbsea/bots';
import { tbpairBots } from '../expansions/tbpair/bots';
import { epckBots } from '../expansions/epck/bots';
import { eptbBots } from '../expansions/eptb/bots';
import { backBots } from '../expansions/back/bots';
import type { Action, ExpansionId, GameState, PlayerId, Rng } from '../engine';
import type { Violation, ViolationCode } from './invariants';
import type { BotContext, BotGoal } from './smart/context';

export interface BotExtension {
  id: ExpansionId;
  /** Extra invariant checks, run after every sim step (use code 'expansion'). Must not throw. */
  invariants?(state: GameState): Violation[];
  /** Base invariant codes that do not hold under this module (e.g. 'award-mismatch'). */
  relax?: readonly ViolationCode[];
  /**
   * The random bot's sense of progress in this module: an action from `options` to play instead
   * of a random pick, or null for no opinion. Asked only when the bot's progress bias triggers
   * (bias 0 stays a plain random pick). Use `rng`, never the game's. T&B: wagons and knights
   * that head somewhere; Seafarers: skip its no-progress moves (`steerAway`).
   */
  steer?(state: GameState, player: PlayerId, options: readonly Action[], rng: Rng): Action | null;
  /**
   * Smart bots (Normal / Hard, src/bots/smart): this module's score for `action` on the shared
   * scale (smart/context.ts: 100 ≈ a VP now, ending the turn 0, a roll 50), or null for no
   * opinion. Asked for every option, base actions included, before the base scoring; the first
   * module with an opinion decides. Module actions nobody scores get the `steer` pick or a
   * random pick on some decisions. Read only public information and `ctx.player`'s own secrets.
   */
  score?(ctx: BotContext, action: Action): number | null;
  /** Smart bots: what this module lets a bot save for (knights, ships…), for trades and plans. */
  goals?(ctx: BotContext): BotGoal[];
}

export const BOT_EXTENSIONS: readonly BotExtension[] = [
  demoBots,
  oilBots,
  cropBots,
  ckBots,
  seafarersBots,
  tbBots,
  epBots,
  seackBots,
  tbckBots,
  tbseaBots,
  tbpairBots,
  epckBots,
  eptbBots,
  backBots,
  // new modules go here, one per line
];

/**
 * A `steer` that only keeps the bot away from a module's no-progress actions (and from ending the
 * turn): when any of `types` is on offer, a type-first random pick among the other options.
 */
export function steerAway(types: readonly string[]): NonNullable<BotExtension['steer']> {
  const skip = new Set<string>([...types, 'endTurn', 'passSpecialBuild']);
  return (_state, _player, options, rng) => {
    if (!options.some((a) => types.includes(a.type))) return null;
    const rest = options.filter((a) => !skip.has(a.type));
    if (rest.length === 0) return null;
    const type = rng.pick([...new Set(rest.map((a) => a.type))]);
    return rng.pick(rest.filter((a) => a.type === type));
  };
}

/** The bot extensions of the expansions active in `state`, in settings order. */
export function botExtensionsFor(state: Pick<GameState, 'settings'>): BotExtension[] {
  const ids = state.settings.expansions as readonly ExpansionId[] | undefined;
  if (!ids || ids.length === 0) return [];
  return ids.flatMap((id) => BOT_EXTENSIONS.filter((x) => x.id === id));
}
