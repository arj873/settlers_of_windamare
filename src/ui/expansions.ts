/**
 * HUD extension points for expansions (docs/EXPANSIONS.md §8).
 *
 * ADDING A MODULE: one import below and one entry at the END of HUD_EXTENSIONS. The HUD only
 * calls the extensions of the expansions active in the shown game.
 */
import { cropHud } from '../expansions/crop/ui';
import { demoHud } from '../expansions/demo/ui';
import { oilHud } from '../expansions/oil/ui';
import type { Action, ExpansionId, GameState, PlayerId } from '../engine';
import { setBoardExtensions } from '../game/logic';
import type { Child } from './dom';
import type { GlyphName } from './icons';
import type { HudView, PlaceMode } from './types';

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
  glyph?: GlyphName;
  /** Cost item for costOf() (shown as card faces). Default: `mode`. */
  costItem?: string;
  /** Pieces left / total for the counter (omit for no counter). */
  left?(state: GameState, player: PlayerId): number;
  total?(state: GameState, player: PlayerId): number;
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
  /** Action types submitted by a plain board click, without a button (like moveRobber). */
  impliedActions?: readonly string[];
}

export const HUD_EXTENSIONS: readonly HudExtension[] = [
  demoHud,
  oilHud,
  cropHud,
  // new modules go here, one per line
];

/** The HUD extensions of the expansions active in `state`, in settings order. */
export function hudExtensionsFor(state: Pick<GameState, 'settings'>): HudExtension[] {
  const ids = state.settings.expansions as readonly ExpansionId[] | undefined;
  if (!ids || ids.length === 0) return [];
  return ids.flatMap((id) => HUD_EXTENSIONS.filter((x) => x.id === id));
}

/** First non-null hint of the active extensions. */
export function extensionHint(state: GameState, view: HudView): string | null {
  for (const x of hudExtensionsFor(state)) {
    const h = x.hint?.(state, view);
    if (h) return h;
  }
  return null;
}

/** Every implied (button-less) board action type of every extension. */
export function impliedExtActions(): ReadonlySet<string> {
  return new Set(HUD_EXTENSIONS.flatMap((x) => x.impliedActions ?? []));
}

/** The action type a namespaced place mode submits, or null. */
export function placeModeAction(mode: string): string | null {
  for (const x of HUD_EXTENSIONS) {
    const card = x.buildCards?.find((c) => c.mode === mode);
    if (card) return card.actionType;
  }
  return null;
}

// boardActions (game/logic.ts) learns the extensions' board actions from here, so the headless room
// server, which imports game/logic but no UI, never loads module stylesheets.
setBoardExtensions({ implied: impliedExtActions(), placeModeAction });
