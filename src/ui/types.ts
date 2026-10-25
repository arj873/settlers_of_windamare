import type { Action, Layout, PlayerId } from '../engine';

export type Controller = 'human' | 'bot';

export interface SeatConfig {
  name: string;
  /** CSS color string. */
  color: string;
  controller: Controller;
}

/** Emitted by the new-game screen. T7 maps `players` to `createGame` and spawns bots for 'bot' seats. */
export interface NewGameConfig {
  /** 3–4 seats in turn order. */
  players: SeatConfig[];
  layout: Layout;
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
