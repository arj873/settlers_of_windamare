/**
 * "Learn Seafarers": a coached game of Heading for New Shores (3 players: you + 2 Easy bots,
 * 14 VP, the printed map), official rules (docs/rules/seafarers.md). It teaches only what
 * Seafarers adds; the intro offers the base tutorial. Nothing is rigged: the seed was picked by a
 * headless search (scripts/tutorial-seeds.test.ts) for few recaps over three learner styles.
 * docs/TUTORIAL.md has the how-to.
 */
import { buildingsOf, longestRoadLength, roadsOf, type VertexId } from '../../engine';
import {
  can,
  defineCourse,
  myMain,
  myTurn,
  myTurnsStarted,
  phaseKind,
  setupStep,
  sevenNow,
  turnOver,
  type LessonDef,
  type TutorialCtx,
} from '../../ui/tutorial/course';
import { SEA_ACTIONS as T, areasAt, rulesOf, seaSlice } from './engine';
import { shipsOf } from './engine/ships';
import './tutorial.css';

type Id =
  | 'intro'
  | 'board'
  | 'place'
  | 'setupShip'
  | 'ships'
  | 'moveShip'
  | 'pirate'
  | 'gold'
  | 'island'
  | 'route'
  | 'finish';

// ---------------------------------------------------------------------------
// Reading the game
// ---------------------------------------------------------------------------

const buildings = (c: TutorialCtx) => buildingsOf(c.state, c.me).length;
const ships = (c: TutorialCtx) => shipsOf(c.state, c.me).length;
const chits = (c: TutorialCtx) =>
  seaSlice(c.state).chits.filter((x) => x.player === c.me && x.area !== 'gift');
/** A legal settlement of the learner's that would earn an island bonus. */
function islandSpots(c: TutorialCtx): VertexId[] {
  const have = chits(c).map((x) => x.area);
  return c.legal.flatMap((a) => {
    if (a.type !== 'buildSettlement') return [];
    const v = (a as { vertex?: VertexId }).vertex;
    return v && areasAt(c.state, v).some((x) => !have.includes(x)) ? [v] : [];
  });
}
/** The learner chooses gold-field resources now. */
function goldNow(c: TutorialCtx): boolean {
  const p = c.state.phase as { kind: string; pending?: number[] };
  return p.kind === 'seafarers/gold' && (p.pending?.[c.me] ?? 0) > 0;
}
/** Someone holds the Longest Trade Route or is close to it. */
function routeInSight(c: TutorialCtx): boolean {
  const s = c.state;
  if (s.awards.longestRoad !== null) return true;
  return s.players.some((p) => longestRoadLength(s, p.id) >= 4);
}
const bonusVp = (c: TutorialCtx) => rulesOf(c.state).bonus?.vp ?? 2;

// ---------------------------------------------------------------------------
// The lessons, in the order they come up
// ---------------------------------------------------------------------------

const LESSONS: readonly LessonDef<Id>[] = [
  {
    id: 'intro',
    title: 'Seafarers',
    text: (c) =>
      `This game teaches only what Seafarers adds to Catan. Scenario: ${rulesOf(c.state).name}, first to ${c.state.settings.vpToWin} points. Ships take you across the sea, and your first settlement on each small island earns ${bonusVp(c)} extra points.`,
    when: () => true,
    offerBase: true,
  },
  {
    id: 'board',
    title: 'Sea and islands',
    text: () =>
      'You start on the big main island; the small islands wait across the sea. Sea hexes produce nothing. A gold field (yellow) pays any resource you choose. (In some scenarios fog hides land until a ship reaches it.)',
    after: ['intro'],
    when: () => true,
  },
  {
    id: 'place',
    title: 'Setting up',
    text: () =>
      'Place your two settlements on the main island as in the base game. A settlement on the coast can reach the sea later.',
    after: ['board'],
    when: (c) => setupStep(c) === 'settlement' && buildings(c) === 0,
    doneWhen: (c) => buildings(c) >= 1,
    stale: (c) => buildings(c) >= 1,
    urgent: true,
  },
  {
    id: 'setupShip',
    title: 'A ship instead of a road',
    text: () =>
      'Next to a coastal settlement you may start with a ship instead of a road: pick the Ship card, then a glowing sea edge. Or place a road as usual.',
    when: (c) => setupStep(c) === 'road' && can(c, T.setupShip),
    doneWhen: (c) => setupStep(c) !== 'road',
    stale: (c) => phaseKind(c) !== 'setup',
    urgent: true,
    focus: 'sea-ship',
  },
  {
    id: 'ships',
    title: 'Ships',
    text: () =>
      'A ship (1 Lumber + 1 Sheep) goes on a sea edge next to your settlement or the end of your ships. Roads and ships join only at a settlement: a road can’t go on from a ship. Sail to an island’s coast, then build a settlement there.',
    after: ['intro'],
    when: myMain,
    doneWhen: turnOver,
    focus: 'sea-ship',
  },
  {
    id: 'moveShip',
    title: 'Moving a ship',
    text: () =>
      'Once per turn you may move one ship for free: the end ship of a route that doesn’t link two of your buildings, and not one built this turn. Pick Move ship, the ship, then a new sea edge.',
    after: ['ships'],
    when: (c) => myMain(c) && can(c, T.pickShip),
    doneWhen: turnOver,
    recap: true,
    focus: 'sea-move',
  },
  {
    id: 'pirate',
    title: 'Robber or pirate',
    text: () =>
      'On a 7 the roller moves the robber or the pirate. The pirate sits on a sea hex: nobody may build or move a ship next to it, and its mover steals a card from a player with a ship there. It never blocks production.',
    after: ['intro'],
    when: (c) => sevenNow(c) || (myTurn(c) && can(c, T.movePirate)),
    doneWhen: (c) => !sevenNow(c) && !can(c, T.movePirate),
    urgent: true,
    recap: true,
    todo: (c) => {
      const p = c.state.phase;
      if (p.kind === 'discard' && (p.pending[c.me] ?? 0) > 0) {
        return `Pick ${String(p.pending[c.me])} cards to give back.`;
      }
      if (myTurn(c) && can(c, T.movePirate)) {
        return 'Click a land tile for the robber or a sea tile for the pirate.';
      }
      if (p.kind === 'steal' && myTurn(c)) return 'Pick a player to steal from.';
      return null;
    },
    focus: 'dice',
  },
  {
    id: 'gold',
    title: 'Gold!',
    text: () =>
      'A gold field produced for you: take any resource for each settlement next to it, 2 for a city, in any mix.',
    after: ['intro'],
    when: goldNow,
    doneWhen: (c) => !goldNow(c),
    // Gold fields lie on the islands: the board lesson covers them if this never comes up.
    stale: (c) => myTurnsStarted(c) > 12,
    urgent: true,
    todo: (c) => (goldNow(c) ? 'Choose your resources.' : null),
  },
  {
    id: 'island',
    title: 'Land ho!',
    text: (c) =>
      `Your first settlement on each small island earns ${bonusVp(c)} extra points (a token under it). Another player settling there first doesn’t matter, and the distance rule still holds.`,
    after: ['ships'],
    when: (c) => chits(c).length > 0 || (myMain(c) && islandSpots(c).length > 0),
    recap: true,
    todo: (c) =>
      myMain(c) && islandSpots(c).length > 0 ? 'Build a settlement on the island.' : null,
  },
  {
    id: 'route',
    title: 'Longest Trade Route',
    text: () =>
      'Longest Road becomes the Longest Trade Route: roads and ships count together, but only where they meet at your settlement or city. 5 or more pieces in a row: 2 points.',
    after: ['ships'],
    when: (c) => routeInSight(c) || (ships(c) >= 3 && roadsOf(c.state, c.me).length >= 2),
    recap: true,
    focus: 'players',
  },
  {
    id: 'finish',
    title: 'You’re ready!',
    text: (c) =>
      `You win with ${c.state.settings.vpToWin} points on your own turn: island bonuses count. Each scenario changes the map and the goal, so read its line in the side panel. Keep playing this game, or start a new one.`,
    after: ['ships'],
    when: () => false,
  },
];

/** The Seafarers course's seed, picked by scripts/tutorial-seeds.test.ts (400 tried). */
export const SEA_TUTORIAL_SEED = 'learn-sea-316';

export const seaTutorialSpec = {
  id: 'seafarers',
  name: 'Seafarers',
  mode: 'seafarers',
  scenario: 'seafarers/newShores',
  seed: SEA_TUTORIAL_SEED,
  lessons: LESSONS,
  gate: 'ships',
  finish: 'finish',
  lastCoachedTurn: 10,
} as const;

export const seaTutorial = defineCourse<Id>({ ...seaTutorialSpec });

/** For tests: where the learner could settle for an island bonus now. */
export { islandSpots };
