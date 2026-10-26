/**
 * Headless bot-vs-bot simulator. Run: pnpm sim -- --games 100 --seed 1 --players 4
 * Exit code: 0 = no violations, 1 = at least one stall / error / invariant violation,
 * 2 = bad usage. Games that merely hit --max-steps are reported but are not violations.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { MAP_IDS, defaultMapFor, isMapId, layoutToMap, type Action, type MapId } from '../engine';
import { createRandomBot, type PickMode } from './index';
import {
  botSeedFor,
  makeDump,
  newGame,
  randomSource,
  replayDump,
  runGame,
  type FailureDump,
  type GameResult,
  type GameSetup,
} from './runner';

export interface SimArgs {
  games: number;
  seed: number;
  players: number;
  maxSteps: number;
  verbose: boolean;
  trace: boolean;
  bias: number;
  pick: PickMode;
  /** null = the default map for the player count (baseRandom / base56 / base78). */
  map: MapId | null;
  outDir: string;
  maxDumps: number;
  replay: string | null;
  help: boolean;
}

export const USAGE = `pnpm sim -- [options]
  --games N       games to play (default 10)
  --seed S        seed of the first game; game i uses S+i (default 1)
  --players N     3..8, must fit the map (default 4)
  --max-steps M   per-game step cap (default 5000)
  --bias P        0..1: chance per move of skipping endTurn when possible (default 0 = pure uniform)
  --pick MODE     byType (an action type first, then an action of it) | uniform (default byType)
  --map M         ${MAP_IDS.join(' | ')}
                  (default: baseRandom for 3-4 players, base56 for 5-6, base78 for 7-8)
  --layout L      random | beginner (old alias for --map baseRandom | base)
  --verbose       one line per game
  --trace         print every action (use with few games)
  --out-dir DIR   where failure dumps go (default sim-failures)
  --max-dumps K   at most K failure dumps per run (default 5)
  --replay FILE   re-run a failure dump and report what happens
`;

export function parseArgs(argv: readonly string[]): SimArgs {
  const args: SimArgs = {
    games: 10,
    seed: 1,
    players: 4,
    maxSteps: 5000,
    verbose: false,
    trace: false,
    bias: 0,
    pick: 'byType',
    map: null,
    outDir: 'sim-failures',
    maxDumps: 5,
    replay: null,
    help: false,
  };
  const flags = new Set(['--verbose', '--trace', '--help']);
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i] as string;
    if (raw === '--') continue;
    const eq = raw.indexOf('=');
    const key = eq < 0 ? raw : raw.slice(0, eq);
    let value = eq < 0 ? undefined : raw.slice(eq + 1);
    if (!flags.has(key) && value === undefined) {
      value = argv[++i];
      if (value === undefined) throw new Error(`${key} needs a value`);
    }
    const num = (min: number, max = Infinity, int = true): number => {
      const n = Number(value);
      if (
        value === '' ||
        !Number.isFinite(n) ||
        n < min ||
        n > max ||
        (int && !Number.isInteger(n))
      ) {
        throw new Error(`${key}: invalid value "${String(value)}"`);
      }
      return n;
    };
    switch (key) {
      case '--games':
        args.games = num(1);
        break;
      case '--seed':
        args.seed = num(-Infinity);
        break;
      case '--players':
        args.players = num(3, 8);
        break;
      case '--max-steps':
        args.maxSteps = num(1);
        break;
      case '--bias':
        args.bias = num(0, 1, false);
        break;
      case '--pick':
        if (value !== 'byType' && value !== 'uniform')
          throw new Error(`--pick: "${String(value)}"`);
        args.pick = value;
        break;
      case '--layout':
        if (value !== 'random' && value !== 'beginner')
          throw new Error(`--layout: "${String(value)}"`);
        args.map = layoutToMap(value);
        break;
      case '--map':
        if (!isMapId(value)) throw new Error(`--map: "${String(value)}"`);
        args.map = value;
        break;
      case '--out-dir':
        args.outDir = value as string;
        break;
      case '--max-dumps':
        args.maxDumps = num(0);
        break;
      case '--replay':
        args.replay = value as string;
        break;
      case '--verbose':
        args.verbose = true;
        break;
      case '--trace':
        args.trace = true;
        break;
      case '--help':
        args.help = true;
        break;
      default:
        throw new Error(`unknown option ${key}`);
    }
  }
  return args;
}

export interface SimStats {
  games: number;
  finished: number;
  maxSteps: number;
  stalls: number;
  errors: number;
  invariantFailures: number;
  /** Violation code -> count (first violation set of each failing game). */
  violationCodes: Record<string, number>;
  /** Wins per seat index. */
  wins: number[];
  totalTurnsFinished: number;
  totalSteps: number;
  failedSeeds: number[];
}

export function emptyStats(players: number): SimStats {
  return {
    games: 0,
    finished: 0,
    maxSteps: 0,
    stalls: 0,
    errors: 0,
    invariantFailures: 0,
    violationCodes: {},
    wins: Array.from({ length: players }, () => 0),
    totalTurnsFinished: 0,
    totalSteps: 0,
    failedSeeds: [],
  };
}

/** Fold one game into the stats. Returns true if the game was a violation. */
export function record(stats: SimStats, seed: number, r: GameResult): boolean {
  stats.games++;
  stats.totalSteps += r.steps;
  if (r.outcome === 'finished') {
    stats.finished++;
    stats.totalTurnsFinished += r.turns;
    if (r.winner !== null) stats.wins[r.winner] = (stats.wins[r.winner] ?? 0) + 1;
  } else if (r.outcome === 'maxSteps') {
    stats.maxSteps++;
  }
  const f = r.failure;
  if (!f) return false;
  stats.failedSeeds.push(seed);
  if (f.kind === 'stall') stats.stalls++;
  else if (f.kind === 'illegal-action' || f.kind === 'exception') stats.errors++;
  else stats.invariantFailures++;
  for (const v of f.violations)
    stats.violationCodes[v.code] = (stats.violationCodes[v.code] ?? 0) + 1;
  if (f.kind === 'illegal-actor')
    stats.violationCodes['legal-actor'] = (stats.violationCodes['legal-actor'] ?? 0) + 1;
  return true;
}

const fmtAction = (a: Action | null) => (a ? JSON.stringify(a) : '(none)');

function printFailure(seed: number, r: GameResult, file: string | null) {
  const f = r.failure;
  if (!f) return;
  console.error(`FAIL seed=${seed} step=${f.step} kind=${f.kind}`);
  console.error(`  action: ${fmtAction(f.action)}`);
  console.error(`  ${f.message.split('\n').slice(0, 6).join('\n  ')}`);
  if (file) console.error(`  dump:   ${file}  (pnpm sim -- --replay ${file})`);
}

export function main(argv: readonly string[], out: (line: string) => void = console.log): number {
  let args: SimArgs;
  try {
    args = parseArgs(argv);
  } catch (e) {
    console.error(`${e instanceof Error ? e.message : String(e)}\n\n${USAGE}`);
    return 2;
  }
  if (args.help) {
    out(USAGE);
    return 0;
  }
  if (args.replay !== null) return replay(args, out);

  const bot = createRandomBot({ progressBias: args.bias, mode: args.pick });
  const stats = emptyStats(args.players);
  let dumps = 0;
  const started = performance.now();
  for (let i = 0; i < args.games; i++) {
    const seed = args.seed + i;
    const setup: GameSetup = {
      seed,
      players: args.players,
      map: args.map ?? defaultMapFor(args.players),
    };
    const t0 = performance.now();
    const result = runGame({
      initial: newGame(setup),
      maxSteps: args.maxSteps,
      source: randomSource(bot, botSeedFor(seed)),
      ...(args.trace
        ? { onStep: ({ step, action }) => out(`  #${step} ${fmtAction(action)}`) }
        : {}),
    });
    const failed = record(stats, seed, result);
    let file: string | null = null;
    if (failed && dumps < args.maxDumps) {
      dumps++;
      file = join(args.outDir, `fail-seed${seed}-step${result.failure?.step}.json`);
      mkdirSync(args.outDir, { recursive: true });
      writeFileSync(file, JSON.stringify(makeDump(setup, args.bias, result), null, 2));
    }
    if (failed) printFailure(seed, result, file);
    if (args.verbose) {
      out(
        `game seed=${seed}: ${result.failure ? `FAILED (${result.failure.kind})` : result.outcome}` +
          ` steps=${result.steps} turns=${result.turns} winner=${String(result.winner)}` +
          ` ${(performance.now() - t0).toFixed(0)}ms`,
      );
    }
  }
  const ms = performance.now() - started;
  const violations = stats.stalls + stats.errors + stats.invariantFailures;
  const avgTurns = stats.finished ? (stats.totalTurnsFinished / stats.finished).toFixed(1) : 'n/a';
  out(
    `\n=== sim: ${stats.games} games, map ${args.map ?? defaultMapFor(args.players)}, ${args.players} players, seeds ${args.seed}..${args.seed + args.games - 1}, bias ${args.bias}, pick ${args.pick} ===`,
  );
  out(`finished:             ${stats.finished}`);
  out(`hit --max-steps:      ${stats.maxSteps}`);
  out(`avg turns (finished): ${avgTurns}`);
  out(`wins by seat:         ${stats.wins.map((w, p) => `P${p}=${w}`).join(' ')}`);
  out(`stalls:               ${stats.stalls}`);
  out(
    `errors:               ${stats.errors}   (exceptions, or applyAction rejecting a legal action)`,
  );
  out(`invariant failures:   ${stats.invariantFailures}`);
  const codes = Object.entries(stats.violationCodes);
  if (codes.length) out(`  by code: ${codes.map(([c, n]) => `${c}=${n}`).join(' ')}`);
  out(
    `time:                 ${(ms / 1000).toFixed(2)}s total, ${(ms / stats.games).toFixed(1)}ms/game, ${(stats.totalSteps / (ms / 1000)).toFixed(0)} steps/s`,
  );
  if (violations > 0) {
    out(`\nFAILED seeds: ${stats.failedSeeds.join(' ')}  (${dumps} dump(s) in ${args.outDir}/)`);
    return 1;
  }
  out('\nOK: no violations');
  return 0;
}

function replay(args: SimArgs, out: (line: string) => void): number {
  const dump = JSON.parse(readFileSync(args.replay as string, 'utf8')) as FailureDump;
  if (dump.version !== 1) {
    console.error(`unsupported dump version ${String(dump.version)}`);
    return 2;
  }
  out(
    `replaying seed=${String(dump.setup.seed)} (${dump.history.length} recorded actions); originally: ${dump.failure.kind} at step ${dump.failure.step}`,
  );
  const result = replayDump(dump, {
    onStep: ({ step, action }) => {
      if (args.verbose || args.trace) out(`  #${step} ${fmtAction(action)}`);
    },
  });
  if (result.failure) {
    printFailure(Number(dump.setup.seed), result, null);
    out('reproduced');
    return 1;
  }
  out(
    `no failure reproduced (outcome: ${result.outcome}) - fixed, or the dump came from older engine behavior`,
  );
  return 0;
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  process.exitCode = main(process.argv.slice(2));
}
