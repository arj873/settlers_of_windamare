import type { Action, ExpansionId, ModeId, OptionValue, PlayerId, ScenarioId } from '../engine';

export type Controller = 'human' | 'bot';

export interface SeatConfig {
  name: string;
  /** CSS color string. */
  color: string;
  controller: Controller;
}

export type MapId = 'base' | 'baseRandom' | 'base56' | 'base78';

/** Emitted by the setup screen. The controller maps `players` to `createGame` and spawns bots for 'bot' seats. */
export interface NewGameConfig {
  /** 'base' or an expansion mode (engine `listModes()`). */
  mode: ModeId;
  /** Expansion modes: the scenario (absent = the mode's first). */
  scenario?: ScenarioId;
  /** Expansion modes: options per expansion. */
  options?: Record<ExpansionId, Record<string, OptionValue>>;
  /** Base mode: the board (expansion modes take theirs from the scenario). */
  map: MapId;
  /** 3–8 seats in turn order. */
  players: SeatConfig[];
  rules: { balancedDice: boolean; hideBankCards: boolean };
  /** Seconds per turn; null = no timer. */
  turnTimerSec: number | null;
  vpToWin: number;
  /** A player holding more than this many cards discards half on a 7. */
  discardLimit: number;
  /** Absent = the controller picks one. */
  seed?: string;
}

/** What the controller tells the HUD about the viewer on every render. */
export interface HudView {
  /** Whose hand is shown. */
  viewer: PlayerId;
  /** Legal actions (any actor; the HUD only looks at `player === viewer`). */
  legal: Action[];
  /** The player whose turn it is is a bot. */
  isBotTurn: boolean;
  /** Optional: which seats are bots (indexed by PlayerId), for the bot marker in the players list. */
  bots?: readonly boolean[];
  /** Optional turn timer (T14); the turn pill shows a countdown while set. */
  turnTimer?: { remainingSec: number; totalSec: number } | null;
}

/** Optional bot-speed control shown in the HUD menu (see `Hud.setBotSpeed`). */
export interface BotSpeedControl {
  /** Current value in ms per bot move. */
  value: number;
  presets: readonly { label: string; ms: number }[];
  onChange: (ms: number) => void;
}

/** Base build modes; the board layer shows the matching targets and calls `buildX` on click. */
export type BasePlaceMode = 'road' | 'settlement' | 'city';
/**
 * Build modes the HUD can enter: a base one or an expansion build card's namespaced mode
 * ('demo/well'; ui/expansions.ts maps it to its action type).
 */
export type PlaceMode = BasePlaceMode | `${string}/${string}`;

export interface HudEvents {
  action: Action;
  newGame: NewGameConfig;
  /** The user toggled a build button (or it was cancelled). The board layer listens. */
  placeMode: PlaceMode | null;
}

export type HudEventName = keyof HudEvents;
