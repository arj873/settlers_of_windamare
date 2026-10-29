/** Everything of the module the browser loads on demand (s18, ../load.ts). */
import type { ExpansionPack } from '../load';
import { epModule } from './engine';
import { epBots } from './bots';
import { epHud } from './ui';
import { epDrawer } from './render';

export const pack: ExpansionPack = {
  module: epModule,
  bots: epBots,
  hud: epHud,
  drawer: epDrawer,
};
