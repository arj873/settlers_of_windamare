/** Everything of the module the browser loads on demand (s18, ../load.ts). */
import type { ExpansionPack } from '../load';
import { seackModule } from './engine';
import { seackBots } from './bots';
import { seackHud } from './ui';

export const pack: ExpansionPack = { module: seackModule, bots: seackBots, hud: seackHud };
