/** Everything of the module the browser loads on demand (s18, ../load.ts). */
import type { ExpansionPack } from '../load';
import { eptbModule } from './engine';
import { eptbBots } from './bots';
import { eptbHud } from './ui';

export const pack: ExpansionPack = { module: eptbModule, bots: eptbBots, hud: eptbHud };
