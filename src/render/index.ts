/** Render layer (T4): PixiJS board view + hit-testing. Reads GameState, never mutates it. */
export { BoardView, type BoardEvents, type Highlights } from './BoardView';
export type { Insets } from './viewport';
export {
  HEX_SIZE,
  boardBounds,
  fitView,
  hexAt,
  pick,
  pickRadii,
  screenToUnit,
  unitToScreen,
  zoomAt,
  type Hit,
  type PickCandidates,
  type ViewTransform,
} from './geometry';
export { drawResourceIcon } from './art';
export { RESOURCE_COLORS, TERRAIN_COLORS, TERRAIN_PALETTE, setFrameColors } from './theme';
