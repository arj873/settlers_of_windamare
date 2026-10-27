/**
 * Event Cards (settings.eventCards, RULES.md §18.2): a drawn card replaces the roll. The event is
 * resolved first, then the card's number produces (T&B 2020 p.4).
 *   - Robber Attacks! = a rolled 7 (discards, robber, steal).
 *   - Epidemic: cities yield 1 this turn. Robber Flees: robber back to the desert, no steal.
 *   - Events with choices open an `event` phase with one task per affected player (any order):
 *     eventGain (Plentiful Year, Tournament, Calm Sea), eventGive (Good Neighbors, Neighborly
 *     Assistance), eventSteal (Trade Advantage: optional; Conflict), eventDamageRoad (Earthquake).
 *     Tasks that became impossible (empty bank, empty hands) are dropped, so the phase always ends.
 *   - Then production, then `main`.
 */
import { RESOURCES, resourceWord } from '../constants';
import { hookAfterProduction } from '../expansions/hooks';
import { isResource } from '../resources';
import { EVENT_INFO, drawEventCard, facesFor } from '../rules/events';
import { produce } from '../rules/production';
import { describeBundle, playerName, stealSecret } from '../rules/text';
import { Rng } from '../rng';
import { handSize, portsOf, publicVictoryPoints, roadsOf } from '../selectors';
import { topologyOf } from '../topology';
import type {
  Action,
  EventKind,
  EventTask,
  GameState,
  PlayerId,
  Resource,
  ResourceCounts,
} from '../types';
import { hasRobber, roadsBlocked } from '../variants';
import { type HandlerMap, type LegalGenerator, fail, log, ok } from './common';
import { resolveSeven } from './robber';

type EventPhase = Extract<GameState['phase'], { kind: 'event' }>;

/** Produce for `roll` and log what everyone received. Returns what each player was paid. */
export function payProduction(draft: GameState, roll: number, cityYield = 2): ResourceCounts[] {
  const paid = produce(draft, roll, { cityYield });
  paid.forEach((gain, p) => {
    if (RESOURCES.some((r) => gain[r] > 0)) {
      log(draft, p, `${playerName(draft, p)} received ${describeBundle(gain)}`);
    }
  });
  return paid;
}

/**
 * The production step of a roll or event card: pay `roll` (cities yield `cityYield`), then
 * `main` or an expansion's afterProduction phase (docs/EXPANSIONS.md §5).
 */
export function produceAndContinue(draft: GameState, roll: number, cityYield = 2): void {
  const paid = payProduction(draft, roll, cityYield);
  draft.phase = hookAfterProduction(draft, roll, paid) ?? { kind: 'main' };
}

const bankTotal = (s: GameState) => RESOURCES.reduce((n, r) => n + s.bank[r], 0);
const cards = (s: GameState, p: PlayerId) => {
  const pl = s.players[p];
  return pl ? handSize(pl) : 0;
};

/** The unique player with strictly the highest score (score ≥ min), or null on a tie. */
function uniqueTop(s: GameState, score: (p: PlayerId) => number, min: number): PlayerId | null {
  const ids = s.players.map((p) => p.id);
  const best = Math.max(...ids.map(score));
  if (best < min) return null;
  const top = ids.filter((p) => score(p) === best);
  return top.length === 1 ? (top[0] as PlayerId) : null;
}

/** Every player tied for the highest score, if that score is ≥ min. */
function allTop(s: GameState, score: (p: PlayerId) => number, min: number): PlayerId[] {
  const ids = s.players.map((p) => p.id);
  const best = Math.max(...ids.map(score));
  return best < min ? [] : ids.filter((p) => score(p) === best);
}

const task = (
  player: PlayerId,
  kind: EventTask['kind'],
  targets: PlayerId[] = [],
  optional = false,
): EventTask => ({ player, kind, targets, optional });

/** Others of `p` holding at least one card. */
const victimsOf = (s: GameState, p: PlayerId) =>
  s.players.filter((o) => o.id !== p && handSize(o) > 0).map((o) => o.id);

/** The decisions an event asks for, in seat order. [] = nothing to decide. */
export function eventTasks(s: GameState, event: EventKind): EventTask[] {
  const n = s.players.length;
  const ids = s.players.map((p) => p.id);
  const knights = (p: PlayerId) => s.players[p]?.knightsPlayed ?? 0;
  switch (event) {
    case 'earthquake':
      return ids
        .filter((p) => !roadsBlocked(s, p) && roadsOf(s, p).length > 0)
        .map((p) => task(p, 'damageRoad'));
    case 'goodNeighbors':
      return ids.filter((p) => cards(s, p) > 0).map((p) => task(p, 'give', [(p + 1) % n]));
    case 'plentifulYear':
      return ids.map((p) => task(p, 'gain'));
    case 'tournament':
      return allTop(s, knights, 1).map((p) => task(p, 'gain'));
    case 'calmSea':
      return allTop(s, (p) => portsOf(s, p).length, 1).map((p) => task(p, 'gain'));
    case 'tradeAdvantage': {
      // The Longest Road holder; unclaimed: the player with more roads than anyone else.
      const holder = s.awards.longestRoad ?? uniqueTop(s, (p) => roadsOf(s, p).length, 1);
      return holder === null ? [] : [task(holder, 'steal', victimsOf(s, holder), true)];
    }
    case 'conflict': {
      // The Largest Army holder; unclaimed: the one player with the most knights (tie: no effect).
      const holder = s.awards.largestArmy ?? uniqueTop(s, knights, 1);
      return holder === null ? [] : [task(holder, 'steal', victimsOf(s, holder))];
    }
    case 'neighborlyAssistance': {
      const vp = (p: PlayerId) => publicVictoryPoints(s, p);
      const top = allTop(s, vp, 0);
      const best = vp(top[0] as PlayerId);
      const poorer = ids.filter((p) => vp(p) < best);
      if (poorer.length === 0) return [];
      return top.map((p) => task(p, 'give', poorer));
    }
    default:
      return [];
  }
}

/** Drop tasks that can no longer be done (empty bank / hand, no victim with cards, no road). */
function pruneTasks(s: GameState, tasks: EventTask[]): EventTask[] {
  return tasks.flatMap((t) => {
    switch (t.kind) {
      case 'gain':
        return bankTotal(s) > 0 ? [t] : [];
      case 'give':
        return cards(s, t.player) > 0 ? [t] : [];
      case 'steal': {
        const targets = t.targets.filter((v) => cards(s, v) > 0);
        return targets.length > 0 ? [{ ...t, targets }] : [];
      }
      case 'damageRoad':
        return roadsOf(s, t.player).length > 0 ? [t] : [];
    }
  });
}

/** Production for the drawn card, then the main phase. */
function finishEvent(draft: GameState): void {
  const roll = draft.dice ? draft.dice[0] + draft.dice[1] : 0;
  produceAndContinue(draft, roll, draft.lastEvent === 'epidemic' ? 1 : 2);
}

/** Set the remaining tasks; with none left, finish the event. */
function continueEvent(draft: GameState, event: EventKind, tasks: EventTask[]): void {
  const left = pruneTasks(draft, tasks);
  if (left.length === 0) finishEvent(draft);
  else draft.phase = { kind: 'event', event, tasks: left };
}

/** rollDice with event cards: draw a card, resolve its event, then (eventually) produce. */
export function resolveEventRoll(draft: GameState, player: PlayerId): void {
  drawEventRoll(draft, player);
  resolveDrawnEvent(draft);
}

/** Draw the next event card as `player`'s roll: sets the dice (its number) and lastEvent, logs. */
export function drawEventRoll(draft: GameState, player: PlayerId): void {
  const { card, reshuffled } = drawEventCard(draft);
  if (reshuffled) log(draft, null, 'New Year: the event deck was shuffled');
  const [a, b] = facesFor(card.number);
  draft.dice = [a, b];
  draft.lastEvent = card.event;
  log(draft, player, `${playerName(draft, player)} rolled ${card.number} (${a}+${b})`);
  const info = EVENT_INFO[card.event];
  if (card.event !== 'none') log(draft, null, `Event: ${info.name}. ${info.text}`);
}

/**
 * Resolve the event card drawn by drawEventRoll (lastEvent; null = no card, e.g. dice set by an
 * expansion card: a plain roll), then (eventually) produce. A 7 is Robber Attacks.
 */
export function resolveDrawnEvent(draft: GameState): void {
  const event = draft.lastEvent ?? 'none';
  const roll = draft.dice ? draft.dice[0] + draft.dice[1] : 0;
  if (event === 'robberAttacks' || roll === 7) {
    resolveSeven(draft);
    return;
  }
  if (event === 'robberFlees' && hasRobber(draft.settings)) {
    const desert = topologyOf(draft).landHexes.find(
      (h) => draft.board.hexes[h]?.terrain === 'desert',
    );
    if (desert && draft.board.hexes[draft.robber]?.terrain !== 'desert') draft.robber = desert;
  }
  continueEvent(draft, event, eventTasks(draft, event));
}

/** The calling player's open task in an event phase, or an error. */
function myTask(
  draft: GameState,
  player: PlayerId,
  kind: EventTask['kind'],
): { phase: EventPhase; task: EventTask } | { error: string } {
  const phase = draft.phase;
  if (phase.kind !== 'event') return { error: 'no event to resolve now' };
  const t = phase.tasks.find((x) => x.player === player);
  if (!t || t.kind !== kind) return { error: 'nothing to do for you in this event' };
  return { phase, task: t };
}

function done(draft: GameState, phase: EventPhase, player: PlayerId): void {
  continueEvent(
    draft,
    phase.event,
    phase.tasks.filter((t) => t.player !== player),
  );
}

function move(draft: GameState, from: PlayerId | 'bank', to: PlayerId | 'bank', r: Resource) {
  const take = from === 'bank' ? draft.bank : draft.players[from]?.resources;
  const give = to === 'bank' ? draft.bank : draft.players[to]?.resources;
  if (!take || !give) return;
  take[r] -= 1;
  give[r] += 1;
}

const eventName = (phase: EventPhase) => EVENT_INFO[phase.event].name;

export const eventHandlers: HandlerMap<
  'eventGain' | 'eventGive' | 'eventSteal' | 'eventDamageRoad'
> = {
  eventGain: (draft, { player, resource }) => {
    const t = myTask(draft, player, 'gain');
    if ('error' in t) return fail(t.error);
    if (!isResource(resource)) return fail('invalid resource');
    if (draft.bank[resource] < 1) return fail(`the bank has no ${resource}`);
    move(draft, 'bank', player, resource);
    log(
      draft,
      player,
      `${playerName(draft, player)} took 1 ${resourceWord(resource)} (${eventName(t.phase)})`,
    );
    done(draft, t.phase, player);
    return ok(draft);
  },

  eventGive: (draft, { player, to, resource }) => {
    const t = myTask(draft, player, 'give');
    if ('error' in t) return fail(t.error);
    if (!t.task.targets.includes(to)) return fail('cannot give to that player');
    if (!isResource(resource)) return fail('invalid resource');
    if ((draft.players[player]?.resources[resource] ?? 0) < 1)
      return fail(`no ${resource} to give`);
    move(draft, player, to, resource);
    log(
      draft,
      player,
      `${playerName(draft, player)} gave 1 ${resource} to ${playerName(draft, to)} (${eventName(t.phase)})`,
    );
    done(draft, t.phase, player);
    return ok(draft);
  },

  eventSteal: (draft, { player, victim }) => {
    const t = myTask(draft, player, 'steal');
    if ('error' in t) return fail(t.error);
    if (victim === null) {
      if (!t.task.optional) return fail('you must take a card');
      log(draft, player, `${playerName(draft, player)} took no card (${eventName(t.phase)})`);
      done(draft, t.phase, player);
      return ok(draft);
    }
    if (!t.task.targets.includes(victim)) return fail('cannot take from that player');
    const hand = draft.players[victim]?.resources;
    if (!hand) return fail('invalid victim');
    const pool: Resource[] = RESOURCES.flatMap((r) => Array.from({ length: hand[r] }, () => r));
    if (pool.length === 0) return fail('that player has no cards');
    const rng = new Rng(draft.rng);
    const r = rng.pick(pool);
    draft.rng = rng.state;
    move(draft, victim, player, r);
    log(
      draft,
      player,
      `${playerName(draft, player)} stole from ${playerName(draft, victim)} (${eventName(t.phase)})`,
      stealSecret(draft, player, victim, [r], ` (${eventName(t.phase)})`),
    );
    done(draft, t.phase, player);
    return ok(draft);
  },

  eventDamageRoad: (draft, { player, edge }) => {
    const t = myTask(draft, player, 'damageRoad');
    if ('error' in t) return fail(t.error);
    if (draft.pieces.roads[edge] !== player) return fail('pick one of your roads');
    const damaged = draft.damagedRoads
      ? [...draft.damagedRoads]
      : draft.players.map((): null => null);
    damaged[player] = edge;
    draft.damagedRoads = damaged;
    log(draft, player, `${playerName(draft, player)}'s road was damaged (Earthquake)`);
    done(draft, t.phase, player);
    return ok(draft);
  },
};

export const eventLegal: LegalGenerator = (state: GameState): Action[] => {
  const phase = state.phase;
  if (phase.kind !== 'event') return [];
  return phase.tasks.flatMap((t): Action[] => {
    const player = t.player;
    const hand = state.players[player]?.resources;
    switch (t.kind) {
      case 'gain':
        return RESOURCES.filter((r) => state.bank[r] > 0).map((resource) => ({
          type: 'eventGain',
          player,
          resource,
        }));
      case 'give':
        return t.targets.flatMap((to) =>
          RESOURCES.filter((r) => (hand?.[r] ?? 0) > 0).map((resource): Action => ({
            type: 'eventGive',
            player,
            to,
            resource,
          })),
        );
      case 'steal':
        return [
          ...t.targets.map((victim): Action => ({ type: 'eventSteal', player, victim })),
          ...(t.optional ? [{ type: 'eventSteal', player, victim: null } as Action] : []),
        ];
      case 'damageRoad':
        return roadsOf(state, player).map((edge): Action => ({
          type: 'eventDamageRoad',
          player,
          edge,
        }));
    }
  });
};
