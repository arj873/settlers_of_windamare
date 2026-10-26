/**
 * Painters shared by the ship expansions (Seafarers, Explorers & Pirates): gold field, fog and
 * revealed-sea hexes, a ship on an edge and the pirate ship.
 */
import type { Graphics } from 'pixi.js';
import { hexPoints, shade } from './art';
import { INK, SEA } from './theme';

const GOLD = { base: 0xe9b824, dark: 0x8f6410, light: 0xfff0a8, nugget: 0xffd84a };
const FOG = { base: 0x9ba3ad, dark: 0x6b727c, light: 0xe3e7ec };
const PIRATE_HULL = 0x1d1b20;

// ---------------------------------------------------------------------------------------------
// Terrain painters
// ---------------------------------------------------------------------------------------------

export function goldHex(g: Graphics, cx: number, cy: number, S: number): void {
  g.poly(hexPoints(cx, cy, S))
    .fill(GOLD.base)
    .stroke({ width: 2, color: GOLD.dark, alpha: 0.9 });
  g.poly(hexPoints(cx, cy, S * 0.9)).stroke({ width: 2, color: GOLD.light, alpha: 0.45 });
  // A heap of nuggets and a few sparkles (the number token sits in the middle).
  const nugget = (x: number, y: number, r: number) =>
    g
      .poly([
        x - r,
        y,
        x - r * 0.4,
        y - r * 0.8,
        x + r * 0.6,
        y - r * 0.7,
        x + r,
        y + r * 0.1,
        x + r * 0.2,
        y + r * 0.7,
        x - r * 0.7,
        y + r * 0.5,
      ])
      .fill(GOLD.nugget)
      .stroke({ width: 1.5, color: GOLD.dark });
  for (const [dx, dy, r] of [
    [-0.5, 0.42, 0.1],
    [-0.36, 0.5, 0.08],
    [0.42, 0.45, 0.11],
    [0.55, 0.3, 0.07],
    [0.3, -0.55, 0.08],
    [-0.45, -0.4, 0.07],
  ] as const) {
    nugget(cx + dx * S, cy + dy * S, r * S);
  }
  for (const [dx, dy] of [
    [0.05, -0.62],
    [-0.62, 0.05],
    [0.66, -0.1],
  ] as const) {
    const x = cx + dx * S;
    const y = cy + dy * S;
    const r = 0.07 * S;
    g.poly([
      x,
      y - r,
      x + r * 0.25,
      y - r * 0.25,
      x + r,
      y,
      x + r * 0.25,
      y + r * 0.25,
      x,
      y + r,
      x - r * 0.25,
      y + r * 0.25,
      x - r,
      y,
      x - r * 0.25,
      y - r * 0.25,
    ]).fill({
      color: 0xffffff,
      alpha: 0.85,
    });
  }
}

export function fogHex(g: Graphics, cx: number, cy: number, S: number): void {
  g.poly(hexPoints(cx, cy, S))
    .fill({ color: FOG.base, alpha: 0.92 })
    .stroke({ width: 2, color: FOG.dark, alpha: 0.6 });
  // Drifting wisps.
  for (const [dy, w, a] of [
    [-0.45, 0.7, 0.55],
    [-0.12, 0.95, 0.7],
    [0.2, 0.8, 0.6],
    [0.5, 0.6, 0.5],
  ] as const) {
    const y = cy + dy * S;
    const x0 = cx - (w / 2) * S;
    g.moveTo(x0, y)
      .bezierCurveTo(x0 + 0.2 * S, y - 0.12 * S, x0 + 0.4 * S, y + 0.1 * S, x0 + 0.55 * S, y)
      .bezierCurveTo(x0 + 0.7 * S, y - 0.1 * S, x0 + w * S - 0.1 * S, y + 0.08 * S, x0 + w * S, y)
      .stroke({ width: 0.07 * S, color: FOG.light, alpha: a, cap: 'round' });
  }
  // A question mark: "unexplored".
  const r = 0.16 * S;
  g.arc(cx, cy - 0.05 * S, r, Math.PI * 1.1, Math.PI * 2.25).stroke({
    width: 0.07 * S,
    color: 0xffffff,
    alpha: 0.8,
    cap: 'round',
  });
  g.moveTo(cx + r * Math.cos(Math.PI * 2.25), cy - 0.05 * S + r * Math.sin(Math.PI * 2.25))
    .lineTo(cx, cy + 0.18 * S)
    .stroke({ width: 0.07 * S, color: 0xffffff, alpha: 0.8, cap: 'round' });
  g.circle(cx, cy + 0.32 * S, 0.045 * S).fill({ color: 0xffffff, alpha: 0.8 });
}

export function seaHex(g: Graphics, cx: number, cy: number, S: number): void {
  g.poly(hexPoints(cx, cy, S)).fill(SEA.base);
  g.poly(hexPoints(cx, cy, S * 0.97)).stroke({ width: 1.5, color: SEA.wave, alpha: 0.2 });
  for (const [dx, dy, wd] of [
    [-0.3, -0.12, 0.34],
    [0.28, 0.2, 0.3],
    [-0.12, 0.48, 0.26],
  ] as const) {
    const x = cx + dx * S;
    const y = cy + dy * S;
    g.moveTo(x - (wd * S) / 2, y)
      .quadraticCurveTo(x - (wd * S) / 4, y - 0.07 * S, x, y)
      .quadraticCurveTo(x + (wd * S) / 4, y + 0.07 * S, x + (wd * S) / 2, y)
      .stroke({ width: 2.2, color: SEA.wave, alpha: 0.38, cap: 'round' });
  }
}

// ---------------------------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------------------------

/** A ship on an edge (local coordinates: the hull along x). */
export function drawShip(g: Graphics, S: number, color: number, warship = false): void {
  const hull = [-0.3, -0.02, 0.32, -0.02, 0.22, 0.12, -0.22, 0.12].map((v) => v * S);
  g.ellipse(2, 0.15 * S, 0.3 * S, 0.05 * S).fill({ color: 0x000000, alpha: 0.28 });
  g.poly(hull).fill(color).stroke({ width: 2.4, color: INK, join: 'round' });
  g.moveTo(-0.26 * S, 0.03 * S)
    .lineTo(0.26 * S, 0.03 * S)
    .stroke({ width: 1.4, color: shade(color, -0.35), alpha: 0.8 });
  g.moveTo(0, -0.02 * S)
    .lineTo(0, -0.36 * S)
    .stroke({ width: 2, color: INK });
  g.poly([0.02 * S, -0.34 * S, 0.02 * S, -0.06 * S, 0.22 * S, -0.08 * S])
    .fill(0xf3ead2)
    .stroke({ width: 1.6, color: INK, join: 'round' });
  if (warship) {
    // A second sail and a red pennant: a warship ("laid on its side" on the table).
    g.poly([-0.02 * S, -0.3 * S, -0.02 * S, -0.06 * S, -0.18 * S, -0.08 * S])
      .fill(0xf3ead2)
      .stroke({ width: 1.6, color: INK, join: 'round' });
    g.poly([0, -0.36 * S, 0.14 * S, -0.41 * S, 0, -0.45 * S])
      .fill(0xd9433a)
      .stroke({ width: 1, color: INK });
    g.moveTo(0, -0.36 * S)
      .lineTo(0, -0.45 * S)
      .stroke({ width: 2, color: INK });
  }
}

/** The pirate ship (black hull, black sail, skull flag), centred on (0, 0). */
export function drawPirate(g: Graphics, S: number, scale = 1): void {
  const k = S * scale;
  g.ellipse(3, 0.2 * k, 0.42 * k, 0.07 * k).fill({ color: 0x000000, alpha: 0.35 });
  g.poly([-0.42 * k, 0, 0.44 * k, 0, 0.3 * k, 0.18 * k, -0.3 * k, 0.18 * k])
    .fill(PIRATE_HULL)
    .stroke({ width: 2.4, color: 0x000000, join: 'round' });
  g.moveTo(-0.34 * k, 0.06 * k)
    .lineTo(0.34 * k, 0.06 * k)
    .stroke({ width: 1.5, color: 0x8a1f1f });
  for (const x of [-0.08, 0.14]) {
    g.moveTo(x * k, 0)
      .lineTo(x * k, -0.5 * k)
      .stroke({ width: 2.4, color: 0x000000 });
  }
  g.poly([-0.06 * k, -0.46 * k, -0.06 * k, -0.06 * k, -0.34 * k, -0.08 * k])
    .fill(0x2a2730)
    .stroke({ width: 1.5, color: 0x000000 });
  g.poly([0.16 * k, -0.48 * k, 0.16 * k, -0.06 * k, 0.4 * k, -0.08 * k])
    .fill(0x2a2730)
    .stroke({ width: 1.5, color: 0x000000 });
  // Jolly Roger.
  g.rect(0.14 * k, -0.66 * k, 0.2 * k, 0.13 * k)
    .fill(0x111111)
    .stroke({ width: 1, color: 0x000000 });
  g.circle(0.24 * k, -0.61 * k, 0.035 * k).fill(0xf3ead2);
  g.moveTo(0.18 * k, -0.56 * k)
    .lineTo(0.3 * k, -0.545 * k)
    .stroke({ width: 1.2, color: 0xf3ead2 });
}
