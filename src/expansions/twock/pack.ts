/** Everything of the module the browser loads on demand (s18, ../load.ts). */
import type { ExpansionPack } from '../load';
import { twockModule } from './engine';
import { twockBots } from './bots';
import { twockHud } from './ui';
import { twockDrawer } from './render';

export const pack: ExpansionPack = {
  module: twockModule,
  bots: twockBots,
  hud: twockHud,
  drawer: twockDrawer,
};
