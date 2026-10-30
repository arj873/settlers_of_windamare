/**
 * "Learn Explorers & Pirates": a coached game of Land Ho! (3 players: you + 2 Easy bots, 8 VP,
 * the printed starting pieces), official rules (docs/rules/explorers-pirates.md). Land Ho! is the
 * rulebook's first scenario: harbor settlements, ships, settlers, exploring and gold, with no
 * setup to place and nothing else on top. The later scenarios (crews, the pirate, the Council's
 * missions) get one lesson and a picture. It teaches only what E&P adds; the intro offers the
 * base tutorial. Nothing is rigged: the seed was picked by a headless search
 * (scripts/tutorial-seeds.test.ts) for few recaps over three learner styles. docs/TUTORIAL.md
 * has the how-to.
 */
import type { EdgeId, Resource } from '../../engine';
import { h } from '../../ui/dom';
import { RESOURCE_LABEL, resourceIcon } from '../../ui/icons';
import {
  can,
  defineCourse,
  diceSum,
  myMain,
  myTurn,
  phaseKind,
  turnLog,
  turnOver,
  type LessonDef,
  type TutorialCtx,
} from '../../ui/tutorial/course';
import {
  EP_ACTIONS as A,
  BASE_MP,
  COST,
  EXTRA_MP,
  GOLD_BUYS,
  GOLD_PER_BUY,
  ITEM,
  LAIR_CREWS,
  LIMIT,
  SCENARIOS,
  START_GOLD,
  epSlice,
  scenarioKey,
} from './engine';
import { touchesFog } from './engine/geometry';
import { epBoard } from './engine/maps';
import { cargoOnBoard, harborsOf } from './engine/ships';
import { goldFace, icon } from './ui';
import './tutorial.css';

type Id =
  | 'intro'
  | 'island'
  | 'turn'
  | 'gold'
  | 'sail'
  | 'explore'
  | 'land'
  | 'fleet'
  | 'harbor'
  | 'seven'
  | 'next'
  | 'finish';

// ---------------------------------------------------------------------------
// Reading the game
// ---------------------------------------------------------------------------

const slice = (c: TutorialCtx) => epSlice(c.state);
const moving = (c: TutorialCtx) => slice(c).turn.movement;
const actionPhase = (c: TutorialCtx) => myMain(c) && !moving(c);
const scenarioName = (c: TutorialCtx) =>
  SCENARIOS.find((r) => r.key === scenarioKey(c.state))?.name ?? 'Land Ho!';
/** Face-down hexes turned over so far (by anyone). */
const explored = (c: TutorialCtx) =>
  Object.keys(epBoard(c.state).region).length - Object.keys(slice(c).hidden).length;
/** The learner may sail a ship to a corner of an unexplored hex now. */
const canExplore = (c: TutorialCtx) =>
  c.legal.some((a) => {
    const e = (a as { edge?: EdgeId }).edge;
    return a.type === A.moveShip && e !== undefined && touchesFog(c.state, e);
  });
const myName = (c: TutorialCtx) => c.state.players[c.me]?.name ?? '';
/** The learner's settler founded a settlement this turn. */
const landedNow = (c: TutorialCtx) =>
  turnLog(c).some((t) => t === `${myName(c)}’s settler founded a settlement`);
const settlersOut = (c: TutorialCtx) => cargoOnBoard(c.state, c.me, 'settler');
/** Harbor settlements on the board beyond the printed one per player. */
const harborsBuilt = (c: TutorialCtx) =>
  c.state.players.reduce((n, p) => n + harborsOf(c.state, p.id).length, 0) > c.state.players.length;
/** A 7 was rolled this turn (Land Ho! has no pirate: no phase remains after the discards). */
const sevenRolled = (c: TutorialCtx) =>
  diceSum(c) === 7 && phaseKind(c) !== 'preRoll' && turnLog(c).some((t) => / rolled 7\b/.test(t));

/** "2 Grain + 2 Ore" from a cost. */
function costText(item: string): string {
  const cost = COST[item];
  if (!cost) return '';
  return (Object.entries(cost) as [Resource, number][])
    .filter(([, n]) => n > 0)
    .map(([r, n]) => `${n} ${RESOURCE_LABEL[r]}`)
    .join(' + ');
}

// ---------------------------------------------------------------------------
// The lessons, in the order they come up
// ---------------------------------------------------------------------------

const LESSONS: readonly LessonDef<Id>[] = [
  {
    id: 'intro',
    title: 'Explorers & Pirates',
    text: (c) =>
      `This game teaches only what Explorers & Pirates adds to Catan. Scenario: ${scenarioName(c)}, first to ${c.state.settings.vpToWin} points. There are no cities, development cards, robber, harbors (ports) or Longest Road: you sail into the unknown and settle new land.`,
    when: () => true,
    offerBase: true,
  },
  {
    id: 'island',
    title: 'Your start',
    text: () =>
      'Your pieces are already placed: a settlement with a road, and a harbor settlement with a ship carrying a settler. A harbor settlement is worth 2 points but produces like a settlement (1 card). The parrot and goose hexes at sea are unexplored: each hides land or open sea.',
    after: ['intro'],
    when: () => true,
    focus: 'ep-fleet',
  },
  {
    id: 'turn',
    title: 'Action, then Movement',
    text: (c) =>
      `Your turn has a third phase. After the roll comes the Action phase: trade and build. Then press Start Movement phase in the ${scenarioName(c)} panel to sail your ships; from then on you can’t trade or build this turn.`,
    after: ['island'],
    when: actionPhase,
    doneWhen: (c) => moving(c) || turnOver(c),
    focus: 'ep-phase',
  },
  {
    id: 'gold',
    title: 'Gold',
    text: () =>
      `You start with ${START_GOLD} gold, and a roll (not a 7) that gives you no resource pays 1 gold. In the Action phase ${GOLD_PER_BUY} gold buy 1 resource of your choice (${GOLD_BUYS} times per turn at most). The supply trades 3:1 (not 4:1) for any resource or for 1 gold.`,
    after: ['turn'],
    when: actionPhase,
    focus: 'ep-gold',
    visual: 'gold',
  },
  {
    id: 'sail',
    title: 'Sailing',
    text: () =>
      `Each ship sails up to ${BASE_MP} edges per turn; ${costText(ITEM.extraMove)} buys it ${EXTRA_MP} more, once per turn. Pick a ship, then a highlighted sea edge. Finish one ship’s voyage before you move the next.`,
    after: ['island'],
    when: (c) => myMain(c) && moving(c),
    doneWhen: turnOver,
    todo: (c) =>
      canExplore(c) ? 'Sail to a corner of a parrot or goose hex to explore it.' : null,
    focus: 'ep-fleet',
  },
  {
    id: 'explore',
    title: 'Exploring',
    text: () =>
      'When an end of a ship reaches a corner of an unexplored hex, the hex turns over and that ship stops for this turn. Land gets a number and pays its explorer 1 card of its resource; open sea pays 2 gold.',
    after: ['island'],
    when: (c) => explored(c) > 0,
    urgent: true,
    recap: true,
  },
  {
    id: 'land',
    title: 'Land ho!',
    text: () =>
      'A ship’s settler founds a settlement for free at a corner of explored land the ship touches (distance rule; no unexplored hex at that corner). The ship and the settler go back to your supply. From there, roads and settlements spread as usual.',
    after: ['island'],
    when: (c) => can(c, A.land) || landedNow(c),
    doneWhen: turnOver,
    urgent: true,
    recap: true,
    todo: (c) =>
      can(c, A.land) ? 'Click a highlighted corner to found a settlement there, or sail on.' : null,
  },
  {
    id: 'fleet',
    title: 'Settlers and ships',
    text: () =>
      `A settler costs what a settlement costs, a ship ${costText(ITEM.ship)}; you have ${LIMIT.settler} settlers and ${LIMIT.ship} ships. Both are built at your harbor settlement: the settler waits in its basin or boards a ship there. In the Movement phase, loading and unloading cost nothing.`,
    after: ['sail'],
    when: (c) =>
      actionPhase(c) && (settlersOut(c) === 0 || can(c, A.buildSettler) || can(c, A.buildShip)),
    recap: true,
    focus: 'ep-build',
    visual: 'costs',
  },
  {
    id: 'harbor',
    title: 'Harbor settlements',
    text: () =>
      `Upgrade a settlement on the coast to a harbor settlement for ${costText(ITEM.harbor)}: 1 more point, and one more harbor to build ships at (${LIMIT.harbor} at most).`,
    after: ['turn'],
    when: (c) => (actionPhase(c) && can(c, A.buildHarbor)) || harborsBuilt(c),
    recap: true,
    focus: 'ep-harbor',
  },
  {
    id: 'seven',
    title: 'A 7 was rolled',
    text: (c) =>
      `Nobody collects; players with more than ${c.state.settings.discardLimit} resource cards discard half (gold never counts). That is all in Land Ho!: there is no robber, and the pirates arrive in the later scenarios.`,
    after: ['intro'],
    when: sevenRolled,
    recap: true,
    todo: (c) => {
      const p = c.state.phase;
      return p.kind === 'discard' && (p.pending[c.me] ?? 0) > 0
        ? `Pick ${String(p.pending[c.me])} cards to give back.`
        : null;
    },
    focus: 'dice',
  },
  {
    id: 'next',
    title: 'Pirates and missions',
    text: () =>
      `Each later scenario adds to this one. Pirate Lairs: crews (${costText(ITEM.crew)}) ride your ships, on a 7 you place your pirate ship and rob a player with a ship next to it, and ${LAIR_CREWS} crews capture a pirate lair on a gold field. Fish for Catan and Spices for Catan: deliver fish and spice to the Council of Catan to climb its mission tracks for points.`,
    after: ['explore', 'land'],
    when: (c) => !myTurn(c),
    recap: true,
    visual: 'scenarios',
  },
  {
    id: 'finish',
    title: 'You’re ready!',
    text: (c) =>
      `You win with ${c.state.settings.vpToWin} points on your own turn: settlements 1, harbor settlements 2. Next time, pick Pirate Lairs on the setup screen. Keep playing this game, or start a new one.`,
    after: ['turn'],
    when: () => false,
  },
];

// ---------------------------------------------------------------------------
// Pictures
// ---------------------------------------------------------------------------

const cards = (item: string) =>
  (Object.entries(COST[item] ?? {}) as [Resource, number][]).flatMap(([r, n]) =>
    Array.from({ length: n }, () => resourceIcon(r, 18)),
  );

function costsVisual(): HTMLElement {
  const row = (pic: HTMLElement, name: string, item: string) =>
    h('li', {}, pic, h('b', {}, name), h('span', { class: 'tut-ep-cost' }, ...cards(item)));
  return h(
    'ul',
    { class: 'tut-ep-rows', attrs: { 'aria-label': 'What it costs' } },
    row(icon('settler', 18), 'Settler', ITEM.settler),
    row(icon('ship', 18), 'Ship', ITEM.ship),
    row(icon('ship', 18), `+${EXTRA_MP} moves`, ITEM.extraMove),
  );
}

function goldVisual(): HTMLElement {
  const coins = (n: number) => Array.from({ length: n }, () => goldFace(16));
  const any = h('span', { class: 'tut-ep-any' }, '?');
  return h(
    'ul',
    { class: 'tut-ep-rows', attrs: { 'aria-label': 'Trading with the supply' } },
    h('li', {}, ...coins(GOLD_PER_BUY), ' → ', any, h('span', {}, 'any resource')),
    h(
      'li',
      {},
      ...Array.from({ length: 3 }, () => resourceIcon('wool', 18)),
      ' → ',
      resourceIcon('ore', 18),
      h('span', {}, 'or'),
      ...coins(1),
    ),
  );
}

function scenariosVisual(): HTMLElement {
  return h(
    'ol',
    { class: 'tut-ep-scen', attrs: { 'aria-label': 'The scenarios' } },
    ...SCENARIOS.map((r) =>
      h(
        'li',
        {},
        h('b', {}, r.name),
        h('span', { class: 'tut-ep-vp' }, `${r.vp} VP`),
        h('span', { class: 'tut-ep-blurb' }, r.blurb),
      ),
    ),
  );
}

/** The E&P course's seed, picked by scripts/tutorial-seeds.test.ts (400 tried). */
export const EP_TUTORIAL_SEED = 'learn-ep-221';

export const epTutorialSpec = {
  id: 'ep',
  name: 'Explorers & Pirates',
  mode: 'ep',
  scenario: 'ep/landHo',
  seed: EP_TUTORIAL_SEED,
  lessons: LESSONS,
  gate: 'turn',
  finish: 'finish',
  lastCoachedTurn: 10,
  visuals: { costs: costsVisual, gold: goldVisual, scenarios: scenariosVisual },
} as const;

export const epTutorial = defineCourse<Id>({ ...epTutorialSpec });

/** For tests. */
export { canExplore, explored };
