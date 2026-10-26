/**
 * Pan / zoom / tap controller. Owns the `ViewTransform` and translates DOM pointer events on the
 * canvas into view changes (drag = pan, wheel = zoom at cursor, two-finger pinch) and into
 * `onTap` / `onHover` callbacks in canvas-relative CSS pixels.
 *
 * Camera modes: the view starts *fitted* (`fitBoardView`) and follows every resize and inset
 * change. Only a real gesture (a pressed drag past `TAP_SLOP`, a wheel, a two-finger pinch)
 * switches to the *manual* camera, which inset changes leave alone. A window resize, a
 * double-click or `fit()` returns to the fitted camera.
 */
import type { Point } from '../engine';
import {
  clampView,
  fitView,
  unitToScreen,
  zoomAt,
  type Rect,
  type ViewTransform,
} from './geometry';

export interface ViewportOptions {
  canvas: HTMLCanvasElement;
  bounds: Rect;
  /** Current screen size in CSS px. */
  getSize: () => { width: number; height: number };
  onChange: (view: ViewTransform) => void;
  onTap: (p: Point) => void;
  /** null = pointer left the canvas or is dragging. */
  onHover: (p: Point | null) => void;
}

/** Screen margins (CSS px) covered by overlays; the fitted board stays inside them. */
export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

/** A pressed pointer must move this far (CSS px) before it pans instead of tapping. */
export const TAP_SLOP = 6;
const MIN_ZOOM = 0.55; // relative to the fitted scale
const MAX_ZOOM = 7;
export const FIT_PADDING = 12;
/** Ignore insets that would shrink the board below this fraction of the full-screen fit. */
export const MIN_INSET_FIT = 0.6;

const sameInsets = (a: Insets, b: Insets) =>
  a.top === b.top && a.right === b.right && a.bottom === b.bottom && a.left === b.left;

/** Negative or non-finite margins (panels measured off-screen) count as 0. */
const clean = (i: Insets): Insets => {
  const c = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);
  return { top: c(i.top), right: c(i.right), bottom: c(i.bottom), left: c(i.left) };
};

/**
 * The fitted view: `bounds` as large as possible inside the screen minus `insets` (the
 * permanent HUD), or the whole screen when that area is too small (`MIN_INSET_FIT`). `avoid`
 * margins (transient overlays, e.g. the docked trade card) only slide that framing, never zoom
 * it, and only as far as the free area allows. Pure: the same inputs give the same view.
 */
export function fitBoardView(
  bounds: Rect,
  width: number,
  height: number,
  insets: Insets = NO_INSETS,
  avoid: Insets = NO_INSETS,
): ViewTransform {
  const full = fitView(bounds, width, height, FIT_PADDING);
  const { top, right, bottom, left } = clean(insets);
  const inner = fitView(
    bounds,
    Math.max(1, width - left - right),
    Math.max(1, height - top - bottom),
    FIT_PADDING,
  );
  if (inner.scale < full.scale * MIN_INSET_FIT) return full;
  const view = { scale: inner.scale, x: inner.x + left, y: inner.y + top };

  // The board spans [lo, hi] on one axis, the free area is [min, max]; overlays cover the
  // first `near` / last `far` px. Slide away from them, never out of the free area.
  const slide = (lo: number, hi: number, min: number, max: number, near: number, far: number) => {
    const want = Math.max(0, near + FIT_PADDING - lo) - Math.max(0, hi - (far - FIT_PADDING));
    if (want > 0) return Math.min(want, Math.max(0, max - hi));
    if (want < 0) return -Math.min(-want, Math.max(0, lo - min));
    return 0;
  };
  const a = clean(avoid);
  const s = view.scale;
  const dx = slide(
    view.x + bounds.minX * s,
    view.x + bounds.maxX * s,
    left + FIT_PADDING,
    width - right - FIT_PADDING,
    a.left,
    width - a.right,
  );
  const dy = slide(
    view.y + bounds.minY * s,
    view.y + bounds.maxY * s,
    top + FIT_PADDING,
    height - bottom - FIT_PADDING,
    a.top,
    height - a.bottom,
  );
  return { scale: s, x: view.x + dx, y: view.y + dy };
}

export class Viewport {
  view: ViewTransform = { x: 0, y: 0, scale: 1 };
  /** True until a real pan / zoom gesture; while true every resize and inset change refits. */
  private fitted = true;
  private fitScale = 1;
  private insets: Insets = NO_INSETS;
  private avoid: Insets = NO_INSETS;
  private size = { width: 0, height: 0 };
  private readonly pointers = new Map<number, Point>();
  private downAt: Point | null = null;
  private dragging = false;
  private pinch: { dist: number; mid: Point } | null = null;
  private readonly cleanup: (() => void)[] = [];

  constructor(private readonly o: ViewportOptions) {
    const c = o.canvas;
    c.style.touchAction = 'none';
    this.listen(c, 'pointerdown', this.onDown);
    this.listen(c, 'pointermove', this.onMove);
    this.listen(c, 'pointerup', this.onUp);
    this.listen(c, 'pointercancel', this.onCancel);
    this.listen(c, 'lostpointercapture', this.onCancel);
    this.listen(c, 'pointerleave', this.onLeave);
    this.listen(c, 'wheel', this.onWheel, { passive: false });
    this.listen(c, 'dblclick', () => this.fit());
    this.fit();
  }

  /** False once the user panned or zoomed (until the next refit). */
  get isFitted(): boolean {
    return this.fitted;
  }

  /** Reset to the fitted framing. */
  fit() {
    const size = this.o.getSize();
    const v = fitBoardView(this.o.bounds, size.width, size.height, this.insets, this.avoid);
    this.size = size;
    this.fitScale = v.scale;
    this.fitted = true;
    this.set(v);
  }

  /** New board bounds (a different map was loaded): refit. */
  setBounds(bounds: Rect) {
    this.o.bounds = bounds;
    this.fit();
  }

  /**
   * Screen margins of the permanent HUD (`insets`) and of transient overlays that should slide
   * the board aside without zooming it (`avoid`). Refits the fitted camera; a manual camera
   * keeps its framing (the next fit uses the new margins).
   */
  setInsets(insets: Insets, avoid: Insets = NO_INSETS) {
    const next = clean(insets);
    const nextAvoid = clean(avoid);
    if (sameInsets(next, this.insets) && sameInsets(nextAvoid, this.avoid)) return;
    this.insets = next;
    this.avoid = nextAvoid;
    if (this.fitted) this.fit();
  }

  /** Call when the screen size may have changed: a real size change always refits. */
  resize() {
    const { width, height } = this.o.getSize();
    if (this.fitted || width !== this.size.width || height !== this.size.height) this.fit();
  }

  dispose() {
    for (const fn of this.cleanup) fn();
    this.cleanup.length = 0;
  }

  private set(view: ViewTransform) {
    const { width, height } = this.size;
    this.view = clampView(view, this.o.bounds, width, height);
    this.o.onChange(this.view);
  }

  private userChange(view: ViewTransform) {
    this.fitted = false;
    this.set(view);
  }

  private listen<K extends keyof HTMLElementEventMap>(
    el: HTMLElement,
    type: K,
    fn: (e: HTMLElementEventMap[K]) => void,
    opts?: AddEventListenerOptions,
  ) {
    const bound = fn.bind(this) as (e: HTMLElementEventMap[K]) => void;
    el.addEventListener(type, bound, opts);
    this.cleanup.push(() => el.removeEventListener(type, bound));
  }

  private local(e: PointerEvent | WheelEvent): Point {
    const r = this.o.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private pinchState(): { dist: number; mid: Point } | null {
    const [a, b] = [...this.pointers.values()];
    if (!a || !b) return null;
    return {
      dist: Math.hypot(a.x - b.x, a.y - b.y),
      mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    };
  }

  private release(pointerId: number) {
    this.pointers.delete(pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    if (this.pointers.size === 0) {
      this.downAt = null;
      this.dragging = false;
      this.o.canvas.style.cursor = '';
    }
  }

  private onDown = (e: PointerEvent) => {
    const p = this.local(e);
    // A mouse is one pointer: a press while another is still tracked means its release was
    // missed (it happened off the canvas). Start over so it can never count as a pinch.
    if (e.pointerType === 'mouse') for (const id of [...this.pointers.keys()]) this.release(id);
    this.pointers.set(e.pointerId, p);
    try {
      this.o.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic pointer ids can't be captured */
    }
    if (this.pointers.size === 1) {
      this.downAt = p;
      this.dragging = false;
    } else {
      this.downAt = null;
      this.dragging = true; // a second finger never produces a tap
      this.pinch = this.pinchState();
    }
    this.o.onHover(null);
  };

  private onMove = (e: PointerEvent) => {
    const p = this.local(e);
    const prev = this.pointers.get(e.pointerId);
    if (prev && e.buttons === 0) {
      // Released somewhere we never heard about: a hover, not a drag.
      this.release(e.pointerId);
    } else if (prev) {
      this.pointers.set(e.pointerId, p);
      this.drag(p, prev);
      return;
    }
    if (e.pointerType === 'mouse') this.o.onHover(p);
  };

  private drag(p: Point, prev: Point) {
    if (this.pointers.size >= 2) {
      const now = this.pinchState();
      if (now && this.pinch && this.pinch.dist > 0) {
        const zoomed = zoomAt(
          this.view,
          now.dist / this.pinch.dist,
          now.mid,
          this.minScale(),
          this.maxScale(),
        );
        this.userChange({
          ...zoomed,
          x: zoomed.x + now.mid.x - this.pinch.mid.x,
          y: zoomed.y + now.mid.y - this.pinch.mid.y,
        });
      }
      this.pinch = now;
      return;
    }

    if (
      !this.dragging &&
      this.downAt &&
      Math.hypot(p.x - this.downAt.x, p.y - this.downAt.y) > TAP_SLOP
    ) {
      this.dragging = true;
      this.o.canvas.style.cursor = 'grabbing';
    }
    if (this.dragging) {
      this.userChange({
        ...this.view,
        x: this.view.x + p.x - prev.x,
        y: this.view.y + p.y - prev.y,
      });
    }
  }

  private onUp = (e: PointerEvent) => {
    const p = this.local(e);
    const wasTap =
      this.pointers.has(e.pointerId) &&
      this.pointers.size === 1 &&
      !this.dragging &&
      this.downAt !== null;
    this.release(e.pointerId);
    if (wasTap) this.o.onTap(p);
    if (e.pointerType === 'mouse') this.o.onHover(p);
  };

  private onCancel = (e: PointerEvent) => {
    this.release(e.pointerId);
  };

  private onLeave = (e: PointerEvent) => {
    if (!this.pointers.has(e.pointerId)) this.o.onHover(null);
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    const factor = Math.exp(-e.deltaY * unit * 0.0016);
    if (factor === 1) return;
    this.userChange(zoomAt(this.view, factor, this.local(e), this.minScale(), this.maxScale()));
  };

  private minScale = () => this.fitScale * MIN_ZOOM;
  private maxScale = () => this.fitScale * MAX_ZOOM;

  /** Screen position of a unit-space point under the current view. */
  toScreen(p: Point): Point {
    return unitToScreen(this.view, p);
  }
}
