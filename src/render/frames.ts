/**
 * Render on demand. Pixi's app ticker draws the stage every animation frame; the board only
 * needs a frame when something changed (state, highlights, hover, camera, resize) or while
 * something moves (glow pulse, pop-in, robber travel, a pending text re-raster). The view calls
 * `invalidate()` on every change and `endFrame(animating)` from its ticker listener, which runs
 * before the stage is drawn: the ticker stops after the first frame with nothing animating.
 */

/** The slice of Pixi's `Ticker` the scheduler drives. */
export interface FrameTicker {
  readonly started: boolean;
  start(): void;
  stop(): void;
}

/**
 * s17 "Performance: Auto": is this device too slow for the full board? Fed the interval between
 * consecutive frames while the board animates (glows, pop-ins), so idle gaps never count. The
 * first frames of an animation (shader compiles, texture uploads) are skipped; after `need`
 * samples the median decides once: slower than `slowMs` (about 35 fps) is slow.
 */
export class FrameRateProbe {
  private readonly samples: number[] = [];
  private skipped = 0;
  private done = false;

  constructor(
    private readonly need = 40,
    private readonly slowMs = 28,
    private readonly skip = 8,
  ) {}

  /** One frame interval (ms); the verdict once, when it is known, else null. */
  add(dtMs: number): 'slow' | 'fast' | null {
    if (this.done) return null;
    if (this.skipped < this.skip) {
      this.skipped++;
      return null;
    }
    this.samples.push(dtMs);
    if (this.samples.length < this.need) return null;
    this.done = true;
    const sorted = [...this.samples].sort((a, b) => a - b);
    const median = sorted[sorted.length >> 1] ?? 0;
    return median > this.slowMs ? 'slow' : 'fast';
  }
}

export class FrameScheduler {
  constructor(private readonly ticker: FrameTicker) {}

  /** Something changed: draw (at least) one more frame. */
  invalidate(): void {
    if (!this.ticker.started) this.ticker.start();
  }

  /** Called once per frame, before the draw; this frame is still drawn either way. */
  endFrame(animating: boolean): void {
    if (!animating && this.ticker.started) this.ticker.stop();
  }
}
