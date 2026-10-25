/**
 * Action registry. Owned by T1 — rules agents should NOT need to edit this file:
 * fill in handlers/generators inside your area file instead. The mapped type below makes
 * TypeScript fail if an action type has no handler.
 */
import type { ActionType } from '../types';
import { buildHandlers, buildLegal } from './build';
import type { Handler, LegalGenerator } from './common';
import { devHandlers, devLegal } from './dev';
import { robberHandlers, robberLegal } from './robber';
import { setupHandlers, setupLegal } from './setup';
import { tradeHandlers, tradeLegal } from './trade';
import { turnHandlers, turnLegal } from './turn';

export const HANDLERS: { [K in ActionType]: Handler<K> } = {
  ...setupHandlers,
  ...turnHandlers,
  ...buildHandlers,
  ...robberHandlers,
  ...devHandlers,
  ...tradeHandlers,
};

export const LEGAL_GENERATORS: readonly LegalGenerator[] = [
  setupLegal,
  turnLegal,
  buildLegal,
  robberLegal,
  devLegal,
  tradeLegal,
];
