/**
 * Every module's rules and bots, imported statically (s18, docs/EXPANSIONS.md §2b): for code that
 * runs without a browser — the room server, the in-browser room server's worker, the simulator,
 * scripts — and for the catalog generator. The browser game loads modules on demand instead
 * (load.ts); tests get everything from the vitest setup (src/testSetup.ts).
 *
 * ADDING A MODULE: one entry at the END of HEADLESS (registry order), then `pnpm gen:catalog`.
 */
import { installExpansion, type ExpansionModule } from '../engine';
import { registerBots, type BotExtension } from '../bots/expansions';
import { demoModule } from './demo/engine';
import { demoBots } from './demo/bots';
import { oilModule } from './oil/engine';
import { oilBots } from './oil/bots';
import { cropModule } from './crop/engine';
import { cropBots } from './crop/bots';
import { ckModule } from './ck/engine';
import { ckBots } from './ck/bots';
import { seafarersModule } from './seafarers/engine';
import { seafarersBots } from './seafarers/bots';
import { tbModule } from './tb/engine';
import { tbBots } from './tb/bots';
import { epModule } from './ep/engine';
import { epBots } from './ep/bots';
import { seackModule } from './seack/engine';
import { seackBots } from './seack/bots';
import { tbckModule } from './tbck/engine';
import { tbckBots } from './tbck/bots';
import { tbseaModule } from './tbsea/engine';
import { tbseaBots } from './tbsea/bots';
import { tbpairModule } from './tbpair/engine';
import { tbpairBots } from './tbpair/bots';
import { epckModule } from './epck/engine';
import { epckBots } from './epck/bots';
import { eptbModule } from './eptb/engine';
import { eptbBots } from './eptb/bots';
import { backModule } from './back/engine';
import { backBots } from './back/bots';
import { twockModule } from './twock/engine';
import { twockBots } from './twock/bots';

/** [rules, bots] of every module, in registry order. */
export const HEADLESS: readonly (readonly [ExpansionModule, BotExtension])[] = [
  [demoModule, demoBots],
  [oilModule, oilBots],
  [cropModule, cropBots],
  [ckModule, ckBots],
  [seafarersModule, seafarersBots],
  [tbModule, tbBots],
  [epModule, epBots],
  [seackModule, seackBots],
  [tbckModule, tbckBots],
  [tbseaModule, tbseaBots],
  [tbpairModule, tbpairBots],
  [epckModule, epckBots],
  [eptbModule, eptbBots],
  [backModule, backBots],
  [twockModule, twockBots],
  // new modules go here, one per line
];

/** Install every module's rules and bots (idempotent). */
export function installHeadless(): void {
  for (const [module, bots] of HEADLESS) {
    installExpansion(module);
    registerBots(bots);
  }
}
