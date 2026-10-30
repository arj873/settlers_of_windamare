/**
 * HUD extension points for expansions (docs/EXPANSIONS.md §8).
 *
 * A module's `pack.ts` lists its HUD extension; it registers when the module loads (s18,
 * src/expansions/load.ts). The HUD only calls the extensions of the expansions active in the
 * shown game.
 */
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

/**
 * One kind of module card in the viewer's hand (#cardinfo, `handCardInfo`). The HUD draws it like
 * a base card and opens its info card (face, name, count, `text`, `status`, `notes`) on a click
 * when it can't be played, or on a right-click / long-press when it can. It never sends an action
 * from a card without `play`.
 */
export interface HandCard {
  /** Unique in the hand, namespaced: 'ck/alchemist', 'ck/paper'. */
  key: string;
  name: string;
  /** How many the viewer holds: > 0, or 0 for a good shown greyed like an empty resource. */
  count: number;
  /** A good's kind as the log names it ('paper', 'gold'): the production animation lands on it. */
  produced?: string;
  /** The card art, `w` px wide (46 in the hand, 34 in the info card). */
  face(w: number): HTMLElement;
  /** What the card does (a card one plays) or what it is for (a good), in plain words. */
  text: string;
  /**
   * 'play': a card one plays (progress card, Swift Journey): after the separator with the dev
   * cards, dimmed (`.is-off`, aria-disabled) while it can't be played.
   * 'good': a card one spends or trades (commodity, gold): after the resources; the click only
   * opens the info card.
   */
  kind: 'play' | 'good';
  /**
   * What a click does now, set only from the viewer's legal actions (`view.legal`), never
   * re-derived from the rules: send that action, or open a dialog for a play that needs choices
   * first (like base Year of Plenty). null: the click opens the info card.
   */
  play: HandCardPlay | null;
  /**
   * The "can I play it" line: how to play it now, or why not and when. It may be derived from the
   * module's rules (only `play` decides "playable"). Omit for a good.
   */
  status?: string;
  /** More lines under the status (C&K: the hand limit). */
  notes?: readonly string[];
  /** A tag on the card ('new'). */
  tag?: string;
  /** More classes on the hand card (module styling, `<id>-` prefixed). */
  cls?: string;
}

/**
 * A playable hand card's click: an action (one of `view.legal`), or a dialog the HUD opens and
 * rebuilds on every render (`close` closes it; a send closes it too; null = gone).
 */
export type HandCardPlay = { action: Action } | { dialog(close: () => void): HudDialog | null };

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
  /**
   * The cards of this module the viewer holds (#cardinfo), one per kind held: the HUD draws them
   * in the hand bar and gives each the dev cards' info card. Not called for spectators.
   */
  handCardInfo?(state: GameState, view: HudView, send: (a: Action) => void): HandCard[];
  /**
   * A combination's word on another module's hand card whose rules it changes (#cardinfo; Barbarian
   * Attack + C&K's progress cards): the status line of card `key` while it can't be played, or
   * null to keep the card's own.
   */
  handCardStatus?(state: GameState, view: HudView, key: string): string | null;
  /** Extra non-card items in the viewer's hand bar, after the resource cards. */
  handCards?(state: GameState, view: HudView, send: (a: Action) => void): Child[];
  /** Extra items shown in the open trade offer's `give` / `want` row (C&K commodities). */
  offerExtras?(state: GameState, side: 'give' | 'want'): Child[];
  /**
   * Card art for a kind of card this module hands out (as the log names it: 'paper', 'gold',
   * 'fish' ...), `w` px wide; null = not one of this module's. The production animation flies
   * it; without one it flies a generic token.
   */
  cardFace?(kind: string, w: number): HTMLElement | null;
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

const huds: HudExtension[] = [];

/** The HUD extensions of every loaded module. */
export const HUD_EXTENSIONS: readonly HudExtension[] = huds;

/**
 * Add a module's HUD extension (when the module loads; the same one again does nothing). The
 * caller registers its sound recipes (`x.sounds.recipes`) with the sound engine.
 */
export function registerHud(x: HudExtension): void {
  const have = huds.find((h) => h.id === x.id);
  if (have === x) return;
  if (have) throw new Error(`a HUD extension for ${x.id} is already registered`);
  huds.push(x);
  syncBoardExtensions();
}

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

/** The viewer's module cards (#cardinfo `handCardInfo`) of the expansions active in `state`. */
export function handCardsFor(
  state: GameState,
  view: HudView,
  send: (a: Action) => void,
): HandCard[] {
  if (view.spectator) return [];
  return hudExtensionsFor(state).flatMap((x) => x.handCardInfo?.(state, view, send) ?? []);
}

/**
 * The status line of a module hand card (#cardinfo): while it can't be played, a combination's
 * word first (`handCardStatus`), else the card's own; null for a good without one.
 */
export function handCardLine(state: GameState, view: HudView, card: HandCard): string | null {
  if (card.kind === 'play' && !card.play) {
    for (const x of hudExtensionsFor(state)) {
      const s = x.handCardStatus?.(state, view, card.key);
      if (s) return s;
    }
  }
  return card.status ?? (card.play ? 'Playable now: click the card to play it.' : null);
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

/** Every loaded module's sound recipes, keyed by namespaced id. */
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
function syncBoardExtensions(): void {
  setBoardExtensions({
    implied: impliedExtActions(),
    placeModeAction,
    placeModeActions,
    buildCardActions: new Set(
      HUD_EXTENSIONS.flatMap((x) => (x.buildCards ?? []).map((c) => c.actionType)),
    ),
  });
}
