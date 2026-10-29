/** Everything of the module the browser loads on demand (s18, ../load.ts). */
import type { ExpansionPack } from '../load';
import { backModule } from './engine';
import { backBots } from './bots';
import { backHud } from './ui';
import { backDrawer } from './render';

export const pack: ExpansionPack = {
  module: backModule,
  bots: backBots,
  hud: backHud,
  drawer: backDrawer,
};
