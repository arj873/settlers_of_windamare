/**
 * Seafarers invariants for the simulator (docs/rules/seafarers.md §9.7). The random bot needs
 * nothing else: ships, the pirate, gold choices, wonders and fortress attacks are all legal moves.
 */
import type { BotExtension } from '../../bots/expansions';
import { checkSeafarers } from './invariants';

export const seafarersBots: BotExtension = {
  id: 'seafarers',
  invariants: checkSeafarers,
  // Longest Trade Route counts ships and Largest Army can be off (the base cross-check counts
  // roads and knights); the robber may be beside the board; Forgotten Tribe gift cards lie on
  // the board; Pirate Islands, Wonders and Cloth have their own ends. The module checks all of
  // them itself.
  relax: ['award-mismatch', 'robber-position', 'dev-conservation', 'winner'],
};
