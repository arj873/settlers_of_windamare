import { describe, expect, it } from 'vitest';
import { FrameRateProbe, FrameScheduler, type FrameTicker } from './frames';

describe('FrameRateProbe (s17)', () => {
  const feed = (probe: FrameRateProbe, dts: number[]) => dts.map((d) => probe.add(d));

  it('skips the first frames, then decides once on the median', () => {
    const probe = new FrameRateProbe(5, 28, 2);
    // Two slow warm-up frames do not count; five fast ones decide.
    expect(feed(probe, [200, 200, 16, 17, 16, 40, 17])).toEqual([
      null,
      null,
      null,
      null,
      null,
      null,
      'fast',
    ]);
    expect(probe.add(500)).toBeNull(); // decided already
  });

  it('calls a device slow when most frames miss ~35 fps', () => {
    const probe = new FrameRateProbe(5, 28, 0);
    expect(feed(probe, [33, 50, 16, 66, 40]).at(-1)).toBe('slow');
  });
});

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
