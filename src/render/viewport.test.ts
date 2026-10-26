import { describe, expect, it } from 'vitest';
import type { Point } from '../engine';
import { topologyFor } from '../engine';
import { boardBounds, fitBounds, fitView, unitToScreen, type ViewTransform } from './geometry';
import {
  FIT_PADDING,
  MIN_INSET_FIT,
  NO_INSETS,
  TAP_SLOP,
  Viewport,
  fitBoardView,
  type Insets,
} from './viewport';

const BOUNDS = boardBounds(topologyFor('base56'));
const HUD: Insets = { top: 56, right: 360, bottom: 118, left: 0 };
const DOCK: Insets = { top: 0, right: 0, bottom: 0, left: 353 };

describe('fitBoardView', () => {
  it('fits the free area inside the insets', () => {
    const v = fitBoardView(BOUNDS, 1600, 1000, HUD);
    const inner = fitView(BOUNDS, 1600 - 360, 1000 - 56 - 118, FIT_PADDING);
    expect(v).toEqual({ scale: inner.scale, x: inner.x, y: inner.y + 56 });
    // The whole board is inside the free area.
    const tl = unitToScreen(v, { x: BOUNDS.minX, y: BOUNDS.minY });
    const br = unitToScreen(v, { x: BOUNDS.maxX, y: BOUNDS.maxY });
    expect(tl.x).toBeGreaterThanOrEqual(0);
    expect(tl.y).toBeGreaterThanOrEqual(56);
    expect(br.x).toBeLessThanOrEqual(1600 - 360);
    expect(br.y).toBeLessThanOrEqual(1000 - 118);
  });

  it('falls back to the full screen when the insets leave too little room', () => {
    const full = fitView(BOUNDS, 1000, 700, FIT_PADDING);
    const v = fitBoardView(BOUNDS, 1000, 700, { top: 300, right: 500, bottom: 200, left: 0 });
    expect(v).toEqual(full);
    expect(fitBoardView(BOUNDS, 1000, 700, HUD).scale).toBeGreaterThanOrEqual(
      full.scale * MIN_INSET_FIT,
    );
  });

  it('never zooms past the full-screen fit, whatever the measured margins', () => {
    const full = fitView(BOUNDS, 1600, 1000, FIT_PADDING);
    for (const weird of [
      { top: -800, right: 0, bottom: -1300, left: 0 },
      { top: Number.NaN, right: -400, bottom: Infinity, left: -50 },
    ]) {
      expect(fitBoardView(BOUNDS, 1600, 1000, weird, weird).scale).toBeLessThanOrEqual(full.scale);
    }
  });

  it('slides away from a docked card without zooming, as far as the free area allows', () => {
    const base = fitBoardView(BOUNDS, 1600, 1000, HUD);
    const docked = fitBoardView(BOUNDS, 1600, 1000, HUD, DOCK);
    expect(docked.scale).toBe(base.scale);
    expect(docked.y).toBe(base.y);
    expect(docked.x).toBeGreaterThan(base.x);
    // ... but never under the sidebar.
    const right = unitToScreen(docked, { x: BOUNDS.maxX, y: 0 }).x;
    expect(right).toBeLessThanOrEqual(1600 - 360 - FIT_PADDING + 1e-9);
    // No room at all (board already spans the free width): it stays put.
    const tight = fitBoardView(BOUNDS, 900, 2000, NO_INSETS, DOCK);
    expect(tight).toEqual(fitBoardView(BOUNDS, 900, 2000));
  });

  it('restores exactly when the overlay goes away', () => {
    const base = fitBoardView(BOUNDS, 1366, 768, HUD);
    fitBoardView(BOUNDS, 1366, 768, HUD, DOCK);
    expect(fitBoardView(BOUNDS, 1366, 768, HUD, NO_INSETS)).toEqual(base);
  });
});

describe('fitted board on a real screen (BUG-B2)', () => {
  // 1918x938, base78, Wood theme, setup phase: pill bottom 56, sidebar 360, hand/controls 118.
  const topo = topologyFor('base78');
  const free = { top: 56, bottom: 938 - 118, left: 0, right: 1918 - 360 };
  const landSpan = (v: ViewTransform) => {
    const ys = topo.landHexes.map((id) => topo.hex[id]?.y ?? 0);
    return (Math.max(...ys) - Math.min(...ys) + 2) * v.scale;
  };

  it('fills the free height with the island, harbors included', () => {
    const v = fitBoardView(fitBounds(topo), 1918, 938, HUD);
    const height = free.bottom - free.top;
    expect(landSpan(v) / height).toBeGreaterThan(0.75);
    const fit = fitBounds(topo);
    const tl = unitToScreen(v, { x: fit.minX, y: fit.minY });
    const br = unitToScreen(v, { x: fit.maxX, y: fit.maxY });
    expect(tl.x).toBeGreaterThanOrEqual(free.left);
    expect(tl.y).toBeGreaterThanOrEqual(free.top);
    expect(br.x).toBeLessThanOrEqual(free.right);
    expect(br.y).toBeLessThanOrEqual(free.bottom);
    // The old fit (whole sea backdrop + frame) left the island ~30% smaller.
    const old = fitBoardView(boardBounds(topo), 1918, 938, HUD);
    expect(v.scale / old.scale).toBeGreaterThan(1.15);
  });

  it('frames fitBounds, while the clamp still uses the whole board', () => {
    const canvas = new FakeCanvas();
    const vp = new Viewport({
      canvas: canvas as unknown as HTMLCanvasElement,
      bounds: boardBounds(topo),
      fitBounds: fitBounds(topo),
      getSize: () => ({ width: 1918, height: 938 }),
      onChange: () => undefined,
      onTap: () => undefined,
      onHover: () => undefined,
    });
    vp.setInsets(HUD);
    expect(vp.view).toEqual(fitBoardView(fitBounds(topo), 1918, 938, HUD));
    vp.setBounds(boardBounds(), fitBounds());
    expect(vp.view).toEqual(fitBoardView(fitBounds(), 1918, 938, HUD));
    vp.dispose();
  });
});

// ---------------------------------------------------------------------------
// Viewport (fake canvas, synthetic pointer events)
// ---------------------------------------------------------------------------

class FakeCanvas extends EventTarget {
  style: Record<string, string> = {};
  getBoundingClientRect() {
    return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
  }
  setPointerCapture() {}
}

function setup(width = 1600, height = 1000) {
  const canvas = new FakeCanvas();
  const size = { width, height };
  const taps: Point[] = [];
  const vp = new Viewport({
    canvas: canvas as unknown as HTMLCanvasElement,
    bounds: BOUNDS,
    getSize: () => ({ ...size }),
    onChange: () => undefined,
    onTap: (p) => taps.push(p),
    onHover: () => undefined,
  });
  const fire = (type: string, props: Record<string, unknown> = {}) => {
    const e = Object.assign(new Event(type, { cancelable: true }), {
      clientX: 0,
      clientY: 0,
      pointerId: 1,
      pointerType: 'mouse',
      buttons: 0,
      deltaY: 0,
      deltaMode: 0,
      ...props,
    });
    canvas.dispatchEvent(e);
  };
  const down = (x: number, y: number, extra: Record<string, unknown> = {}) =>
    fire('pointerdown', { clientX: x, clientY: y, buttons: 1, ...extra });
  const move = (x: number, y: number, extra: Record<string, unknown> = {}) =>
    fire('pointermove', { clientX: x, clientY: y, buttons: 1, ...extra });
  const up = (x: number, y: number, extra: Record<string, unknown> = {}) =>
    fire('pointerup', { clientX: x, clientY: y, buttons: 0, ...extra });
  /** Playwright's `mouse.click`: hover move, press, release at one point. */
  const click = (x: number, y: number) => {
    move(x, y, { buttons: 0 });
    down(x, y);
    up(x, y);
  };
  return { vp, size, taps, fire, down, move, up, click };
}

const copy = (v: ViewTransform) => ({ ...v });

describe('Viewport camera modes', () => {
  it('a click is a tap and never moves the camera', () => {
    const { vp, taps, click, down, move, up } = setup();
    const fitted = copy(vp.view);
    click(500, 400);
    // Jitter inside the slop is still a tap.
    down(600, 300);
    move(600 + TAP_SLOP - 1, 300);
    up(600 + TAP_SLOP - 1, 300);
    expect(taps).toHaveLength(2);
    expect(vp.isFitted).toBe(true);
    expect(vp.view).toEqual(fitted);
  });

  it('a pressed drag past the slop pans and switches to the manual camera', () => {
    const { vp, taps, down, move, up } = setup();
    const x0 = vp.view.x;
    down(500, 400);
    move(520, 400);
    move(560, 410);
    up(560, 410);
    expect(taps).toHaveLength(0);
    expect(vp.isFitted).toBe(false);
    expect(vp.view.x).toBeCloseTo(x0 + 60);
  });

  it('a missed pointerup never turns the next hover into a drag', () => {
    const { vp, taps, down, move, click } = setup();
    const fitted = copy(vp.view);
    down(500, 400); // the release happens off the canvas and is never seen
    move(900, 700, { buttons: 0 }); // mouse moves to the next button: just a hover
    click(300, 300);
    expect(vp.isFitted).toBe(true);
    expect(vp.view).toEqual(fitted);
    expect(taps).toEqual([{ x: 300, y: 300 }]);
  });

  it('a second mouse press (missed release) is never a pinch', () => {
    const { vp, taps, down, move, up } = setup();
    const fitted = copy(vp.view);
    down(500, 400, { pointerId: 1 });
    down(200, 200, { pointerId: 2 }); // some engines hand out a fresh id
    move(202, 201, { pointerId: 2 });
    up(202, 201, { pointerId: 2 });
    expect(vp.view).toEqual(fitted);
    expect(taps).toHaveLength(1);
  });

  it('two-finger pinch still zooms', () => {
    const { vp, down, move } = setup();
    const s0 = vp.view.scale;
    down(400, 400, { pointerId: 11, pointerType: 'touch' });
    down(600, 400, { pointerId: 12, pointerType: 'touch' });
    move(700, 400, { pointerId: 12, pointerType: 'touch' });
    expect(vp.view.scale).toBeGreaterThan(s0);
    expect(vp.isFitted).toBe(false);
  });

  it('wheel zooms (manual); double-click and fit() refit exactly', () => {
    const { vp, fire } = setup();
    const fitted = copy(vp.view);
    fire('wheel', { clientX: 300, clientY: 300, deltaY: -240 });
    expect(vp.view.scale).toBeGreaterThan(fitted.scale);
    expect(vp.isFitted).toBe(false);
    fire('dblclick');
    expect(vp.isFitted).toBe(true);
    expect(vp.view).toEqual(fitted);
    fire('wheel', { clientX: 300, clientY: 300, deltaY: 120 });
    vp.fit();
    expect(vp.view).toEqual(fitted);
  });

  it('inset changes refit the fitted camera but leave a manual one alone', () => {
    const { vp, fire } = setup();
    vp.setInsets(HUD);
    expect(vp.view).toEqual(fitBoardView(BOUNDS, 1600, 1000, HUD));
    vp.setInsets(HUD, DOCK);
    expect(vp.view).toEqual(fitBoardView(BOUNDS, 1600, 1000, HUD, DOCK));
    fire('wheel', { clientX: 300, clientY: 300, deltaY: -240 });
    const manual = copy(vp.view);
    vp.setInsets(HUD);
    vp.setInsets({ ...HUD, top: 120 }, DOCK);
    expect(vp.view).toEqual(manual);
    // The next fit uses the latest margins.
    vp.fit();
    expect(vp.view).toEqual(fitBoardView(BOUNDS, 1600, 1000, { ...HUD, top: 120 }, DOCK));
  });

  it('a real resize refits even a manual camera; a no-op resize keeps it', () => {
    const { vp, size, fire } = setup();
    vp.setInsets(HUD);
    fire('wheel', { clientX: 300, clientY: 300, deltaY: -240 });
    const manual = copy(vp.view);
    vp.resize();
    expect(vp.view).toEqual(manual);
    size.width = 1366;
    size.height = 768;
    vp.resize();
    expect(vp.isFitted).toBe(true);
    expect(vp.view).toEqual(fitBoardView(BOUNDS, 1366, 768, HUD));
  });

  it('stays exactly fitted through hundreds of clicks, docks, dialogs and resizes', () => {
    const { vp, size, taps, click, down, up, move } = setup();
    let seed = 7;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    let insets = HUD;
    let avoid = NO_INSETS;
    let clicks = 0;
    for (let i = 0; i < 600; i++) {
      const r = rand();
      if (r < 0.15)
        avoid = avoid === NO_INSETS ? DOCK : NO_INSETS; // trade card docks / leaves
      else if (r < 0.25)
        insets = { ...HUD, top: 56 + Math.round(rand() * 20) }; // pill text
      else if (r < 0.3) {
        // Window resize between the two playtest sizes.
        const big = rand() < 0.5;
        size.width = big ? 1600 : 1366;
        size.height = big ? 1000 : 768;
        vp.resize();
      } else if (r < 0.35) {
        // A press whose release is lost, then the mouse travels to a HUD button.
        down(rand() * 1200, rand() * 900);
        move(rand() * 1600, rand() * 1000, { buttons: 0 });
      } else if (r < 0.4) {
        // A click with a pixel of jitter.
        const x = rand() * 1200;
        const y = rand() * 900;
        down(x, y);
        move(x + 1, y + 1);
        up(x + 1, y + 1);
        clicks++;
      } else {
        click(rand() * 1200, rand() * 900);
        clicks++;
      }
      vp.setInsets(insets, avoid);
      const want = fitBoardView(BOUNDS, size.width, size.height, insets, avoid);
      expect(vp.isFitted).toBe(true);
      expect(vp.view).toEqual(want);
      // Docking only ever slides the board: same scale as without the card.
      expect(vp.view.scale).toBe(fitBoardView(BOUNDS, size.width, size.height, insets).scale);
    }
    expect(taps.length).toBeGreaterThanOrEqual(clicks);
  });
});
