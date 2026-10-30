/** Everything of the module the browser loads on demand (s18, ../load.ts). */
import type { ExpansionPack } from '../load';
import { ckModule } from './engine';
import { ckBots } from './bots';
import { ckHud } from './ui';
import { ckDrawer } from './render';
import { ckTutorial } from './tutorial';

export const pack: ExpansionPack = {
  module: ckModule,
  bots: ckBots,
  hud: ckHud,
  drawer: ckDrawer,
  tutorial: ckTutorial,
};
