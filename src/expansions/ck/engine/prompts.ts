/**
 * Prompts: the choices a C&K phase asks for and who answers. Handlers accept exactly the
 * choices listed here and the legal generator emits exactly these, so both stay in step.
 * Answers are the generic actions ck/pickVertex, pickEdge, pickHex, pickPlayer, pickGood,
 * pickTrack, pickCard and ck/done.
 */
import { RESOURCES } from '../../../engine/constants';
import { log, resumePhase } from '../../../engine/actions/common';
import { playerName } from '../../../engine/rules/text';
import type { Action, GameState, Phase, PlayerId, VertexId } from '../../../engine/types';
import { applyCardChoice, cardActor, cardOptions, sameChoice, type CardChoice } from './cards';
import { moveTargets } from './routes';
import {
  afterQueueStep,
  displaceTargets,
  displaced,
  drawProgress,
  freeCities,
  knightActionBlocker,
  moveGood,
  pillage,
  pillageable,
  placeMetropolis,
  proceed,
  returnCard,
} from './rules';
import {
  CARD_TRACK,
  TRACKS,
  ckPlayer,
  ckSlice,
  type CardPhase,
  type CkAction,
  phaseOf,
  type Track,
} from './state';

export type Choice = CardChoice | { kind: 'track'; id: Track };

export interface Prompt {
  actor: PlayerId;
  options: Choice[];
}

const pn = playerName;
const vertices = (ids: readonly VertexId[]): Choice[] => ids.map((id) => ({ kind: 'vertex', id }));

/** The open prompt of a C&K phase (null when the phase has none). */
export function promptFor(state: GameState): Prompt | null {
  const phase = phaseOf(state);
  const s = ckSlice(state);
  switch (phase.kind) {
    case 'ck/pillage': {
      const p = phase.queue[0];
      return p === undefined ? null : { actor: p, options: vertices(pillageable(state, p)) };
    }
    case 'ck/defender': {
      const p = phase.queue[0];
      if (p === undefined) return null;
      const options = TRACKS.filter((t) => s.decks[t].length > 0).map((id): Choice => ({
        kind: 'track',
        id,
      }));
      return { actor: p, options };
    }
    case 'ck/progressDiscard': {
      const p = phase.queue[0];
      if (p === undefined) return null;
      const cards = [...new Set(s.players[p]?.progress ?? [])].sort();
      return { actor: p, options: cards.map((id): Choice => ({ kind: 'card', id })) };
    }
    case 'ck/aqueduct': {
      const p = phase.queue[0];
      if (p === undefined) return null;
      const options = RESOURCES.filter((r) => state.bank[r] > 0).map((id): Choice => ({
        kind: 'good',
        id,
      }));
      return { actor: p, options };
    }
    case 'ck/metropolis':
      return { actor: phase.player, options: vertices(freeCities(state, phase.player)) };
    case 'ck/knight': {
      const p = state.turn.current;
      if (knightActionBlocker(state, p, phase.vertex) !== null) return { actor: p, options: [] };
      return {
        actor: p,
        options: vertices([
          ...moveTargets(state, p, phase.vertex),
          ...displaceTargets(state, p, phase.vertex),
        ]),
      };
    }
    case 'ck/relocate':
      return {
        actor: phase.player,
        options: vertices(moveTargets(state, phase.player, phase.from)),
      };
    case 'ck/card':
      return { actor: cardActor(state, phase), options: cardOptions(state, phase) };
    default:
      return null;
  }
}

/** The action that answers `choice` for `player`. */
export function choiceAction(player: PlayerId, c: Choice): Action {
  const a: CkAction = (() => {
    switch (c.kind) {
      case 'vertex':
        return { type: 'ck/pickVertex', player, vertex: c.id };
      case 'edge':
        return { type: 'ck/pickEdge', player, edge: c.id };
      case 'hex':
        return { type: 'ck/pickHex', player, hex: c.id };
      case 'player':
        return { type: 'ck/pickPlayer', player, target: c.id };
      case 'good':
        return { type: 'ck/pickGood', player, good: c.id };
      case 'track':
        return { type: 'ck/pickTrack', player, track: c.id };
      case 'card':
        return { type: 'ck/pickCard', player, card: c.id };
      case 'done':
        return { type: 'ck/done', player };
    }
  })();
  return a as unknown as Action;
}

/** The choice a pick action makes (null = malformed). */
export function choiceOf(a: CkAction): Choice | null {
  switch (a.type) {
    case 'ck/pickVertex':
      return typeof a.vertex === 'string' ? { kind: 'vertex', id: a.vertex } : null;
    case 'ck/pickEdge':
      return typeof a.edge === 'string' ? { kind: 'edge', id: a.edge } : null;
    case 'ck/pickHex':
      return typeof a.hex === 'string' ? { kind: 'hex', id: a.hex } : null;
    case 'ck/pickPlayer':
      return typeof a.target === 'number' ? { kind: 'player', id: a.target } : null;
    case 'ck/pickGood':
      return typeof a.good === 'string' ? { kind: 'good', id: a.good } : null;
    case 'ck/pickTrack':
      return typeof a.track === 'string' ? { kind: 'track', id: a.track } : null;
    case 'ck/pickCard':
      return typeof a.card === 'string' ? { kind: 'card', id: a.card } : null;
    case 'ck/done':
      return { kind: 'done' };
    default:
      return null;
  }
}

const same = (a: Choice, b: Choice): boolean =>
  a.kind === 'track' || b.kind === 'track'
    ? a.kind === b.kind && (a as { id: unknown }).id === (b as { id: unknown }).id
    : sameChoice(a, b);

/** Apply a pick: returns an error, or null after changing the draft. */
export function answer(draft: GameState, player: PlayerId, choice: Choice): string | null {
  const prompt = promptFor(draft);
  if (!prompt) return 'nothing to choose now';
  if (prompt.actor !== player) return 'it is not your choice';
  if (!prompt.options.some((o) => same(o, choice))) return 'not one of the options';
  const phase = phaseOf(draft);
  switch (phase.kind) {
    case 'ck/pillage':
      if (choice.kind === 'vertex') pillage(draft, choice.id);
      afterQueueStep(draft, phase.queue, 'ck/pillage');
      return null;
    case 'ck/defender':
      if (choice.kind === 'track') drawProgress(draft, player, choice.id);
      afterQueueStep(draft, phase.queue, 'ck/defender');
      return null;
    case 'ck/progressDiscard': {
      if (choice.kind !== 'card') return 'pick a card';
      const hand = ckPlayer(draft, player).progress;
      hand.splice(hand.indexOf(choice.id), 1);
      returnCard(draft, CARD_TRACK[choice.id], choice.id);
      log(draft, player, `${pn(draft, player)} discarded a progress card`);
      proceed(draft, phase.then);
      return null;
    }
    case 'ck/aqueduct': {
      if (choice.kind !== 'good') return 'pick a resource';
      moveGood(draft, 'bank', player, choice.id);
      log(draft, player, `${pn(draft, player)} took 1 ${choice.id} (Aqueduct)`);
      const rest = phase.queue.slice(1);
      const bankHas = RESOURCES.some((r) => draft.bank[r] > 0);
      draft.phase =
        rest.length > 0 && bankHas
          ? ({ kind: 'ck/aqueduct', queue: rest } as Phase)
          : { kind: 'main' };
      return null;
    }
    case 'ck/metropolis':
      if (choice.kind === 'vertex') placeMetropolis(draft, player, phase.track, choice.id);
      draft.phase = resumePhase(draft, phase.resume);
      return null;
    case 'ck/knight': {
      if (choice.kind !== 'vertex') return 'pick a spot';
      const s = ckSlice(draft);
      const k = s.knights[phase.vertex];
      if (!k) return 'no knight there';
      Reflect.deleteProperty(s.knights, phase.vertex);
      const victim = s.knights[choice.id];
      s.knights[choice.id] = { ...k, active: false };
      if (victim) {
        log(
          draft,
          player,
          `${pn(draft, player)}'s knight displaced a knight of ${pn(draft, victim.owner)}`,
        );
        draft.phase = (displaced(draft, victim, choice.id) as Phase | null) ?? { kind: 'main' };
      } else {
        log(draft, player, `${pn(draft, player)} moved a knight`);
        draft.phase = { kind: 'main' };
      }
      return null;
    }
    case 'ck/relocate':
      if (choice.kind === 'vertex') {
        ckSlice(draft).knights[choice.id] = { ...phase.knight };
        log(draft, player, `${pn(draft, player)}'s knight retreated`);
      }
      draft.phase = { kind: 'main' };
      return null;
    case 'ck/card':
      if (choice.kind === 'track') return 'not one of the options';
      applyCardChoice(draft, phase as CardPhase, choice);
      return null;
    default:
      return 'nothing to choose now';
  }
}
