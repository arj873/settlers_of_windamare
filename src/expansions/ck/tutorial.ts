/**
 * "Learn Cities & Knights": a coached C&K game on the starter board, you + 2 Easy bots, 13 VP,
 * official rules (docs/rules/cities-knights.md). It teaches only what C&K adds; the intro offers
 * the base tutorial. Nothing is rigged: the seed was picked by a headless search
 * (scripts/tutorial-seeds.test.ts) so the event die shows a city gate on the learner's first
 * roll, the barbarian ship sets sail on their second turn and the barbarians attack on turn 15
 * (after the learner's fifth turn). Before the first attack the robber sleeps, so no steal
 * shifts the dice: those rolls are the seed's whatever the learner does. docs/TUTORIAL.md has
 * the how-to.
 */
import { buildingsOf, getPlayer, handSize } from '../../engine';
import { h } from '../../ui/dom';
import { RESOURCE_LABEL, resourceIcon } from '../../ui/icons';
import {
  can,
  defineCourse,
  diceSum,
  myMain,
  myTurn,
  myTurnsStarted,
  phaseKind,
  setupStep,
  turnLog,
  turnOver,
  type LessonDef,
  type TutorialCtx,
} from '../../ui/tutorial/course';
import {
  BARBARIAN_STEPS,
  COMMODITY_OF,
  TRACKS,
  TRACK_COMMODITY,
  activeStrength,
  barbarianStrength,
  ckPlayer,
  ckSlice,
  commodityCount,
  defenderStrength,
  knightsOf,
  phaseOf,
  type Commodity,
} from './engine';
import { COMMODITY_LABEL, TRACK_LABEL, TRACK_SVG, commodityFace } from './ui';
import './tutorial.css';

type Id =
  | 'intro'
  | 'place'
  | 'city'
  | 'dice'
  | 'commodities'
  | 'improve'
  | 'knights'
  | 'barbarians'
  | 'warning'
  | 'attack'
  | 'progress'
  | 'knightUse'
  | 'seven'
  | 'walls'
  | 'metropolis'
  | 'finish';

// ---------------------------------------------------------------------------
// Reading the game
// ---------------------------------------------------------------------------

const me = (c: TutorialCtx) => ckPlayer(c.state, c.me);
const slice = (c: TutorialCtx) => ckSlice(c.state);
const buildings = (c: TutorialCtx) => buildingsOf(c.state, c.me).length;
const hasCity = (c: TutorialCtx) => buildingsOf(c.state, c.me, 'city').length > 0;
const improved = (c: TutorialCtx) => TRACKS.some((t) => me(c).improvements[t] > 0);
const myKnights = (c: TutorialCtx) => knightsOf(c.state, c.me);
const holdsProgress = (c: TutorialCtx) => me(c).progress.length + me(c).vpCards.length > 0;
/** Someone reached the ability level, or a metropolis is out. */
const highLevel = (c: TutorialCtx) =>
  TRACKS.some((t) => slice(c).metropolis[t] !== null) ||
  slice(c).players.some((p) => TRACKS.some((t) => p.improvements[t] >= 3));
/** A 7 was rolled this turn (with no discard due, the robber's sleep leaves no phase behind). */
const sevenRolled = (c: TutorialCtx) =>
  diceSum(c) === 7 && phaseKind(c) !== 'preRoll' && turnLog(c).some((t) => / rolled 7\b/.test(t));
/** The learner must answer the barbarians' attack (lose a city / pick a progress deck). */
function attackChoice(c: TutorialCtx): 'pillage' | 'defender' | null {
  const p = phaseOf(c.state);
  if ((p.kind === 'ck/pillage' || p.kind === 'ck/defender') && p.queue[0] === c.me) {
    return p.kind === 'ck/pillage' ? 'pillage' : 'defender';
  }
  return null;
}
/** "Barbarians 4, knights of Catan 2" from the latest attack in the log. */
function lastAttack(c: TutorialCtx): { barbarians: number; knights: number } | null {
  for (let i = c.state.log.length - 1; i >= 0; i--) {
    const m = /barbarians attack! Barbarians (\d+), knights of Catan (\d+)/.exec(
      c.state.log[i]?.text ?? '',
    );
    if (m) return { barbarians: Number(m[1]), knights: Number(m[2]) };
  }
  return null;
}
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const EVENT_TEXT = {
  ship: 'a ship',
  trade: 'the yellow (trade) gate',
  politics: 'the blue (politics) gate',
  science: 'the green (science) gate',
} as const;

// ---------------------------------------------------------------------------
// The lessons, in the order they come up
// ---------------------------------------------------------------------------

const LESSONS: readonly LessonDef<Id>[] = [
  {
    id: 'intro',
    title: 'Cities & Knights',
    text: (c) =>
      `This game teaches only what Cities & Knights adds to Catan. First to ${c.state.settings.vpToWin} points wins. There are no development cards: you build knights to fight off the barbarians and improve your cities to earn progress cards.`,
    when: () => true,
    offerBase: true,
  },
  {
    id: 'place',
    title: 'Setting up',
    text: () =>
      'Place a settlement and a road as usual. Your second building will be a city: one touching forest, pasture or mountains will also make commodities.',
    after: ['intro'],
    when: (c) => setupStep(c) === 'settlement' && buildings(c) === 0,
    doneWhen: (c) => buildings(c) >= 1,
    stale: (c) => buildings(c) >= 1,
    urgent: true,
  },
  {
    id: 'city',
    title: 'A city right away',
    text: () =>
      'Your second building is a city. It pays 1 card for each tile it touches now; after that it produces like any city.',
    when: (c) => setupStep(c) === 'settlement' && buildings(c) === 1,
    doneWhen: hasCity,
    stale: hasCity,
    urgent: true,
  },
  {
    id: 'dice',
    title: 'Three dice',
    text: (c, live) => {
      const e = slice(c).event;
      return `${live && e ? `The event die shows ${EVENT_TEXT[e]}. ` : ''}The red and yellow dice produce as usual. The event die shows a ship on 3 faces (the barbarians sail closer) or a city gate in one of three colours (progress cards, below).`;
    },
    after: ['intro'],
    when: (c) => myMain(c) && slice(c).event !== null,
    stale: (c) => myTurnsStarted(c) >= 3,
    focus: 'ck-dice',
  },
  {
    id: 'commodities',
    title: 'Commodities',
    text: () =>
      'A city on forest, pasture or mountains produces 1 resource and 1 commodity: paper, cloth or coin. On fields and hills it still takes 2 resources. Commodities are cards in your hand: trade them, and they count on a 7.',
    after: ['dice'],
    when: (c) => commodityCount(c.state, c.me) > 0 || improved(c),
    recap: true,
    focus: 'hand',
    visual: 'commodities',
  },
  {
    id: 'improve',
    title: 'City improvements',
    text: () =>
      'Spend commodities to improve your cities on three tracks. Level 1 costs 1 commodity, level 2 costs 2, and so on; you need a city. From level 1 a track also earns progress cards of its colour.',
    after: ['commodities'],
    when: (c) => myMain(c) || improved(c),
    doneWhen: (c) => turnOver(c) || improved(c),
    focus: 'ck-tracks',
    visual: 'tracks',
  },
  {
    id: 'knights',
    title: 'Knights',
    text: () =>
      'Knights defend Catan. Build one (1 Sheep + 1 Ore) on an empty corner along your roads; it starts inactive. Activate it with 1 Wheat: only active knights fight the barbarians.',
    after: ['dice'],
    when: (c) =>
      myMain(c) && (can(c, 'ck/buildKnight') || myKnights(c).length > 0 || myTurnsStarted(c) >= 2),
    doneWhen: (c) => turnOver(c) || myKnights(c).some(([, k]) => k.active),
    focus: 'ck-knight',
  },
  {
    id: 'barbarians',
    title: 'The barbarians',
    text: () =>
      'Every ship on the event die moves the barbarian ship one step along the track. When it lands they attack: their strength is the number of cities on the board, against the active knights of all players.',
    after: ['dice'],
    when: (c) => slice(c).barbarian >= 1 || slice(c).attacks > 0,
    recap: true,
    focus: 'ck-barb',
  },
  {
    id: 'warning',
    title: 'The barbarians are near',
    text: (c) => {
      const left = BARBARIAN_STEPS - slice(c).barbarian;
      return `${plural(left, 'more ship')} and they land: ${plural(barbarianStrength(c.state), 'city', 'cities')} against ${plural(defenderStrength(c.state), 'active knight')} right now. If the barbarians are stronger, the players with the weakest active knights each lose a city (it becomes a settlement).`;
    },
    after: ['barbarians'],
    when: (c) => slice(c).barbarian >= BARBARIAN_STEPS - 2 && slice(c).attacks === 0,
    stale: (c) => slice(c).attacks > 0,
    todo: (c) =>
      myMain(c) && activeStrength(c.state, c.me) === 0
        ? can(c, 'ck/buildKnight') || myKnights(c).length > 0
          ? 'Build or activate a knight to defend your cities.'
          : 'Collect 1 Sheep + 1 Ore for a knight, and 1 Wheat to activate it.'
        : null,
    focus: 'ck-barb',
  },
  {
    id: 'attack',
    title: 'The barbarians attacked',
    text: (c, live) => {
      const a = live ? lastAttack(c) : null;
      const score = a
        ? `Barbarians ${a.barbarians}, knights ${a.knights}: ${a.barbarians > a.knights ? 'the barbarians won' : 'Catan held'}. `
        : '';
      return `${score}When the barbarians win, each player with the weakest knights loses a city (a metropolis is safe). When the knights hold, the strongest defender gets a Defender of Catan card, 1 point. Then every knight goes inactive, the ship starts over, and the robber is awake from now on.`;
    },
    after: ['dice'],
    when: (c) => slice(c).attacks > 0,
    urgent: true,
    recap: true,
    todo: (c) => {
      const choice = attackChoice(c);
      if (choice === 'pillage') return 'Pick the city you lose.';
      if (choice === 'defender')
        return 'You tied for the strongest: pick a progress deck to draw from.';
      return null;
    },
    focus: 'ck-barb',
  },
  {
    id: 'progress',
    title: 'Progress cards',
    text: () =>
      'On a city gate, everyone whose improvement of that colour is high enough draws a progress card of it: level 1 on a red die of 1-2, level 2 on 1-3, and so on. Play cards on your turn (the Alchemist before you roll). Keep at most 4; Printer and Constitution are points, shown at once.',
    after: ['dice'],
    when: (c) => holdsProgress(c),
    recap: true,
    focus: 'ck-progress',
  },
  {
    id: 'knightUse',
    title: 'Using knights',
    text: () =>
      'Command, then a knight: an active knight may move along your roads, displace a weaker enemy knight, or (once the robber is awake) chase him from a tile it touches; then it is inactive. A knight activated this turn must wait. Promote a knight for 1 Sheep + 1 Ore (mighty needs Politics level 3).',
    after: ['knights'],
    when: (c) => myMain(c) && myKnights(c).length > 0,
    recap: true,
    focus: 'ck-command',
  },
  {
    id: 'seven',
    title: 'A 7 was rolled',
    text: (c) =>
      `Nobody collects; players with more than ${c.state.settings.discardLimit} cards discard half as usual (commodities count, and each city wall adds 2). ${slice(c).attacks === 0 ? 'The robber sleeps until the barbarians first attack: no tile is blocked and nothing is stolen yet.' : 'Since the first attack the robber moves and steals as in the base game.'}`,
    when: sevenRolled,
    recap: true,
    todo: (c) => {
      const p = c.state.phase;
      if (p.kind === 'discard' && (p.pending[c.me] ?? 0) > 0) {
        return `Pick ${String(p.pending[c.me])} cards to give back.`;
      }
      if (p.kind === 'moveRobber' && myTurn(c)) return 'Click a glowing tile to move the robber.';
      return null;
    },
    focus: 'dice',
  },
  {
    id: 'walls',
    title: 'City walls',
    text: () =>
      'A city wall (2 Brick) goes under one of your cities. Each wall lets you hold 2 more cards when a 7 is rolled (3 walls at most). If the barbarians pillage that city, its wall is lost too.',
    after: ['knights'],
    when: (c) =>
      myMain(c) &&
      hasCity(c) &&
      (can(c, 'ck/buildWall') || handSize(getPlayer(c.state, c.me)) >= 7),
    recap: true,
    focus: 'ck-wall',
  },
  {
    id: 'metropolis',
    title: 'Abilities and metropolises',
    text: () =>
      'Level 3 of a track unlocks an ability: Trade 2:1 commodity trades, Politics mighty knights, Science a free resource when a roll pays you nothing. The first to level 4 takes that track’s metropolis: 2 points on one of your cities, safe from the barbarians. Reaching level 5 first takes it away.',
    after: ['improve'],
    when: (c) => highLevel(c) || (myMain(c) && improved(c)),
    recap: true,
    focus: 'ck-tracks',
  },
  {
    id: 'finish',
    title: 'You’re ready!',
    text: (c) =>
      `You win with ${c.state.settings.vpToWin} points on your own turn. Points come from buildings, metropolises (2 each), Defender of Catan cards, the Printer and Constitution, the merchant and Longest Road. Keep playing this game, or start a new one.`,
    after: ['dice'],
    when: () => false,
  },
];

// ---------------------------------------------------------------------------
// Pictures
// ---------------------------------------------------------------------------

const TERRAIN_NAME: Partial<Record<keyof typeof COMMODITY_OF, string>> = {
  lumber: 'Forest',
  wool: 'Pasture',
  ore: 'Mountains',
};

function commoditiesVisual(): HTMLElement {
  return h(
    'ul',
    { class: 'tut-ck-goods', attrs: { 'aria-label': 'What a city produces' } },
    ...(['lumber', 'wool', 'ore'] as const).map((r) => {
      const c = COMMODITY_OF[r] as Commodity;
      return h(
        'li',
        {},
        h('span', {}, TERRAIN_NAME[r], ' → '),
        resourceIcon(r, 18),
        h('b', {}, RESOURCE_LABEL[r]),
        ' + ',
        commodityFace(c, 16),
        h('b', {}, COMMODITY_LABEL[c]),
      );
    }),
  );
}

function tracksVisual(): HTMLElement {
  return h(
    'ul',
    { class: 'tut-ck-tracks', attrs: { 'aria-label': 'The three tracks' } },
    ...TRACKS.map((t) => {
      const c = TRACK_COMMODITY[t];
      const icon = h('span', { class: `ck-trk-ico ck-trk-${t}`, attrs: { 'aria-hidden': 'true' } });
      icon.innerHTML = `<svg viewBox="0 0 32 32" width="18" height="18">${TRACK_SVG[t]}</svg>`;
      return h(
        'li',
        {},
        icon,
        h('b', {}, TRACK_LABEL[t]),
        ' costs ',
        commodityFace(c, 16),
        COMMODITY_LABEL[c].toLowerCase(),
      );
    }),
  );
}

/** The C&K course's seed, picked by scripts/tutorial-seeds.test.ts (300 tried). */
export const CK_TUTORIAL_SEED = 'learn-ck-7';

export const ckTutorialSpec = {
  id: 'ck',
  name: 'Cities & Knights',
  mode: 'ck',
  scenario: 'ck/starter',
  seed: CK_TUTORIAL_SEED,
  lessons: LESSONS,
  gate: 'dice',
  finish: 'finish',
  lastCoachedTurn: 8,
  visuals: { commodities: commoditiesVisual, tracks: tracksVisual },
} as const;

export const ckTutorial = defineCourse<Id>({ ...ckTutorialSpec });
