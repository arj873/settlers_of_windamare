/** Everything of the module the browser loads on demand (s18, ../load.ts). */
import type { ExpansionPack } from '../load';
import { epckModule } from './engine';
import { epckBots } from './bots';
import { epckHud } from './ui';

export const pack: ExpansionPack = { module: epckModule, bots: epckBots, hud: epckHud };
