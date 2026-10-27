import type { BotLevel } from '../bots/levels';
import type { PieceStyleId } from './profile/model';
import type {
  Action,
  ExpansionId,
  MapRules,
  MapSelection,
  ModeId,
  OptionValue,
  PlayerId,
  RobberMode,
  ScenarioId,
  SetupPlacement,
  TimerSettings,
} from '../engine';

export type Controller = 'human' | 'bot';

export interface SeatConfig {
  name: string;
  /** CSS color string. */
  color: string;
  controller: Controller;
  /** B1: the bot's difficulty on a 'bot' seat (absent = DEFAULT_BOT_LEVEL). */
  botLevel?: BotLevel;
  /** PR1 (cosmetic): profile picture, AvatarRef (absent = none; bots show the bot). */
  avatar?: string;
  /** PR1 (cosmetic): piece style id (absent = classic). */
  pieceStyle?: PieceStyleId;
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
  /** V1 variants; absent (or any field absent) = official rules. Only non-defaults are set. */
  variants?: NewGameVariants;
}

/** Game-setting variants from the setup screen (engine GameConfig fields of the same names). */
export interface NewGameVariants {
  robberMode?: RobberMode;
  eventCards?: boolean;
  rushMode?: boolean;
  turboMode?: boolean;
  secondSettler?: boolean;
  randomTurnOrder?: boolean;
  mapSelection?: MapSelection;
  setupPlacement?: SetupPlacement;
  /** Adjacencies random maps may have (only `true` flags are set). */
  mapRules?: MapRules;
  /** The optional 5+ player rule set (5+ seats only). */
  rules56?: boolean;
  /** Chess clock (replaces `turnTimerSec`, which is then null). */
  timer?: TimerSettings;
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
  /**
   * Online spectator (M3): public info only. No hand bar, no buttons, no dialogs, a
   * "Spectating" pill. `viewer` is then not a seat (pass -1).
   */
  spectator?: boolean;
  /** Online (M3): seats whose player is disconnected (indexed by PlayerId). */
  away?: readonly boolean[];
  /**
   * UX2: wall-clock length of the finished game in ms (hotseat controller / online room clock),
   * shown on the stats screen; null or absent = unknown.
   */
  gameDurationMs?: number | null;
}

/** Online play (M3): what the menu and the winner screen offer instead of "New game". */
export interface SessionAction {
  label: string;
  primary?: boolean;
  onClick: () => void;
}

/** Optional bot-speed control shown in the HUD menu (see `Hud.setBotSpeed`). */
export interface BotSpeedControl {
  /** Current value in ms per bot move. */
  value: number;
  presets: readonly { label: string; ms: number }[];
  onChange: (ms: number) => void;
}

/** An on/off menu setting (#51: "Show longest road on the board"). */
export interface ToggleControl {
  value: boolean;
  onChange: (on: boolean) => void;
}

/** The "Confirm before building" menu setting (issue #28): ask before a board click builds. */
export interface BuildConfirmControl {
  value: boolean;
  onChange: (on: boolean) => void;
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
