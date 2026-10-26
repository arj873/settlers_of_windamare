/**
 * Pan / zoom / tap controller. Owns the `ViewTransform` and translates DOM pointer events on the
 * canvas into view changes (drag = pan, wheel = zoom at cursor, two-finger pinch) and into
 * `onTap` / `onHover` callbacks in canvas-relative CSS pixels.
 */
import type { Point } from '../engine';
import {
  clampView,
  fitView,
  screenToUnit,
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

const TAP_SLOP = 6;
const MIN_ZOOM = 0.55; // relative to the fitted scale
const MAX_ZOOM = 7;
const PADDING = 12;
/** Ignore insets that would shrink the board below this fraction of the full-screen fit. */
const MIN_INSET_FIT = 0.6;

export class Viewport {
  view: ViewTransform = { x: 0, y: 0, scale: 1 };
  /** True until the user pans or zooms; then resize keeps their framing instead of refitting. */
  private fitted = true;
  private fitScale = 1;
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
    this.listen(c, 'pointerleave', this.onLeave);
    this.listen(c, 'wheel', this.onWheel, { passive: false });
    this.listen(c, 'dblclick', () => this.fit());
    this.fit();
  }

  private insets: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

  /** Reset to the fitted framing. */
  fit() {
    const { width, height } = this.o.getSize();
    const v = this.fitFor(width, height);
    this.fitScale = v.scale;
    this.fitted = true;
    this.set(v);
  }

  /** New board bounds (a different map was loaded): refit. */
  setBounds(bounds: Rect) {
    this.o.bounds = bounds;
    this.fit();
  }

  /** Keep the fitted board clear of overlays; refits unless the user has moved the view. */
  setInsets(insets: Insets) {
    const i = this.insets;
    if (
      i.top === insets.top &&
      i.right === insets.right &&
      i.bottom === insets.bottom &&
      i.left === insets.left
    ) {
      return;
    }
    this.insets = { ...insets };
    this.resize();
  }

  /** Fitted view for a screen size, inside the insets when they leave enough room. */
  private fitFor(width: number, height: number): ViewTransform {
    const full = fitView(this.o.bounds, width, height, PADDING);
    const { top, right, bottom, left } = this.insets;
    const inner = fitView(
      this.o.bounds,
      Math.max(1, width - left - right),
      Math.max(1, height - top - bottom),
      PADDING,
    );
    if (inner.scale < full.scale * MIN_INSET_FIT) return full;
    return { scale: inner.scale, x: inner.x + left, y: inner.y + top };
  }

  /** Call when the screen size changed. */
  resize() {
    if (this.fitted) {
      this.fit();
      return;
    }
    // Keep the user's framing: same unit point at the center, same zoom relative to the fit.
    const { width, height } = this.o.getSize();
    const relZoom = this.view.scale / this.fitScale;
    const old = this.lastSize;
    const center = screenToUnit(this.view, { x: old.width / 2, y: old.height / 2 });
    const f = this.fitFor(width, height);
    this.fitScale = f.scale;
    const scale = f.scale * relZoom;
    this.set({ scale, x: width / 2 - center.x * scale, y: height / 2 - center.y * scale });
  }

  dispose() {
    for (const fn of this.cleanup) fn();
    this.cleanup.length = 0;
  }

  private lastSize = { width: 1, height: 1 };

  private set(view: ViewTransform) {
    const size = this.o.getSize();
    this.lastSize = size;
    this.view = clampView(view, this.o.bounds, size.width, size.height);
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

  private onDown = (e: PointerEvent) => {
    const p = this.local(e);
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
    if (!prev) {
      if (e.pointerType === 'mouse') this.o.onHover(p);
      return;
    }
    this.pointers.set(e.pointerId, p);

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
  };

  private onUp = (e: PointerEvent) => {
    const p = this.local(e);
    const wasTap = this.pointers.size === 1 && !this.dragging && this.downAt !== null;
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    if (this.pointers.size === 0) {
      this.downAt = null;
      this.dragging = false;
      this.o.canvas.style.cursor = '';
    }
    if (wasTap) this.o.onTap(p);
    if (e.pointerType === 'mouse') this.o.onHover(p);
  };

  private onCancel = (e: PointerEvent) => {
    this.pointers.delete(e.pointerId);
    this.pinch = null;
    if (this.pointers.size === 0) {
      this.downAt = null;
      this.dragging = false;
      this.o.canvas.style.cursor = '';
    }
  };

  private onLeave = (e: PointerEvent) => {
    if (!this.pointers.has(e.pointerId)) this.o.onHover(null);
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    const factor = Math.exp(-e.deltaY * unit * 0.0016);
    this.userChange(zoomAt(this.view, factor, this.local(e), this.minScale(), this.maxScale()));
  };

  private minScale = () => this.fitScale * MIN_ZOOM;
  private maxScale = () => this.fitScale * MAX_ZOOM;

  /** Screen position of a unit-space point under the current view. */
  toScreen(p: Point): Point {
    return unitToScreen(this.view, p);
  }
}
