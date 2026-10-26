/**
 * Bot-vs-bot benchmark (B1): one "hero" level against a field of another, seats rotated so the
 * hero plays every seat equally often. Every step is checked by the sim invariants.
 *
 *   pnpm bench --hero normal --field easy --games 200
 *   pnpm bench --hero hard --field normal --games 200 --players 4 --mode ck
 *
 * Reports the hero's win rate (vs the 1/players a level match would give), turns per game, and
 * the slowest decision. Exit code 1 on a violation, 2 on bad usage.
 */
import { pathToFileURL } from 'node:url';
import { Rng } from '../engine';
import type { Bot } from './index';
import { botForLevel } from './byLevel';
import { BOT_LEVELS, isBotLevel, type BotLevel } from './levels';
import { newGame, runGame, type ActionSource, type GameSetup } from './runner';

export interface BenchArgs {
  hero: BotLevel;
  field: BotLevel;
  games: number;
  players: number;
  seed: number;
  maxSteps: number;
  mode: string | null;
  scenario: string | null;
}

export interface BenchResult {
  games: number;
  heroWins: number;
  /** Games that ended without a winner (max steps). */
  unfinished: number;
  failures: string[];
  avgTurns: number;
  /** Slowest single decision in ms, and the mean. */
  maxMs: number;
  meanMs: number;
}

/**
 * One bot per seat, each with its own RNG stream. Bots get their own legal actions, minus player
 * trades after one offer in a turn (as the game controller and the room do).
 */
export function seatSource(
  bots: readonly Bot[],
  seed: string,
  timing?: { max: number; total: number; count: number },
): ActionSource {
  const rngs = bots.map((_, i) => Rng.fromSeed(`${seed}:seat${i}`));
  const pickRng = Rng.fromSeed(`${seed}:actor`);
  const offers = new Map<string, number>();
  return ({ state, actors, legal }) => {
    const withMoves = actors.filter((p) => legal.some((a) => a.player === p));
    if (withMoves.length === 0) return null;
    // Players owing a response (discards, trade replies) first, as in the game controller.
    const owing = withMoves.filter((p) => p !== state.turn.current);
    const p = pickRng.pick(owing.length > 0 ? owing : withMoves);
    const own = legal.filter((a) => a.player === p);
    const key = `${state.turn.number}:${p}`;
    const used = offers.get(key) ?? 0;
    const noOffers = own.filter((a) => a.type !== 'offerTrade');
    const options = used < 1 || noOffers.length === 0 ? own : noOffers;
    const bot = bots[p];
    if (!bot) throw new Error(`no bot for seat ${p}`);
    const t0 = performance.now();
    const action = bot(state, p, rngs[p] as Rng, options);
    const dt = performance.now() - t0;
    if (timing) {
      timing.max = Math.max(timing.max, dt);
      timing.total += dt;
      timing.count += 1;
    }
    if (action?.type === 'offerTrade') offers.set(key, used + 1);
    return action;
  };
}

/** `hero` in one seat (rotated game by game) against `field` everywhere else. */
export function runBench(
  args: BenchArgs,
  log: (line: string) => void = () => {},
  bots: { hero: Bot; field: Bot } = {
    hero: botForLevel(args.hero),
    field: botForLevel(args.field),
  },
): BenchResult {
  const timing = { max: 0, total: 0, count: 0 };
  let heroWins = 0;
  let unfinished = 0;
  let turns = 0;
  const failures: string[] = [];
  for (let g = 0; g < args.games; g++) {
    const heroSeat = g % args.players;
    const seats = Array.from({ length: args.players }, (_, i) =>
      i === heroSeat ? bots.hero : bots.field,
    );
    const seed = `bench:${args.seed}:${g}`;
    const setup: GameSetup = {
      seed,
      players: args.players,
      ...(args.mode ? { mode: args.mode } : {}),
      ...(args.scenario ? { scenario: args.scenario } : {}),
    };
    const result = runGame({
      initial: newGame(setup),
      maxSteps: args.maxSteps,
      source: seatSource(seats, seed, timing),
    });
    turns += result.turns;
    if (result.outcome === 'failed') {
      failures.push(`${seed}: ${result.failure?.kind} ${result.failure?.message.slice(0, 300)}`);
      log(`FAIL ${failures[failures.length - 1]}`);
    } else if (result.winner === null) unfinished += 1;
    else if (result.winner === heroSeat) heroWins += 1;
  }
  return {
    games: args.games,
    heroWins,
    unfinished,
    failures,
    avgTurns: turns / Math.max(1, args.games),
    maxMs: timing.max,
    meanMs: timing.total / Math.max(1, timing.count),
  };
}

export function parseBenchArgs(argv: readonly string[]): BenchArgs {
  const args: BenchArgs = {
    hero: 'normal',
    field: 'easy',
    games: 200,
    players: 4,
    seed: 1,
    maxSteps: 20000,
    mode: null,
    scenario: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--') continue;
    const value = argv[++i];
    if (value === undefined) throw new Error(`${flag} needs a value`);
    const int = () => {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 1) throw new Error(`${flag}: positive integer expected`);
      return n;
    };
    const level = () => {
      if (!isBotLevel(value)) throw new Error(`${flag}: one of ${BOT_LEVELS.join(', ')}`);
      return value;
    };
    switch (flag) {
      case '--hero':
        args.hero = level();
        break;
      case '--field':
        args.field = level();
        break;
      case '--games':
        args.games = int();
        break;
      case '--players':
        args.players = int();
        break;
      case '--seed':
        args.seed = int();
        break;
      case '--max-steps':
        args.maxSteps = int();
        break;
      case '--mode':
        args.mode = value;
        break;
      case '--scenario':
        args.scenario = value;
        break;
      default:
        throw new Error(`unknown flag ${flag}`);
    }
  }
  return args;
}

function main(): void {
  let args: BenchArgs;
  try {
    args = parseBenchArgs(process.argv.slice(2));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(2);
  }
  const t0 = performance.now();
  const r = runBench(args, (line) => console.log(line));
  const finished = r.games - r.unfinished - r.failures.length;
  const pct = (x: number) => `${((100 * x) / Math.max(1, r.games)).toFixed(1)}%`;
  console.log(
    `${args.hero} vs ${args.players - 1}x ${args.field}` +
      ` (${args.mode ?? 'base'}${args.scenario ? ` ${args.scenario}` : ''}, ${args.players}P, ${r.games} games, seats rotated)`,
  );
  console.log(
    `  hero wins ${r.heroWins} (${pct(r.heroWins)}; even share ${(100 / args.players).toFixed(1)}%)` +
      `  finished ${finished}  unfinished ${r.unfinished}  failed ${r.failures.length}`,
  );
  console.log(
    `  avg turns ${r.avgTurns.toFixed(1)}  decision ms: mean ${r.meanMs.toFixed(3)} max ${r.maxMs.toFixed(1)}` +
      `  wall ${((performance.now() - t0) / 1000).toFixed(1)}s`,
  );
  process.exit(r.failures.length > 0 ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
