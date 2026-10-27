/**
 * HUD extension points for expansions (docs/EXPANSIONS.md §8).
 *
 * ADDING A MODULE: one import below and one entry at the END of HUD_EXTENSIONS. The HUD only
 * calls the extensions of the expansions active in the shown game.
 */
import { cropHud } from '../expansions/crop/ui';
import { demoHud } from '../expansions/demo/ui';
import { oilHud } from '../expansions/oil/ui';
import { ckHud } from '../expansions/ck/ui';
import { seafarersHud } from '../expansions/seafarers/ui';
import { tbHud } from '../expansions/tb/ui';
import { epHud } from '../expansions/ep/ui';
import { seackHud } from '../expansions/seack/ui';
import { tbckHud } from '../expansions/tbck/ui';
import { tbseaHud } from '../expansions/tbsea/ui';
import { tbpairHud } from '../expansions/tbpair/ui';
import { epckHud } from '../expansions/epck/ui';
import { eptbHud } from '../expansions/eptb/ui';
import { backHud } from '../expansions/back/ui';
import { twockHud } from '../expansions/twock/ui';
import type { Action, ExpansionId, GameState, PlayerId } from '../engine';
import type { ExtensionSounds, SoundRecipe } from '../audio/types';
import { setBoardExtensions } from '../game/logic';
import type { Child } from './dom';
import type { GlyphName } from './icons';
import type { BasePlaceMode, HudView, PlaceMode } from './types';

export interface HudPanel {
  title: string;
  body: HTMLElement;
}

export interface HudDialog {
  /** Changes when the dialog's content identity changes (drives the enter animation). */
  key: string;
  title: string;
  body: Child[];
  /** Blocks the board (true) or floats over it. */
  modal: boolean;
}

/** A build-bar button for a module piece: toggles `mode` like Road / Settlement / City. */
export interface ExtBuildCard {
  /** Namespaced place mode ('demo/well'). */
  mode: PlaceMode;
  label: string;
  /** The action type a board click submits in this mode. */
  actionType: string;
  /**
   * More action types this mode places (Seafarers: a setup ship, a free ship from Road
   * Building). The card is enabled by any of them, and in this mode a board click prefers them
   * over the implied prompts (a coast edge could otherwise only take the road).
   */
  alsoActions?: readonly string[];
  glyph?: GlyphName;
  /** Cost item for costOf() (shown as card faces). Default: `mode`. */
  costItem?: string;
  /** E4: whether the card is shown in this game at all (one module, several scenarios). Default: always. */
  available?(state: GameState): boolean;
  /** Pieces left / total for the counter (omit for no counter). */
  left?(state: GameState, player: PlayerId): number;
  total?(state: GameState, player: PlayerId): number;
  /**
   * Why the card is off besides missing resources (no spot, none left), shown with them in the
   * disabled reason; null = no such reason. Default: none ("Not possible right now").
   */
  blocker?(state: GameState, player: PlayerId): string | null;
}

export interface HudExtension {
  id: ExpansionId;
  /** A sidebar section between Bank and Players (null = none right now). */
  panel?(state: GameState, view: HudView, send: (a: Action) => void): HudPanel | null;
  buildCards?: readonly ExtBuildCard[];
  /** A dialog for this module's phases. Base forced dialogs (discard, steal, trade) come first. */
  dialog?(
    state: GameState,
    view: HudView,
    legal: readonly Action[],
    send: (a: Action) => void,
  ): HudDialog | null;
  /** Turn-pill text for this module's phases (the viewer can act). */
  hint?(state: GameState, view: HudView): string | null;
  /** Extra cards in the viewer's hand bar, after the resource cards (C&K commodities). */
  handCards?(state: GameState, view: HudView, send: (a: Action) => void): Child[];
  /** Extra items shown in the open trade offer's `give` / `want` row (C&K commodities). */
  offerExtras?(state: GameState, side: 'give' | 'want'): Child[];
  /** Action types submitted by a plain board click, without a button (like moveRobber). */
  impliedActions?: readonly string[];
  /**
   * Base build-bar cards this module's games do not use (E&P: no cities). A function decides per
   * game (E&P + C&K has cities).
   */
  hideBaseCards?:
    readonly BasePlaceMode[] | ((state: Pick<GameState, 'settings'>) => readonly BasePlaceMode[]);
  /**
   * Sound effects (A1): recipes under `<id>/<name>` (registered for every module at boot) and a
   * cue hook called with each state change of a game the module is active in (src/game/sounds.ts).
   */
  sounds?: ExtensionSounds<GameState>;
}

export const HUD_EXTENSIONS: readonly HudExtension[] = [
  demoHud,
  oilHud,
  cropHud,
  ckHud,
  seafarersHud,
  tbHud,
  epHud,
  seackHud,
  tbckHud,
  tbseaHud,
  tbpairHud,
  epckHud,
  eptbHud,
  backHud,
  twockHud,
  // new modules go here, one per line
];

/** The HUD extensions of the expansions active in `state`, in settings order. */
export function hudExtensionsFor(state: Pick<GameState, 'settings'>): HudExtension[] {
  const ids = state.settings.expansions as readonly ExpansionId[] | undefined;
  if (!ids || ids.length === 0) return [];
  return ids.flatMap((id) => HUD_EXTENSIONS.filter((x) => x.id === id));
}

/** Base build cards hidden by an active extension (`hideBaseCards`). */
export function hiddenBaseCards(state: Pick<GameState, 'settings'>): ReadonlySet<string> {
  return new Set(
    hudExtensionsFor(state).flatMap((x) =>
      typeof x.hideBaseCards === 'function' ? x.hideBaseCards(state) : (x.hideBaseCards ?? []),
    ),
  );
}

/** First non-null hint of the active extensions. */
export function extensionHint(state: GameState, view: HudView): string | null {
  for (const x of hudExtensionsFor(state)) {
    const h = x.hint?.(state, view);
    if (h) return h;
  }
  return null;
}

/** The sound hooks of the expansions active in `state` (A1). */
export function extensionSounds(state: Pick<GameState, 'settings'>): ExtensionSounds<GameState>[] {
  return hudExtensionsFor(state).flatMap((x) => (x.sounds ? [x.sounds] : []));
}

/** Every module's sound recipes, keyed by namespaced id (registered once at boot). */
export function extensionSoundRecipes(): Record<string, SoundRecipe> {
  return Object.assign({}, ...HUD_EXTENSIONS.map((x) => x.sounds?.recipes ?? {})) as Record<
    string,
    SoundRecipe
  >;
}

/** Every implied (button-less) board action type of every extension. */
export function impliedExtActions(): ReadonlySet<string> {
  return new Set(HUD_EXTENSIONS.flatMap((x) => x.impliedActions ?? []));
}

/** The build card label of a namespaced place mode ('tb/wagon' -> 'Wagon'), or null. */
export function placeModeLabel(mode: string): string | null {
  for (const x of HUD_EXTENSIONS) {
    const card = x.buildCards?.find((c) => c.mode === mode);
    if (card) return card.label;
  }
  return null;
}

/** The action type a namespaced place mode submits, or null. */
export function placeModeAction(mode: string): string | null {
  for (const x of HUD_EXTENSIONS) {
    const card = x.buildCards?.find((c) => c.mode === mode);
    if (card) return card.actionType;
  }
  return null;
}

/** Every action type a namespaced place mode submits (its actionType first), or []. */
export function placeModeActions(mode: string): readonly string[] {
  for (const x of HUD_EXTENSIONS) {
    const card = x.buildCards?.find((c) => c.mode === mode);
    if (card) return [card.actionType, ...(card.alsoActions ?? [])];
  }
  return [];
}

// boardActions (game/logic.ts) learns the extensions' board actions from here, so the headless room
// server, which imports game/logic but no UI, never loads module stylesheets.
setBoardExtensions({ implied: impliedExtActions(), placeModeAction, placeModeActions });
