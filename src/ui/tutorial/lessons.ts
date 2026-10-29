/**
 * "Learn to play" lessons (base game). Each lesson is a short card the coach panel shows when its
 * moment comes up in the learner's game. Pure: every predicate reads only the game state and the
 * learner's legal actions, so a reload picks up where it was (machine.ts keeps the progress).
 * The texts follow docs/RULES.md and the engine's settings (vpToWin, discardLimit).
 */
import {
  buildingsOf,
  getPlayer,
  handSize,
  longestRoadLength,
  roadsOf,
  type Action,
  type ActionType,
  type GameState,
  type PlayerId,
} from '../../engine';

export interface TutorialCtx {
  readonly state: GameState;
  /** The learner's seat. */
  readonly me: PlayerId;
  /** The learner's legal actions right now. */
  readonly legal: readonly Action[];
}

export type LessonId =
  | 'goal'
  | 'board'
  | 'place1'
  | 'road1'
  | 'snake'
  | 'place2'
  | 'road2'
  | 'roll'
  | 'production'
  | 'build'
  | 'endTurn'
  | 'seven'
  | 'trade'
  | 'devCards'
  | 'devTypes'
  | 'awards'
  | 'finish';

/** HUD element the panel points at (tutorial.css maps each to a HUD selector). */
export type Focus = 'roll' | 'end' | 'build' | 'dev' | 'trade' | 'hand' | 'players' | 'dice';

/** Pictures under the text: the terrain → resource row or the five development cards. */
export type Visual = 'terrain' | 'devCards';

export interface Lesson {
  id: LessonId;
  title: string;
  /** 1-3 short sentences. `live` = about the current moment (false when paging back). */
  text: (c: TutorialCtx, live: boolean) => string;
  /** Lessons that must be finished first. */
  after?: readonly LessonId[];
  /** Its moment: it may show now. */
  when: (c: TutorialCtx) => boolean;
  /** Closes by itself once this holds (the player did it, or the moment passed). Else: Next. */
  doneWhen?: (c: TutorialCtx) => boolean;
  /** Not shown yet and no longer useful: finished without showing (no recap). */
  stale?: (c: TutorialCtx) => boolean;
  /** The player must act now: it pushes a reading lesson off the panel. */
  urgent?: boolean;
  /** Event lesson: if its event never comes up, it shows as a recap before the end. */
  recap?: boolean;
  /** A live "your move" line while the lesson is up. */
  todo?: (c: TutorialCtx) => string | null;
  focus?: Focus;
  visual?: Visual;
}

// ---------------------------------------------------------------------------
// Reading the game
// ---------------------------------------------------------------------------

const phaseOf = (c: TutorialCtx) => c.state.phase.kind;
const myTurn = (c: TutorialCtx) => c.state.turn.current === c.me;
const can = (c: TutorialCtx, type: ActionType) => c.legal.some((a) => a.type === type);
const setupStep = (c: TutorialCtx) => {
  const p = c.state.phase;
  return p.kind === 'setup' && myTurn(c) ? p.step : null;
};
const settlements = (c: TutorialCtx) => buildingsOf(c.state, c.me).length;
const roads = (c: TutorialCtx) => roadsOf(c.state, c.me).length;
const dice = (c: TutorialCtx) => (c.state.dice ? c.state.dice[0] + c.state.dice[1] : null);

/** How many of the learner's turns have started (setup is turn 0). */
export function myTurnsStarted(c: TutorialCtx): number {
  const n = c.state.players.length;
  const first = 1 + ((c.me - c.state.settings.startingPlayer + n) % n);
  const t = c.state.turn.number;
  return t < first ? 0 : Math.floor((t - first) / n) + 1;
}

/** A rolled 7 is being resolved (discards, robber, steal), not a Knight. */
export function sevenNow(c: TutorialCtx): boolean {
  const kind = phaseOf(c);
  if (kind === 'discard') return true;
  if (kind !== 'moveRobber' && kind !== 'steal') return false;
  const turn = c.state.turn.number;
  for (let i = c.state.log.length - 1; i >= 0; i--) {
    const e = c.state.log[i];
    if (!e || e.turn !== turn) break;
    const roll = / rolled (\d+)\b/.exec(e.text);
    if (roll) return roll[1] === '7';
    if (/ played /.test(e.text)) return false;
  }
  return false;
}

/** A player trade offer is waiting for the learner's answer. */
export function offerToMe(c: TutorialCtx): boolean {
  const p = c.state.phase;
  return p.kind === 'trade' && p.offer.from !== c.me && p.offer.responses[c.me] === 'pending';
}

/** The learner built or bought something after setup. */
function builtSomething(c: TutorialCtx): boolean {
  const me = getPlayer(c.state, c.me);
  const dev = Object.values(me.devCards).reduce((s, n) => s + n, 0);
  const fresh = Object.values(me.newDevCards).reduce((s, n) => s + n, 0);
  return (
    roads(c) > 2 ||
    settlements(c) > 2 ||
    buildingsOf(c.state, c.me, 'city').length > 0 ||
    dev + fresh > 0
  );
}

const holdsDevCard = (c: TutorialCtx) => {
  const me = getPlayer(c.state, c.me);
  return [...Object.values(me.devCards), ...Object.values(me.newDevCards)].some((n) => n > 0);
};

const myMain = (c: TutorialCtx) => myTurn(c) && phaseOf(c) === 'main';
const turnOver = (c: TutorialCtx) => !myTurn(c) || phaseOf(c) === 'preRoll';

/** Someone is close to an award, or holds one. */
function awardInSight(c: TutorialCtx): boolean {
  const s = c.state;
  if (s.awards.longestRoad !== null || s.awards.largestArmy !== null) return true;
  return s.players.some((p) => p.knightsPlayed >= 2 || longestRoadLength(s, p.id) >= 4);
}

/** Play on without the coach after this many of the learner's turns (event lessons get a recap). */
export const LAST_COACHED_TURN = 7;

// ---------------------------------------------------------------------------
// The lessons, in the order they come up
// ---------------------------------------------------------------------------

export const LESSONS: readonly Lesson[] = [
  {
    id: 'goal',
    title: 'Your goal',
    text: (c) =>
      `Be the first to reach ${c.state.settings.vpToWin} victory points. A settlement is worth 1 point and a city 2. Some development cards and two awards give points too.`,
    when: () => true,
  },
  {
    id: 'board',
    title: 'The board',
    text: () =>
      'Each land tile produces one resource. The number on a tile is the dice roll that makes it produce: more dots means it comes up more often. The desert produces nothing.',
    after: ['goal'],
    when: () => true,
    visual: 'terrain',
  },
  {
    id: 'place1',
    title: 'Place a settlement',
    text: () =>
      'Click a glowing corner to build your first settlement. It can’t be on a corner next to another settlement (the distance rule). Corners touching 6s and 8s pay out the most.',
    after: ['board'],
    when: (c) => setupStep(c) === 'settlement' && settlements(c) === 0,
    doneWhen: (c) => settlements(c) >= 1,
    stale: (c) => settlements(c) >= 1,
    urgent: true,
  },
  {
    id: 'road1',
    title: 'Add a road',
    text: () =>
      'Now click a glowing edge next to your settlement. Roads lead to new building spots.',
    when: (c) => setupStep(c) === 'road' && roads(c) === 0,
    doneWhen: (c) => roads(c) >= 1,
    stale: (c) => roads(c) >= 1,
    urgent: true,
  },
  {
    id: 'snake',
    title: 'Taking turns',
    text: () =>
      'Now the others place theirs. Setup goes round once in turn order, then back in reverse: you went first, so you also place last.',
    after: ['road1'],
    when: (c) => phaseOf(c) === 'setup' && !myTurn(c),
    doneWhen: (c) => phaseOf(c) !== 'setup' || myTurn(c),
    stale: (c) => settlements(c) >= 2,
  },
  {
    id: 'place2',
    title: 'Second settlement',
    text: () =>
      'Place your second settlement. This one pays you right away: one card for each tile it touches (the desert gives none). Different resources help most.',
    when: (c) => setupStep(c) === 'settlement' && settlements(c) === 1,
    doneWhen: (c) => settlements(c) >= 2,
    stale: (c) => settlements(c) >= 2,
    urgent: true,
  },
  {
    id: 'road2',
    title: 'One more road',
    text: () =>
      'Add a road next to your new settlement. The cards it paid you are in your hand at the bottom.',
    when: (c) => setupStep(c) === 'road' && roads(c) === 1,
    doneWhen: (c) => roads(c) >= 2,
    stale: (c) => roads(c) >= 2,
    urgent: true,
    focus: 'hand',
  },
  {
    id: 'roll',
    title: 'Roll the dice',
    text: () => 'Each turn starts with a roll. Click Roll dice.',
    when: (c) => myTurn(c) && phaseOf(c) === 'preRoll',
    doneWhen: (c) => !myTurn(c) || phaseOf(c) !== 'preRoll',
    stale: (c) => myTurnsStarted(c) >= 2,
    urgent: true,
    focus: 'roll',
  },
  {
    id: 'production',
    title: 'Collecting resources',
    text: (c, live) =>
      `${live && dice(c) !== null ? `You rolled ${String(dice(c))}. ` : ''}Every settlement touching a tile with the rolled number gets 1 card, every city 2. This happens on every roll, so you also collect on the others’ turns.`,
    after: ['roll'],
    when: (c) => myMain(c) && dice(c) !== 7,
    doneWhen: turnOver,
    stale: (c) => myTurnsStarted(c) >= 3,
    focus: 'hand',
  },
  {
    id: 'build',
    title: 'Building',
    text: () =>
      'Spend cards to build; point at (or press and hold) a card at the bottom to see its cost. Roads must touch your roads or buildings, a new settlement needs your road (and the distance rule), and a city upgrades a settlement.',
    after: ['production'],
    when: myMain,
    doneWhen: (c) => turnOver(c) || builtSomething(c),
    focus: 'build',
  },
  {
    id: 'endTurn',
    title: 'End your turn',
    text: () => 'Done for now? Click End turn. Keep an eye on the others’ rolls: they pay you too.',
    after: ['build'],
    when: myMain,
    doneWhen: turnOver,
    stale: (c) => myTurnsStarted(c) > 2,
    focus: 'end',
  },
  {
    id: 'seven',
    title: 'A 7 was rolled',
    text: (c) =>
      `Nobody collects on a 7. Everyone with more than ${c.state.settings.discardLimit} cards discards half (rounded down). Then the roller moves the robber to block a tile and steals 1 random card from a player next to it.`,
    when: sevenNow,
    doneWhen: (c) => !sevenNow(c) && myMain(c),
    urgent: true,
    recap: true,
    todo: (c) => {
      const p = c.state.phase;
      if (p.kind === 'discard' && (p.pending[c.me] ?? 0) > 0) {
        return `Pick ${String(p.pending[c.me])} cards to give back.`;
      }
      if (p.kind === 'moveRobber' && myTurn(c)) return 'Click a glowing tile to move the robber.';
      if (p.kind === 'steal' && myTurn(c)) return 'Pick a player to steal from.';
      return null;
    },
    focus: 'dice',
  },
  {
    id: 'trade',
    title: 'Trading',
    text: () =>
      'Trade for what you’re missing. Trade offers your cards to the other players; Bank swaps 4 of one resource for 1 of your choice. With a settlement on a harbor you swap 3:1, or 2:1 for the harbor’s resource.',
    after: ['roll'],
    when: (c) =>
      offerToMe(c) ||
      (myMain(c) &&
        (can(c, 'bankTrade') || handSize(getPlayer(c.state, c.me)) >= 3) &&
        myTurnsStarted(c) >= 2),
    recap: true,
    todo: (c) => (offerToMe(c) ? 'Someone offers you a trade: Accept or Reject it.' : null),
    focus: 'trade',
  },
  {
    id: 'devCards',
    title: 'Development cards',
    text: () =>
      'Buy card swaps 1 Sheep, 1 Wheat and 1 Ore for a development card. You can’t play a card on the turn you buy it, and you may play only one per turn.',
    after: ['roll'],
    when: (c) => myMain(c) && (can(c, 'buyDevCard') || holdsDevCard(c)),
    recap: true,
    focus: 'dev',
  },
  {
    id: 'devTypes',
    title: 'The five cards',
    text: () =>
      'The deck has five kinds of cards; more than half are Knights. A Victory Point card counts as soon as you have it.',
    after: ['devCards'],
    when: () => true,
    visual: 'devCards',
  },
  {
    id: 'awards',
    title: 'Longest Road and Largest Army',
    text: () =>
      'Two awards are worth 2 points each. Longest Road: the first unbroken road of 5 or more. Largest Army: the first to play 3 Knights. Whoever beats the holder takes it over.',
    after: ['roll'],
    when: awardInSight,
    recap: true,
    focus: 'players',
  },
  {
    id: 'finish',
    title: 'You’re ready!',
    text: (c) =>
      `You win the moment you reach ${c.state.settings.vpToWin} points on your own turn. That’s all the rules. Keep playing this game, or start a new one.`,
    after: ['endTurn'],
    when: () => false,
  },
];

const BY_ID = new Map(LESSONS.map((l) => [l.id, l]));

export function lesson(id: LessonId): Lesson {
  const l = BY_ID.get(id);
  if (!l) throw new Error(`unknown lesson ${id}`);
  return l;
}

export function isLessonId(x: unknown): x is LessonId {
  return typeof x === 'string' && BY_ID.has(x as LessonId);
}

/** Time to wrap up: the game is over, every event happened, or the coached turns are used up. */
export function wrapUp(c: TutorialCtx, done: ReadonlySet<LessonId>): boolean {
  if (c.state.phase.kind === 'gameOver') return true;
  if (!done.has('endTurn')) return false;
  if (LESSONS.every((l) => !l.recap || done.has(l.id))) return true;
  return myTurnsStarted(c) >= LAST_COACHED_TURN;
}
