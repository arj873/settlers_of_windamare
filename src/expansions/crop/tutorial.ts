/**
 * "Learn Crop Trust": a coached game on the first-game board (3 players: you + 2 Easy bots,
 * 10 VP), official rules (docs/rules/crop-trust.md). It teaches only what Crop Trust adds; the
 * intro offers the base tutorial. Nothing is rigged: the seed was picked by a headless search
 * (scripts/tutorial-seeds.test.ts) for few recaps over three learner styles. docs/TUTORIAL.md has
 * the how-to.
 */
import { RESOURCE_LABEL } from '../../ui/icons';
import { h } from '../../ui/dom';
import {
  can,
  defineCourse,
  myMain,
  myTurn,
  turnOver,
  type LessonDef,
  type TutorialCtx,
} from '../../ui/tutorial/course';
import {
  DEPOSIT_COST,
  EMPTY_FIELDS_END,
  EXTINCT_END,
  HEX_LIMIT,
  SPECIES,
  SPECIES_NAME,
  VAULT_SIZE,
  cropSlice,
  emptyCounts,
  emptyFields,
  fieldsHexes,
  totalOf,
  type HarvestPhase,
  type ReplantPhase,
} from './engine';
import { chip } from './ui';
import './tutorial.css';

type Id = 'intro' | 'fields' | 'harvest' | 'vault' | 'replant' | 'events' | 'collapse' | 'finish';

// ---------------------------------------------------------------------------
// Reading the game
// ---------------------------------------------------------------------------

const slice = (c: TutorialCtx) => cropSlice(c.state);
/** The learner harvests a field now. */
function harvestNow(c: TutorialCtx): boolean {
  const p = c.state.phase;
  return p.kind === 'crop/harvest' && (p as HarvestPhase).queue[0]?.player === c.me;
}
/** Seeds the learner still replants, or 0. */
function replantLeft(c: TutorialCtx): number {
  const p = c.state.phase;
  return p.kind === 'crop/replant' && myTurn(c) ? (p as ReplantPhase).left : 0;
}
/** The newest revealed event still in the log ("Blue reveals an event: Small-scale loss: 2 rice"). */
function lastEvent(c: TutorialCtx): string | null {
  for (let i = c.state.log.length - 1; i >= 0; i--) {
    const t = c.state.log[i]?.text ?? '';
    if (/ reveals an event: /.test(t)) return t;
  }
  return null;
}
const depositCost = () =>
  `${DEPOSIT_COST.lumber} ${RESOURCE_LABEL.lumber} + ${DEPOSIT_COST.ore} ${RESOURCE_LABEL.ore}`;

// ---------------------------------------------------------------------------
// The lessons, in the order they come up
// ---------------------------------------------------------------------------

const LESSONS: readonly LessonDef<Id>[] = [
  {
    id: 'intro',
    title: 'Crop Trust',
    text: (c) =>
      `This game teaches only what Crop Trust adds to Catan. First to ${c.state.settings.vpToWin} points wins, unless the crops die out first: then the best seed saver wins. ${RESOURCE_LABEL.grain} cards are called food here.`,
    when: () => true,
    offerBase: true,
  },
  {
    id: 'fields',
    title: 'Fields and crops',
    text: () =>
      `There is no desert: five fields carry crop tokens of ${SPECIES.length} kinds, more on the likelier numbers. Fields don’t pay food by themselves: their crops are harvested. The robber starts on the pasture 2.`,
    after: ['intro'],
    when: () => true,
    focus: 'crop-fields',
    visual: 'crops',
  },
  {
    id: 'harvest',
    title: 'Harvest',
    text: () =>
      'When a field’s number is rolled, each player with a building on it may take 1 crop off it for 1 food, in turn from the roller; a city harvests a second time. A crop taken is gone, and an empty field gives nothing.',
    after: ['intro'],
    when: harvestNow,
    doneWhen: (c) => !harvestNow(c),
    urgent: true,
    recap: true,
    todo: (c) => (harvestNow(c) ? 'Pick a crop to harvest, or Skip to leave it growing.' : null),
  },
  {
    id: 'vault',
    title: 'The seed vault',
    text: () =>
      `Once a turn, pay ${depositCost()} to store a crop from a field next to you on your Crop Storage Record (the Crop Trust panel), one of each kind per row. The 2nd crop of a row earns a development card; the 3rd, 4th and 5th earn 1 point each.`,
    after: ['intro'],
    when: myMain,
    doneWhen: (c) => turnOver(c) || slice(c).deposited,
    todo: (c) =>
      can(c, 'crop/deposit')
        ? 'Store a seed: pick the crop, the field and a row, then Store.'
        : null,
    focus: 'crop-vault',
  },
  {
    id: 'replant',
    title: 'Replanting',
    text: () =>
      `Storing a seed refills your seed vault with ${VAULT_SIZE} seeds of that crop. The ${VAULT_SIZE} it held before go back to the island, each on a different field (at most ${HEX_LIMIT} crops a field).`,
    after: ['vault'],
    when: (c) => replantLeft(c) > 0,
    doneWhen: (c) => replantLeft(c) === 0,
    urgent: true,
    recap: true,
    todo: (c) => {
      const n = replantLeft(c);
      return n > 0 ? `Click a field to plant a seed (${n} left).` : null;
    },
  },
  {
    id: 'events',
    title: 'Effects of growth',
    text: (c, live) => {
      const e = live ? lastEvent(c) : null;
      return `${e ? `${e}. ` : ''}Each settlement or city built, and each Longest Road or Largest Army taken, reveals an event token: crops of one kind are lost, or every field with a single kind left is wiped out (monoculture).`;
    },
    after: ['intro'],
    when: (c) => slice(c).used.length > 0 || slice(c).boxed > 0,
    recap: true,
    focus: 'crop-fields',
  },
  {
    id: 'collapse',
    title: 'When the crops run out',
    text: (c, live) => {
      const empty = live ? emptyFields(c.state).length : 0;
      const now = empty > 0 ? `Fields empty now: ${empty} of ${fieldsHexes(c.state).length}. ` : '';
      return `${now}If ${EMPTY_FIELDS_END} fields are empty or ${EXTINCT_END} kinds die out (none on the fields or in a vault), the game ends at once. Whoever stored the most crops wins, but not the player whose harvest caused it.`;
    },
    after: ['intro'],
    // A field down to its last crop is the warning.
    when: (c) =>
      fieldsHexes(c.state).some((h) => totalOf(slice(c).crops[h] ?? emptyCounts()) <= 1) ||
      slice(c).extinct.length > 0,
    recap: true,
    focus: 'crop-facts',
  },
  {
    id: 'finish',
    title: 'You’re ready!',
    text: (c) =>
      `You win with ${c.state.settings.vpToWin} points on your own turn, or with the most stored crops if the crops collapse. Harvesting feeds you but empties the fields; storing seeds earns points and plants new crops. Keep playing this game, or start a new one.`,
    after: ['vault'],
    when: () => false,
  },
];

// ---------------------------------------------------------------------------
// Pictures
// ---------------------------------------------------------------------------

/** The five crops' tokens. */
function cropsVisual(): HTMLElement {
  return h(
    'ul',
    { class: 'tut-crop-kinds', attrs: { 'aria-label': 'The five crops' } },
    ...SPECIES.map((sp) => h('li', {}, chip(sp, 16), SPECIES_NAME[sp])),
  );
}

/** The Crop Trust course's seed, picked by scripts/tutorial-seeds.test.ts (300 tried). */
export const CROP_TUTORIAL_SEED = 'learn-crop-52';

export const cropTutorialSpec = {
  id: 'crop',
  name: 'Crop Trust',
  mode: 'crop',
  scenario: 'crop/cropTrust',
  seed: CROP_TUTORIAL_SEED,
  lessons: LESSONS,
  gate: 'vault',
  finish: 'finish',
  lastCoachedTurn: 8,
  visuals: { crops: cropsVisual },
} as const;

export const cropTutorial = defineCourse<Id>({ ...cropTutorialSpec });
