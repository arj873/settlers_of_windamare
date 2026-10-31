// @vitest-environment jsdom
// Which renderer draws a piece-style preview, and what happens when one comes out blank. Real
// WebGL is checked in the browser (scripts/perf/flows.mjs, "previews"); here the renderers are
// fakes that hand back pixels.
import type * as Pixi from 'pixi.js';
import { RendererType, type Renderer } from 'pixi.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const detect = vi.hoisted(() => vi.fn());
vi.mock('pixi.js', async (importOriginal) => ({
  ...(await importOriginal<typeof Pixi>()),
  autoDetectRenderer: detect,
}));

/** 2 x 1 px: one transparent pixel, one red. */
const DRAWN = () => new Uint8ClampedArray([0, 0, 0, 0, 214, 69, 65, 255]);
const BLANK = () => new Uint8ClampedArray(8);

function fakeRenderer(opts: {
  type?: RendererType;
  lost?: boolean;
  pixels?: () => Uint8ClampedArray;
}) {
  const pixels = vi.fn(() => ({ pixels: (opts.pixels ?? DRAWN)(), width: 2, height: 1 }));
  const renderer = {
    type: opts.type ?? RendererType.WEBGL,
    gl: { isContextLost: () => opts.lost ?? false },
    extract: { pixels },
  } as unknown as Renderer;
  return { renderer, pixels };
}

/** A fresh module (renderers, caches and the warning are module state). */
const load = async () => {
  vi.resetModules();
  return import('./stylePreview');
};

const realGetContext = HTMLCanvasElement.prototype.getContext;
let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  // testSetup.ts gives jsdom canvases no context; previews need putImageData.
  HTMLCanvasElement.prototype.getContext = (() => ({
    createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    putImageData: () => undefined,
  })) as unknown as HTMLCanvasElement['getContext'];
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  HTMLCanvasElement.prototype.getContext = realGetContext;
  warn.mockRestore();
  detect.mockReset();
});

describe('piece style previews', () => {
  it('draws with the board renderer while its WebGL context is live', async () => {
    const m = await load();
    const board = fakeRenderer({});
    m.usePreviewRenderer(board.renderer);
    const art = await m.pieceStylePreview('keep', '#d64541');
    expect(art?.width).toBe(2);
    expect(board.pixels).toHaveBeenCalledTimes(1);
    expect(detect).not.toHaveBeenCalled();
  });

  it('draws with the Canvas 2D renderer when the board context is lost', async () => {
    const m = await load();
    const board = fakeRenderer({ lost: true });
    const canvas = fakeRenderer({ type: RendererType.CANVAS });
    detect.mockResolvedValue(canvas.renderer);
    m.usePreviewRenderer(board.renderer);
    expect(await m.pieceStylePreview('pagoda', '#3a7bd5')).not.toBeNull();
    expect(board.pixels).not.toHaveBeenCalled();
    expect(detect).toHaveBeenCalledWith(expect.objectContaining({ preference: 'canvas' }));
    expect(warn).not.toHaveBeenCalled();
  });

  it('draws with the Canvas 2D renderer before the board exists', async () => {
    const m = await load();
    const canvas = fakeRenderer({ type: RendererType.CANVAS });
    detect.mockResolvedValue(canvas.renderer);
    expect(await m.pieceStylePreview('classic', '#d64541')).not.toBeNull();
    expect(canvas.pixels).toHaveBeenCalledTimes(1);
  });

  it('tries the Canvas 2D renderer when the board draws a blank picture', async () => {
    const m = await load();
    const board = fakeRenderer({ pixels: BLANK });
    const canvas = fakeRenderer({ type: RendererType.CANVAS });
    detect.mockResolvedValue(canvas.renderer);
    m.usePreviewRenderer(board.renderer);
    expect(await m.pieceStylePreview('adobe', '#d64541')).not.toBeNull();
    expect(board.pixels).toHaveBeenCalledTimes(1);
    expect(canvas.pixels).toHaveBeenCalledTimes(1);
  });

  it('a preview that cannot be drawn warns once and is drawn again next time', async () => {
    const m = await load();
    let pixels = BLANK;
    const board = fakeRenderer({ pixels: () => pixels() });
    detect.mockResolvedValue(fakeRenderer({ type: RendererType.CANVAS, pixels: BLANK }).renderer);
    m.usePreviewRenderer(board.renderer);
    expect(await m.pieceStylePreview('timber', '#d64541')).toBeNull();
    expect(await m.pieceStylePreview('longhouse', '#d64541')).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/Piece style previews failed/);
    // The board draws again (its context came back): the failure was not cached.
    pixels = DRAWN;
    expect(await m.pieceStylePreview('timber', '#d64541')).not.toBeNull();
  });
});
