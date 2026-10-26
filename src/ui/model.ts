/**
 * Pure derivations for the HUD: which controls are enabled (from legal actions ONLY),
 * the mode hint, best bank ratios, dev card rows. No DOM here.
 */
import {
  actingPlayers,
  canPlaceCity,
  canPlaceRoad,
  canPlaceSettlement,
  COSTS,
  DEV_CARD_TYPES,
  devCardCount,
  EVENT_INFO,
  getPlayer,
  handCount,
  longestRoadLength,
  PIECE_LIMITS,
  piecesLeft,
  portsOf,
  publicVictoryPoints,
  supplyOf,
  topologyOf,
  RESOURCES,
  victoryPoints,
  visibleSpecialBuildQueue,
  type Action,
  type ActionOf,
  type ActionType,
  type DevCardType,
  type GameState,
  type PlayerId,
  type Resource,
} from '../engine';
import { extensionHint, placeModeAction } from './expansions';
import type { BasePlaceMode, HudView, PlaceMode } from './types';

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

/** Is the build mode usable now? Expansion modes need `legal` (their action type must be in it). */
export function placeModeAvailable(
  av: Availability,
  mode: PlaceMode,
  legal: readonly Action[] = [],
): boolean {
  if (mode === 'road') return av.buildRoad;
  if (mode === 'settlement') return av.buildSettlement;
  if (mode === 'city') return av.buildCity;
  const type = placeModeAction(mode);
  return type !== null && legal.some((a) => a.type === type);
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
  /** Length of the player's longest road. */
  roadLength: number;
  longestRoad: boolean;
  largestArmy: boolean;
  isCurrent: boolean;
  /** Has something to do right now (discard, respond to trade...). */
  isActing: boolean;
  isBot: boolean;
}

export function playerSummaries(
  state: GameState,
  viewer: PlayerId,
  bots: readonly boolean[] = [],
): PlayerSummary[] {
  const acting = actingPlayers(state);
  return state.players.map((p) => ({
    id: p.id,
    name: p.name,
    color: p.color,
    publicVp: publicVictoryPoints(state, p.id),
    hiddenVp: p.id === viewer ? victoryPoints(state, p.id) - publicVictoryPoints(state, p.id) : 0,
    // Public counts: on an online view other hands are masked (engine/view.ts).
    cards: handCount(state, p.id),
    devCards: devCardCount(state, p.id),
    knights: p.knightsPlayed,
    roadLength: longestRoadLength(state, p.id),
    longestRoad: state.awards.longestRoad === p.id,
    largestArmy: state.awards.largestArmy === p.id,
    isCurrent: state.turn.current === p.id,
    isActing: acting.includes(p.id) && state.phase.kind !== 'gameOver',
    isBot: bots[p.id] === true,
  }));
}

/**
 * The "hide bank cards" rule. Read defensively: the setting may live at `settings.hideBankCards`
 * or `settings.rules.hideBankCards`, or not exist yet.
 */
export function bankCardsHidden(state: GameState): boolean {
  const s = state.settings as unknown as {
    hideBankCards?: unknown;
    rules?: { hideBankCards?: unknown };
  };
  return s.hideBankCards === true || s.rules?.hideBankCards === true;
}

export interface BankView {
  /** `count` is null when the bank's cards are hidden. */
  stacks: { resource: Resource; count: number | null }[];
  devDeck: number;
}

export function bankView(state: GameState): BankView {
  const hidden = bankCardsHidden(state);
  return {
    stacks: RESOURCES.map((resource) => ({
      resource,
      count: hidden ? null : state.bank[resource],
    })),
    devDeck: state.devDeck.length,
  };
}

export type BuildKind = 'dev' | BasePlaceMode;

export interface BuildCard {
  kind: BuildKind;
  /** Pieces left (dev: cards left in the deck). */
  left: number;
  total: number;
  /** Legal right now for the viewer. */
  enabled: boolean;
}

/** The build bar: dev card, road, settlement, city with what is left of each. */
export function buildCards(state: GameState, viewer: PlayerId, av: Availability): BuildCard[] {
  const left = piecesLeft(state, viewer);
  const deck = supplyOf(state).devDeck; // depends on the map (25 base, 34 for 5-6P, ...)
  const deckTotal = DEV_CARD_TYPES.reduce((n, t) => n + deck[t], 0);
  // No development deck in this game (an expansion's supply, e.g. C&K): no Buy card button.
  const dev: BuildCard[] =
    deckTotal > 0
      ? [{ kind: 'dev', left: state.devDeck.length, total: deckTotal, enabled: av.buyDevCard }]
      : [];
  return [
    ...dev,
    { kind: 'road', left: left.road, total: PIECE_LIMITS.road, enabled: av.buildRoad },
    {
      kind: 'settlement',
      left: left.settlement,
      total: PIECE_LIMITS.settlement,
      enabled: av.buildSettlement,
    },
    { kind: 'city', left: left.city, total: PIECE_LIMITS.city, enabled: av.buildCity },
  ];
}

const PIECE_PLURAL: Record<BasePlaceMode, string> = {
  road: 'roads',
  settlement: 'settlements',
  city: 'cities',
};

export interface BlockReason {
  text: string;
  /** Can't afford: the cards still missing (shown as card faces). */
  missing?: Partial<Record<Resource, number>>;
}

/** Is there any spot for `kind`, ignoring cost and phase? (geometry + own network only) */
function anySpot(state: GameState, viewer: PlayerId, kind: BasePlaceMode): boolean {
  const t = topologyOf(state);
  if (kind === 'road') return t.edges.some((e) => canPlaceRoad(state, viewer, e));
  if (kind === 'city') return t.vertices.some((v) => canPlaceCity(state, viewer, v));
  return t.vertices.some((v) => canPlaceSettlement(state, viewer, v, { requireRoad: true }));
}

/**
 * Why a build-bar button is disabled (empty when it is enabled): not the viewer's moment,
 * no pieces / cards left, the missing cards, no legal spot. Most useful reason first.
 */
export function blockReasons(state: GameState, viewer: PlayerId, card: BuildCard): BlockReason[] {
  if (card.enabled) return [];
  const phase = state.phase.kind;
  if (phase === 'gameOver') return [{ text: 'The game is over' }];
  if (state.turn.current !== viewer) return [{ text: 'Not your turn' }];
  if (phase === 'preRoll') return [{ text: 'Roll the dice first' }];
  if (phase === 'setup') return [{ text: 'Place your starting pieces first' }];
  if (phase !== 'main' && phase !== 'specialBuild') {
    return [{ text: 'Finish the current step first' }];
  }

  const kind = card.kind;
  if (card.left === 0) {
    return [
      {
        text:
          kind === 'dev'
            ? 'No development cards left'
            : `No ${PIECE_PLURAL[kind]} left (all ${card.total} placed)`,
      },
    ];
  }
  const out: BlockReason[] = [];
  const hand = getPlayer(state, viewer).resources;
  const cost = COSTS[kind === 'dev' ? 'devCard' : kind];
  const missing: Partial<Record<Resource, number>> = {};
  for (const r of RESOURCES) if (cost[r] > hand[r]) missing[r] = cost[r] - hand[r];
  if (Object.keys(missing).length > 0) {
    const list = Object.entries(missing).map(([r, n]) => `${n} ${r}`);
    out.push({ text: `Missing ${list.join(', ')}`, missing });
  }
  if (kind !== 'dev' && !anySpot(state, viewer, kind)) {
    out.push({
      text:
        kind === 'city'
          ? 'No settlement to upgrade'
          : kind === 'road'
            ? 'No free edge next to your roads or buildings'
            : 'No legal spot (needs your road, no building next to it)',
    });
  }
  return out.length > 0 ? out : [{ text: 'Not possible right now' }];
}

/** Dark or light text for a player colour (`#rgb` / `#rrggbb`; anything else gets light text). */
export function inkFor(color: string): 'dark' | 'light' {
  const digits = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim())?.[1];
  if (!digits) return 'light';
  const hex = digits.length === 3 ? [...digits].map((c) => c + c).join('') : digits;
  const [r = 0, g = 0, b = 0] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  // Perceived luminance (Rec. 709 weights, gamma ignored on purpose: good enough for a choice).
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.62 ? 'dark' : 'light';
}

/** The turn timer warns (red, pulsing) for the last this-many seconds. */
export const TIMER_WARN_SEC = 10;

export interface TurnInfo {
  /** Whose avatar the pill shows. */
  player: PlayerId;
  /** "Your turn", "Blue's turn" or "Special build: Blue". */
  title: string;
  hint: Hint | null;
  /** Special building phase: who is still to go after this step ("then Red, White"). */
  next: string | null;
}

export function turnInfo(state: GameState, view: HudView, placeMode: PlaceMode | null): TurnInfo {
  const current = state.turn.current;
  const name = state.players[current]?.name ?? `Player ${current + 1}`;
  const phase = state.phase;
  const title =
    phase.kind === 'gameOver'
      ? 'Game over'
      : phase.kind === 'specialBuild'
        ? `Special build: ${current === view.viewer ? 'you' : name}`
        : current === view.viewer
          ? 'Your turn'
          : `${name}'s turn`;
  let next: string | null = null;
  if (phase.kind === 'specialBuild') {
    const queue = visibleSpecialBuildQueue(state);
    const upNext = (phase.owner + 1) % state.players.length;
    next =
      queue.length > 0
        ? `then ${names(state, queue)}`
        : upNext === view.viewer
          ? 'then your turn'
          : `then ${names(state, [upNext])}'s turn`;
  }
  let hint = hintFor(state, view, placeMode);
  // "Blue's turn — Blue is thinking…" says the name twice.
  if (hint?.text === `${name} is thinking…`) hint = { text: 'thinking…', tone: 'wait' };
  if (hint && title === 'Your turn' && hint.text.startsWith('Your turn — ')) {
    hint = { ...hint, text: hint.text.slice('Your turn — '.length) };
  }
  return { player: current, title, hint, next };
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
        : {
            text: state.settings.rules56
              ? 'Build, buy or play one card, then pass'
              : 'Build or buy a card, then pass',
            tone: 'action',
          };
    case 'mapVeto':
      return { text: 'Veto one of the candidate maps', tone: 'action' };
    case 'event': {
      const t = phase.tasks.find((x) => x.player === view.viewer);
      const what =
        t?.kind === 'damageRoad'
          ? 'Earthquake — pick one of your roads to damage'
          : `${EVENT_INFO[phase.event].name} — make your choice`;
      return { text: what, tone: 'action' };
    }
    default:
      // An expansion phase: its HudExtension.hint, or a generic prompt.
      return { text: extensionHint(state, view) ?? 'Your move', tone: 'action' };
  }
}

/** What a plain board click means right now (non-build). T7 uses it to pick which targets to highlight. */
export type BoardPrompt =
  'setupSettlement' | 'setupRoad' | 'moveRobber' | 'freeRoad' | 'damageRoad';

export function boardPrompt(view: HudView): BoardPrompt | null {
  for (const a of viewerLegal(view)) {
    if (a.type === 'placeSetupSettlement') return 'setupSettlement';
    if (a.type === 'placeSetupRoad') return 'setupRoad';
    if (a.type === 'moveRobber') return 'moveRobber';
    if (a.type === 'placeFreeRoad') return 'freeRoad';
    if (a.type === 'eventDamageRoad') return 'damageRoad';
  }
  return null;
}

export function diceTotal(dice: readonly [number, number] | null): number | null {
  return dice ? dice[0] + dice[1] : null;
}
