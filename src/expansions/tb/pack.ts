/** Everything of the module the browser loads on demand (s18, ../load.ts). */
import type { ExpansionPack } from '../load';
import { tbModule } from './engine';
import { tbBots } from './bots';
import { tbHud } from './ui';
import { tbDrawer } from './render';

export const pack: ExpansionPack = {
  module: tbModule,
  bots: tbBots,
  hud: tbHud,
  drawer: tbDrawer,
};
