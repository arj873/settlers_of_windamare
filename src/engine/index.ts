/** Public engine API. Other layers import from 'src/engine' only (not deep paths) where possible. */
export * from './types';
export * from './constants';
export * from './hex';
export * from './topology';
export * from './maps';
export * from './mapLookup';
export * from './expansions/types';
export * from './expansions/ext';
export {
  BASE_MODE,
  activeModules,
  allModules,
  allScenarios,
  expansionById,
  isActive,
  isExpansionId,
  listModes,
  mapDef,
  modeById,
  scenarioById,
} from './expansions/registry';
export {
  costOf,
  expansionVictoryParts,
  expansionVictoryPoints,
  longestRoadName,
  pieceLimit,
  routeName,
  terrainKind,
  type BaseCostItem,
} from './expansions/hooks';
export { upgradeState, SCHEMA_VERSION } from './migrate';
export * from './rng';
export * from './resources';
export * from './selectors';
export * from './rules/placement';
export {
  assembleBoard,
  beginnerBoard,
  dealTokens,
  generateBoard,
  mapRuleViolations,
  randomBoard,
  redNumbersSeparated,
  type MapRuleViolations,
} from './board';
export * from './variants';
export * from './clock';
export { EVENT_CARDS, EVENT_INFO, facesFor, type EventCard } from './rules/events';
export { MAP_VETO_CANDIDATES, vetoOrder } from './actions/veto';
export { secondSettlerFor } from './actions/turn';
export { setupRoundAt } from './actions/setup';
export { canRepairRoad } from './actions/build';
export {
  createGame,
  defaultVpToWin,
  layoutToMap,
  optionVpBonus,
  resolveMode,
  randomMapFor,
  randomSeatOrder,
  resolveSettings,
  type GameConfig,
  type PlayerConfig,
  type ResolvedMode,
} from './createGame';
export { applyAction, legalActions } from './engine';
export { longestRoadLength, longestRoadLengths } from './rules/longestRoad';
export { bankTradeRatio } from './actions/trade';
export { specialBuildQueue } from './actions/turn';
export * from './view';
export {
  DICE_TOTALS,
  GAIN_SOURCES,
  LOSS_SINKS,
  bankCards,
  emptyStats,
  statsOf,
  sumCounts,
  tradesByRatio,
} from './stats';
