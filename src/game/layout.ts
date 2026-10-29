/** Keeps the fitted board clear of the HUD panels by measuring them, plus the "Fit board" button. */
import type { Insets } from '../render';

function rectOf(root: HTMLElement, selector: string): DOMRect | null {
  const el = root.querySelector(selector);
  if (!el || el.childElementCount === 0) return null;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? r : null;
}

/** Margins in px, each clamped to [0, the screen size on its axis]. */
const clampTo = (n: number, max: number) => Math.round(Math.min(max, Math.max(0, n)));

export interface HudLayout {
  /** Permanent HUD: sidebar right, turn pill top, hand / controls bottom. The board fits inside. */
  insets: Insets;
  /** Transient overlays the board slides away from without zooming (the docked trade card). */
  avoid: Insets;
}

/**
 * Screen margins covered by the HUD, or null when there is nothing meaningful to measure (a
 * full-screen cover is up, or the bottom HUD is not rendered): callers then leave the board as
 * it is. Dialogs and the hotseat cover are never margins.
 */
export function measureHudInsets(
  root: HTMLElement,
  width: number,
  height: number,
): HudLayout | null {
  if (root.classList.contains('is-covered')) return null;
  const side = rectOf(root, '.hud-side');
  const turn = rectOf(root, '.hud-turn');
  const bottom = rectOf(root, '.hud-bottom');
  const controls = rectOf(root, '.hud-controls');
  // A docked trade offer card (bottom-left, above the hand) slides the board right.
  const dock = rectOf(root, '.scrim.is-side .dialog');
  if (!bottom) return null;
  // On phones the sidebar is a drawer floating over the board (CSS sets --floating: 1).
  const sideEl = root.querySelector('.hud-side');
  const floating =
    sideEl !== null && getComputedStyle(sideEl).getPropertyValue('--floating').trim() === '1';
  const sideLeft = side && !floating ? side.left : width;
  // The tutorial coach panel (src/ui/tutorial): a left column, or a band on top on phones.
  const coach = rectOf(root, '.tut-panel');
  const coachEl = root.querySelector('.tut-panel');
  const coachDock =
    coach && coachEl ? getComputedStyle(coachEl).getPropertyValue('--coach-dock').trim() : '';
  const coachTop = coach && coachDock === 'top' ? coach.bottom + 6 : 0;
  return {
    insets: {
      top: clampTo(Math.max(turn ? turn.bottom : 0, coachTop), height),
      left: coach && coachDock === 'left' ? clampTo(coach.right + 8, width) : 0,
      right: clampTo(width - sideLeft, width),
      bottom: clampTo(Math.max(height - bottom.top, controls ? height - controls.top : 0), height),
    },
    avoid: {
      top: 0,
      right: 0,
      bottom: 0,
      left: dock && dock.left < width / 2 ? clampTo(dock.right + 8, width) : 0,
    },
  };
}

/**
 * Small "Fit board" button (top-left, under the menu) that recenters the board camera. Lives
 * outside the HUD root (the HUD re-renders its own children); hidden while the HUD is covered.
 */
export function createFitButton(onFit: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'board-fit';
  btn.title = 'Fit board';
  btn.setAttribute('aria-label', 'Fit board');
  btn.innerHTML =
    '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" ' +
    'stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/><circle cx="12" cy="12" r="2.2"/></svg>';
  btn.addEventListener('click', onFit);
  return btn;
}
