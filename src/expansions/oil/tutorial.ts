/**
 * "Learn Oil Springs": a coached game on the rulebook board (3 players: you + 2 Easy bots, 12 VP),
 * official rules (docs/rules/oil-springs.md). It teaches only what Oil Springs adds; the intro
 * offers the base tutorial. Nothing is rigged: the seed was picked by a headless search
 * (scripts/tutorial-seeds.test.ts) for few recaps over three learner styles. docs/TUTORIAL.md has
 * the how-to.
 */
import { buildingsOf, type ResourceCounts } from '../../engine';
import { h } from '../../ui/dom';
import { RESOURCE_LABEL, resourceIcon } from '../../ui/icons';
import {
  can,
  defineCourse,
  myMain,
  setupStep,
  turnOver,
  type LessonDef,
  type TutorialCtx,
} from '../../ui/tutorial/course';
import {
  DISASTER_AT,
  DISASTER_FLOOD,
  METROPOLIS_COST,
  METROPOLIS_OIL,
  SEQUESTER_PER_VP,
  SPRING_LOSS,
  metropolisCount,
  oilScale,
  oilSlice,
} from './engine';
import { drop } from './ui';
import './tutorial.css';

type Id =
  'intro' | 'place' | 'oil' | 'pollution' | 'sequester' | 'metropolis' | 'disaster' | 'finish';

// ---------------------------------------------------------------------------
// Reading the game
// ---------------------------------------------------------------------------

const slice = (c: TutorialCtx) => oilSlice(c.state);
const buildings = (c: TutorialCtx) => buildingsOf(c.state, c.me).length;
/** The newest disaster roll still in the log ("Disaster! Blue rolled 8"), or null. */
function lastDisaster(c: TutorialCtx): number | null {
  for (let i = c.state.log.length - 1; i >= 0; i--) {
    const m = /^Disaster! .* rolled (\d+)$/.exec(c.state.log[i]?.text ?? '');
    if (m) return Number(m[1]);
  }
  return null;
}
/** A disaster struck (a flood leaves no trace but the log; a hit hex or spring does). */
const disasterSeen = (c: TutorialCtx) =>
  lastDisaster(c) !== null || slice(c).destroyed.length > 0 || slice(c).lost > 0;

/** "1 Brick, 1 Wheat, 1 Ore" from a cost. */
const costText = (cost: ResourceCounts) =>
  (Object.keys(cost) as (keyof ResourceCounts)[])
    .filter((r) => cost[r] > 0)
    .map((r) => `${cost[r]} ${RESOURCE_LABEL[r]}`)
    .join(', ');

// ---------------------------------------------------------------------------
// The lessons, in the order they come up
// ---------------------------------------------------------------------------

const LESSONS: readonly LessonDef<Id>[] = [
  {
    id: 'intro',
    title: 'Oil Springs',
    text: (c) =>
      `This game teaches only what Oil Springs adds to Catan. The three tiles with a derrick are oil springs: oil speeds you up, but every oil used pollutes the island. First to ${c.state.settings.vpToWin} points at the end of their own turn wins.`,
    when: () => true,
    offerBase: true,
  },
  {
    id: 'place',
    title: 'Setting up',
    text: () =>
      'Place your settlements as in the base game. A corner of an oil spring earns oil when its number is rolled: 1 per settlement, 2 per city.',
    after: ['intro'],
    when: (c) => setupStep(c) === 'settlement' && buildings(c) === 0,
    doneWhen: (c) => buildings(c) >= 1,
    stale: (c) => buildings(c) >= 1,
    urgent: true,
  },
  {
    id: 'oil',
    title: 'Oil',
    text: (c) =>
      `Springs pay oil instead of cards. On your turn, use 1 oil for 2 cards of one other resource, as often as you like. You hold at most ${oilScale(c.state).cap} oil; it counts on a 7, can be stolen, and trades with players but never with the bank.`,
    after: ['intro'],
    when: myMain,
    doneWhen: turnOver,
    todo: (c) =>
      can(c, 'oil/convert')
        ? 'Turn 1 oil into 2 cards in the Oil Springs panel, or keep it.'
        : null,
    focus: 'oil-panel',
    visual: 'uses',
  },
  {
    id: 'pollution',
    title: 'Pollution',
    text: (c, live) =>
      `Each oil used (turned into cards or spent on a metropolis) moves the pollution marker one step${live ? `: it is at ${slice(c).marker} now` : ''}. When it reaches ${DISASTER_AT}, a disaster strikes at the end of that turn; nobody may use oil that would push it further.`,
    after: ['oil'],
    when: (c) => slice(c).marker > 0 || disasterSeen(c),
    recap: true,
    focus: 'oil-track',
  },
  {
    id: 'sequester',
    title: 'Sequestering oil',
    text: () =>
      `Once a turn, if you used no oil, you may sequester 1 oil: it leaves the game for good. Every ${SEQUESTER_PER_VP} sequestered is 1 point, and the first to ${SEQUESTER_PER_VP} becomes Champion of the Environment, 1 more point (lost only to someone who sequesters more).`,
    after: ['oil'],
    when: (c) => (myMain(c) && can(c, 'oil/sequester')) || slice(c).sequestered.some((n) => n > 0),
    recap: true,
    focus: 'oil-actions',
  },
  {
    id: 'metropolis',
    title: 'Metropolis',
    text: (c) =>
      `Make one of your cities a metropolis for ${costText(METROPOLIS_COST)} and ${METROPOLIS_OIL} oil: it produces 3 (cards or oil), is worth 3 points and survives floods. There are only ${oilScale(c.state).metropolises} in the game.`,
    after: ['oil'],
    when: (c) =>
      Object.values(c.state.pieces.buildings).some((b) => b?.kind === 'city') ||
      metropolisCount(c.state) > 0,
    recap: true,
    focus: 'oil-metro',
  },
  {
    id: 'disaster',
    title: 'Disaster!',
    text: (c, live) => {
      const roll = live ? lastDisaster(c) : null;
      const now = roll === null ? '' : `The disaster dice showed ${roll}. `;
      return `${now}A ${DISASTER_FLOOD} floods the coast: settlements there are lost, cities shrink to settlements, metropolises are safe. Any other number destroys a hex with that number for good (a spring loses ${SPRING_LOSS} oil instead). Once ${oilScale(c.state).ruin} hexes are lost the island is abandoned: only the Champion of the Environment wins.`;
    },
    after: ['pollution'],
    when: disasterSeen,
    recap: true,
    focus: 'oil-track',
  },
  {
    id: 'finish',
    title: 'You’re ready!',
    text: (c) =>
      `You win with ${c.state.settings.vpToWin} points at the end of your own turn, after any disaster. Metropolises, sequestered oil and the Champion count. Keep playing this game, or start a new one.`,
    after: ['oil'],
    when: () => false,
  },
];

// ---------------------------------------------------------------------------
// Pictures
// ---------------------------------------------------------------------------

const drops = (n: number, kind: 'oil' | 'saved' = 'oil') =>
  Array.from({ length: n }, () => drop(16, kind));

/** What oil is for: cards, a metropolis, or sequestered for points. */
function usesVisual(): HTMLElement {
  const cost = (Object.keys(METROPOLIS_COST) as (keyof ResourceCounts)[]).filter(
    (r) => METROPOLIS_COST[r] > 0,
  );
  return h(
    'ul',
    { class: 'tut-oil-uses', attrs: { 'aria-label': 'What oil is for' } },
    h('li', {}, ...drops(1), ' → 2 cards of one resource'),
    h(
      'li',
      {},
      ...drops(METROPOLIS_OIL),
      ' + ',
      ...cost.map((r) => resourceIcon(r, 16)),
      ' → ',
      h('b', {}, 'Metropolis'),
    ),
    h('li', {}, ...drops(SEQUESTER_PER_VP, 'saved'), ' sequestered → ', h('b', {}, '1 point')),
  );
}

/** The Oil Springs course's seed, picked by scripts/tutorial-seeds.test.ts (300 tried). */
export const OIL_TUTORIAL_SEED = 'learn-oil-288';

export const oilTutorialSpec = {
  id: 'oil',
  name: 'Oil Springs',
  mode: 'oil',
  scenario: 'oil/oilSprings',
  seed: OIL_TUTORIAL_SEED,
  lessons: LESSONS,
  gate: 'oil',
  finish: 'finish',
  lastCoachedTurn: 10,
  visuals: { uses: usesVisual },
} as const;

export const oilTutorial = defineCourse<Id>({ ...oilTutorialSpec });
