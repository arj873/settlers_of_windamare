/**
 * Seed search for the expansion tutorials (docs/TUTORIAL.md). Skipped unless asked for:
 *
 *   TUTORIAL_SEEDS=ck nice -n 19 pnpm vitest run scripts/tutorial-seeds.test.ts
 *   TUTORIAL_SEEDS=seafarers TUTORIAL_SEED_COUNT=80 nice -n 19 pnpm vitest run scripts/tutorial-seeds.test.ts
 *
 * Each candidate seed's tutorial game is played headless (src/ui/tutorial/testkit.ts) by three
 * learners (the Normal, Hard and Easy bots in the human seat) against the course's Easy bots,
 * the coach following and Next pressed on every lesson. A seed scores by the course's `score`:
 * key events early enough for every learner, few recaps. Prints a table, best first.
 */
import { describe, it } from 'vitest';
import { defineCourse, type Course, type CourseSpec } from '../src/ui/tutorial/course';
import { LEARNERS, drive, firstTurn as turnOf, type Drive } from '../src/ui/tutorial/testkit';
import { ckTutorialSpec } from '../src/expansions/ck/tutorial';
import { seaTutorialSpec } from '../src/expansions/seafarers/tutorial';
import { oilTutorialSpec } from '../src/expansions/oil/tutorial';
import { cropTutorialSpec } from '../src/expansions/crop/tutorial';

const which = process.env.TUTORIAL_SEEDS ?? '';
const count = Number(process.env.TUTORIAL_SEED_COUNT ?? 40);
/** The learner's turn index (1 = their first) of a game turn, for a 3-player game they start. */
const learnerTurn = (turn: number | null) =>
  turn === null ? null : Math.floor((turn - 1) / 3) + 1;

interface Row {
  seed: string;
  score: number;
  notes: string;
}

type Scorer = (runs: { name: string; d: Drive }[]) => { score: number; notes: string };

function search(spec: CourseSpec<string>, prefix: string, scorer: Scorer): Row[] {
  const rows: Row[] = [];
  for (let i = 0; i < count; i++) {
    const seed = `${prefix}${i}`;
    const course: Course = defineCourse({ ...spec, seed });
    const runs = LEARNERS.map((l) => ({
      name: l.name,
      d: drive(course, { learner: l.bot, learnerSeed: l.seed, maxMoves: 4000 }),
    }));
    rows.push({ seed, ...scorer(runs) });
  }
  return rows.sort((a, b) => a.score - b.score);
}

const recapsOf = (d: Drive) => d.shown.filter((s) => s.recap).map((s) => s.id);

/**
 * C&K: a gate on the learner's first roll, the ship moving early, the first attack in the
 * learner's turns 4-7.
 */
const ckScore: Scorer = (runs) => {
  const d0 = runs[0]?.d;
  if (!d0) return { score: 999, notes: '' };
  const gateTurn = turnOf(d0, /The event die shows the .* gate/);
  const ship = learnerTurn(turnOf(d0, /barbarians sail closer/));
  const attack = learnerTurn(turnOf(d0, /barbarians attack!/));
  let score = 0;
  if (gateTurn !== 1) score += 2;
  if (ship === null || ship > 2) score += 2;
  if (attack === null || attack < 4 || attack > 7) score += 8;
  const notes = [`gate T${gateTurn} ship L${ship} attack L${attack}`];
  for (const { name, d } of runs) {
    const recaps = recapsOf(d);
    score += recaps.length;
    if (!d.run.over) score += 10;
    notes.push(`${name}: ${recaps.join(',') || '-'}`);
  }
  return { score, notes: notes.join(' | ') };
};

/** Seafarers: few recaps (a ship moved, gold, the pirate, an island) for every learner. */
const seaScore: Scorer = (runs) => {
  let score = 0;
  const d0 = runs[0]?.d;
  const seven = d0 ? learnerTurn(turnOf(d0, / rolled 7\b/)) : null;
  if (seven === null || seven > 5) score += 2;
  const notes = [`first 7 L${seven}`];
  for (const { name, d } of runs) {
    const recaps = recapsOf(d);
    score += recaps.length * 2;
    if (!d.run.over) score += 10;
    const island = d.shown.find((s) => s.id === 'island' && !s.recap);
    notes.push(
      `${name}: ${recaps.join(',') || '-'}${island ? ` island L${learnerTurn(island.turn)}` : ''}`,
    );
  }
  return { score, notes: notes.join(' | ') };
};

/** The learner's turn index of the first log entry of theirs matching `re`, or null. */
const mineFirst = (d: Drive, re: RegExp) =>
  learnerTurn(d.log.find((e) => e.player === 0 && re.test(e.text))?.turn ?? null);

/**
 * Oil Springs: few recaps (pollution, sequestering, a metropolis, a disaster) for every learner;
 * the Normal learner's springs pay early (the bots don't seek springs, a reader may).
 */
const oilScore: Scorer = (runs) => {
  let score = 0;
  const notes: string[] = [];
  for (const { name, d } of runs) {
    const recaps = recapsOf(d);
    const oil = mineFirst(d, / received \d+ oil/);
    score += recaps.length * 2;
    if (name === 'normal' && (oil === null || oil > 3)) score += 2;
    if (!d.run.over) score += 10;
    notes.push(`${name}: oil L${oil} ${recaps.join(',') || '-'}`);
  }
  return { score, notes: notes.join(' | ') };
};

/** Crop Trust: a harvest and a seed deposit early, the game not over too soon, few recaps. */
const cropScore: Scorer = (runs) => {
  let score = 0;
  const notes: string[] = [];
  for (const { name, d } of runs) {
    const recaps = recapsOf(d);
    const harvest = mineFirst(d, / harvested /);
    const stored = mineFirst(d, / stored .* in the seed vault/);
    const end = learnerTurn(turnOf(d, /^Crop collapse/));
    score += recaps.length * 2;
    if (harvest === null || harvest > 3) score += 2;
    if (stored === null || stored > 5) score += 1;
    if (end !== null && end < 6) score += 3;
    if (!d.run.over) score += 10;
    notes.push(
      `${name}: harvest L${harvest} store L${stored} end L${end} ${recaps.join(',') || '-'}`,
    );
  }
  return { score, notes: notes.join(' | ') };
};

describe.skipIf(!which)('tutorial seed search', () => {
  it(`searches ${which}`, () => {
    const rows =
      which === 'ck'
        ? search(ckTutorialSpec, 'learn-ck-', ckScore)
        : which === 'oil'
          ? search(oilTutorialSpec, 'learn-oil-', oilScore)
          : which === 'crop'
            ? search(cropTutorialSpec, 'learn-crop-', cropScore)
            : search(seaTutorialSpec, 'learn-sea-', seaScore);
    for (const r of rows.slice(0, 15)) console.log(`${r.seed}\t${r.score}\t${r.notes}`);
  }, 3_600_000);
});
