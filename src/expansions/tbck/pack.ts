/** Everything of the module the browser loads on demand (s18, ../load.ts). */
import type { ExpansionPack } from '../load';
import { tbckModule } from './engine';
import { tbckBots } from './bots';
import { tbckHud } from './ui';

export const pack: ExpansionPack = { module: tbckModule, bots: tbckBots, hud: tbckHud };
