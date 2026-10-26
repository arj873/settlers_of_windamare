/** Shared shapes between the session server, the CLI and the in-page scanner (`inpage.js`). */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Action, GameState, PlayerId } from '../../src/engine';

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const PLAYTEST_DIR = join(REPO_ROOT, 'playtest');
export const SESSION_FILE = join(PLAYTEST_DIR, 'session.json');
export const SHOTS_DIR = join(PLAYTEST_DIR, 'shots');
export const BUGS_DIR = join(PLAYTEST_DIR, 'bugs');

/** Written by `pt:serve`, read by every `pt` call. */
export interface SessionInfo {
  port: number;
  pid: number;
  appUrl: string;
  /** Number of seats (players), 3..8. */
  seats: number;
  map: string | null;
  seed: string;
  vp: number | null;
  startedAt: string;
}

export interface CommandRequest {
  /** 0-based player index; -1 for seat-less commands (stop). */
  seat: number;
  cmd: string;
  args: string[];
  flags: Record<string, string>;
}

export interface CommandResponse {
  out: string;
  /** For `probe`: true when the seat should stop waiting. */
  ready?: boolean;
}

/** A visible HUD button, as found by `inpage.js`. */
export interface Control {
  /** `data-pt` attribute value set on the element during this scan. */
  id: string;
  /** Visible text with section context, e.g. "Give: Brick 4:1", "Seat2: Trade". */
  label: string;
  enabled: boolean;
  /** Toggle chips (trade recipients): currently on. */
  on: boolean;
  inDialog: boolean;
}

/** A − value + stepper (discard / trade composer). */
export interface Stepper {
  label: string;
  value: number;
  decId: string | null;
  incId: string | null;
  canDec: boolean;
  canInc: boolean;
}

export interface UiScan {
  /** Hotseat cover heading, e.g. "Pass to Seat2"; null when no cover. */
  cover: string | null;
  /** New-game / resume / winner screen showing. */
  screen: 'newGame' | 'resume' | 'winner' | null;
  winnerText: string | null;
  hint: string | null;
  dialogTitle: string | null;
  /** Dialog text lines that are not buttons (summary / errors / notes). */
  dialogText: string[];
  controls: Control[];
  steppers: Stepper[];
  toasts: string[];
  /** Resource counts shown in the HUD hand (lowercase resource -> count); null if hidden. */
  hand: Record<string, number> | null;
  /** Player panels as shown: name, VP, card counts. */
  panels: { name: string; vp: number; cards: number; dev: number; knights: number }[];
  diceTotal: number | null;
}

export interface Snapshot {
  state: GameState | null;
  viewer: PlayerId | null;
  legal: Action[];
  targets: Action[];
  ui: UiScan;
  consoleCount: number;
}
