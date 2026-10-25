/**
 * Procedural artwork: terrain motifs, resource icons, buildings, robber. No image assets.
 * Everything draws into a Pixi `Graphics` in design pixels (1 unit = HEX_SIZE px) so Pixi
 * tessellates curves smoothly; the world container scales the result to the screen.
 */
import type { Graphics } from 'pixi.js';
import { Rng, type Resource, type Terrain } from '../engine';
import { HEX_SIZE as S } from './geometry';
import { INK, TERRAIN_PALETTE } from './theme';

type Pt = [number, number];

const SQRT3 = Math.sqrt(3);

/** Flat [x0, y0, x1, y1, ...] of a pointy-top hexagon, corners clockwise from N. */
export function hexPoints(cx: number, cy: number, r: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 90);
    out.push(cx + r * Math.cos(a), cy + r * Math.sin(a));
  }
  return out;
}

/** Is (x, y) (relative to a hex center, unit-radius `r`) inside the pointy-top hexagon? */
function inHex(x: number, y: number, r: number): boolean {
  const ax = Math.abs(x);
  return ax <= (SQRT3 / 2) * r && Math.abs(y) <= r - ax / SQRT3;
}

/** Deterministic points inside the hex ring, away from the number token. */
function scatter(rng: Rng, n: number, minDist: number, reach = 0.8, hole = 0.5): Pt[] {
  const pts: Pt[] = [];
  for (let tries = 0; tries < 400 && pts.length < n; tries++) {
    const x = (rng.float() * 2 - 1) * reach;
    const y = (rng.float() * 2 - 1) * reach;
    if (!inHex(x, y, reach) || Math.hypot(x, y) < hole) continue;
    if (pts.some(([px, py]) => Math.hypot(px - x, py - y) < minDist)) continue;
    pts.push([x, y]);
  }
  return pts.sort((a, b) => a[1] - b[1]);
}

const px = (v: number) => v * S;

// ---------------------------------------------------------------------------
// Terrain motifs. (ox, oy) = hex center in design px.
// ---------------------------------------------------------------------------

function tree(g: Graphics, ox: number, oy: number, x: number, y: number, h: number) {
  const X = ox + px(x);
  const Y = oy + px(y);
  g.ellipse(X, Y, px(h * 0.3), px(h * 0.09)).fill({ color: 0x000000, alpha: 0.22 });
  g.rect(X - px(h * 0.04), Y - px(h * 0.16), px(h * 0.08), px(h * 0.18)).fill(0x5b3a1e);
  const tiers = [
    { w: 0.66, top: 0.5, bottom: 0.14, color: 0x1f5c2c },
    { w: 0.54, top: 0.74, bottom: 0.34, color: 0x2a7339 },
    { w: 0.4, top: 1.0, bottom: 0.58, color: 0x38904b },
  ];
  for (const t of tiers) {
    const left: Pt[] = [
      [-t.w * h * 0.5, -t.bottom * h],
      [0, -t.top * h],
      [0, -t.bottom * h],
    ];
    const right: Pt[] = [
      [0, -t.top * h],
      [t.w * h * 0.5, -t.bottom * h],
      [0, -t.bottom * h],
    ];
    const at = (pts: Pt[]) => pts.flatMap(([dx, dy]) => [X + px(dx), Y + px(dy)]);
    g.poly(at(left)).fill(t.color);
    g.poly(at(right)).fill({ color: 0x0d2a14, alpha: 0.28 });
    g.poly(at([...left.slice(0, 2), right[1] as Pt])).stroke({
      width: 1.4,
      color: 0x0f3418,
      alpha: 0.7,
      join: 'round',
    });
  }
}

function sheep(g: Graphics, ox: number, oy: number, x: number, y: number, s: number, flip: 1 | -1) {
  const X = ox + px(x);
  const Y = oy + px(y);
  const u = px(s);
  g.ellipse(X, Y + u * 0.34, u * 0.62, u * 0.16).fill({ color: 0x000000, alpha: 0.2 });
  for (const lx of [-0.26, 0.2]) {
    g.rect(X + lx * u, Y + u * 0.1, u * 0.09, u * 0.26).fill(0x3a3a3a);
  }
  const wool: Pt[] = [
    [-0.34, 0],
    [-0.1, -0.12],
    [0.16, -0.1],
    [0.36, 0.0],
    [0.0, 0.12],
  ];
  for (const [wx, wy] of wool) {
    g.circle(X + wx * u * flip, Y + wy * u, u * 0.26)
      .fill(0xf7f7ef)
      .stroke({ width: 1.2, color: 0x9aa093, alpha: 0.8 });
  }
  g.ellipse(X + 0.46 * u * flip, Y + 0.04 * u, u * 0.15, u * 0.17).fill(0x363636);
  g.circle(X + 0.5 * u * flip, Y - 0.02 * u, u * 0.025).fill(0xffffff);
}

function wheat(g: Graphics, ox: number, oy: number, x: number, y: number, h: number) {
  const X = ox + px(x);
  const Y = oy + px(y);
  const H = px(h);
  g.moveTo(X, Y)
    .lineTo(X, Y - H)
    .stroke({ width: 2, color: 0x8a6a14, cap: 'round' });
  for (let i = 0; i < 4; i++) {
    const yy = Y - H * (0.5 + i * 0.14);
    for (const side of [-1, 1]) {
      g.ellipse(X + side * H * 0.09, yy, H * 0.07, H * 0.13)
        .fill(i % 2 ? 0xd9a417 : 0xf2c53d)
        .stroke({ width: 0.8, color: 0x8a6a14, alpha: 0.7 });
    }
  }
  g.ellipse(X, Y - H * 1.08, H * 0.06, H * 0.14).fill(0xf2c53d);
}

function mountain(g: Graphics, ox: number, oy: number, x: number, y: number, w: number, h: number) {
  const X = ox + px(x);
  const Y = oy + px(y);
  const W = px(w);
  const H = px(h);
  g.ellipse(X + W * 0.06, Y + H * 0.02, W * 0.58, H * 0.1).fill({ color: 0x000000, alpha: 0.2 });
  const apex: Pt = [X + W * 0.04, Y - H];
  g.poly([X - W / 2, Y, ...apex, X + W * 0.06, Y]).fill(TERRAIN_PALETTE.ore.light);
  g.poly([...apex, X + W * 0.06, Y, X + W / 2, Y]).fill(TERRAIN_PALETTE.ore.dark);
  g.poly([X - W / 2, Y, ...apex, X + W / 2, Y]).stroke({
    width: 1.8,
    color: 0x2f3842,
    join: 'round',
  });
  const c = 0.34; // snow cap depth
  g.poly([
    ...apex,
    apex[0] - W * 0.17,
    apex[1] + H * c,
    apex[0] - W * 0.07,
    apex[1] + H * (c - 0.1),
    apex[0] + W * 0.02,
    apex[1] + H * (c + 0.06),
    apex[0] + W * 0.09,
    apex[1] + H * (c - 0.08),
    apex[0] + W * 0.17,
    apex[1] + H * c,
  ]).fill(0xf7fbff);
  g.poly([
    ...apex,
    apex[0] + W * 0.17,
    apex[1] + H * c,
    apex[0] + W * 0.09,
    apex[1] + H * (c - 0.08),
    apex[0] + W * 0.02,
    apex[1] + H * (c + 0.06),
  ]).fill({ color: 0xb8c8d8, alpha: 0.7 });
}

function cactus(g: Graphics, ox: number, oy: number, x: number, y: number, h: number) {
  const X = ox + px(x);
  const Y = oy + px(y);
  const H = px(h);
  const green = 0x5f9a4a;
  const edge = { width: 1.4, color: 0x2f5a25 };
  g.ellipse(X, Y, H * 0.3, H * 0.07).fill({ color: 0x000000, alpha: 0.18 });
  g.roundRect(X - H * 0.1, Y - H, H * 0.2, H, H * 0.1)
    .fill(green)
    .stroke(edge);
  g.roundRect(X - H * 0.32, Y - H * 0.62, H * 0.16, H * 0.07, H * 0.035)
    .fill(green)
    .stroke(edge);
  g.roundRect(X - H * 0.32, Y - H * 0.78, H * 0.1, H * 0.23, H * 0.05)
    .fill(green)
    .stroke(edge);
  g.roundRect(X + H * 0.16, Y - H * 0.5, H * 0.16, H * 0.07, H * 0.035)
    .fill(green)
    .stroke(edge);
  g.roundRect(X + H * 0.22, Y - H * 0.68, H * 0.1, H * 0.23, H * 0.05)
    .fill(green)
    .stroke(edge);
}

function motifSeed(q: number, r: number): number {
  return (Math.imul(q + 17, 73856093) ^ Math.imul(r + 31, 19349663)) >>> 0;
}

/** Decorates one land hex of terrain type `t` centered at (ox, oy) design px. */
export function drawTerrainMotif(
  g: Graphics,
  t: Terrain,
  ox: number,
  oy: number,
  q: number,
  r: number,
) {
  const pal = TERRAIN_PALETTE[t];
  const rng = new Rng(motifSeed(q, r));

  switch (t) {
    case 'lumber': {
      for (const [x, y] of scatter(rng, 11, 0.3, 0.84, 0.46)) tree(g, ox, oy, x, y + 0.14, 0.46);
      break;
    }
    case 'brick': {
      const bw = 0.2;
      const bh = 0.105;
      const shades = [0xb5532f, 0xc4623f, 0xd2724c, 0xa84a2a];
      for (let row = -9; row <= 9; row++) {
        const y = row * (bh + 0.02);
        const off = row % 2 ? bw / 2 : 0;
        for (let col = -6; col <= 6; col++) {
          const x = col * (bw + 0.02) + off;
          if (
            !inHex(x, y, 0.84) ||
            !inHex(x + bw / 2, y + bh / 2, 0.9) ||
            !inHex(x - bw / 2, y - bh / 2, 0.9)
          )
            continue;
          if (Math.hypot(x, y) < 0.44) continue;
          const shade = shades[Math.floor(rng.float() * shades.length)] ?? 0xc4623f;
          g.roundRect(ox + px(x - bw / 2), oy + px(y - bh / 2), px(bw), px(bh), 2.5).fill(shade);
          g.rect(ox + px(x - bw / 2) + 2, oy + px(y - bh / 2) + 1, px(bw) - 4, 2).fill({
            color: 0xffffff,
            alpha: 0.13,
          });
        }
      }
      break;
    }
    case 'wool': {
      for (let i = 0; i < 26; i++) {
        const x = (rng.float() * 2 - 1) * 0.78;
        const y = (rng.float() * 2 - 1) * 0.78;
        if (!inHex(x, y, 0.78) || Math.hypot(x, y) < 0.42) continue;
        const X = ox + px(x);
        const Y = oy + px(y);
        g.moveTo(X - 4, Y)
          .lineTo(X - 2, Y - 6)
          .moveTo(X, Y)
          .lineTo(X, Y - 8)
          .moveTo(X + 4, Y)
          .lineTo(X + 2, Y - 6)
          .stroke({ width: 1.6, color: pal.dark, cap: 'round' });
      }
      const spots = scatter(rng, 3, 0.55, 0.7, 0.52);
      spots.forEach(([x, y], i) => sheep(g, ox, oy, x, y, 0.26, i % 2 ? -1 : 1));
      break;
    }
    case 'grain': {
      for (let y = -0.78; y <= 0.78; y += 0.12) {
        const half = Math.min((SQRT3 / 2) * 0.86, SQRT3 * (0.86 - Math.abs(y)));
        if (half <= 0.05) continue;
        const Y = oy + px(y);
        g.moveTo(ox - px(half), Y);
        for (let x = -half; x <= half; x += 0.05) {
          g.lineTo(ox + px(x), Y + Math.sin((x + y * 3) * 9) * 1.8);
        }
        g.stroke({ width: 2, color: pal.dark, alpha: 0.55, cap: 'round' });
      }
      for (const [x, y] of scatter(rng, 9, 0.28, 0.78, 0.5)) wheat(g, ox, oy, x, y + 0.12, 0.3);
      break;
    }
    case 'ore': {
      mountain(g, ox, oy, -0.4, 0.32, 0.56, 0.52);
      mountain(g, ox, oy, 0.4, 0.34, 0.5, 0.44);
      mountain(g, ox, oy, 0.02, -0.34, 0.5, 0.44);
      for (const [x, y] of scatter(rng, 5, 0.25, 0.8, 0.6)) {
        g.ellipse(ox + px(x), oy + px(y + 0.12), 3.5, 2.5).fill(pal.dark);
      }
      break;
    }
    case 'desert': {
      for (const [x, y, w] of [
        [-0.32, 0.38, 0.4],
        [0.3, -0.38, 0.34],
        [0.14, 0.52, 0.3],
        [-0.42, -0.28, 0.26],
      ] as const) {
        g.moveTo(ox + px(x - w / 2), oy + px(y))
          .quadraticCurveTo(ox + px(x), oy + px(y - w * 0.6), ox + px(x + w / 2), oy + px(y))
          .stroke({ width: 2.4, color: pal.dark, alpha: 0.7, cap: 'round' });
      }
      cactus(g, ox, oy, 0.45, 0.36, 0.34);
      for (const [x, y] of [
        [-0.5, 0.12],
        [-0.12, -0.55],
        [0.58, -0.06],
      ] as const) {
        g.ellipse(ox + px(x), oy + px(y), 4, 2.6).fill(pal.dark);
      }
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Resource icons (port badges; exported for the UI layer)
// ---------------------------------------------------------------------------

/** Small icon of `res` centered at (x, y), fitting a box of `size` design px. */
export function drawResourceIcon(g: Graphics, res: Resource, x: number, y: number, size: number) {
  const u = size;
  switch (res) {
    case 'brick': {
      // Two courses of two bricks, staggered.
      g.roundRect(x - 0.5 * u, y - 0.34 * u, 0.46 * u, 0.3 * u, 1.5)
        .fill(0xc4623f)
        .stroke({ width: 1.2, color: 0x6d2d14 });
      g.roundRect(x + 0.04 * u, y - 0.34 * u, 0.46 * u, 0.3 * u, 1.5)
        .fill(0xd2724c)
        .stroke({ width: 1.2, color: 0x6d2d14 });
      g.roundRect(x - 0.27 * u, y + 0.04 * u, 0.46 * u, 0.3 * u, 1.5)
        .fill(0xb5532f)
        .stroke({ width: 1.2, color: 0x6d2d14 });
      break;
    }
    case 'lumber': {
      g.roundRect(x - 0.5 * u, y - 0.24 * u, 0.9 * u, 0.48 * u, 0.1 * u)
        .fill(0x8a5a2b)
        .stroke({ width: 1.2, color: 0x4a2f14 });
      g.ellipse(x + 0.4 * u, y, 0.14 * u, 0.24 * u)
        .fill(0xd9b17a)
        .stroke({ width: 1.2, color: 0x4a2f14 });
      g.ellipse(x + 0.4 * u, y, 0.07 * u, 0.12 * u).stroke({ width: 1, color: 0x8a5a2b });
      g.moveTo(x - 0.35 * u, y - 0.08 * u)
        .lineTo(x + 0.15 * u, y - 0.08 * u)
        .stroke({ width: 1, color: 0x5b3a1e, alpha: 0.7 });
      g.moveTo(x - 0.35 * u, y + 0.1 * u)
        .lineTo(x + 0.2 * u, y + 0.1 * u)
        .stroke({ width: 1, color: 0x5b3a1e, alpha: 0.7 });
      break;
    }
    case 'wool': {
      g.rect(x - 0.28 * u, y + 0.1 * u, 0.08 * u, 0.3 * u).fill(0x3a3a3a);
      g.rect(x + 0.12 * u, y + 0.1 * u, 0.08 * u, 0.3 * u).fill(0x3a3a3a);
      for (const [dx, dy] of [
        [-0.3, 0],
        [-0.05, -0.12],
        [0.2, -0.04],
        [0.3, 0.08],
        [-0.05, 0.1],
      ] as const) {
        g.circle(x + dx * u, y + dy * u, 0.24 * u)
          .fill(0xf7f7ef)
          .stroke({ width: 1, color: 0x8d9388 });
      }
      g.ellipse(x + 0.46 * u, y + 0.02 * u, 0.14 * u, 0.17 * u).fill(0x363636);
      break;
    }
    case 'grain': {
      g.moveTo(x, y + 0.48 * u)
        .lineTo(x, y - 0.3 * u)
        .stroke({ width: 2, color: 0x8a6a14, cap: 'round' });
      for (let i = 0; i < 3; i++) {
        const yy = y - 0.28 * u + i * 0.2 * u;
        for (const side of [-1, 1]) {
          g.ellipse(x + side * 0.15 * u, yy + 0.08 * u, 0.1 * u, 0.17 * u)
            .fill(i % 2 ? 0xd9a417 : 0xf2c53d)
            .stroke({ width: 1, color: 0x8a6a14 });
        }
      }
      g.ellipse(x, y - 0.42 * u, 0.09 * u, 0.17 * u)
        .fill(0xf2c53d)
        .stroke({ width: 1, color: 0x8a6a14 });
      break;
    }
    case 'ore': {
      g.poly([
        x - 0.48 * u,
        y + 0.1 * u,
        x - 0.2 * u,
        y - 0.36 * u,
        x + 0.24 * u,
        y - 0.36 * u,
        x + 0.5 * u,
        y + 0.1 * u,
        x + 0.1 * u,
        y + 0.42 * u,
        x - 0.24 * u,
        y + 0.42 * u,
      ])
        .fill(0x8f9ba7)
        .stroke({ width: 1.3, color: 0x2f3842, join: 'round' });
      g.poly([
        x - 0.2 * u,
        y - 0.36 * u,
        x + 0.24 * u,
        y - 0.36 * u,
        x + 0.05 * u,
        y + 0.02 * u,
        x - 0.3 * u,
        y + 0.02 * u,
      ]).fill({ color: 0xffffff, alpha: 0.35 });
      g.poly([
        x + 0.05 * u,
        y + 0.02 * u,
        x + 0.5 * u,
        y + 0.1 * u,
        x + 0.1 * u,
        y + 0.42 * u,
      ]).fill({ color: 0x000000, alpha: 0.22 });
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

/** Lighten (amount > 0) or darken (< 0) a 0xRRGGBB colour. */
export function shade(color: number, amount: number): number {
  const mix = (c: number) => {
    const v = amount >= 0 ? c + (255 - c) * amount : c * (1 + amount);
    return Math.max(0, Math.min(255, Math.round(v)));
  };
  return (mix((color >> 16) & 255) << 16) | (mix((color >> 8) & 255) << 8) | mix(color & 255);
}

/** Road along a segment (design px), shortened at both ends so it sits between buildings. */
export function drawRoad(g: Graphics, a: Pt, b: Pt, color: number) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  const ux = dx / len;
  const uy = dy / len;
  const inset = px(0.17);
  const x0 = a[0] + ux * inset;
  const y0 = a[1] + uy * inset;
  const x1 = b[0] - ux * inset;
  const y1 = b[1] - uy * inset;
  g.moveTo(x0 + 1.5, y0 + 2.5)
    .lineTo(x1 + 1.5, y1 + 2.5)
    .stroke({ width: px(0.17), color: 0x000000, alpha: 0.28, cap: 'round' });
  g.moveTo(x0, y0)
    .lineTo(x1, y1)
    .stroke({ width: px(0.17), color: INK, cap: 'round' });
  g.moveTo(x0, y0)
    .lineTo(x1, y1)
    .stroke({ width: px(0.115), color, cap: 'round' });
  const nx = -uy * px(0.03);
  const ny = ux * px(0.03);
  g.moveTo(x0 + nx, y0 + ny)
    .lineTo(x1 + nx, y1 + ny)
    .stroke({ width: px(0.03), color: shade(color, 0.45), alpha: 0.7, cap: 'round' });
}

export function drawSettlement(g: Graphics, x: number, y: number, color: number) {
  const pts: Pt[] = [
    [-0.17, 0.14],
    [-0.17, -0.04],
    [0, -0.21],
    [0.17, -0.04],
    [0.17, 0.14],
  ];
  const at = (p: Pt[]) => p.flatMap(([dx, dy]) => [x + px(dx), y + px(dy)]);
  g.ellipse(x + 2, y + px(0.15), px(0.22), px(0.07)).fill({ color: 0x000000, alpha: 0.3 });
  g.poly(at(pts)).fill(color).stroke({ width: 2.6, color: INK, join: 'round' });
  g.poly(
    at([
      [-0.17, -0.04],
      [0, -0.21],
      [0.17, -0.04],
    ]),
  ).fill({ color: 0x000000, alpha: 0.2 });
  g.poly(
    at([
      [-0.17, -0.04],
      [0, -0.21],
      [-0.02, -0.04],
    ]),
  ).fill({ color: 0xffffff, alpha: 0.22 });
  g.rect(x - px(0.035), y + px(0.04), px(0.07), px(0.1)).fill({ color: INK, alpha: 0.65 });
}

export function drawCity(g: Graphics, x: number, y: number, color: number) {
  const pts: Pt[] = [
    [-0.29, 0.17],
    [-0.29, -0.1],
    [-0.15, -0.28],
    [0.0, -0.1],
    [0.0, -0.03],
    [0.15, -0.17],
    [0.3, -0.03],
    [0.3, 0.17],
  ];
  const at = (p: Pt[]) => p.flatMap(([dx, dy]) => [x + px(dx), y + px(dy)]);
  g.ellipse(x + 2, y + px(0.18), px(0.36), px(0.08)).fill({ color: 0x000000, alpha: 0.3 });
  g.poly(at(pts)).fill(color).stroke({ width: 2.6, color: INK, join: 'round' });
  g.poly(
    at([
      [-0.29, -0.1],
      [-0.15, -0.28],
      [0.0, -0.1],
    ]),
  ).fill({ color: 0x000000, alpha: 0.2 });
  g.poly(
    at([
      [0.0, -0.03],
      [0.15, -0.17],
      [0.3, -0.03],
    ]),
  ).fill({ color: 0x000000, alpha: 0.2 });
  g.poly(
    at([
      [-0.29, -0.1],
      [-0.15, -0.28],
      [-0.17, -0.1],
    ]),
  ).fill({ color: 0xffffff, alpha: 0.22 });
  g.moveTo(x, y - px(0.1))
    .lineTo(x, y + px(0.17))
    .stroke({ width: 1.8, color: INK, alpha: 0.8 });
  g.rect(x - px(0.2), y - px(0.03), px(0.07), px(0.09))
    .fill({ color: 0xffe9a8, alpha: 0.9 })
    .stroke({ width: 1, color: INK });
  g.rect(x + px(0.1), y + px(0.06), px(0.07), px(0.09))
    .fill({ color: 0xffe9a8, alpha: 0.9 })
    .stroke({ width: 1, color: INK });
}

/** Robber pawn standing with its base at (x, y). */
export function drawRobber(g: Graphics, x: number, y: number) {
  const h = px(0.62);
  g.ellipse(x + 2, y + 1, px(0.17), px(0.06)).fill({ color: 0x000000, alpha: 0.35 });
  const body = [
    x - px(0.15),
    y,
    x - px(0.09),
    y - h * 0.38,
    x - px(0.06),
    y - h * 0.58,
    x + px(0.06),
    y - h * 0.58,
    x + px(0.09),
    y - h * 0.38,
    x + px(0.15),
    y,
  ];
  g.poly(body).fill(0x3b3d44).stroke({ width: 2, color: 0x0e0e12, join: 'round' });
  g.poly([
    x - px(0.15),
    y,
    x - px(0.09),
    y - h * 0.38,
    x - px(0.045),
    y - h * 0.38,
    x - px(0.07),
    y,
  ]).fill({ color: 0xffffff, alpha: 0.16 });
  g.circle(x, y - h * 0.78, px(0.085))
    .fill(0x474a53)
    .stroke({ width: 2, color: 0x0e0e12 });
  g.circle(x - px(0.025), y - h * 0.8, px(0.025)).fill({ color: 0xffffff, alpha: 0.28 });
  g.ellipse(x, y - h * 0.05, px(0.17), px(0.045))
    .fill(0x2a2b31)
    .stroke({ width: 1.6, color: 0x0e0e12 });
}
