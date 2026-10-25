/** Game controller (T7): owns the current GameState, wires engine <-> render <-> ui <-> bots. */
export {
  BOT_OFFERS_PER_TURN,
  DEFAULT_SPEED,
  FAST_FACTOR,
  GameController,
  defaultBot,
  type BoardLike,
  type ControllerOptions,
  type HudLike,
  type ToastKind,
} from './controller';
export {
  actionForClick,
  boardActions,
  highlightsFor,
  isStalled,
  nextBot,
  obligated,
  pickViewer,
  type BoardClick,
  type BotTurn,
  type Seats,
} from './logic';
export {
  SAVE_KEY,
  browserStorage,
  clearSession,
  loadSession,
  saveSession,
  type KeyValueStore,
  type SavedSession,
} from './persist';
export { parseParams, type DevParams } from './params';
