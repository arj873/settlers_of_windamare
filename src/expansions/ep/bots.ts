/**
 * Explorers & Pirates bots: invariants for the simulator and a `steer` that gives the random bot a
 * sense of E&P progress (docs/rules/explorers-pirates.md §9.7).
 */
import type { BotExtension } from '../../bots/expansions';
import { checkEp } from './invariants';

export const epBots: BotExtension = {
  id: 'ep',
  invariants: checkEp,
  // No robber (NO_ROBBER), no Longest Road / Largest Army: the module checks its own state.
  relax: ['robber-position', 'award-mismatch'],
};
