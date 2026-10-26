/**
 * Pure derivations for the HUD: which controls are enabled (from legal actions ONLY),
 * the mode hint, best bank ratios, dev card rows. No DOM here.
 */
import {
  actingPlayers,
  getPlayer,
  handSize,
  portsOf,
  publicVictoryPoints,
  RESOURCES,
  totalDevCards,
  victoryPoints,
  type Action,
  type ActionOf,
  type ActionType,
  type DevCardType,
  type GameState,
  type PlayerId,
  type Resource,
} from '../engine';
import type { HudView, PlaceMode } from './types';

/** Legal actions the viewer may submit. */
export function viewerLegal(view: HudView): Action[] {
  return view.legal.filter((a) => a.player === view.viewer);
}

export function ofType<T extends ActionType>(legal: readonly Action[], type: T): ActionOf<T>[] {
  return legal.filter((a): a is ActionOf<T> => a.type === type);
}

export interface Availability {
  roll: boolean;
  endTurn: boolean;
  /** Special building phase: the End turn button passes the build step instead. */
  passSpecialBuild: boolean;
  buildRoad: boolean;
  buildSettlement: boolean;
  buildCity: boolean;
  buyDevCard: boolean;
  playKnight: boolean;
  playRoadBuilding: boolean;
  playYearOfPlenty: boolean;
  playMonopoly: boolean;
  bankTrade: boolean;
  offerTrade: boolean;
}

/** `legal` must already be filtered to the viewer (see `viewerLegal`). */
export function availability(legal: readonly Action[]): Availability {
  const has = (t: ActionType) => legal.some((a) => a.type === t);
  return {
    roll: has('rollDice'),
    endTurn: has('endTurn'),
    passSpecialBuild: has('passSpecialBuild'),
    buildRoad: has('buildRoad'),
    buildSettlement: has('buildSettlement'),
    buildCity: has('buildCity'),
    buyDevCard: has('buyDevCard'),
    playKnight: has('playKnight'),
    playRoadBuilding: has('playRoadBuilding'),
    playYearOfPlenty: has('playYearOfPlenty'),
    playMonopoly: has('playMonopoly'),
    bankTrade: has('bankTrade'),
    offerTrade: has('offerTrade'),
  };
}

export function placeModeAvailable(av: Availability, mode: PlaceMode): boolean {
  return mode === 'road' ? av.buildRoad : mode === 'settlement' ? av.buildSettlement : av.buildCity;
}

/** Bank ratio per resource for `player`: 2 (matching port), 3 (generic port) or 4. */
export function bestRatios(state: GameState, player: PlayerId): Record<Resource, 2 | 3 | 4> {
  const kinds = portsOf(state, player);
  const generic = kinds.includes('generic');
  const out = {} as Record<Resource, 2 | 3 | 4>;
  for (const r of RESOURCES) out[r] = kinds.includes(r) ? 2 : generic ? 3 : 4;
  return out;
}

/** Find the legal bankTrade for a (give, receive) pair. */
export function findBankTrade(
  legal: readonly Action[],
  give: Resource,
  receive: Resource,
): ActionOf<'bankTrade'> | undefined {
  return ofType(legal, 'bankTrade').find((a) => a.give === give && a.receive === receive);
}

/** Find the legal Year of Plenty action for two picks (order-insensitive). */
export function findYearOfPlenty(
  legal: readonly Action[],
  a: Resource,
  b: Resource,
): ActionOf<'playYearOfPlenty'> | undefined {
  return ofType(legal, 'playYearOfPlenty').find(
    (x) =>
      (x.resources[0] === a && x.resources[1] === b) ||
      (x.resources[0] === b && x.resources[1] === a),
  );
}

export interface DevCardRow {
  type: DevCardType;
  /** Playable (bought on an earlier turn). */
  ready: number;
  /** Bought this turn. */
  fresh: number;
  /** A legal play action exists right now. */
  canPlay: boolean;
}

export const DEV_CARD_INFO: Record<DevCardType, { name: string; blurb: string; icon: string }> = {
  knight: { name: 'Knight', blurb: 'Move the robber and steal a card.', icon: '⚔️' },
  victoryPoint: { name: 'Victory Point', blurb: 'Counts 1 VP. Stays hidden.', icon: '🏆' },
  roadBuilding: { name: 'Road Building', blurb: 'Build 2 roads for free.', icon: '🛣️' },
  yearOfPlenty: {
    name: 'Year of Plenty',
    blurb: 'Take any 2 resources from the bank.',
    icon: '🎁',
  },
  monopoly: { name: 'Monopoly', blurb: 'Take every card of one resource.', icon: '💰' },
};

const PLAY_TYPE: Record<Exclude<DevCardType, 'victoryPoint'>, ActionType> = {
  knight: 'playKnight',
  roadBuilding: 'playRoadBuilding',
  yearOfPlenty: 'playYearOfPlenty',
  monopoly: 'playMonopoly',
};

export function devCardRows(
  state: GameState,
  viewer: PlayerId,
  legal: readonly Action[],
): DevCardRow[] {
  const p = getPlayer(state, viewer);
  const types: DevCardType[] = [
    'knight',
    'roadBuilding',
    'yearOfPlenty',
    'monopoly',
    'victoryPoint',
  ];
  return types
    .map((type) => ({
      type,
      ready: p.devCards[type],
      fresh: p.newDevCards[type],
      canPlay: type !== 'victoryPoint' && legal.some((a) => a.type === PLAY_TYPE[type]),
    }))
    .filter((r) => r.ready + r.fresh > 0);
}

export interface PlayerSummary {
  id: PlayerId;
  name: string;
  color: string;
  publicVp: number;
  /** Only meaningful for the viewer: VP cards held. */
  hiddenVp: number;
  cards: number;
  devCards: number;
  knights: number;
  longestRoad: boolean;
  largestArmy: boolean;
  isCurrent: boolean;
  /** Has something to do right now (discard, respond to trade...). */
  isActing: boolean;
}

export function playerSummaries(state: GameState, viewer: PlayerId): PlayerSummary[] {
  const acting = actingPlayers(state);
  return state.players.map((p) => ({
    id: p.id,
    name: p.name,
    color: p.color,
    publicVp: publicVictoryPoints(state, p.id),
    hiddenVp: p.id === viewer ? victoryPoints(state, p.id) - publicVictoryPoints(state, p.id) : 0,
    cards: handSize(p),
    devCards: totalDevCards(p.devCards) + totalDevCards(p.newDevCards),
    knights: p.knightsPlayed,
    longestRoad: state.awards.longestRoad === p.id,
    largestArmy: state.awards.largestArmy === p.id,
    isCurrent: state.turn.current === p.id,
    isActing: acting.includes(p.id) && state.phase.kind !== 'gameOver',
  }));
}

export interface Hint {
  text: string;
  tone: 'action' | 'wait';
}

function names(state: GameState, ids: PlayerId[]): string {
  return ids.map((i) => state.players[i]?.name ?? `Player ${i + 1}`).join(', ');
}

/** The banner telling the viewer what the board expects (or whom we are waiting for). */
export function hintFor(state: GameState, view: HudView, placeMode: PlaceMode | null): Hint | null {
  const phase = state.phase;
  if (phase.kind === 'gameOver') return null;
  const mine = viewerLegal(view);
  const current = names(state, [state.turn.current]);

  if (mine.length === 0) {
    const who = actingPlayers(state);
    if (view.isBotTurn && who.includes(state.turn.current)) {
      return { text: `${current} is thinking…`, tone: 'wait' };
    }
    return { text: `Waiting for ${names(state, who)}…`, tone: 'wait' };
  }

  switch (phase.kind) {
    case 'setup':
      return {
        text:
          phase.step === 'settlement'
            ? 'Place a settlement'
            : 'Place a road next to your new settlement',
        tone: 'action',
      };
    case 'preRoll':
      return { text: 'Roll the dice', tone: 'action' };
    case 'main':
      return placeMode
        ? { text: `Place a ${placeMode} — pick a highlighted spot (Esc to cancel)`, tone: 'action' }
        : { text: 'Your turn — build, trade or end your turn', tone: 'action' };
    case 'discard':
      return {
        text: `Rolled a 7 — discard ${phase.pending[view.viewer] ?? 0} cards`,
        tone: 'action',
      };
    case 'moveRobber':
      return { text: 'Move the robber to a new hex', tone: 'action' };
    case 'steal':
      return { text: 'Choose a player to steal from', tone: 'action' };
    case 'roadBuilding':
      return { text: `Place a free road (${phase.remaining} left)`, tone: 'action' };
    case 'trade':
      return phase.offer.from === view.viewer
        ? { text: 'Waiting for trade responses…', tone: 'wait' }
        : { text: 'Respond to the trade offer', tone: 'action' };
    case 'specialBuild':
      return placeMode
        ? { text: `Place a ${placeMode} — pick a highlighted spot (Esc to cancel)`, tone: 'action' }
        : { text: 'Special build — build or buy a card, then pass', tone: 'action' };
  }
}

/** What a plain board click means right now (non-build). T7 uses it to pick which targets to highlight. */
export type BoardPrompt = 'setupSettlement' | 'setupRoad' | 'moveRobber' | 'freeRoad';

export function boardPrompt(view: HudView): BoardPrompt | null {
  for (const a of viewerLegal(view)) {
    if (a.type === 'placeSetupSettlement') return 'setupSettlement';
    if (a.type === 'placeSetupRoad') return 'setupRoad';
    if (a.type === 'moveRobber') return 'moveRobber';
    if (a.type === 'placeFreeRoad') return 'freeRoad';
  }
  return null;
}

export function diceTotal(dice: readonly [number, number] | null): number | null {
  return dice ? dice[0] + dice[1] : null;
}
