/**
 * Headless game loop: bots (or a scripted action list) play one game while invariants are
 * checked after every step. The engine is injected (`deps`) so tests can run it on a stub.
 */
import {
  applyAction,
  createGame,
  legalActions,
  PLAYER_COLORS,
  Rng,
  type Action,
  type ActionResult,
  type GameState,
  type Layout,
  type MapId,
  type PlayerId,
} from '../engine';
import { actorsFor, createRandomBot, type Bot } from './index';
import { checkInvariants, type Violation } from './invariants';

export interface EngineDeps {
  legalActions: (state: GameState, player?: PlayerId) => Action[];
  applyAction: (state: GameState, action: Action) => ActionResult;
  checkInvariants: (state: GameState) => Violation[];
}

export const ENGINE_DEPS: EngineDeps = { legalActions, applyAction, checkInvariants };

/** Everything needed to rebuild a game's initial state. */
export interface GameSetup {
  seed: number | string;
  /** 3..8 (must fit the map). */
  players: number;
  /** Default: `layout` (old dumps) or createGame's default for the player count. */
  map?: MapId;
  /** @deprecated v1 dumps; use `map`. */
  layout?: Layout;
  vpToWin?: number;
  /** Default: createGame's (on with 5+ players). */
  specialBuildPhase?: boolean;
  /** Default false. */
  balancedDice?: boolean;
}

export function newGame(setup: GameSetup): GameState {
  return createGame({
    seed: setup.seed,
    players: PLAYER_COLORS.slice(0, setup.players),
    ...(setup.map === undefined ? {} : { map: setup.map }),
    ...(setup.layout === undefined ? {} : { layout: setup.layout }),
    ...(setup.vpToWin === undefined ? {} : { vpToWin: setup.vpToWin }),
    ...(setup.specialBuildPhase === undefined
      ? {}
      : { specialBuildPhase: setup.specialBuildPhase }),
    ...(setup.balancedDice === undefined ? {} : { balancedDice: setup.balancedDice }),
  });
}

export type FailureKind =
  /** Nobody has a legal action but the game is not over. */
  | 'stall'
  /** applyAction rejected an action that legalActions offered. */
  | 'illegal-action'
  /** legalActions / applyAction / the bot threw. */
  | 'exception'
  /** An invariant was violated (initial state or after a step). */
  | 'invariant'
  /** legalActions offered an action for a player who may not act in this phase. */
  | 'illegal-actor';

export interface Failure {
  kind: FailureKind;
  /** Index of the step that was being attempted (0 = before any action). */
  step: number;
  /** The action being applied (null for stalls and failures before choosing one). */
  action: Action | null;
  message: string;
  violations: Violation[];
  /** State the step started from. */
  stateBefore: GameState;
  /** State after the step, for invariant failures. */
  stateAfter: GameState | null;
}

export type Outcome = 'finished' | 'maxSteps' | 'failed' | 'scriptEnded';

export interface GameResult {
  outcome: Outcome;
  steps: number;
  /** `turn.number` of the last state. */
  turns: number;
  winner: PlayerId | null;
  failure: Failure | null;
  /** Every successfully applied action, in order. */
  history: Action[];
  finalState: GameState;
}

/** Chooses the next action; null ends the run (used by scripted replays). */
export type ActionSource = (ctx: {
  step: number;
  state: GameState;
  actors: PlayerId[];
  legal: Action[];
}) => Action | null;

export interface RunOptions {
  initial: GameState;
  maxSteps: number;
  deps?: EngineDeps;
  /** Default: random bots driven by `botSeed` / `bot`. */
  source?: ActionSource;
  bot?: Bot;
  botSeed?: number | string;
  /** Called after each applied action. */
  onStep?: (info: { step: number; action: Action; state: GameState }) => void;
}

/** Seed for the bots' private RNG, derived from the game seed (never the game's own RNG). */
export function botSeedFor(gameSeed: number | string): string {
  return `bots:${String(gameSeed)}`;
}

export function randomSource(bot: Bot, botSeed: number | string): ActionSource {
  const rng = Rng.fromSeed(botSeed);
  return ({ state, actors, legal }) => {
    const withMoves = actors.filter((p) => legal.some((a) => a.player === p));
    if (withMoves.length === 0) return null;
    const actor = rng.pick(withMoves);
    return bot(state, actor, rng, legal);
  };
}

export function scriptedSource(actions: readonly Action[]): ActionSource {
  return ({ step }) => actions[step] ?? null;
}

function errorText(e: unknown): string {
  return e instanceof Error ? (e.stack ?? e.message) : String(e);
}

export function runGame(opts: RunOptions): GameResult {
  const deps = opts.deps ?? ENGINE_DEPS;
  const source =
    opts.source ??
    randomSource(
      opts.bot ?? createRandomBot(),
      opts.botSeed ?? botSeedFor(opts.initial.settings.seed),
    );
  const history: Action[] = [];
  let state = opts.initial;

  const done = (outcome: Outcome, failure: Failure | null = null): GameResult => ({
    outcome,
    steps: history.length,
    turns: state.turn.number,
    winner: state.winner,
    failure,
    history,
    finalState: state,
  });
  const fail = (
    kind: FailureKind,
    message: string,
    action: Action | null,
    violations: Violation[] = [],
    stateAfter: GameState | null = null,
  ) =>
    done('failed', {
      kind,
      step: history.length,
      action,
      message,
      violations,
      stateBefore: state,
      stateAfter,
    });

  const check = (s: GameState): Violation[] | string => {
    try {
      return deps.checkInvariants(s);
    } catch (e) {
      return `invariant checker threw: ${errorText(e)}`;
    }
  };
  const initialViolations = check(state);
  if (typeof initialViolations === 'string') return fail('exception', initialViolations, null);
  if (initialViolations.length > 0) {
    return fail('invariant', describe(initialViolations), null, initialViolations);
  }

  while (history.length < opts.maxSteps) {
    if (state.phase.kind === 'gameOver') return done('finished');

    let legal: Action[];
    let action: Action | null;
    try {
      legal = deps.legalActions(state);
      const actors = actorsFor(state);
      const stray = legal.find((a) => !actors.includes(a.player));
      if (stray) {
        return fail(
          'illegal-actor',
          `legalActions offered ${stray.type} for player ${stray.player}, who cannot act in phase ${state.phase.kind} (actors: ${actors.join(',') || 'none'})`,
          stray,
        );
      }
      if (legal.length === 0) {
        return fail('stall', `no legal actions for anyone in phase ${state.phase.kind}`, null);
      }
      action = source({ step: history.length, state, actors, legal });
    } catch (e) {
      return fail('exception', errorText(e), null);
    }
    if (action === null) return done('scriptEnded');

    let result: ActionResult;
    try {
      result = deps.applyAction(state, action);
    } catch (e) {
      return fail('exception', errorText(e), action);
    }
    if (!result.ok) {
      return fail('illegal-action', `applyAction rejected a legal action: ${result.error}`, action);
    }
    const before = state;
    history.push(action);
    state = result.state;
    opts.onStep?.({ step: history.length - 1, action, state });
    const violations = check(state);
    if (typeof violations === 'string') {
      history.pop();
      const after = state;
      state = before;
      return fail('exception', violations, action, [], after);
    }
    if (violations.length > 0) {
      history.pop();
      const after = state;
      state = before;
      return fail('invariant', describe(violations), action, violations, after);
    }
  }
  return state.phase.kind === 'gameOver' ? done('finished') : done('maxSteps');
}

function describe(violations: Violation[]): string {
  return violations.map((v) => `[${v.code}] ${v.message}`).join('; ');
}

// ---------------------------------------------------------------------------
// Failure dumps + replay
// ---------------------------------------------------------------------------

export interface FailureDump {
  version: 1;
  setup: GameSetup;
  botProgressBias: number;
  failure: Omit<Failure, 'stateBefore' | 'stateAfter'>;
  /** Applied actions before the failure; replay re-applies these, then `failure.action`. */
  history: Action[];
  stateBefore: GameState;
  stateAfter: GameState | null;
}

export function makeDump(
  setup: GameSetup,
  botProgressBias: number,
  result: GameResult,
): FailureDump {
  const f = result.failure;
  if (!f) throw new Error('makeDump: game did not fail');
  const { stateBefore, stateAfter, ...rest } = f;
  return {
    version: 1,
    setup,
    botProgressBias,
    failure: rest,
    history: result.history,
    stateBefore,
    stateAfter,
  };
}

/**
 * Re-run a dump from its seed: applies the recorded actions (then the failing action, if any)
 * with every check enabled. Independent of the bot, so it survives bot changes.
 */
export function replayDump(
  dump: FailureDump,
  opts: { deps?: EngineDeps; onStep?: RunOptions['onStep'] } = {},
): GameResult {
  const script = dump.failure.action ? [...dump.history, dump.failure.action] : dump.history;
  return runGame({
    initial: newGame(dump.setup),
    maxSteps: script.length + 1,
    source: scriptedSource(script),
    ...(opts.deps ? { deps: opts.deps } : {}),
    ...(opts.onStep ? { onStep: opts.onStep } : {}),
  });
}
