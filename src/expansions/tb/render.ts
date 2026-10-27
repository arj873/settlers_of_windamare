/**
 * Traders & Barbarians board drawer. Terrains: lake, swamp, oasis, the Barbarian Attack castle
 * (with its 1&4 / 2&5 / 3&6 edge marks as 1-3 dots) and the three trade hexes. Layers: lake
 * numbers and fishing grounds (Fishermen); rivers, bridge sites and bridges (Rivers); caravan
 * start arrows and camels (Caravans); conquered hexes, coastal barbarians and knights (BA);
 * plazas with spokes, commodity stacks, wagons and barbarians on paths (T&B); the neutral
 * players' roads and settlements (Catan for Two).
 *
 * Pixi has no theme tokens: every fill is a mid-tone with a dark ink outline, so pieces read on
 * the light and the dark themes alike (as in ck/render.ts).
 */
import { Container, Graphics, Text } from 'pixi.js';
import {
  edgeInfo,
  vertexInfo,
  type EdgeId,
  type GameState,
  type HexId,
  type PlayerId,
  type Point,
  type VertexId,
} from '../../engine';
import { drawTerrainMotif, hexPoints, shade } from '../../render/art';
import type { BoardDrawer, DrawContext } from '../../render/expansions';
import { TOKEN, terrainPalette } from '../../render/theme';
import {
  CASTLE,
  GLASSWORKS,
  LAKE,
  NEUTRAL_COLORS,
  OASIS,
  QUARRY,
  SWAMP,
  TB,
  TRADE_CASTLE,
  barbarianEdges,
  extraNumbers,
  tbBoard,
  type Commodity,
  type TbSlice,
} from './engine';

const INK = 0x2a1708;
const BRONZE = 0xb07a3a;
const WATER = 0x3f86b8;
const WATER_LIGHT = 0x8fcbea;
const SERIF = 'Georgia, "Times New Roman", serif';
/** Static board text is rasterised generously: the drawer gets no zoom-aware resolution. */
const TEXT_RES = 3;

export const COMMODITY_COLOR: Readonly<Record<Commodity, number>> = {
  glass: 0x6fd0e0,
  marble: 0xf2efe8,
  tools: 0x8a6a4a,
  sand: 0xe6c47a,
};

const slice = (state: GameState): TbSlice | undefined => state.ext[TB] as TbSlice | undefined;
const cssColor = (css: string): number => parseInt(css.replace('#', ''), 16);

function label(text: string, size: number, fill: number): Text {
  const t = new Text({
    text,
    style: { fontFamily: SERIF, fontSize: size, fontWeight: 'bold', fill },
    resolution: TEXT_RES,
  });
  t.anchor.set(0.5);
  return t;
}

/** A number disc like the core tokens, at (x, y) with radius r. */
function disc(c: Container, n: number, x: number, y: number, r: number): void {
  const g = new Graphics();
  g.circle(x + 1, y + 2, r).fill({ color: 0x000000, alpha: 0.3 });
  g.circle(x, y, r).fill(TOKEN.face).stroke({ width: 2, color: TOKEN.rim });
  c.addChild(g);
  const t = label(String(n), r * 1.05, n === 6 || n === 8 ? TOKEN.red : TOKEN.text);
  t.position.set(x, y);
  c.addChild(t);
}

// ---------------------------------------------------------------------------
// Terrains
// ---------------------------------------------------------------------------

interface Pal {
  base: number;
  dark: number;
  light: number;
}

function hexBase(g: Graphics, cx: number, cy: number, S: number, pal: Pal): void {
  g.poly(hexPoints(cx, cy, S))
    .fill(pal.base)
    .stroke({ width: 2, color: pal.dark, alpha: 0.9 });
  g.poly(hexPoints(cx, cy, S * 0.9)).stroke({ width: 2, color: pal.light, alpha: 0.35 });
}

function reeds(g: Graphics, x: number, y: number, S: number): void {
  for (const dx of [-0.04, 0, 0.04]) {
    g.moveTo(x + dx * S, y)
      .lineTo(x + dx * 1.6 * S, y - 0.16 * S)
      .stroke({ width: 0.018 * S, color: 0x3d5a22, cap: 'round' });
  }
  g.ellipse(x + 0.01 * S, y - 0.15 * S, 0.014 * S, 0.035 * S).fill(0x6b4a22);
}

function lake(g: Graphics, cx: number, cy: number, S: number): void {
  hexBase(g, cx, cy, S, terrainPalette('wool'));
  g.poly(hexPoints(cx, cy, S * 0.8))
    .fill(WATER)
    .stroke({ width: 2, color: 0x2a6390 });
  for (const [dx, dy] of [
    [-0.4, -0.35],
    [0.3, 0.38],
    [0.45, -0.1],
  ] as const) {
    g.moveTo(cx + (dx - 0.1) * S, cy + dy * S)
      .quadraticCurveTo(cx + dx * S, cy + (dy - 0.06) * S, cx + (dx + 0.1) * S, cy + dy * S)
      .stroke({ width: 2, color: WATER_LIGHT, alpha: 0.7, cap: 'round' });
  }
  reeds(g, cx - 0.62 * S, cy + 0.32 * S, S);
  reeds(g, cx + 0.6 * S, cy - 0.3 * S, S);
}

function swamp(g: Graphics, cx: number, cy: number, S: number): void {
  hexBase(g, cx, cy, S, { base: 0x66744a, dark: 0x3f4d2e, light: 0x8f9f6e });
  for (const [dx, dy, w] of [
    [-0.4, -0.3, 0.22],
    [0.38, -0.42, 0.16],
    [0.42, 0.35, 0.24],
    [-0.35, 0.45, 0.18],
  ] as const) {
    g.ellipse(cx + dx * S, cy + dy * S, w * S, w * 0.45 * S).fill({ color: 0x2f4a3e, alpha: 0.8 });
    g.ellipse(cx + (dx - 0.04) * S, cy + (dy - 0.02) * S, w * 0.5 * S, w * 0.15 * S).fill({
      color: 0x8fb0a0,
      alpha: 0.4,
    });
  }
  reeds(g, cx - 0.62 * S, cy + 0.05 * S, S);
  reeds(g, cx + 0.12 * S, cy - 0.55 * S, S);
  reeds(g, cx + 0.66 * S, cy + 0.05 * S, S);
}

function palm(g: Graphics, x: number, y: number, S: number): void {
  g.moveTo(x, y)
    .quadraticCurveTo(x + 0.05 * S, y - 0.15 * S, x + 0.02 * S, y - 0.3 * S)
    .stroke({ width: 0.035 * S, color: 0x6b4a22, cap: 'round' });
  for (const a of [-2.6, -2, -1.2, -0.5]) {
    const ex = x + 0.02 * S + Math.cos(a) * 0.16 * S;
    const ey = y - 0.3 * S + Math.sin(a) * 0.1 * S + 0.04 * S;
    g.moveTo(x + 0.02 * S, y - 0.3 * S)
      .quadraticCurveTo((x + ex) / 2, y - 0.38 * S, ex, ey)
      .stroke({ width: 0.03 * S, color: 0x2f7a3a, cap: 'round' });
  }
}

function oasis(g: Graphics, cx: number, cy: number, S: number): void {
  const pal = terrainPalette('desert');
  hexBase(g, cx, cy, S, pal);
  drawTerrainMotif(g, 'desert', cx, cy, Math.round(cx), Math.round(cy));
  g.ellipse(cx, cy + 0.5 * S, 0.3 * S, 0.13 * S)
    .fill(WATER)
    .stroke({ width: 1.5, color: 0x2a6390 });
  palm(g, cx - 0.42 * S, cy + 0.5 * S, S);
  palm(g, cx + 0.4 * S, cy + 0.45 * S, S);
  palm(g, cx - 0.1 * S, cy - 0.45 * S, S);
}

function tower(g: Graphics, x: number, y: number, w: number, h: number, stone: number): void {
  g.rect(x - w / 2, y - h, w, h)
    .fill(stone)
    .stroke({ width: 1.5, color: INK });
  const m = w / 5;
  for (let i = 0; i < 3; i++) {
    g.rect(x - w / 2 + i * 2 * m, y - h - m, m, m)
      .fill(stone)
      .stroke({ width: 1, color: INK });
  }
}

/** Barbarian Attack's castle: stone, a keep, and 1-3 dots marking the opposite-edge pairs. */
function baCastle(g: Graphics, cx: number, cy: number, S: number): void {
  hexBase(g, cx, cy, S, { base: 0x9a948a, dark: 0x6a645c, light: 0xc8c2b6 });
  const stone = 0xc9c1b2;
  tower(g, cx - 0.32 * S, cy + 0.25 * S, 0.18 * S, 0.45 * S, stone);
  tower(g, cx + 0.32 * S, cy + 0.25 * S, 0.18 * S, 0.45 * S, stone);
  g.rect(cx - 0.23 * S, cy - 0.05 * S, 0.46 * S, 0.3 * S)
    .fill(stone)
    .stroke({ width: 1.5, color: INK });
  tower(g, cx, cy - 0.05 * S, 0.22 * S, 0.35 * S, shade(stone, 0.1));
  g.roundRect(cx - 0.06 * S, cy + 0.1 * S, 0.12 * S, 0.15 * S, 0.06 * S).fill(INK);
  g.moveTo(cx, cy - 0.47 * S)
    .lineTo(cx, cy - 0.65 * S)
    .stroke({ width: 1.5, color: INK });
  g.poly([cx, cy - 0.65 * S, cx + 0.14 * S, cy - 0.6 * S, cx, cy - 0.55 * S]).fill(0xc0281f);
  // Edge marks: side i (clockwise from NE) gets 1 + i % 3 dots, so opposite sides match.
  for (let i = 0; i < 6; i++) {
    const a = -Math.PI / 3 + (i * Math.PI) / 3;
    const ex = cx + Math.cos(a) * 0.72 * S;
    const ey = cy + Math.sin(a) * 0.72 * S;
    const n = 1 + (i % 3);
    for (let k = 0; k < n; k++) {
      const off = (k - (n - 1) / 2) * 0.07 * S;
      g.circle(ex - Math.sin(a) * off, ey + Math.cos(a) * off, 0.028 * S)
        .fill(0xf2e6c4)
        .stroke({ width: 1, color: INK });
    }
  }
}

/** Trade hexes keep their centre free for the plaza: the motif sits in the upper half. */
function tradeCastle(g: Graphics, cx: number, cy: number, S: number): void {
  hexBase(g, cx, cy, S, { base: 0xb79a6c, dark: 0x86704c, light: 0xd8c39a });
  const stone = 0xe0d4bc;
  tower(g, cx - 0.36 * S, cy - 0.22 * S, 0.16 * S, 0.36 * S, stone);
  tower(g, cx + 0.36 * S, cy - 0.22 * S, 0.16 * S, 0.36 * S, stone);
  g.rect(cx - 0.28 * S, cy - 0.42 * S, 0.56 * S, 0.2 * S)
    .fill(stone)
    .stroke({ width: 1.5, color: INK });
  g.poly([cx - 0.04 * S, cy - 0.7 * S, cx + 0.16 * S, cy - 0.64 * S, cx - 0.04 * S, cy - 0.58 * S])
    .fill(0x3d6fd6)
    .stroke({ width: 1, color: INK });
  g.moveTo(cx - 0.04 * S, cy - 0.42 * S)
    .lineTo(cx - 0.04 * S, cy - 0.7 * S)
    .stroke({ width: 1.5, color: INK });
}

function quarry(g: Graphics, cx: number, cy: number, S: number): void {
  hexBase(g, cx, cy, S, { base: 0xb9b2a6, dark: 0x8a8378, light: 0xdcd6cc });
  const blocks: [number, number, number][] = [
    [-0.45, -0.25, 0.2],
    [-0.22, -0.32, 0.16],
    [0.3, -0.3, 0.22],
    [0.48, 0.15, 0.16],
    [-0.5, 0.2, 0.16],
  ];
  for (const [dx, dy, w] of blocks) {
    const x = cx + dx * S;
    const y = cy + dy * S;
    g.rect(x - (w * S) / 2, y - (w * S) / 2, w * S, w * 0.7 * S)
      .fill(0xf2efe8)
      .stroke({ width: 1.5, color: 0x6a645c });
    g.moveTo(x - (w * S) / 2, y - (w * S) / 2)
      .lineTo(x - (w * S) / 3, y - (w * S) / 2 - 0.05 * S)
      .lineTo(x + (w * S) / 2 + 0.03 * S, y - (w * S) / 2 - 0.05 * S)
      .lineTo(x + (w * S) / 2, y - (w * S) / 2)
      .fill(0xd8d2c6)
      .stroke({ width: 1, color: 0x6a645c });
  }
  g.moveTo(cx - 0.15 * S, cy - 0.6 * S)
    .lineTo(cx + 0.12 * S, cy - 0.5 * S)
    .stroke({ width: 0.03 * S, color: 0x6b4a22, cap: 'round' });
}

function glassworks(g: Graphics, cx: number, cy: number, S: number): void {
  hexBase(g, cx, cy, S, { base: 0x7fb8bd, dark: 0x4f8a90, light: 0xb7e0e3 });
  // A furnace with a chimney and smoke, and glass bottles.
  g.roundRect(cx - 0.42 * S, cy - 0.42 * S, 0.34 * S, 0.24 * S, 0.1 * S)
    .fill(0xa0583a)
    .stroke({ width: 1.5, color: INK });
  g.circle(cx - 0.25 * S, cy - 0.3 * S, 0.06 * S).fill(0xf2a03a);
  g.rect(cx - 0.18 * S, cy - 0.68 * S, 0.07 * S, 0.27 * S)
    .fill(0x7a3e28)
    .stroke({ width: 1, color: INK });
  g.circle(cx - 0.1 * S, cy - 0.76 * S, 0.05 * S).fill({ color: 0xffffff, alpha: 0.45 });
  for (const [dx, h] of [
    [0.2, 0.22],
    [0.34, 0.28],
    [0.48, 0.2],
  ] as const) {
    const x = cx + dx * S;
    const y = cy - 0.2 * S;
    g.roundRect(x - 0.045 * S, y - h * S, 0.09 * S, h * S, 0.03 * S)
      .fill({ color: 0x6fd0e0, alpha: 0.9 })
      .stroke({ width: 1.2, color: 0x2a6370 });
    g.rect(x - 0.015 * S, y - (h + 0.06) * S, 0.03 * S, 0.06 * S).fill(0x2a6370);
  }
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

/** A bronze barbarian with a horned helmet standing at (x, y). */
function barbarian(g: Graphics, x: number, y: number, S: number): void {
  const h = 0.3 * S;
  g.ellipse(x + 1.5, y + 1, 0.09 * S, 0.035 * S).fill({ color: 0x000000, alpha: 0.35 });
  g.poly([x - 0.08 * S, y, x - 0.05 * S, y - h * 0.6, x + 0.05 * S, y - h * 0.6, x + 0.08 * S, y])
    .fill(BRONZE)
    .stroke({ width: 1.5, color: INK, join: 'round' });
  g.circle(x, y - h * 0.78, 0.055 * S)
    .fill(BRONZE)
    .stroke({ width: 1.5, color: INK });
  for (const s of [-1, 1]) {
    g.moveTo(x + s * 0.045 * S, y - h * 0.85)
      .quadraticCurveTo(x + s * 0.11 * S, y - h * 0.9, x + s * 0.1 * S, y - h * 1.08)
      .stroke({ width: 0.025 * S, color: 0xf2e6c4, cap: 'round' });
  }
}

function knight(g: Graphics, x: number, y: number, S: number, color: number): void {
  const w = 0.13 * S;
  const top = y - w * 1.05;
  const bottom = y + w * 1.15;
  g.ellipse(x + 2, bottom, w * 0.9, w * 0.25).fill({ color: 0x000000, alpha: 0.3 });
  g.poly([x - w, top, x + w, top, x + w, y + w * 0.1, x, bottom, x - w, y + w * 0.1])
    .fill(color)
    .stroke({ width: 2, color: INK, join: 'round' });
  g.moveTo(x, top + w * 0.25)
    .lineTo(x, bottom - w * 0.3)
    .moveTo(x - w * 0.55, y - w * 0.2)
    .lineTo(x + w * 0.55, y - w * 0.2)
    .stroke({ width: Math.max(1.5, 0.025 * S), color: 0xffffff, cap: 'round' });
}

/** A camel at (x, y), facing along (ux, uy). */
function camel(g: Graphics, x: number, y: number, S: number, ux: number): void {
  const f = ux >= 0 ? 1 : -1;
  const X = (dx: number) => x + f * dx * S;
  const Y = (dy: number) => y + dy * S;
  const body = 0xc08a4c;
  g.ellipse(x + 2, Y(0.17), 0.18 * S, 0.035 * S).fill({ color: 0x000000, alpha: 0.3 });
  for (const lx of [-0.1, -0.04, 0.06, 0.12]) {
    g.moveTo(X(lx), Y(0.02))
      .lineTo(X(lx), Y(0.17))
      .stroke({ width: 0.03 * S, color: shade(body, -0.35), cap: 'round' });
  }
  g.ellipse(X(0), Y(0), 0.15 * S, 0.07 * S)
    .fill(body)
    .stroke({ width: 1.5, color: INK });
  g.ellipse(X(-0.02), Y(-0.07), 0.08 * S, 0.06 * S)
    .fill(body)
    .stroke({ width: 1.5, color: INK });
  g.moveTo(X(0.12), Y(-0.01))
    .lineTo(X(0.19), Y(-0.13))
    .stroke({ width: 0.05 * S, color: INK, cap: 'round' })
    .moveTo(X(0.12), Y(-0.01))
    .lineTo(X(0.19), Y(-0.13))
    .stroke({ width: 0.032 * S, color: body, cap: 'round' });
  g.ellipse(X(0.215), Y(-0.14), 0.045 * S, 0.025 * S)
    .fill(body)
    .stroke({ width: 1.2, color: INK });
}

function wagon(
  g: Graphics,
  x: number,
  y: number,
  S: number,
  color: number,
  load: number | null,
): void {
  g.ellipse(x + 2, y + 0.11 * S, 0.17 * S, 0.035 * S).fill({ color: 0x000000, alpha: 0.3 });
  if (load !== null) {
    g.roundRect(x - 0.09 * S, y - 0.17 * S, 0.18 * S, 0.1 * S, 0.02 * S)
      .fill(load)
      .stroke({ width: 1.2, color: INK });
  }
  g.roundRect(x - 0.15 * S, y - 0.08 * S, 0.3 * S, 0.12 * S, 0.02 * S)
    .fill(color)
    .stroke({ width: 1.8, color: INK });
  for (const dx of [-0.09, 0.09]) {
    g.circle(x + dx * S, y + 0.06 * S, 0.05 * S)
      .fill(0x6b4a22)
      .stroke({ width: 1.5, color: INK });
    g.circle(x + dx * S, y + 0.06 * S, 0.015 * S).fill(0xf2e6c4);
  }
}

// ---------------------------------------------------------------------------
// Layer helpers
// ---------------------------------------------------------------------------

function graphicsLayer(draw: (g: Graphics, c: Container) => void): Container {
  const c = new Container();
  const g = new Graphics();
  c.addChild(g);
  draw(g, c);
  return c;
}

const edgeEnds = (ctx: DrawContext, e: EdgeId): [Point, Point] | null => {
  const info = ctx.topo.edge[e];
  const a = info && ctx.topo.vertex[info.vertices[0]];
  const b = info && ctx.topo.vertex[info.vertices[1]];
  return a && b ? [a, b] : null;
};

/** A dashed line between two px points. */
function dashed(
  g: Graphics,
  a: [number, number],
  b: [number, number],
  dash: number,
  style: object,
): void {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const n = Math.max(1, Math.floor(len / (dash * 2)));
  for (let i = 0; i < n; i++) {
    const t0 = (i * 2 * dash) / len + (len - n * 2 * dash) / (2 * len);
    const t1 = t0 + dash / len;
    g.moveTo(a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0).lineTo(
      a[0] + (b[0] - a[0]) * t1,
      a[1] + (b[1] - a[1]) * t1,
    );
  }
  g.stroke(style);
}

const isConquered = (s: TbSlice | undefined, h: HexId) => (s?.ba?.onHex[h] ?? 0) >= 3;

/** A numbered trade hex (T&B × T&B sheets): its token sits left of the plaza, smaller. */
const TRADE_TOKEN = { dx: -0.5, dy: 0, scale: 0.62 } as const;
const tradeToken = (state: GameState, h: HexId) =>
  state.board.hexes[h]?.token != null && (tbBoard(state).tradeHexes ?? []).some((t) => t.hex === h)
    ? TRADE_TOKEN
    : undefined;

export const tbDrawer: BoardDrawer = {
  id: TB,
  tokenAt: tradeToken,
  terrain: {
    [LAKE]: lake,
    [SWAMP]: swamp,
    [OASIS]: oasis,
    [CASTLE]: baCastle,
    [TRADE_CASTLE]: tradeCastle,
    [QUARRY]: quarry,
    [GLASSWORKS]: glassworks,
  },
  layers: [
    // --- Fishermen -----------------------------------------------------------------------
    {
      key: 'lakes',
      z: 'board',
      sig: (state) => JSON.stringify(tbBoard(state).lakes ?? []),
      draw: (state, ctx) =>
        graphicsLayer((_g, c) => {
          for (const l of tbBoard(state).lakes ?? []) {
            const info = ctx.topo.hex[l.hex];
            if (!info) continue;
            const [x, y] = ctx.pt(info);
            const r = 0.18 * ctx.S;
            const k = l.numbers.length;
            l.numbers.forEach((n, i) => {
              const a =
                -Math.PI / 2 + (i * 2 * Math.PI) / k + (k === 2 ? Math.PI / 2 : Math.PI / 4);
              disc(c, n, x + Math.cos(a) * 0.3 * ctx.S, y + Math.sin(a) * 0.3 * ctx.S, r);
            });
          }
        }),
    },
    // --- Rivers and the T&B × T&B sheets: a second number on a hex (the 2 on the 12) -------
    {
      key: 'extraNumbers',
      z: 'board',
      sig: (state) => JSON.stringify(extraNumbers(state)),
      draw: (state, ctx) =>
        graphicsLayer((_g, c) => {
          for (const x of extraNumbers(state)) {
            const info = ctx.topo.hex[x.hex];
            if (!info) continue;
            const [cx, cy] = ctx.pt(info);
            disc(c, x.number, cx + 0.42 * ctx.S, cy - 0.3 * ctx.S, 0.2 * ctx.S);
          }
        }),
    },
    {
      key: 'grounds',
      z: 'board',
      sig: (state) => JSON.stringify(tbBoard(state).grounds ?? []),
      draw: (state, ctx) =>
        graphicsLayer((g, c) => {
          const S = ctx.S;
          for (const gr of tbBoard(state).grounds ?? []) {
            const tip = gr.vertices[0] ? ctx.topo.vertex[gr.vertices[0]] : undefined;
            if (!tip) continue;
            // Outward = away from the land hexes the notch touches.
            let ox = 0;
            let oy = 0;
            for (const h of tip.hexes) {
              const hi = ctx.topo.hex[h];
              if (hi) {
                ox += tip.x - hi.x;
                oy += tip.y - hi.y;
              }
            }
            const d = Math.hypot(ox, oy) || 1;
            const ux = ox / d;
            const uy = oy / d;
            const [tx, ty] = ctx.pt(tip);
            const side = gr.vertices
              .slice(1)
              .map((v) => ctx.topo.vertex[v])
              .filter((v) => v !== undefined);
            // The tile: a fan from the notch's coastal neighbours out to sea.
            const pts: number[] = [];
            const [a, b] = side;
            if (a && b) {
              const [ax, ay] = ctx.pt(a);
              const [bx, by] = ctx.pt(b);
              pts.push(
                ax,
                ay,
                tx,
                ty,
                bx,
                by,
                bx + ux * 0.45 * S,
                by + uy * 0.45 * S,
                tx + ux * 0.7 * S,
                ty + uy * 0.7 * S,
                ax + ux * 0.45 * S,
                ay + uy * 0.45 * S,
              );
            } else {
              pts.push(...hexPoints(tx + ux * 0.4 * S, ty + uy * 0.4 * S, 0.35 * S));
            }
            g.poly(pts).fill({ color: 0x8fd0e8, alpha: 0.9 }).stroke({ width: 2, color: 0x1f4f73 });
            for (const k of [-1, 1]) {
              const fx = tx + ux * 0.34 * S - uy * k * 0.22 * S;
              const fy = ty + uy * 0.34 * S + ux * k * 0.22 * S;
              g.ellipse(fx, fy, 0.07 * S, 0.035 * S).fill(0xf2a03a);
              g.poly([
                fx + 0.06 * S,
                fy,
                fx + 0.11 * S,
                fy - 0.035 * S,
                fx + 0.11 * S,
                fy + 0.035 * S,
              ]).fill(0xf2a03a);
            }
            for (const v of gr.vertices) {
              const vi = ctx.topo.vertex[v];
              if (!vi) continue;
              const [vx, vy] = ctx.pt(vi);
              g.circle(vx, vy, 0.05 * S)
                .fill(WATER_LIGHT)
                .stroke({ width: 1.2, color: 0x1f4f73 });
            }
            disc(c, gr.number, tx + ux * 0.62 * S, ty + uy * 0.62 * S, 0.17 * S);
          }
        }),
    },
    // --- Rivers --------------------------------------------------------------------------
    {
      key: 'rivers',
      z: 'board',
      sig: (state) => JSON.stringify(tbBoard(state).rivers ?? []),
      draw: (state, ctx) =>
        graphicsLayer((g) => {
          const S = ctx.S;
          const board = tbBoard(state);
          const rivers = board.rivers ?? [];
          const seg = (a: Point, b: Point, gapA: number, gapB: number) => {
            const [ax, ay] = ctx.pt(a);
            const [bx, by] = ctx.pt(b);
            const len = Math.hypot(bx - ax, by - ay);
            const ux = (bx - ax) / len;
            const uy = (by - ay) / len;
            const s0: [number, number] = [ax + ux * gapA, ay + uy * gapA];
            const s1: [number, number] = [bx - ux * gapB, by - uy * gapB];
            // A gently wavy river, passing under the number tokens.
            const mx = (s0[0] + s1[0]) / 2 - uy * 0.1 * S;
            const my = (s0[1] + s1[1]) / 2 + ux * 0.1 * S;
            for (const [w, col] of [
              [0.2, 0x1f5d8f],
              [0.14, WATER],
              [0.04, WATER_LIGHT],
            ] as const) {
              g.moveTo(s0[0], s0[1])
                .quadraticCurveTo(mx, my, s1[0], s1[1])
                .stroke({
                  width: w * S,
                  color: col,
                  cap: 'round',
                  alpha: col === WATER_LIGHT ? 0.6 : 1,
                });
            }
          };
          const gap = 0.4 * S;
          for (let i = 0; i + 1 < rivers.length; i++) {
            const a = ctx.topo.hex[rivers[i] as HexId];
            const b = ctx.topo.hex[rivers[i + 1] as HexId];
            if (!a || !b || !a.neighbors.includes(b.id)) continue;
            const ga = state.board.hexes[a.id]?.token === null ? 0 : gap;
            const gb = state.board.hexes[b.id]?.token === null ? 0 : gap;
            seg(a, b, ga, gb);
          }
          // Mouths: from the river hex out across its coastal side.
          for (const e of board.bridgeSites ?? []) {
            const info = ctx.topo.edge[e];
            if (!info || info.hexes.length !== 1) continue;
            const h = ctx.topo.hex[info.hexes[0] as HexId];
            if (!h) continue;
            const out = { x: info.x + (info.x - h.x) * 0.25, y: info.y + (info.y - h.y) * 0.25 };
            seg(h, out, state.board.hexes[h.id]?.token === null ? 0 : gap, 0);
          }
        }),
    },
    {
      key: 'bridgeSites',
      z: 'board',
      sig: (state) =>
        (tbBoard(state).bridgeSites ?? [])
          .map((e) => `${e}:${state.pieces.roads[e] ?? ''}`)
          .join(','),
      draw: (state, ctx) =>
        graphicsLayer((g) => {
          for (const e of tbBoard(state).bridgeSites ?? []) {
            if (state.pieces.roads[e] !== undefined) continue;
            const ends = edgeEnds(ctx, e);
            if (!ends) continue;
            dashed(g, ctx.pt(ends[0]), ctx.pt(ends[1]), 0.07 * ctx.S, {
              width: 0.06 * ctx.S,
              color: 0x6b4a22,
              cap: 'round',
            });
          }
        }),
    },
    {
      key: 'bridges',
      z: 'pieces',
      sig: (state) => JSON.stringify(slice(state)?.rivers?.bridges ?? {}),
      draw: (state, ctx) =>
        graphicsLayer((g) => {
          const S = ctx.S;
          for (const [e, owner] of Object.entries(slice(state)?.rivers?.bridges ?? {}) as [
            EdgeId,
            PlayerId,
          ][]) {
            const ends = edgeEnds(ctx, e);
            if (!ends) continue;
            const [a, b] = ends.map((p) => ctx.pt(p)) as [[number, number], [number, number]];
            const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
            const ux = (b[0] - a[0]) / len;
            const uy = (b[1] - a[1]) / len;
            const nx = -uy;
            const ny = ux;
            const p0: [number, number] = [a[0] + ux * 0.18 * S, a[1] + uy * 0.18 * S];
            const p1: [number, number] = [b[0] - ux * 0.18 * S, b[1] - uy * 0.18 * S];
            const w = 0.1 * S;
            const mid: [number, number] = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2];
            // Deck (an arched plank), then rails in the owner's colour.
            g.poly([
              p0[0] + nx * w,
              p0[1] + ny * w,
              mid[0] + nx * w - ny * 0,
              mid[1] + ny * w - 0.06 * S,
              p1[0] + nx * w,
              p1[1] + ny * w,
              p1[0] - nx * w,
              p1[1] - ny * w,
              mid[0] - nx * w,
              mid[1] - ny * w - 0.06 * S,
              p0[0] - nx * w,
              p0[1] - ny * w,
            ])
              .fill(0xa8733e)
              .stroke({ width: 2, color: INK, join: 'round' });
            for (let i = 1; i < 5; i++) {
              const t = i / 5;
              const x = p0[0] + (p1[0] - p0[0]) * t;
              const y = p0[1] + (p1[1] - p0[1]) * t - Math.sin(t * Math.PI) * 0.06 * S;
              g.moveTo(x + nx * w * 0.9, y + ny * w * 0.9)
                .lineTo(x - nx * w * 0.9, y - ny * w * 0.9)
                .stroke({ width: 1, color: 0x6b4a22 });
            }
            for (const s of [-1, 1]) {
              g.moveTo(p0[0] + s * nx * w, p0[1] + s * ny * w)
                .quadraticCurveTo(
                  mid[0] + s * nx * w,
                  mid[1] + s * ny * w - 0.12 * S,
                  p1[0] + s * nx * w,
                  p1[1] + s * ny * w,
                )
                .stroke({ width: 0.045 * S, color: INK, cap: 'round' })
                .moveTo(p0[0] + s * nx * w, p0[1] + s * ny * w)
                .quadraticCurveTo(
                  mid[0] + s * nx * w,
                  mid[1] + s * ny * w - 0.12 * S,
                  p1[0] + s * nx * w,
                  p1[1] + s * ny * w,
                )
                .stroke({ width: 0.025 * S, color: ctx.colorOf(owner), cap: 'round' });
            }
          }
        }),
    },
    // --- Caravans ------------------------------------------------------------------------
    {
      key: 'caravanStarts',
      z: 'board',
      sig: (state) =>
        `${JSON.stringify(tbBoard(state).caravanStarts ?? [])}${(slice(state)?.caravans?.camels ?? []).map((c) => c.edge).join(',')}`,
      draw: (state, ctx) =>
        graphicsLayer((g) => {
          const S = ctx.S;
          const taken = new Set((slice(state)?.caravans?.camels ?? []).map((c) => c.edge));
          for (const st of tbBoard(state).caravanStarts ?? []) {
            if (taken.has(st.edge)) continue;
            const info = ctx.topo.edge[st.edge];
            const head = ctx.topo.vertex[st.head];
            const tailId = info?.vertices.find((v) => v !== st.head);
            const tail = tailId ? ctx.topo.vertex[tailId] : undefined;
            if (!head || !tail) continue;
            const [hx, hy] = ctx.pt(head);
            const [tx, ty] = ctx.pt(tail);
            const len = Math.hypot(hx - tx, hy - ty);
            const ux = (hx - tx) / len;
            const uy = (hy - ty) / len;
            const sx = tx + ux * 0.2 * S;
            const sy = ty + uy * 0.2 * S;
            const ex = hx - ux * 0.25 * S;
            const ey = hy - uy * 0.25 * S;
            const tip = [
              ex + ux * 0.16 * S,
              ey + uy * 0.16 * S,
              ex - uy * 0.13 * S,
              ey + ux * 0.13 * S,
              ex + uy * 0.13 * S,
              ey - ux * 0.13 * S,
            ];
            g.moveTo(sx, sy)
              .lineTo(ex, ey)
              .stroke({ width: 0.11 * S, color: INK, cap: 'round' });
            g.poly(tip).fill(INK);
            g.moveTo(sx, sy)
              .lineTo(ex, ey)
              .stroke({ width: 0.06 * S, color: 0xe6b25a, cap: 'round' });
            g.poly(tip).fill(0xe6b25a).stroke({ width: 1.5, color: INK });
          }
        }),
    },
    {
      key: 'camels',
      z: 'pieces',
      sig: (state) =>
        (slice(state)?.caravans?.camels ?? []).map((c) => `${c.edge}>${c.head}`).join(','),
      draw: (state, ctx) =>
        graphicsLayer((g) => {
          for (const c of slice(state)?.caravans?.camels ?? []) {
            // Sea paths too (T&B + Seafarers).
            const info = edgeInfo(ctx.topo, c.edge);
            const head = vertexInfo(ctx.topo, c.head);
            if (!info || !head) continue;
            const [x, y] = ctx.pt(info);
            const [hx] = ctx.pt(head);
            camel(g, x, y, ctx.S * 1.5, hx - x);
          }
        }),
    },
    // --- Barbarian Attack ----------------------------------------------------------------
    {
      key: 'conquered',
      z: 'board',
      sig: (state) => JSON.stringify(slice(state)?.ba?.onHex ?? {}),
      draw: (state, ctx) =>
        graphicsLayer((g) => {
          const s = slice(state);
          const S = ctx.S;
          for (const h of Object.keys(s?.ba?.onHex ?? {}) as HexId[]) {
            if (!isConquered(s, h)) continue;
            const info = ctx.topo.hex[h];
            if (!info) continue;
            const [hx, hy] = ctx.pt(info);
            g.poly(hexPoints(hx, hy, S * 0.98)).fill({ color: 0x2a1a10, alpha: 0.5 });
            // The number token is turned face down (where it sits: a trade hex's is moved).
            const at = tradeToken(state, h);
            const k = at?.scale ?? 1;
            const x = hx + (at?.dx ?? 0) * S;
            const y = hy + (at?.dy ?? 0) * S;
            g.circle(x, y, 0.37 * S * k)
              .fill(0x5a4a3a)
              .stroke({ width: 2.5, color: INK });
            const d = 0.17 * S * k;
            g.moveTo(x - d, y - d)
              .lineTo(x + d, y + d)
              .moveTo(x + d, y - d)
              .lineTo(x - d, y + d)
              .stroke({ width: 0.05 * S * k, color: 0xd9a35a, cap: 'round' });
          }
        }),
    },
    {
      key: 'coastBarbarians',
      z: 'top',
      sig: (state) => JSON.stringify([slice(state)?.ba?.onHex ?? {}, slice(state)?.ba?.paths]),
      draw: (state, ctx) =>
        graphicsLayer((g) => {
          // BA + T&B: the barbarians by a path are drawn there (pathBarbarians).
          const byPath = Object.values(slice(state)?.ba?.paths ?? {});
          for (const [h, all] of Object.entries(slice(state)?.ba?.onHex ?? {}) as [
            HexId,
            number,
          ][]) {
            const info = ctx.topo.hex[h];
            if (!info) continue;
            const [x, y] = ctx.pt(info);
            const n = all - byPath.filter((x) => x === h).length;
            for (let i = 0; i < n; i++) {
              barbarian(g, x + (i - (n - 1) / 2) * 0.2 * ctx.S, y + 0.72 * ctx.S, ctx.S);
            }
          }
        }),
    },
    {
      key: 'knights',
      z: 'pieces',
      sig: (state) => JSON.stringify(slice(state)?.ba?.knights ?? {}),
      draw: (state, ctx) =>
        graphicsLayer((g) => {
          for (const [e, owner] of Object.entries(slice(state)?.ba?.knights ?? {}) as [
            EdgeId,
            PlayerId,
          ][]) {
            const info = ctx.topo.edge[e];
            if (!info) continue;
            const [x, y] = ctx.pt(info);
            knight(g, x, y, ctx.S, ctx.colorOf(owner));
          }
        }),
    },
    // --- Traders & Barbarians ------------------------------------------------------------
    {
      key: 'plazas',
      z: 'board',
      sig: (state) => JSON.stringify(tbBoard(state).tradeHexes ?? []),
      draw: (state, ctx) =>
        graphicsLayer((g) => {
          const S = ctx.S;
          const t = ctx.topo;
          for (const e of t.edges) {
            if (!e.includes(',C')) continue;
            const ends = edgeEnds(ctx, e);
            if (!ends) continue;
            const a = ctx.pt(ends[0]);
            const b = ctx.pt(ends[1]);
            g.moveTo(a[0], a[1])
              .lineTo(b[0], b[1])
              .stroke({ width: 0.1 * S, color: 0x8a6a44, cap: 'round' });
            g.moveTo(a[0], a[1])
              .lineTo(b[0], b[1])
              .stroke({ width: 0.06 * S, color: 0xe6d3a8, cap: 'round' });
          }
          for (const th of tbBoard(state).tradeHexes ?? []) {
            const info = t.hex[th.hex];
            if (!info) continue;
            const [x, y] = ctx.pt(info);
            const w = 0.17 * S;
            g.rect(x - w + 1.5, y - w + 2.5, 2 * w, 2 * w).fill({ color: 0x000000, alpha: 0.3 });
            g.rect(x - w, y - w, 2 * w, 2 * w)
              .fill(0xe6d3a8)
              .stroke({ width: 2, color: INK });
            g.rect(x - w * 0.55, y - w * 0.55, w * 1.1, w * 1.1).stroke({
              width: 1,
              color: 0x8a6a44,
            });
          }
        }),
    },
    {
      key: 'tradeStacks',
      z: 'board',
      sig: (state) =>
        Object.entries(slice(state)?.traders?.stacks ?? {})
          .map(([h, s]) => `${h}:${s.length}:${s[s.length - 1] ?? ''}`)
          .join(','),
      draw: (state, ctx) =>
        graphicsLayer((g, c) => {
          const S = ctx.S;
          for (const [h, stack] of Object.entries(slice(state)?.traders?.stacks ?? {}) as [
            HexId,
            Commodity[],
          ][]) {
            const info = ctx.topo.hex[h];
            if (!info) continue;
            const [cx, cy] = ctx.pt(info);
            const x = cx + 0.42 * S;
            const y = cy + 0.38 * S;
            const k = Math.min(4, stack.length);
            for (let i = 0; i < k; i++) {
              g.roundRect(x - 0.11 * S, y - i * 0.035 * S, 0.22 * S, 0.1 * S, 0.02 * S)
                .fill(0x8a6a44)
                .stroke({ width: 1.2, color: INK });
            }
            const lbl = label(String(stack.length), 0.14 * S, 0xf8efd8);
            lbl.position.set(x, y - (k - 1) * 0.035 * S + 0.05 * S);
            c.addChild(lbl);
          }
        }),
    },
    {
      key: 'wagons',
      z: 'pieces',
      sig: (state) => {
        const t = slice(state)?.traders;
        return t ? `${t.wagons.join(',')}|${t.commodity.join(',')}` : '';
      },
      draw: (state, ctx) =>
        graphicsLayer((g) => {
          const t = slice(state)?.traders;
          if (!t) return;
          const at = new Map<VertexId, PlayerId[]>();
          t.wagons.forEach((v, p) => {
            if (v) at.set(v, [...(at.get(v) ?? []), p]);
          });
          for (const [v, ps] of at) {
            const info = vertexInfo(ctx.topo, v);
            if (!info) continue;
            const [x, y] = ctx.pt(info);
            ps.forEach((p, i) => {
              const dx = (i - (ps.length - 1) / 2) * 0.26 * ctx.S;
              const c = t.commodity[p] ?? null;
              // Off the building's spot: wagons stand just below their vertex.
              wagon(
                g,
                x + dx,
                y + 0.24 * ctx.S,
                ctx.S,
                ctx.colorOf(p),
                c ? COMMODITY_COLOR[c] : null,
              );
            });
          }
        }),
    },
    {
      key: 'pathBarbarians',
      z: 'top',
      sig: (state) => barbarianEdges(state).join(','),
      draw: (state, ctx) =>
        graphicsLayer((g) => {
          for (const e of barbarianEdges(state)) {
            const info = edgeInfo(ctx.topo, e);
            if (!info) continue;
            const [x, y] = ctx.pt(info);
            barbarian(g, x, y + 0.1 * ctx.S, ctx.S);
          }
        }),
    },
    // --- Catan for Two -------------------------------------------------------------------
    {
      key: 'neutralRoads',
      z: 'board',
      sig: (state) => (slice(state)?.two?.neutrals ?? []).map((n) => n.roads.join(',')).join('|'),
      draw: (state, ctx) =>
        graphicsLayer((g) => {
          (slice(state)?.two?.neutrals ?? []).forEach((n, i) => {
            const color = cssColor(NEUTRAL_COLORS[i as 0 | 1]);
            for (const e of n.roads) {
              const ends = edgeEnds(ctx, e);
              if (ends) ctx.art.drawRoad(g, ctx.pt(ends[0]), ctx.pt(ends[1]), color);
            }
          });
        }),
    },
    {
      key: 'neutralSettlements',
      z: 'pieces',
      sig: (state) =>
        (slice(state)?.two?.neutrals ?? []).map((n) => n.settlements.join(',')).join('|'),
      draw: (state, ctx) =>
        graphicsLayer((g) => {
          (slice(state)?.two?.neutrals ?? []).forEach((n, i) => {
            const color = cssColor(NEUTRAL_COLORS[i as 0 | 1]);
            for (const v of n.settlements) {
              const info = ctx.topo.vertex[v];
              if (!info) continue;
              const [x, y] = ctx.pt(info);
              ctx.art.drawSettlement(g, x, y, color);
            }
          });
        }),
    },
  ],
};
