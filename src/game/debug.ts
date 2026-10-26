/**
 * Read-only debug hook for the playtest harness (`scripts/playtest`), installed only with
 * `?debug=1`. It exposes state for inspection; the harness still plays through real clicks.
 *
 *   window.__catanDebug.state()        GameState copy (null before a game)
 *   window.__catanDebug.legal(player?) legal actions (all, or one player's)
 *   window.__catanDebug.viewer()       who the screen is shown to
 *   window.__catanDebug.boardTargets() board actions a click submits now (what is highlighted)
 *   window.__catanDebug.screenPos(id)  page CSS px of a vertex / edge / hex id
 *   window.__catanDebug.consoleErrors() console errors/warnings and uncaught errors so far
 */
import type { Action, GameState, PlayerId, Point } from '../engine';
import type { GameController } from './controller';

export interface ConsoleEntry {
  level: 'error' | 'warn';
  text: string;
  /** ms since the hook was installed. */
  at: number;
}

export interface CatanDebug {
  state(): GameState | null;
  legal(player?: PlayerId): Action[];
  viewer(): PlayerId | null;
  boardTargets(): Action[];
  screenPos(id: string): Point | null;
  consoleErrors(): ConsoleEntry[];
}

const MAX_ENTRIES = 500;

/** JSON round-trip: callers get plain data and can never reach live objects. */
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function describe(v: unknown): string {
  if (v instanceof Error) return v.stack ?? `${v.name}: ${v.message}`;
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export function installDebugHook(
  controller: Pick<GameController, 'state' | 'legalActions' | 'viewer' | 'boardActions'>,
  board: { screenPos(id: string): Point | null },
): CatanDebug {
  const entries: ConsoleEntry[] = [];
  const t0 = performance.now();
  const record = (level: ConsoleEntry['level'], args: unknown[]) => {
    entries.push({ level, text: args.map(describe).join(' '), at: performance.now() - t0 });
    if (entries.length > MAX_ENTRIES) entries.shift();
  };
  for (const level of ['error', 'warn'] as const) {
    const orig = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      record(level, args);
      orig(...args);
    };
  }
  window.addEventListener('error', (e) => record('error', [e.error ?? e.message]));
  window.addEventListener('unhandledrejection', (e) => record('error', ['unhandled', e.reason]));

  const hook: CatanDebug = {
    state: () => copy(controller.state),
    legal: (player) =>
      copy(controller.legalActions.filter((a) => player === undefined || a.player === player)),
    viewer: () => controller.viewer,
    boardTargets: () => copy(controller.boardActions),
    screenPos: (id) => board.screenPos(id),
    consoleErrors: () => copy(entries),
  };
  (window as unknown as { __catanDebug: CatanDebug }).__catanDebug = hook;
  return hook;
}
