/** UI layer (T6): HTML/CSS overlay — HUD, dialogs, hand, log. Emits Actions, never edits state. */
export { Hud } from './hud';
export type {
  Controller,
  HudEvents,
  HudEventName,
  HudView,
  NewGameConfig,
  PlaceMode,
  SeatConfig,
} from './types';
export { boardPrompt, type BoardPrompt } from './model';
export {
  boardFrameColors,
  currentTheme,
  initTheme,
  onThemeChange,
  setTheme,
  THEMES,
  type ThemeName,
} from './theme';
