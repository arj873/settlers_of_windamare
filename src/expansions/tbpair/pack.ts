/** Everything of the module the browser loads on demand (s18, ../load.ts). */
import type { ExpansionPack } from '../load';
import { tbpairModule } from './engine';
import { tbpairBots } from './bots';
import { tbpairHud } from './ui';

export const pack: ExpansionPack = { module: tbpairModule, bots: tbpairBots, hud: tbpairHud };
