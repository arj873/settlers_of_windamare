/**
 * Tests and the seed search (docs/TUTORIAL.md): play a course's game headless the way the
 * controller does (bots by seat level on the controller's bot rng, one trade offer per bot and
 * turn) with a scripted learner in the human seat, following the coach after every move.
 * Not imported by the app.
 */
import { applyAction, legalActions, Rng, type Action, type GameState } from '../../engine';
import type { Bot } from '../../bots';
import { botForLevel } from '../../bots/byLevel';
import { BOT_OFFERS_PER_TURN } from '../../game/controller';
import { appendedLog, nextBot } from '../../game/logic';
import type { Course, TutorialCtx } from './course';
import { advance, newRun, next, type TutorialRun } from './machine';

export const ctxOf = (course: Course, state: GameState): TutorialCtx => ({
  state,
  me: course.me,
  legal: legalActions(state).filter((a) => a.player === course.me),
});

export function act(state: GameState, a: Action): GameState {
  const r = applyAction(state, a);
  if (!r.ok) throw new Error(`${a.type}: ${r.error}`);
  return r.state;
}

/** When a lesson showed: its id, the game turn and how many of the learner's turns had started. */
export interface Shown {
  id: string;
  turn: number;
  recap: boolean;
}

export interface Drive {
  state: GameState;
  run: TutorialRun;
  /** Every lesson as it came on the panel. */
  shown: Shown[];
  moves: number;
  /** The whole game log (the state's own log is trimmed to its newest entries). */
  log: GameState['log'];
}

/** First game turn whose log entry matches, or null. */
export const firstTurn = (d: Drive, re: RegExp): number | null =>
  d.log.find((e) => re.test(e.text))?.turn ?? null;

export interface DriveOptions {
  /** The learner's moves (default: the Normal bot). */
  learner?: Bot;
  /** Its rng seed (learners differ by it too). */
  learnerSeed?: number;
  /** Stop when this holds (checked after every move and Next). Default: the run is over. */
  until?: (d: Drive) => boolean;
  maxMoves?: number;
  /**
   * Press Next on the live lesson after this many moves on it (reading takes a moment; the
   * learner's own move closes action lessons first). Default 1; Infinity = never.
   */
  readAfter?: number;
}

/** The three scripted learners of the tests and the seed search: Normal, Hard and Easy play. */
export const LEARNERS: readonly { name: string; bot: Bot; seed: number }[] = [
  { name: 'normal', bot: botForLevel('normal'), seed: 11 },
  { name: 'hard', bot: botForLevel('hard'), seed: 12 },
  { name: 'easy', bot: botForLevel('easy'), seed: 13 },
];

/**
 * What every course must get right (docs/TUTORIAL.md checklist); [] = fine. Static checks plus a
 * headless run per learner that must finish the course.
 */
export function courseProblems(course: Course): string[] {
  const out: string[] = [];
  const ids = course.lessons.map((l) => l.id);
  if (new Set(ids).size !== ids.length) out.push('lesson ids repeat');
  for (const l of course.lessons) {
    for (const a of l.after ?? []) if (!ids.includes(a)) out.push(`${l.id}: unknown after ${a}`);
    if (l.visual && !course.visuals?.[l.visual] && !['terrain', 'devCards'].includes(l.visual)) {
      out.push(`${l.id}: no visual ${l.visual}`);
    }
  }
  if (!ids.includes(course.finish)) out.push(`no finish lesson ${course.finish}`);
  if (!course.seed.startsWith('learn-')) out.push('the seed must start with learn-');
  const state = course.game();
  if (!course.isGame(state)) out.push('isGame rejects its own game');
  if (state.settings.startingPlayer !== course.me) out.push('the learner does not start');
  if (course.seats[course.me] !== 'human') out.push('the learner seat is not human');
  const first = advance(newRun(course.seed, course.me), ctxOf(course, state), course);
  if (first.current !== course.lessons[0]?.id) out.push('the first lesson does not open the run');
  for (const l of LEARNERS) {
    const d = drive(course, { learner: l.bot, learnerSeed: l.seed });
    if (!d.run.over) out.push(`${l.name} learner did not finish (turn ${d.state.turn.number})`);
    else if (d.shown.at(-1)?.id !== course.finish) out.push(`${l.name}: did not end on finish`);
  }
  return out;
}

/** Play the course's game from the start (or from `from`), the coach following. */
export function drive(course: Course, o: DriveOptions = {}, from?: Drive): Drive {
  const learner = o.learner ?? botForLevel('normal');
  const rng = new Rng(o.learnerSeed ?? 11);
  const botRng = Rng.fromSeed(`bots:${course.seed}`);
  const until = o.until ?? ((d: Drive) => d.run.over);
  const readAfter = o.readAfter ?? 1;
  let state = from?.state ?? course.game();
  let run = from?.run ?? newRun(course.seed, course.me);
  const shown: Shown[] = [...(from?.shown ?? [])];
  const log = [...(from?.log ?? state.log)];
  const d = (): Drive => ({ state, run, shown, moves, log });
  let moves = from?.moves ?? 0;
  let onLesson = 0;
  const note = (before: TutorialRun) => {
    if (run.current !== null && run.current !== before.current) {
      shown.push({
        id: run.current,
        turn: state.turn.number,
        recap: run.recapped.includes(run.current),
      });
      onLesson = 0;
    }
  };
  const follow = () => {
    const before = run;
    run = advance(run, ctxOf(course, state), course);
    note(before);
  };
  if (!from) follow();
  const offers = new Map<string, number>();
  const seats = [...course.seats];
  for (let i = 0; i < (o.maxMoves ?? 3000) && !until(d()); i++) {
    // Read: Next on the live lesson once the learner had a look.
    if (run.current !== null && onLesson >= readAfter) {
      const before = run;
      run = next(run, ctxOf(course, state), course);
      note(before);
      continue;
    }
    if (state.phase.kind === 'gameOver') break;
    const legal = legalActions(state);
    const bot = nextBot(state, seats, legal);
    let a: Action | null;
    if (bot) {
      const key = `${state.turn.number}:${bot.player}`;
      let own = legal.filter((x) => x.player === bot.player);
      if ((offers.get(key) ?? 0) >= BOT_OFFERS_PER_TURN) {
        const rest = own.filter((x) => x.type !== 'offerTrade');
        if (rest.length > 0) own = rest;
      }
      a = botForLevel(course.botLevels[bot.player])(state, bot.player, botRng, own);
      if (a?.type === 'offerTrade') offers.set(key, (offers.get(key) ?? 0) + 1);
    } else {
      const mine = legal.filter((x) => x.player === course.me);
      if (mine.length === 0) break;
      a = learner(state, course.me, rng, mine);
    }
    if (!a) break;
    const prev = state;
    state = act(state, a);
    log.push(...appendedLog(prev, state));
    moves++;
    onLesson++;
    follow();
  }
  return d();
}
