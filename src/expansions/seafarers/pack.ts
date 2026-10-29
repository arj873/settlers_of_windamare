/** Everything of the module the browser loads on demand (s18, ../load.ts). */
import type { ExpansionPack } from '../load';
import { seafarersModule } from './engine';
import { seafarersBots } from './bots';
import { seafarersHud } from './ui';
import { seafarersDrawer } from './render';

export const pack: ExpansionPack = {
  module: seafarersModule,
  bots: seafarersBots,
  hud: seafarersHud,
  drawer: seafarersDrawer,
};
