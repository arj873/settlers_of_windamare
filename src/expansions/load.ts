/**
 * Expansion modules on demand in the browser (s18, docs/EXPANSIONS.md §2b): each module's
 * `pack.ts` (rules, bots, HUD extension, board drawer, stylesheet) is its own chunk, fetched by
 * `ensureModules` (engine registry) when a mode that needs it is picked, a save is resumed or an
 * online room's mode arrives. Base games never download them.
 *
 * ADDING A MODULE: a `pack.ts` in its folder and one entry in PACKS.
 */
import {
  installExpansion,
  setModuleLoader,
  type ExpansionId,
  type ExpansionModule,
} from '../engine';
import { registerBots, type BotExtension } from '../bots/expansions';
import { registerDrawer, type BoardDrawer } from '../render/expansions';
import { registerHud, type HudExtension } from '../ui/expansions';

/** One module's parts for every layer. */
export interface ExpansionPack {
  module: ExpansionModule;
  bots: BotExtension;
  hud: HudExtension;
  drawer?: BoardDrawer;
}

type PackFile = Promise<{ pack: ExpansionPack }>;

/** One dynamic import per module (a static string each, so the bundler makes one chunk each). */
export const PACKS: Readonly<Record<ExpansionId, () => PackFile>> = {
  demo: () => import('./demo/pack'),
  oil: () => import('./oil/pack'),
  crop: () => import('./crop/pack'),
  ck: () => import('./ck/pack'),
  seafarers: () => import('./seafarers/pack'),
  tb: () => import('./tb/pack'),
  ep: () => import('./ep/pack'),
  seack: () => import('./seack/pack'),
  tbck: () => import('./tbck/pack'),
  tbsea: () => import('./tbsea/pack'),
  tbpair: () => import('./tbpair/pack'),
  epck: () => import('./epck/pack'),
  eptb: () => import('./eptb/pack'),
  back: () => import('./back/pack'),
  twock: () => import('./twock/pack'),
};

/** Register every layer of a pack (idempotent). */
export function installPack(pack: ExpansionPack): void {
  installExpansion(pack.module);
  registerBots(pack.bots);
  registerHud(pack.hud);
  if (pack.drawer) registerDrawer(pack.drawer);
}

/** Fetch a module's pack (rejects for an unknown id or a failed download). */
export async function loadPack(id: ExpansionId): Promise<ExpansionPack> {
  const file = Object.hasOwn(PACKS, id) ? PACKS[id] : undefined;
  if (!file) throw new Error(`no pack for expansion ${id}`);
  return (await file()).pack;
}

/**
 * Make `ensureModules` fetch packs on demand; `onInstall` sees each pack once it is registered
 * (the app registers its sound recipes).
 */
export function useBrowserLoader(onInstall: (pack: ExpansionPack) => void = () => undefined): void {
  setModuleLoader(async (id) => {
    const pack = await loadPack(id);
    installPack(pack);
    onInstall(pack);
  });
}

/** Tests and tools: fetch and install every pack. */
export async function installAllPacks(): Promise<void> {
  const packs = await Promise.all(Object.keys(PACKS).map(loadPack));
  for (const p of packs) installPack(p);
}
