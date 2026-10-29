/** Everything of the module the browser loads on demand (s18, ../load.ts). */
import type { ExpansionPack } from '../load';
import { cropModule } from './engine';
import { cropBots } from './bots';
import { cropHud } from './ui';
import { cropDrawer } from './render';

export const pack: ExpansionPack = {
  module: cropModule,
  bots: cropBots,
  hud: cropHud,
  drawer: cropDrawer,
};
