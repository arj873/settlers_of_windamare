/**
 * OWNER: T3 (rules-trade).
 * buyDevCard (main): pay COSTS.devCard, pop devDeck into newDevCards.
 *   Also in specialBuild (T13), by the builder: the card goes straight into devCards, since it
 *   was bought before the builder's own turn and may be played on it (RULES.md §16.10c).
 * play* (preRoll or main): at most one per turn (turn.devCardPlayed), only from devCards
 *   (never newDevCards). VP cards are never "played"; they count automatically.
 *   Played cards are recorded (knightsPlayed / progressCardsPlayed) so deck + hands + played = 25.
 *   playKnight        -> knightsPlayed++, phase moveRobber{resume: <phase it was played in>}
 *   playRoadBuilding  -> phase roadBuilding{remaining: min(2, roads left), resume}
 *                        Rejected when no road could be placed (no pieces / no legal edge).
 *   placeFreeRoad     -> free road (canPlaceRoad); when remaining hits 0 or no legal edge -> resume
 *   playYearOfPlenty  -> take 2 from bank (must be available)
 *   playMonopoly      -> all other players give all of that resource
 */
import { COSTS, RESOURCES } from '../constants';
import { addResources, hasResources, isResource, subtractResources } from '../resources';
import { canPlaceRoad } from '../rules/placement';
import { getPlayer, piecesLeft } from '../selectors';
import { topologyOf } from '../topology';
import type {
  Action,
  DevCardType,
  EdgeId,
  GameState,
  PlayerId,
  Resource,
  ResourceBundle,
  ResumePhase,
} from '../types';
import { roadsBlocked } from '../variants';
import { type HandlerMap, type LegalGenerator, fail, isCurrent, log, ok } from './common';
import { startRobber } from './robber';

type PlayableCard = Exclude<DevCardType, 'victoryPoint'>;

const CARD_NAMES: Record<PlayableCard, string> = {
  knight: 'a Knight',
  roadBuilding: 'Road Building',
  yearOfPlenty: 'Year of Plenty',
  monopoly: 'Monopoly',
};

/** Buying is allowed in `main` and in the special building phase (turn.current = builder). */
export function canBuyDevCard(state: GameState, player: PlayerId): string | null {
  if (state.phase.kind !== 'main' && state.phase.kind !== 'specialBuild') {
    return 'can only buy development cards in the main or special building phase';
  }
  if (!isCurrent(state, player)) return 'not your turn';
  if (state.devDeck.length === 0) return 'no development cards left';
  if (!hasResources(getPlayer(state, player).resources, COSTS.devCard)) {
    return 'not enough resources';
  }
  return null;
}

/** Common guard for playing a card. Returns the phase to resume to, or an error string. */
function canPlay(
  state: GameState,
  player: PlayerId,
  card: PlayableCard,
): { resume: ResumePhase } | { error: string } {
  const kind = state.phase.kind;
  if (kind !== 'preRoll' && kind !== 'main') {
    return { error: 'can only play development cards before rolling or in the main phase' };
  }
  if (!isCurrent(state, player)) return { error: 'not your turn' };
  if (state.turn.devCardPlayed) return { error: 'already played a development card this turn' };
  if (getPlayer(state, player).devCards[card] < 1) {
    return { error: `no playable ${card} card (cards bought this turn must wait)` };
  }
  return { resume: kind };
}

/** Edges where `player` could place a road right now (geometry; none while a road is damaged). */
function roadSpots(state: GameState, player: PlayerId): EdgeId[] {
  if (roadsBlocked(state, player)) return [];
  return topologyOf(state).edges.filter((e) => canPlaceRoad(state, player, e));
}

function canPlaceAnyRoad(state: GameState, player: PlayerId): boolean {
  return piecesLeft(state, player).road > 0 && roadSpots(state, player).length > 0;
}

/** Mark the card as played (knights count in knightsPlayed, the rest in progressCardsPlayed). */
function spend(draft: GameState, player: PlayerId, card: PlayableCard): void {
  const p = getPlayer(draft, player);
  p.devCards[card] -= 1;
  if (card === 'knight') p.knightsPlayed += 1;
  else p.progressCardsPlayed[card] += 1;
  draft.turn.devCardPlayed = true;
  log(draft, player, `${getPlayer(draft, player).name} played ${CARD_NAMES[card]}`);
}

function isResourcePair(x: unknown): x is [Resource, Resource] {
  return Array.isArray(x) && x.length === 2 && x.every(isResource);
}

/** Year of Plenty pair as a bundle; the bank must cover it. */
function pairBundle([a, b]: [Resource, Resource]): ResourceBundle {
  return a === b ? { [a]: 2 } : { [a]: 1, [b]: 1 };
}

export const devHandlers: HandlerMap<
  | 'buyDevCard'
  | 'playKnight'
  | 'playRoadBuilding'
  | 'placeFreeRoad'
  | 'playYearOfPlenty'
  | 'playMonopoly'
> = {
  buyDevCard: (draft, { player }) => {
    const err = canBuyDevCard(draft, player);
    if (err) return fail(err);
    const p = getPlayer(draft, player);
    p.resources = subtractResources(p.resources, COSTS.devCard);
    draft.bank = addResources(draft.bank, COSTS.devCard);
    const card = draft.devDeck.pop() as DevCardType;
    // Bought outside your own turn (special build) -> playable on your next turn (FAQ).
    if (draft.phase.kind === 'specialBuild') p.devCards[card] += 1;
    else p.newDevCards[card] += 1;
    log(draft, player, `${p.name} bought a development card`);
    return ok(draft);
  },

  playKnight: (draft, { player }) => {
    const check = canPlay(draft, player, 'knight');
    if ('error' in check) return fail(check.error);
    spend(draft, player, 'knight');
    startRobber(draft, check.resume);
    return ok(draft);
  },

  playRoadBuilding: (draft, { player }) => {
    const check = canPlay(draft, player, 'roadBuilding');
    if ('error' in check) return fail(check.error);
    if (!canPlaceAnyRoad(draft, player)) return fail('no road can be placed');
    spend(draft, player, 'roadBuilding');
    const remaining = Math.min(2, piecesLeft(draft, player).road);
    draft.phase = { kind: 'roadBuilding', remaining, resume: check.resume };
    return ok(draft);
  },

  placeFreeRoad: (draft, { player, edge }) => {
    const phase = draft.phase;
    if (phase.kind !== 'roadBuilding') return fail('not placing free roads');
    if (!isCurrent(draft, player)) return fail('not your turn');
    if (piecesLeft(draft, player).road < 1) return fail('no roads left');
    if (roadsBlocked(draft, player)) return fail('repair your damaged road first');
    if (typeof edge !== 'string' || !canPlaceRoad(draft, player, edge)) {
      return fail('cannot place a road there');
    }
    draft.pieces.roads[edge] = player;
    log(draft, player, `${getPlayer(draft, player).name} placed a free road`);
    const remaining = phase.remaining - 1;
    draft.phase =
      remaining > 0 && canPlaceAnyRoad(draft, player)
        ? { kind: 'roadBuilding', remaining, resume: phase.resume }
        : { kind: phase.resume };
    return ok(draft);
  },

  playYearOfPlenty: (draft, { player, resources }) => {
    const check = canPlay(draft, player, 'yearOfPlenty');
    if ('error' in check) return fail(check.error);
    if (!isResourcePair(resources)) return fail('pick exactly two resources');
    const bundle = pairBundle(resources);
    if (!hasResources(draft.bank, bundle)) return fail('the bank does not have those resources');
    spend(draft, player, 'yearOfPlenty');
    const p = getPlayer(draft, player);
    p.resources = addResources(p.resources, bundle);
    draft.bank = subtractResources(draft.bank, bundle);
    log(draft, player, `${p.name} took ${resources[0]} and ${resources[1]}`);
    return ok(draft);
  },

  playMonopoly: (draft, { player, resource }) => {
    const check = canPlay(draft, player, 'monopoly');
    if ('error' in check) return fail(check.error);
    if (!isResource(resource)) return fail('invalid resource');
    spend(draft, player, 'monopoly');
    const me = getPlayer(draft, player);
    let taken = 0;
    for (const other of draft.players) {
      if (other.id === player) continue;
      taken += other.resources[resource];
      other.resources[resource] = 0;
    }
    me.resources[resource] += taken;
    log(draft, player, `${me.name} took ${taken} ${resource}`);
    return ok(draft);
  },
};

export const devLegal: LegalGenerator = (state: GameState): Action[] => {
  const player = state.turn.current;
  const out: Action[] = [];

  if (state.phase.kind === 'roadBuilding') {
    if (piecesLeft(state, player).road < 1) return out;
    for (const edge of roadSpots(state, player)) out.push({ type: 'placeFreeRoad', player, edge });
    return out;
  }

  if (canBuyDevCard(state, player) === null) out.push({ type: 'buyDevCard', player });

  const playable = (card: PlayableCard) => !('error' in canPlay(state, player, card));
  if (playable('knight')) out.push({ type: 'playKnight', player });
  if (playable('roadBuilding') && canPlaceAnyRoad(state, player)) {
    out.push({ type: 'playRoadBuilding', player });
  }
  if (playable('yearOfPlenty')) {
    RESOURCES.forEach((a, i) => {
      for (const b of RESOURCES.slice(i)) {
        if (hasResources(state.bank, pairBundle([a, b]))) {
          out.push({ type: 'playYearOfPlenty', player, resources: [a, b] });
        }
      }
    });
  }
  if (playable('monopoly')) {
    for (const resource of RESOURCES) out.push({ type: 'playMonopoly', player, resource });
  }
  return out;
};
