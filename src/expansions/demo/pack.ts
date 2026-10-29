/** Everything of the module the browser loads on demand (s18, ../load.ts). */
import type { ExpansionPack } from '../load';
import { demoModule } from './engine';
import { demoBots } from './bots';
import { demoHud } from './ui';
import { demoDrawer } from './render';

export const pack: ExpansionPack = {
  module: demoModule,
  bots: demoBots,
  hud: demoHud,
  drawer: demoDrawer,
};
