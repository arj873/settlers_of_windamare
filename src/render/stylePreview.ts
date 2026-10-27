/**
 * Piece-style previews for the profile dialogs (PR1): a settlement and a city of one style in one
 * colour, drawn by the real painters (pieceStyles.ts) on a small offscreen Pixi renderer and
 * handed out as PNG data URLs (cached). One shared renderer for the whole page; where WebGL is
 * unavailable (tests, old devices) previews resolve to null and the UI shows the name only.
 */
import { autoDetectRenderer, Color, Container, Graphics, Rectangle, type Renderer } from 'pixi.js';
import { HEX_SIZE as S } from './geometry';
import { pieceStyle } from './pieceStyles';

/** The preview's box in design px (hex sizes * S): settlement on the left, city on the right. */
const W = 1.05 * S;
const H = 0.62 * S;

let renderer: Promise<Renderer | null> | null = null;
const cache = new Map<string, Promise<string | null>>();

function shared(): Promise<Renderer | null> {
  renderer ??= autoDetectRenderer({
    preference: 'webgl',
    width: 8,
    height: 8,
    backgroundAlpha: 0,
    antialias: true,
  }).catch((e: unknown) => {
    console.warn('piece style previews unavailable', e);
    return null;
  });
  return renderer;
}

/**
 * A data URL picturing `styleId` in `color` (CSS), `px` CSS pixels wide (height ≈ 0.59 of it),
 * at the screen's pixel ratio. null when previews are unavailable.
 */
export function pieceStylePreview(
  styleId: string,
  color: string,
  px = 120,
): Promise<string | null> {
  const dpr = typeof window !== 'undefined' ? Math.min(3, window.devicePixelRatio || 1) : 1;
  const key = `${styleId}|${color}|${px}|${dpr}`;
  let hit = cache.get(key);
  if (!hit) {
    hit = draw(styleId, color, (px / W) * dpr).catch(() => null);
    cache.set(key, hit);
  }
  return hit;
}

async function draw(styleId: string, css: string, resolution: number): Promise<string | null> {
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
    return await r.extract.base64({
      target: root,
      frame: new Rectangle(0, 0, W, H),
      resolution,
      antialias: true,
      clearColor: [0, 0, 0, 0],
    });
  } finally {
    root.destroy({ children: true });
  }
}
