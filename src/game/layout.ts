/** Keeps the fitted board clear of the HUD panels by measuring them. */
import type { Insets } from '../render';

function rectOf(root: HTMLElement, selector: string): DOMRect | null {
  const el = root.querySelector(selector);
  if (!el || el.childElementCount === 0) return null;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? r : null;
}

/**
 * Screen margins covered by the HUD (players left, dice/log right, hint top, hand bottom), or null
 * while a full-screen cover is up (nothing meaningful to measure).
 */
export function measureHudInsets(root: HTMLElement, width: number, height: number): Insets | null {
  if (root.classList.contains('is-covered')) return null;
  const players = rectOf(root, '.hud-players');
  const log = rectOf(root, '.hud-log-wrap');
  const dice = rectOf(root, '.hud-dice-wrap');
  const hint = rectOf(root, '.hud-hint-wrap');
  const bottom = rectOf(root, '.hud-bottom');
  if (!players && !bottom) return null;
  return {
    top: Math.round(hint ? hint.bottom : 0),
    left: Math.round(players ? players.right : 0),
    right: Math.round(Math.max(log ? width - log.left : 0, dice ? width - dice.left : 0)),
    bottom: Math.round(bottom ? height - bottom.top : 0),
  };
}
