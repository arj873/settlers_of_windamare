import { describe, expect, it } from 'vitest';
import { FrameScheduler, type FrameTicker } from './frames';

function fakeTicker() {
  const t = {
    started: true,
    starts: 0,
    stops: 0,
    start() {
      if (!t.started) t.starts++;
      t.started = true;
    },
    stop() {
      t.stops++;
      t.started = false;
    },
  };
  return t satisfies FrameTicker;
}

describe('FrameScheduler', () => {
  it('stops the ticker after a frame with nothing animating', () => {
    const t = fakeTicker();
    new FrameScheduler(t).endFrame(false);
    expect(t.started).toBe(false);
  });

  it('keeps the ticker running while something animates', () => {
    const t = fakeTicker();
    const f = new FrameScheduler(t);
    f.endFrame(true);
    f.endFrame(true);
    expect(t.started).toBe(true);
    expect(t.stops).toBe(0);
  });

  it('restarts a stopped ticker on invalidate, once', () => {
    const t = fakeTicker();
    const f = new FrameScheduler(t);
    f.endFrame(false);
    f.invalidate();
    f.invalidate();
    expect(t.started).toBe(true);
    expect(t.starts).toBe(1);
    f.endFrame(false);
    expect(t.started).toBe(false);
  });
});
