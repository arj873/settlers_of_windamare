/**
 * "Learn Traders & Barbarians": a coached game of the box's title scenario (3 players: you + 2
 * Easy bots, 13 VP, the 3-4 player board), official rules (docs/rules/traders-barbarians.md
 * §2.6, §3.7, §4.7). It teaches only what the scenario adds; the intro offers the base tutorial.
 * One course per module: the title scenario is the one with the most new rules (wagons, tolls,
 * commodities, baggage train, barbarians on paths, gold), and its gold and city-in-setup rules
 * carry over to Rivers and Barbarian Attack. Nothing is rigged: the seed was picked by a headless
 * search (scripts/tutorial-seeds.test.ts) for few recaps over three learner styles.
 * docs/TUTORIAL.md has the how-to.
 */
import { buildingsOf } from '../../engine';
import { h } from '../../ui/dom';
import {
  can,
  defineCourse,
  myMain,
  myTurn,
  myTurnsStarted,
  phaseKind,
  setupStep,
  turnOver,
  type LessonDef,
  type TutorialCtx,
} from '../../ui/tutorial/course';
import {
  BAGGAGE,
  BARBARIAN_MP,
  COMMODITIES,
  DELIVER_TO,
  GOLD_PER_RESOURCE,
  MAX_LEVEL,
  NO_ROAD_MP,
  ROAD_MP,
  SC_TRADERS,
  START_GOLD,
  TB,
  WAGON_GRAIN_MP,
  goldSaleRatio,
  phaseOf,
  tradersOf,
  upgradeCost,
  type Commodity,
  type TbPhase,
  type TradeKind,
} from './engine';
import { tbIcon } from './ui';
import './tutorial.css';

type Id =
  | 'intro'
  | 'board'
  | 'place'
  | 'city'
  | 'gold'
  | 'wagon'
  | 'roads'
  | 'load'
  | 'deliver'
  | 'baggage'
  | 'barbarians'
  | 'driveOff'
  | 'swift'
  | 'finish';

// ---------------------------------------------------------------------------
// Reading the game
// ---------------------------------------------------------------------------

const traders = (c: TutorialCtx) => tradersOf(c.state);
const buildings = (c: TutorialCtx) => buildingsOf(c.state, c.me).length;
const hasCity = (c: TutorialCtx) => buildingsOf(c.state, c.me, 'city').length > 0;
const level = (c: TutorialCtx) => traders(c).level[c.me] ?? 1;
function card(c: TutorialCtx): (typeof BAGGAGE)[number] {
  const b = BAGGAGE[level(c) - 1] ?? BAGGAGE[0];
  if (!b) throw new Error('no baggage train cards');
  return b;
}
const carrying = (c: TutorialCtx): Commodity | null => traders(c).commodity[c.me] ?? null;
const delivered = (c: TutorialCtx) => traders(c).delivered[c.me] ?? 0;
const swiftHeld = (c: TutorialCtx) =>
  (traders(c).swift.held[c.me] ?? 0) + (traders(c).swift.fresh[c.me] ?? 0);
/** The learner's wagon move is on (after Wagon, until the turn ends). */
const moving = (c: TutorialCtx) => myTurn(c) && phaseKind(c) === 'tb/wagon';
type BarbarianPhase = Extract<TbPhase, { kind: 'tb/barbarian' }>;
/** A barbarian is being moved (7, Knight, drive-off): its phase, or null. */
function barbarianPhase(c: TutorialCtx): BarbarianPhase | null {
  const p = phaseOf(c.state);
  return p.kind === 'tb/barbarian' ? (p as BarbarianPhase) : null;
}
/** A barbarian is being moved after a 7 or a Knight (with its discards), not a drive-off. */
const barbarianNow = (c: TutorialCtx) =>
  phaseKind(c) === 'discard' || barbarianPhase(c)?.steal === true;

const KIND_NAME: Readonly<Record<TradeKind, string>> = {
  castle: 'Castle',
  quarry: 'Quarry',
  glassworks: 'Glassworks',
};
const GOOD_NAME: Readonly<Record<Commodity, string>> = {
  glass: 'Glass',
  marble: 'Marble',
  tools: 'Tools',
  sand: 'Sand',
};
const upgradeText = (target: number) => {
  const c = upgradeCost(target);
  return `${c.lumber} Lumber + ${c.wool} Sheep + ${c.ore} Ore`;
};

// ---------------------------------------------------------------------------
// The lessons, in the order they come up
// ---------------------------------------------------------------------------

const LESSONS: readonly LessonDef<Id>[] = [
  {
    id: 'intro',
    title: 'Traders & Barbarians',
    text: (c) =>
      `This game teaches only what the Traders & Barbarians scenario adds to Catan: first to ${c.state.settings.vpToWin} points wins. Your wagon carries commodities between the castle, the quarry and the glassworks; each delivery earns 1 point and gold.`,
    when: () => true,
    offerBase: true,
  },
  {
    id: 'board',
    title: 'Trade hexes and barbarians',
    text: () =>
      'The castle, quarry and glassworks produce nothing: wagons trade at the plaza in their centre, and nobody builds there. There is no desert and no robber; three barbarians stand on paths instead. A 2 or 12 is rolled again.',
    after: ['intro'],
    when: () => true,
  },
  {
    id: 'place',
    title: 'Setting up',
    text: () =>
      'Place a settlement and a road as usual. Your second building will be a city, and your wagon starts there: close to a trade hex is good.',
    after: ['board'],
    when: (c) => setupStep(c) === 'settlement' && buildings(c) === 0,
    doneWhen: (c) => buildings(c) >= 1,
    stale: (c) => buildings(c) >= 1,
    urgent: true,
  },
  {
    id: 'city',
    title: 'A city and a wagon',
    text: () =>
      'Your second building is a city: it pays 1 card for each tile it touches, and your wagon starts on its corner.',
    when: (c) => setupStep(c) === 'settlement' && buildings(c) === 1,
    doneWhen: hasCity,
    stale: hasCity,
    urgent: true,
  },
  {
    id: 'wagon',
    title: 'Your wagon',
    text: (c) =>
      `Build first, then move your wagon: pick Wagon, then a glowing corner, one step at a time. It has ${card(c).mp} movement points a turn: a path with your road costs ${ROAD_MP}, a path without a road ${NO_ROAD_MP}. Once it moves, building is over for the turn.`,
    after: ['intro'],
    when: myMain,
    doneWhen: (c) => turnOver(c) || moving(c),
    focus: 'tb-wagon',
  },
  {
    id: 'roads',
    title: 'Roads and tolls',
    text: () =>
      `Another player’s road costs ${ROAD_MP} movement point plus 1 gold to its owner (they pay you on yours). A barbarian on a path adds ${BARBARIAN_MP}. Once per move, 1 Wheat buys ${WAGON_GRAIN_MP} more points.`,
    after: ['wagon'],
    when: moving,
    doneWhen: turnOver,
    todo: (c) => {
      const m = traders(c).move;
      if (!moving(c) || m.over) return null;
      return `${m.mp} movement points left: click a glowing corner, or end your turn.`;
    },
  },
  {
    id: 'gold',
    title: 'Gold',
    text: (c) =>
      `You start with ${START_GOLD} gold. On your turn ${GOLD_PER_RESOURCE} gold buy 1 resource from the bank (twice per turn at most), and ${goldSaleRatio(c.state, c.me)} cards of one kind sell for 1 gold. Gold is never stolen or discarded.`,
    after: ['wagon'],
    when: myMain,
    // Gold buys stop once the wagon moves: make room for the move's lesson.
    doneWhen: (c) => turnOver(c) || moving(c),
    focus: 'tb-gold',
  },
  {
    id: 'load',
    title: 'Loading a commodity',
    text: () =>
      'Entering a plaza ends the move. If you carry nothing, you load the top commodity of that hex’s stack; the side panel shows what everyone carries. Each one goes to one trade hex:',
    after: ['wagon'],
    when: (c) => carrying(c) !== null || delivered(c) > 0,
    recap: true,
    focus: 'tb-table',
    visual: 'goods',
  },
  {
    id: 'deliver',
    title: 'Delivered!',
    text: (c) =>
      `At the plaza that wants your commodity you earn 1 point and gold: ${card(c).gold} with your baggage train card ${level(c)}. Then you load the next commodity right there.`,
    after: ['load'],
    when: (c) => delivered(c) > 0,
    recap: true,
    focus: 'tb-table',
  },
  {
    id: 'baggage',
    title: 'Baggage train',
    text: () =>
      `Upgrade your baggage train card on your turn, one card at a time: ${upgradeText(2)} (${upgradeText(4)} for cards 4 and 5). Better cards move further, earn more gold and drive barbarians off; card ${MAX_LEVEL} is worth 1 point.`,
    after: ['wagon'],
    when: (c) => myMain(c) && (can(c, 'tb/upgradeWagon') || level(c) > 1 || myTurnsStarted(c) >= 3),
    doneWhen: (c) => turnOver(c) || moving(c) || level(c) > 1,
    focus: 'tb-baggage',
    visual: 'baggage',
  },
  {
    id: 'barbarians',
    title: 'Barbarians instead of the robber',
    text: () =>
      `On a 7, after the usual discards, the roller moves one barbarian to any free path and steals a card from the owner of a road there; a Knight does the same. Barbarians never block production, but a wagon pays ${BARBARIAN_MP} more points to pass one.`,
    after: ['intro'],
    when: barbarianNow,
    doneWhen: (c) => !barbarianNow(c),
    urgent: true,
    recap: true,
    todo: (c) => {
      const p = c.state.phase;
      if (p.kind === 'discard' && (p.pending[c.me] ?? 0) > 0) {
        return `Pick ${String(p.pending[c.me])} cards to give back.`;
      }
      const b = barbarianPhase(c);
      if (b && myTurn(c)) {
        return b.from === null
          ? 'Click a barbarian to move.'
          : 'Click the path it moves to: a road there lets you rob its owner.';
      }
      return null;
    },
    focus: 'dice',
  },
  {
    id: 'driveOff',
    title: 'Drive a barbarian off',
    text: (c) =>
      `Your wagon stands next to a barbarian. Roll a die: ${card(c).driveOff ?? 6} or more and you move that barbarian to a path of your choice (no theft). One try per barbarian and turn.`,
    after: ['wagon'],
    when: (c) => can(c, 'tb/driveOff'),
    doneWhen: turnOver,
    focus: 'tb-actions',
  },
  {
    id: 'swift',
    title: 'Swift Journey',
    text: () =>
      'You drew a Swift Journey card. After your wagon’s regular move (even into a plaza), play it from your hand to move again with fresh movement points. It counts as your development card of the turn.',
    after: ['wagon'],
    when: (c) => swiftHeld(c) > 0,
    focus: 'hand',
  },
  {
    id: 'finish',
    title: 'You’re ready!',
    text: (c) =>
      `You win with ${c.state.settings.vpToWin} points on your own turn: buildings, deliveries, baggage train card ${MAX_LEVEL}, Largest Army and point cards count; there is no Longest Road here. The box’s other scenarios and variants are on the setup screen. Keep playing this game, or start a new one.`,
    after: ['wagon'],
    when: () => false,
  },
];

// ---------------------------------------------------------------------------
// Pictures
// ---------------------------------------------------------------------------

/** Where each commodity goes. */
function goodsVisual(): HTMLElement {
  const kinds = [...new Set(COMMODITIES.map((g) => DELIVER_TO[g]))];
  return h(
    'ul',
    { class: 'tut-tb-goods', attrs: { 'aria-label': 'Where each commodity goes' } },
    ...kinds.map((k) => {
      const goods = COMMODITIES.filter((g) => DELIVER_TO[g] === k);
      return h(
        'li',
        {},
        ...goods.map((g) => tbIcon(g, 18)),
        h('b', {}, goods.map((g) => GOOD_NAME[g]).join(', ')),
        ` → ${KIND_NAME[k]}`,
      );
    }),
  );
}

/** The five baggage train cards. */
function baggageVisual(): HTMLElement {
  const cell = (tag: 'th' | 'td', ...kids: (string | HTMLElement)[]) => h(tag, {}, ...kids);
  return h(
    'table',
    { class: 'tut-tb-baggage', attrs: { 'aria-label': 'Baggage train cards' } },
    h(
      'thead',
      {},
      h(
        'tr',
        {},
        cell('th', 'Card'),
        cell('th', tbIcon('mp', 14), ' Move'),
        cell('th', tbIcon('gold', 14), ' Gold'),
        cell('th', tbIcon('barbarian', 14), ' Drive off'),
      ),
    ),
    h(
      'tbody',
      {},
      ...BAGGAGE.map((b, i) =>
        h(
          'tr',
          {},
          cell('td', `${i + 1}${i + 1 === MAX_LEVEL ? ' (+1 pt)' : ''}`),
          cell('td', String(b.mp)),
          cell('td', `+${b.gold}`),
          cell('td', b.driveOff === null ? '—' : `${b.driveOff}+`),
        ),
      ),
    ),
  );
}

/** The Traders & Barbarians course's seed, picked by scripts/tutorial-seeds.test.ts (300 tried). */
export const TB_TUTORIAL_SEED = 'learn-tb-77';

export const tbTutorialSpec = {
  id: TB,
  name: 'Traders & Barbarians',
  mode: TB,
  scenario: SC_TRADERS,
  seed: TB_TUTORIAL_SEED,
  lessons: LESSONS,
  gate: 'wagon',
  finish: 'finish',
  lastCoachedTurn: 10,
  visuals: { goods: goodsVisual, baggage: baggageVisual },
} as const;

export const tbTutorial = defineCourse<Id>({ ...tbTutorialSpec });
