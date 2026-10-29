/** Everything of the module the browser loads on demand (s18, ../load.ts). */
import type { ExpansionPack } from '../load';
import { oilModule } from './engine';
import { oilBots } from './bots';
import { oilHud } from './ui';
import { oilDrawer } from './render';

export const pack: ExpansionPack = {
  module: oilModule,
  bots: oilBots,
  hud: oilHud,
  drawer: oilDrawer,
};
