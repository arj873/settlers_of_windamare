/**
 * Piece-style previews for the profile dialogs (PR1): a settlement and a city of one style in one
 * colour, drawn by the real painters (pieceStyles.ts) with the board's renderer (s18; before the
 * board exists, a small offscreen one) and handed out as PNG data URLs (cached). Where WebGL is
 * unavailable (tests, old devices) previews resolve to null and the UI shows the name only.
 */
import { autoDetectRenderer, Color, Container, Graphics, Rectangle, type Renderer } from 'pixi.js';
import { HEX_SIZE as S } from './geometry';
import { pieceStyle } from './pieceStyles';

/** The preview's box in design px (hex sizes * S): settlement on the left, city on the right. */
const W = 1.05 * S;
const H = 0.62 * S;

let renderer: Promise<Renderer | null> | null = null;
const cache = new Map<string, Promise<HTMLCanvasElement | null>>();

/**
 * s18: draw previews with the board's renderer. A renderer of their own was a second WebGL
 * context: ~0.8 s to open the profile dialog on a slow device, and GPU memory a phone lacks.
 */
export function usePreviewRenderer(r: Renderer): void {
  renderer = Promise.resolve(r);
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

function shared(): Promise<Renderer | null> {
  renderer ??= autoDetectRenderer({
    preference: 'webgl',
    width: 8,
    height: 8,
    backgroundAlpha: 0,
    antialias: true,
    // Like the board's (app.ts): none of Pixi's browser extras.
    skipExtensionImports: true,
  }).catch((e: unknown) => {
    console.warn('piece style previews unavailable', e);
    return null;
  });
  return renderer;
}

/**
 * A canvas picturing `styleId` in `color` (CSS), `px` CSS pixels wide (height ≈ 0.59 of it), at
 * the screen's pixel ratio, to copy from (it is shared). null when previews are unavailable.
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
    hit = inTurn(() => draw(styleId, color, (px / W) * dpr)).catch(() => null);
    cache.set(key, hit);
  }
  return hit;
}

async function draw(
  styleId: string,
  css: string,
  resolution: number,
): Promise<HTMLCanvasElement | null> {
  const r = await shared();
  if (!r) return null;
  const color = new Color(css).toNumber();
  const style = pieceStyle(styleId);
  const root = new Container();
  const g = new Graphics();
  // Base line a little below the middle; the city stands taller.
  style.settlement(g, 0.24 * S, 0.42 * S, color);
  style.city(g, 0.7 * S, 0.42 * S, color);
  root.addChild(g);
  try {
    return r.extract.canvas({
      target: root,
      frame: new Rectangle(0, 0, W, H),
      resolution,
      antialias: true,
      clearColor: [0, 0, 0, 0],
    }) as HTMLCanvasElement;
  } finally {
    root.destroy({ children: true });
  }
}
