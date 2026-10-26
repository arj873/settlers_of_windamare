/** Keeps the fitted board clear of the HUD panels by measuring them. */
import type { Insets } from '../render';

function rectOf(root: HTMLElement, selector: string): DOMRect | null {
  const el = root.querySelector(selector);
  if (!el || el.childElementCount === 0) return null;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? r : null;
}

/**
 * Screen margins covered by the HUD (sidebar right, turn pill top, hand / controls bottom), or
 * null while a full-screen cover is up (nothing meaningful to measure).
 */
export function measureHudInsets(root: HTMLElement, width: number, height: number): Insets | null {
  if (root.classList.contains('is-covered')) return null;
  const side = rectOf(root, '.hud-side');
  const turn = rectOf(root, '.hud-turn');
  const bottom = rectOf(root, '.hud-bottom');
  const controls = rectOf(root, '.hud-controls');
  // A docked trade offer card (bottom-left) pushes the board right instead of covering it.
  const dock = rectOf(root, '.scrim.is-side .dialog');
  if (!side && !bottom) return null;
  // On phones the sidebar is a drawer floating over the board (CSS sets --floating: 1).
  const sideEl = root.querySelector('.hud-side');
  const floating =
    sideEl !== null && getComputedStyle(sideEl).getPropertyValue('--floating').trim() === '1';
  const sideLeft = side && !floating ? side.left : width;
  return {
    top: Math.round(turn ? turn.bottom : 0),
    left: Math.round(dock && dock.left < width / 2 ? dock.right + 8 : 0),
    right: Math.round(Math.max(0, width - sideLeft)),
    bottom: Math.round(
      Math.max(bottom ? height - bottom.top : 0, controls ? height - controls.top : 0),
    ),
  };
}
