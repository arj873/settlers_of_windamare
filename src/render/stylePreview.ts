/**
 * Piece-style previews for the profile dialogs (PR1): a settlement and a city of one style in one
 * colour, drawn by the real painters (pieceStyles.ts) and handed out as canvases (cached). Drawn
 * with the board's renderer (s18); before the board exists, or when its WebGL context is lost,
 * with Pixi's Canvas 2D renderer. A preview that cannot be drawn resolves to null (the UI shows
 * the name only), warns once, and is tried again the next time it is asked for.
 */
import {
  autoDetectRenderer,
  Color,
  Container,
  Graphics,
  Rectangle,
  RendererType,
  type Renderer,
  type WebGLRenderer,
} from 'pixi.js';
import { HEX_SIZE as S } from './geometry';
import { pieceStyle } from './pieceStyles';

/** The preview's box in design px (hex sizes * S): settlement on the left, city on the right. */
const W = 1.05 * S;
const H = 0.62 * S;

let board: Renderer | null = null;
let fallback: Promise<Renderer | null> | null = null;
const cache = new Map<string, Promise<HTMLCanvasElement | null>>();

/**
 * s18: draw previews with the board's renderer. A renderer of their own was a second WebGL
 * context: ~0.8 s to open the profile dialog on a slow device, and GPU memory a phone lacks.
 */
export function usePreviewRenderer(r: Renderer): void {
  board = r;
}

/**
 * One preview per frame, after it (s18): the dialog that asks for them paints first, and stays
 * responsive while they fill in.
 */
let turn: Promise<unknown> = Promise.resolve();
const afterFrame = () =>
  new Promise<void>((r) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => setTimeout(r, 0));
    } else setTimeout(r, 0);
  });
function inTurn<T>(job: () => Promise<T>): Promise<T> {
  const run = turn.then(afterFrame).then(job);
  turn = run.catch(() => undefined);
  return run;
}

/**
 * The board's WebGL context is gone: browsers drop it for a phone's background tab, a GPU reset
 * or too many contexts, and the board sits unseen behind the home and join screens. Read back
 * meanwhile, every pixel is 0 and nothing throws: blank previews, kept in the caches for good
 * (the "names only" Profile dialog after s18).
 */
function contextLost(r: Renderer): boolean {
  return r.type === RendererType.WEBGL && (r as WebGLRenderer).gl.isContextLost();
}

/**
 * Pixi's Canvas 2D renderer: no GPU context to open (slow on a weak device) or to lose. Its
 * previews look the same as the WebGL ones.
 */
function canvasRenderer(): Promise<Renderer | null> {
  fallback ??= autoDetectRenderer({
    preference: 'canvas',
    width: 8,
    height: 8,
    backgroundAlpha: 0,
    antialias: true,
    // Like the board's (app.ts): none of Pixi's browser extras.
    skipExtensionImports: true,
  }).catch((e: unknown) => {
    warnOnce('no renderer for them', e);
    return null;
  });
  return fallback;
}

let warned = false;
function warnOnce(why: string, detail?: unknown): void {
  if (warned) return;
  warned = true;
  console.warn(`Piece style previews failed (${why}): the dialogs show names only.`, detail ?? '');
}

/**
 * A canvas picturing `styleId` in `color` (CSS), `px` CSS pixels wide (height ≈ 0.59 of it), at
 * the screen's pixel ratio, to copy from (it is shared). null when it cannot be drawn.
 * s18: a canvas, not a PNG data URL: encoding the PNG was half the cost of a preview.
 */
export function pieceStylePreview(
  styleId: string,
  color: string,
  px = 120,
): Promise<HTMLCanvasElement | null> {
  const dpr = typeof window !== 'undefined' ? Math.min(3, window.devicePixelRatio || 1) : 1;
  const key = `${styleId}|${color}|${px}|${dpr}`;
  let hit = cache.get(key);
  if (!hit) {
    hit = inTurn(() => draw(styleId, color, (px / W) * dpr)).catch((e: unknown) => {
      warnOnce(`"${styleId}" threw`, e);
      return null;
    });
    cache.set(key, hit);
    // A failure is not kept: the next dialog tries again (the board's context may be back).
    void hit.then((art) => {
      if (!art) cache.delete(key);
    });
  }
  return hit;
}

async function draw(
  styleId: string,
  css: string,
  resolution: number,
): Promise<HTMLCanvasElement | null> {
  let boardError: unknown;
  if (board && !contextLost(board)) {
    try {
      const art = paint(board, styleId, css, resolution);
      if (art) return art;
    } catch (e) {
      boardError = e;
    }
  }
  const r = await canvasRenderer();
  if (!r) return null;
  const art = paint(r, styleId, css, resolution);
  if (!art) warnOnce(`"${styleId}" came out blank`, boardError);
  return art;
}

/** Some pixel is not fully transparent (RGBA bytes). */
function drawn(pixels: Uint8Array | Uint8ClampedArray): boolean {
  for (let i = 3; i < pixels.length; i += 4) if (pixels[i] !== 0) return true;
  return false;
}

/** The preview drawn with `r`, or null when it came out blank (every pixel transparent). */
function paint(
  r: Renderer,
  styleId: string,
  css: string,
  resolution: number,
): HTMLCanvasElement | null {
  const color = new Color(css).toNumber();
  const style = pieceStyle(styleId);
  const root = new Container();
  const g = new Graphics();
  // Base line a little below the middle; the city stands taller.
  style.settlement(g, 0.24 * S, 0.42 * S, color);
  style.city(g, 0.7 * S, 0.42 * S, color);
  root.addChild(g);
  try {
    const { pixels, width, height } = r.extract.pixels({
      target: root,
      frame: new Rectangle(0, 0, W, H),
      resolution,
      antialias: true,
      clearColor: [0, 0, 0, 0],
    });
    if (!drawn(pixels)) return null;
    // What `extract.canvas` does, where a missing 2D context (iOS canvas memory cap) is seen.
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const image = ctx.createImageData(width, height);
    image.data.set(pixels);
    ctx.putImageData(image, 0, 0);
    return canvas;
  } finally {
    root.destroy({ children: true });
  }
}
