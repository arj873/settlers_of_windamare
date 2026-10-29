/** Everything of the module the browser loads on demand (s18, ../load.ts). */
import type { ExpansionPack } from '../load';
import { tbseaModule } from './engine';
import { tbseaBots } from './bots';
import { tbseaHud } from './ui';

export const pack: ExpansionPack = { module: tbseaModule, bots: tbseaBots, hud: tbseaHud };
