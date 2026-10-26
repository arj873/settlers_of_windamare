import type { Action, PlayerId } from '../engine';

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
  mode: 'base';
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
}

/** Build modes the HUD can enter; the board layer shows the matching targets and calls `buildX` on click. */
export type PlaceMode = 'road' | 'settlement' | 'city';

export interface HudEvents {
  action: Action;
  newGame: NewGameConfig;
  /** The user toggled a build button (or it was cancelled). The board layer listens. */
  placeMode: PlaceMode | null;
}

export type HudEventName = keyof HudEvents;
