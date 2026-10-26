/**
 * Per-player views for online play (docs/MULTIPLAYER.md §6). A view is what one seat (or a
 * spectator) may know: a GameState-shaped object with every secret masked, plus `view` with the
 * public counts the masked fields no longer carry. Because it has the GameState shape, the board
 * and the HUD render it unchanged; UI code reads hand / dev card counts through `handCount` /
 * `devCardCount` (they work on full states too).
 *
 * Masked (for everyone but the owner; a spectator owns nothing):
 *  - players[p].resources, devCards, newDevCards  -> all 0 (counts in view.handCounts / devCardCounts)
 *  - devDeck (order and composition)              -> HIDDEN_DEV_CARD x length
 *  - diceDeck (balanced dice order)               -> HIDDEN_DICE_CARD x length
 *  - eventDeck (Event Cards order, V1)            -> HIDDEN_EVENT_CARD x length
 * Public on purpose (V1): map-veto candidates and votes, event tasks, lastEvent, damagedRoads,
 * settings.seatOrder (the seating is visible at the table anyway).
 *  - rng                                          -> 0
 *  - settings.seed and the seed in the "Game created" log line -> HIDDEN_SEED / removed
 *  - stats (UX2: stolen card types, dev cards bought, hidden VP over time) -> absent
 * Once the game is over every hand and dev card is revealed (final scores show VP cards), and
 * so are the stats; decks, rng and seed stay hidden.
 * Expansion secrets (progress cards, fog stacks, face-down tiles, ...) are masked by each active
 * module's `maskFor` hook (docs/EXPANSIONS.md §5), chained after the base masks above.
 *
 * Pure and deterministic. The view shares unchanged parts (board, pieces, log entries...) with
 * `state`: treat it as read-only. Never pass a view to applyAction / legalActions.
 */
import { specialBuildQueue } from './actions/turn';
import { hookMaskFor } from './expansions/hooks';
import { emptyDevCards, emptyResources, totalDevCards, totalResources } from './resources';
import { getPlayer } from './selectors';
import type { DevCardType, GameState, LogEntry, Player, PlayerId } from './types';
import { addPublicCounts, hiddenFrom, type Viewer } from './viewer';

export { addPublicCounts, hiddenFrom, type Viewer };

export const HIDDEN_SEED = 'hidden';
/** Placeholder for every face-down dev card; only `devDeck.length` is meaningful in a view. */
export const HIDDEN_DEV_CARD: DevCardType = 'knight';
/** Placeholder for every undrawn dice card; only `diceDeck.length` is meaningful in a view. */
export const HIDDEN_DICE_CARD = 0;
/** Placeholder for every undrawn event card (V1); only `eventDeck.length` is meaningful. */
export const HIDDEN_EVENT_CARD = 0;

export interface ViewInfo {
  /** The seat this view belongs to; null = spectator. */
  viewer: PlayerId | null;
  /** Resource cards in each player's hand (public). */
  handCounts: number[];
  /** Unplayed dev cards per player, bought this turn included (public). */
  devCardCounts: number[];
  /** True where the player's resources / dev cards are zeroed in this view. */
  masked: boolean[];
  /**
   * specialBuild phase: the builders still to come, clockwise. Unlike `specialBuildQueue` it does
   * not drop players who cannot afford anything (that would leak their hands). [] otherwise.
   */
  specialBuildQueue: PlayerId[];
}

export interface GameView extends GameState {
  view: ViewInfo;
}

const unplayedDevCards = (p: Player) => totalDevCards(p.devCards) + totalDevCards(p.newDevCards);

/** "Game created (Base map, seed 42)" -> "Game created (Base map)". */
const SEED_IN_LOG = /, seed .*\)$/;

function maskLogEntry(e: LogEntry): LogEntry {
  if (e.turn !== 0 || e.player !== null || !e.text.startsWith('Game created (')) return e;
  return { ...e, text: e.text.replace(SEED_IN_LOG, ')') };
}

/** Builders after `builder` up to (excluding) `owner`, clockwise. */
function publicSpecialBuildQueue(state: GameState): PlayerId[] {
  const phase = state.phase;
  if (phase.kind !== 'specialBuild') return [];
  const n = state.players.length;
  const out: PlayerId[] = [];
  for (let b = (phase.builder + 1) % n; b !== phase.owner; b = (b + 1) % n) out.push(b);
  return out;
}

/** What `viewer` may see of `state`. Throws for a seat that does not exist. */
export function viewFor(state: GameState, viewer: Viewer): GameView {
  const seat = viewer === 'spectator' ? null : viewer;
  if (seat !== null && !state.players[seat]) throw new Error(`no player ${seat}`);
  const revealAll = state.phase.kind === 'gameOver';
  const masked = state.players.map((p) => hiddenFrom(state, viewer, p.id));
  const { stats, ...rest } = state;
  const base: GameView = {
    ...rest,
    ...(revealAll && stats ? { stats } : {}),
    settings: { ...state.settings, seed: HIDDEN_SEED },
    players: state.players.map((p, i) =>
      masked[i]
        ? {
            ...p,
            resources: emptyResources(),
            devCards: emptyDevCards(),
            newDevCards: emptyDevCards(),
          }
        : p,
    ),
    devDeck: state.devDeck.map(() => HIDDEN_DEV_CARD),
    diceDeck: state.diceDeck.map(() => HIDDEN_DICE_CARD),
    ...(state.eventDeck ? { eventDeck: state.eventDeck.map(() => HIDDEN_EVENT_CARD) } : {}),
    log: state.log.map(maskLogEntry),
    rng: 0,
    view: {
      viewer: seat,
      handCounts: state.players.map((p) => totalResources(p.resources)),
      devCardCounts: state.players.map(unplayedDevCards),
      masked,
      specialBuildQueue: publicSpecialBuildQueue(state),
    },
  };
  // Modules mask their own secrets (and may raise the public counts: addPublicCounts).
  return hookMaskFor(base, viewer, state) as GameView;
}

export function isGameView(state: GameState): state is GameView {
  return typeof (state as Partial<GameView>).view === 'object';
}

// ---------------------------------------------------------------------------
// Public-info helpers for UI code (work on full states and on views)
// ---------------------------------------------------------------------------

/** Resource cards in `player`'s hand. */
export function handCount(state: GameState, player: PlayerId): number {
  if (isGameView(state)) return state.view.handCounts[player] ?? 0;
  return totalResources(getPlayer(state, player).resources);
}

/** Unplayed dev cards `player` holds (bought this turn included). */
export function devCardCount(state: GameState, player: PlayerId): number {
  if (isGameView(state)) return state.view.devCardCounts[player] ?? 0;
  return unplayedDevCards(getPlayer(state, player));
}

/**
 * The special-build queue the UI may show: the engine's exact queue on a full state (hotseat),
 * the unfiltered public one on a view.
 */
export function visibleSpecialBuildQueue(state: GameState): PlayerId[] {
  return isGameView(state) ? state.view.specialBuildQueue : specialBuildQueue(state);
}
