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
