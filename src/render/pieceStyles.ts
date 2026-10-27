/**
 * Cosmetic settlement / city styles (player profile, src/ui/profile/model.ts). Purely visual:
 * every style draws the same piece in the same spot, only the silhouette changes.
 *
 * Conventions (same as `drawSettlement` / `drawCity` in ./art): flat vector shapes into a Pixi
 * `Graphics` in design px, offsets below are hex units (1 = HEX_SIZE px), (x, y) is the vertex,
 * the player colour is the main fill, a dark INK outline keeps light colours readable on light
 * terrain. Footprints match Classic so expansion overlays (C&K walls / metropolis) still fit:
 * settlements within about ±0.20 x, -0.26..+0.16 y; cities within ±0.33 x, -0.36..+0.19 y.
 * Deterministic, no randomness.
 */
import type { Graphics } from 'pixi.js';
import type { PieceStyleId } from '../ui/profile/model';
import { drawCity, drawSettlement, shade } from './art';
import { HEX_SIZE as U } from './geometry';
import { INK } from './theme';

export interface PieceStyle {
  id: PieceStyleId;
  /** Settlement whose base centre is the vertex (x, y), design px, player colour 0xRRGGBB. */
  settlement(g: Graphics, x: number, y: number, color: number): void;
  city(g: Graphics, x: number, y: number, color: number): void;
}

// ---------------------------------------------------------------------------
// Drawing kit
// ---------------------------------------------------------------------------

const LINE = { width: 2.6, color: INK, join: 'round' } as const;
const FINE = { width: 1.1, color: INK, join: 'round' } as const;
const LIT = 0xffe9a8;
const WOOD = 0x4a3020;
const GOLD = 0xe8b94a;

/** Flat [x, y, ...] list in hex units -> design px around (x, y). */
function at(x: number, y: number, rel: readonly number[]): number[] {
  const out = new Array<number>(rel.length);
  for (let i = 0; i < rel.length; i += 2) {
    out[i] = x + (rel[i] ?? 0) * U;
    out[i + 1] = y + (rel[i + 1] ?? 0) * U;
  }
  return out;
}

/** A piece drawer bound to one vertex: every coordinate is in hex units relative to it. */
class Pen {
  constructor(
    readonly g: Graphics,
    readonly x: number,
    readonly y: number,
  ) {}
  X(v: number): number {
    return this.x + v * U;
  }
  Y(v: number): number {
    return this.y + v * U;
  }
  shadow(dy: number, rx: number, ry: number): void {
    this.g.ellipse(this.x + 2, this.Y(dy), rx * U, ry * U).fill({ color: 0x000000, alpha: 0.3 });
  }
  /** Outlined solid polygon. */
  solid(rel: readonly number[], color: number): void {
    this.g
      .poly(at(this.x, this.y, rel))
      .fill(color)
      .stroke(LINE);
  }
  /** Unoutlined tint polygon (shading facets). */
  tint(rel: readonly number[], color: number, alpha: number): void {
    this.g.poly(at(this.x, this.y, rel)).fill({ color, alpha });
  }
  box(l: number, t: number, r: number, b: number, color: number): void {
    this.g
      .rect(this.X(l), this.Y(t), (r - l) * U, (b - t) * U)
      .fill(color)
      .stroke(LINE);
  }
  boxTint(l: number, t: number, r: number, b: number, color: number, alpha: number): void {
    this.g.rect(this.X(l), this.Y(t), (r - l) * U, (b - t) * U).fill({ color, alpha });
  }
  line(x0: number, y0: number, x1: number, y1: number, width: number, alpha = 1, color = INK) {
    this.g
      .moveTo(this.X(x0), this.Y(y0))
      .lineTo(this.X(x1), this.Y(y1))
      .stroke({ width, color, alpha, cap: 'round' });
  }
  /** Small lit window centred on (cx, cy). */
  window(cx: number, cy: number, w: number, h: number): void {
    this.g
      .rect(this.X(cx - w / 2), this.Y(cy - h / 2), w * U, h * U)
      .fill({ color: LIT, alpha: 0.95 })
      .stroke(FINE);
  }
  /** Round-topped opening standing on `bottom` (doors, arched windows). */
  arch(cx: number, bottom: number, w: number, h: number, color: number, alpha: number) {
    const r = (w / 2) * U;
    const l = this.X(cx) - r;
    const spring = this.Y(bottom - h) + r;
    this.g
      .moveTo(l, this.Y(bottom))
      .lineTo(l, spring)
      .arc(this.X(cx), spring, r, Math.PI, 0)
      .lineTo(l + 2 * r, this.Y(bottom))
      .closePath()
      .fill({ color, alpha });
  }
  litArch(cx: number, bottom: number, w: number, h: number) {
    this.arch(cx, bottom, w, h, LIT, 0.95);
    this.g.stroke(FINE);
  }
  door(cx: number, bottom: number, w: number, h: number) {
    this.arch(cx, bottom, w, h, INK, 0.72);
  }
  /** Rounded box (adobe) in `color` with its right side shaded and a sunlit top edge. */
  softBox(l: number, t: number, r: number, b: number, rad: number, color: number) {
    const { g } = this;
    g.roundRect(this.X(l), this.Y(t), (r - l) * U, (b - t) * U, rad * U)
      .fill(color)
      .stroke(LINE);
    const s = r - (r - l) * 0.24;
    g.moveTo(this.X(s), this.Y(t))
      .lineTo(this.X(r - rad), this.Y(t))
      .quadraticCurveTo(this.X(r), this.Y(t), this.X(r), this.Y(t + rad))
      .lineTo(this.X(r), this.Y(b - rad))
      .quadraticCurveTo(this.X(r), this.Y(b), this.X(r - rad), this.Y(b))
      .lineTo(this.X(s), this.Y(b))
      .closePath()
      .fill({ color: 0x000000, alpha: 0.17 });
    this.line(l + rad, t + 0.012, s - 0.01, t + 0.012, 2, 0.4, 0xffffff);
  }
}

// ---------------------------------------------------------------------------
// Timber: half-timbered Tudor cottage / townhouses
// ---------------------------------------------------------------------------

const BEAM = 2.1;
const BEAM_A = 0.78;

function timberSettlement(g: Graphics, x: number, y: number, color: number) {
  const p = new Pen(g, x, y);
  const roof = shade(color, -0.3);
  p.shadow(0.15, 0.21, 0.065);
  // Chimney behind the roof.
  p.box(0.065, -0.235, 0.115, -0.1, shade(color, -0.45));
  // Ground floor, jettied upper floor, steep roof.
  p.solid([-0.12, 0.14, -0.12, 0.035, 0.12, 0.035, 0.12, 0.14], color);
  p.solid([-0.15, 0.045, -0.15, -0.065, 0.15, -0.065, 0.15, 0.045], color);
  p.solid([-0.18, -0.06, 0, -0.265, 0.18, -0.06], roof);
  p.tint([-0.18, -0.06, 0, -0.265, -0.025, -0.06], 0xffffff, 0.2);
  // Timber frame.
  p.line(-0.075, -0.065, -0.075, 0.045, BEAM, BEAM_A);
  p.line(0.075, -0.065, 0.075, 0.045, BEAM, BEAM_A);
  p.line(-0.15, 0.045, -0.075, -0.065, BEAM, BEAM_A);
  p.line(0.15, 0.045, 0.075, -0.065, BEAM, BEAM_A);
  p.line(-0.06, 0.035, -0.06, 0.14, BEAM, BEAM_A);
  p.line(0.06, 0.035, 0.06, 0.14, BEAM, BEAM_A);
  p.window(0, -0.012, 0.07, 0.06);
  p.door(0, 0.14, 0.06, 0.085);
  p.g
    .circle(p.X(0), p.Y(-0.14), 0.026 * U)
    .fill({ color: LIT, alpha: 0.95 })
    .stroke(FINE);
}

function timberCity(g: Graphics, x: number, y: number, color: number) {
  const p = new Pen(g, x, y);
  const roof = shade(color, -0.3);
  p.shadow(0.18, 0.35, 0.075);
  // Right-hand townhouse (behind), hipped roof and chimney.
  p.box(0.2, -0.255, 0.245, -0.13, shade(color, -0.45));
  p.solid([0.02, 0.17, 0.02, -0.04, 0.28, -0.04, 0.28, 0.17], color);
  p.solid([-0.005, -0.035, 0.065, -0.175, 0.245, -0.175, 0.31, -0.035], roof);
  p.tint([-0.005, -0.035, 0.065, -0.175, 0.1, -0.175, 0.06, -0.035], 0xffffff, 0.2);
  p.line(0.02, 0.06, 0.28, 0.06, BEAM, BEAM_A);
  p.line(0.105, -0.04, 0.105, 0.17, BEAM, BEAM_A);
  p.line(0.195, -0.04, 0.195, 0.17, BEAM, BEAM_A);
  p.line(0.195, 0.06, 0.28, -0.04, BEAM, BEAM_A);
  p.window(0.15, 0.01, 0.06, 0.06);
  p.window(0.237, 0.012, 0.045, 0.05);
  p.door(0.15, 0.17, 0.055, 0.085);
  // Tall gabled townhouse in front: ground floor, jettied first floor, steep gable.
  p.solid([-0.28, 0.17, -0.28, 0.055, 0.03, 0.055, 0.03, 0.17], color);
  p.solid([-0.305, 0.065, -0.305, -0.075, 0.055, -0.075, 0.055, 0.065], color);
  p.solid([-0.33, -0.07, -0.125, -0.35, 0.08, -0.07], roof);
  p.tint([-0.33, -0.07, -0.125, -0.35, -0.155, -0.07], 0xffffff, 0.2);
  p.line(-0.215, -0.075, -0.215, 0.065, BEAM, BEAM_A);
  p.line(-0.035, -0.075, -0.035, 0.065, BEAM, BEAM_A);
  p.line(-0.305, 0.065, -0.215, -0.075, BEAM, BEAM_A);
  p.line(0.055, 0.065, -0.035, -0.075, BEAM, BEAM_A);
  p.line(-0.16, 0.055, -0.16, 0.17, BEAM, BEAM_A);
  p.line(-0.02, 0.055, -0.02, 0.17, BEAM, BEAM_A);
  p.window(-0.125, -0.008, 0.075, 0.065);
  p.window(-0.22, 0.11, 0.06, 0.05);
  p.door(-0.09, 0.17, 0.06, 0.09);
  p.g
    .circle(p.X(-0.125), p.Y(-0.17), 0.032 * U)
    .fill({ color: LIT, alpha: 0.95 })
    .stroke(FINE);
}

// ---------------------------------------------------------------------------
// Longhouse: low Nordic hall with a sway-backed roof and crossed dragon boards
// ---------------------------------------------------------------------------

/** Long hall: walls l..r from `top` to `bottom`, roof eaves overhanging by 0.03. */
function hall(
  p: Pen,
  l: number,
  r: number,
  top: number,
  bottom: number,
  ridge: number,
  color: number,
) {
  const { g } = p;
  const cx = (l + r) / 2;
  const half = (r - l) / 2;
  const eave = top + 0.015;
  const el = l - 0.035;
  const er = r + 0.035;
  const rl = l + half * 0.2;
  const rr = r - half * 0.2;
  p.box(l, top, r, bottom, color);
  // Planks.
  for (let i = 1; i < 6; i++) {
    const vx = l + ((r - l) * i) / 6;
    p.line(vx, top + 0.01, vx, bottom - 0.005, 1, 0.22);
  }
  const roof = shade(color, -0.25);
  const sag = ridge + 0.05;
  g.moveTo(p.X(el), p.Y(eave))
    .quadraticCurveTo(p.X(el + 0.02), p.Y((eave + ridge) / 2), p.X(rl), p.Y(ridge))
    .quadraticCurveTo(p.X(cx), p.Y(sag), p.X(rr), p.Y(ridge))
    .quadraticCurveTo(p.X(er - 0.02), p.Y((eave + ridge) / 2), p.X(er), p.Y(eave))
    .quadraticCurveTo(p.X(cx), p.Y(eave + 0.035), p.X(el), p.Y(eave))
    .closePath()
    .fill(roof)
    .stroke(LINE);
  // Shingle courses and a sunlit band under the ridge.
  const mid = (eave + ridge) / 2;
  g.moveTo(p.X(el + 0.02), p.Y(mid + 0.025))
    .quadraticCurveTo(p.X(cx), p.Y(mid + 0.06), p.X(er - 0.02), p.Y(mid + 0.025))
    .stroke({ width: 1.2, color: INK, alpha: 0.3 });
  g.moveTo(p.X(rl + 0.01), p.Y(ridge + 0.03))
    .quadraticCurveTo(p.X(cx), p.Y(sag + 0.03), p.X(rr - 0.01), p.Y(ridge + 0.03))
    .stroke({ width: 3, color: 0xffffff, alpha: 0.28, cap: 'round' });
  dragonBoards(p, rl, ridge, color);
  dragonBoards(p, rr, ridge, color);
}

/** Crossed gable boards above a ridge end, curling into little heads. */
function dragonBoards(p: Pen, ex: number, ey: number, color: number) {
  const wood = shade(color, -0.55);
  const tips: readonly (readonly [number, number, number, number])[] = [
    [ex - 0.03, ey + 0.03, ex + 0.028, ey - 0.06],
    [ex + 0.03, ey + 0.03, ex - 0.028, ey - 0.06],
  ];
  for (const [x0, y0, x1, y1] of tips) p.line(x0, y0, x1, y1, 4.6);
  for (const [x0, y0, x1, y1] of tips) p.line(x0, y0, x1, y1, 2, 1, wood);
  // Dragon heads: a knob curling outward at each tip.
  for (const [x0, , x1, y1] of tips) {
    const out = x1 > x0 ? 1 : -1;
    p.g
      .circle(p.X(x1 + out * 0.008), p.Y(y1 - 0.004), 0.016 * U)
      .fill(wood)
      .stroke({ width: 1.4, color: INK });
    p.g.circle(p.X(x1 + out * 0.012), p.Y(y1 - 0.007), 0.0045 * U).fill(GOLD);
  }
}

function longhouseSettlement(g: Graphics, x: number, y: number, color: number) {
  const p = new Pen(g, x, y);
  p.shadow(0.15, 0.23, 0.06);
  hall(p, -0.165, 0.165, 0.03, 0.14, -0.125, color);
  p.door(0, 0.14, 0.06, 0.08);
  p.window(-0.105, 0.085, 0.035, 0.03);
  p.window(0.105, 0.085, 0.035, 0.03);
}

function longhouseCity(g: Graphics, x: number, y: number, color: number) {
  const p = new Pen(g, x, y);
  const roof = shade(color, -0.25);
  p.shadow(0.18, 0.35, 0.075);
  // Stave tower behind the hall: lower body, skirt roof, belfry, spire.
  p.box(0.155, -0.1, 0.285, 0.15, color);
  p.box(0.175, -0.205, 0.265, -0.09, color);
  p.window(0.22, -0.15, 0.035, 0.04);
  p.solid([0.12, -0.035, 0.32, -0.035, 0.28, -0.115, 0.16, -0.115], roof);
  p.solid([0.145, -0.19, 0.22, -0.355, 0.295, -0.19], roof);
  p.tint([0.145, -0.19, 0.22, -0.355, 0.205, -0.19], 0xffffff, 0.22);
  p.tint([0.12, -0.035, 0.16, -0.115, 0.2, -0.115, 0.175, -0.035], 0xffffff, 0.18);
  // The great hall.
  hall(p, -0.3, 0.16, 0.06, 0.17, -0.135, color);
  p.door(-0.07, 0.17, 0.07, 0.095);
  p.window(-0.215, 0.115, 0.04, 0.035);
  p.window(0.075, 0.115, 0.04, 0.035);
}

// ---------------------------------------------------------------------------
// Keep: crenellated stone towers, curtain wall
// ---------------------------------------------------------------------------

/** A square tower: tapered body l..r from `top` to `bottom`, corbelled parapet, merlons. */
function tower(p: Pen, l: number, r: number, top: number, bottom: number, n: number, c: number) {
  const w = r - l;
  const taper = w * 0.05;
  const pl = l - w * 0.07;
  const pr = r + w * 0.07;
  const pt = top - 0.05;
  const mh = 0.058;
  p.solid([l - taper, bottom, l, top, r, top, r + taper, bottom], c);
  stones(p, l, r, top + 0.02, bottom, 4.5);
  // Shaded right face.
  const s = r - w * 0.28;
  p.tint([s, top, r, top, r + taper, bottom, s, bottom], 0x000000, 0.18);
  // Merlons (behind the parapet's top edge), parapet.
  const mw = (pr - pl) / (2 * n - 1);
  for (let i = 0; i < n; i++) {
    const ml = pl + i * 2 * mw;
    p.box(ml, pt - mh, ml + mw, pt + 0.01, c);
    if (i === n - 1) p.boxTint(ml + mw * 0.45, pt - mh, ml + mw, pt + 0.01, 0x000000, 0.18);
  }
  p.box(pl, pt, pr, top + 0.005, c);
  p.boxTint(pr - (pr - pl) * 0.26, pt, pr, top + 0.005, 0x000000, 0.18);
  p.line(pl + 0.012, pt + 0.012, pr - (pr - pl) * 0.3, pt + 0.012, 1.8, 0.35, 0xffffff);
}

/** Staggered mortar lines over a wall face. */
function stones(p: Pen, l: number, r: number, top: number, bottom: number, rows: number) {
  const h = (bottom - top) / rows;
  for (let i = 1; i < rows; i++) {
    const yy = top + i * h;
    p.line(l + 0.012, yy, r - 0.012, yy, 1, 0.28);
  }
  const step = (r - l) / 3;
  for (let i = 0; i < Math.ceil(rows); i++) {
    const y0 = top + i * h + 0.008;
    const y1 = Math.min(bottom, top + (i + 1) * h) - 0.008;
    if (y1 <= y0) continue;
    const off = i % 2 === 0 ? step : step * 1.5;
    for (let vx = l + off; vx < r - 0.02; vx += step) p.line(vx, y0, vx, y1, 1, 0.24);
  }
}

function keepSettlement(g: Graphics, x: number, y: number, color: number) {
  const p = new Pen(g, x, y);
  p.shadow(0.15, 0.2, 0.06);
  tower(p, -0.125, 0.125, -0.135, 0.14, 3, color);
  p.window(-0.005, -0.075, 0.032, 0.06);
  p.door(-0.005, 0.14, 0.075, 0.1);
}

function keepCity(g: Graphics, x: number, y: number, color: number) {
  const p = new Pen(g, x, y);
  p.shadow(0.18, 0.36, 0.08);
  // The keep (back left) and a second tower (right).
  tower(p, -0.215, 0.025, -0.235, 0.1, 4, color);
  tower(p, 0.155, 0.285, -0.115, 0.12, 3, color);
  // Banner hanging on the keep.
  p.g
    .poly(at(x, y, [-0.15, -0.24, -0.08, -0.24, -0.08, -0.095, -0.115, -0.125, -0.15, -0.095]))
    .fill(shade(color, 0.45))
    .stroke({ width: 1.4, color: INK, join: 'round' });
  p.g.circle(p.X(-0.115), p.Y(-0.185), 0.016 * U).fill(GOLD);
  p.window(-0.03, -0.14, 0.03, 0.055);
  p.window(0.22, -0.06, 0.03, 0.05);
  // Curtain wall in front with a wall-walk of merlons and a gate.
  const n = 7;
  const mw = 0.6 / (2 * n - 1);
  for (let i = 0; i < n; i++) {
    const ml = -0.3 + i * 2 * mw;
    p.box(ml, -0.045, ml + mw, 0.01, color);
  }
  p.box(-0.3, 0.0, 0.3, 0.17, color);
  stones(p, -0.3, 0.3, 0.0, 0.17, 3);
  p.boxTint(0.16, -0.0, 0.3, 0.17, 0x000000, 0.14);
  p.line(-0.29, 0.012, 0.15, 0.012, 1.8, 0.35, 0xffffff);
  p.arch(0.06, 0.17, 0.1, 0.13, INK, 0.85);
  p.line(0.043, 0.07, 0.043, 0.165, 1.1, 0.55, shade(color, 0.3));
  p.line(0.077, 0.07, 0.077, 0.165, 1.1, 0.55, shade(color, 0.3));
  p.line(0.015, 0.115, 0.105, 0.115, 1.1, 0.55, shade(color, 0.3));
}

// ---------------------------------------------------------------------------
// Adobe: rounded mud-brick blocks, vigas, domes and a minaret
// ---------------------------------------------------------------------------

/** Row of protruding roof-beam ends. */
function vigas(p: Pen, l: number, r: number, yy: number, n: number) {
  const step = (r - l) / (n - 1);
  for (let i = 0; i < n; i++) {
    p.g.circle(p.X(l + i * step), p.Y(yy), 0.011 * U).fill(WOOD);
  }
}

function adobeSettlement(g: Graphics, x: number, y: number, color: number) {
  const p = new Pen(g, x, y);
  p.shadow(0.15, 0.22, 0.06);
  // Upper room behind, the ladder up to it, the main block in front.
  p.softBox(-0.135, -0.18, 0.055, 0.0, 0.035, color);
  vigas(p, -0.105, 0.025, -0.152, 4);
  p.litArch(-0.04, -0.045, 0.04, 0.06);
  p.softBox(-0.18, -0.035, 0.18, 0.14, 0.04, color);
  vigas(p, -0.14, 0.14, 0.0, 6);
  const rail = { width: 1.8, color: WOOD, cap: 'round' } as const;
  p.g
    .moveTo(p.X(0.085), p.Y(-0.035))
    .lineTo(p.X(0.07), p.Y(-0.235))
    .moveTo(p.X(0.125), p.Y(-0.035))
    .lineTo(p.X(0.11), p.Y(-0.235))
    .stroke(rail);
  for (let i = 0; i < 4; i++) {
    const yy = -0.07 - i * 0.045;
    const dx = (-0.035 - yy) * 0.075;
    p.g
      .moveTo(p.X(0.085 - dx), p.Y(yy))
      .lineTo(p.X(0.125 - dx), p.Y(yy))
      .stroke({ width: 1.4, color: WOOD });
  }
  p.door(0.07, 0.14, 0.065, 0.1);
  p.litArch(-0.1, 0.085, 0.045, 0.055);
}

function adobeCity(g: Graphics, x: number, y: number, color: number) {
  const p = new Pen(g, x, y);
  const { g: gg } = p;
  p.shadow(0.18, 0.36, 0.08);
  // Minaret (behind, right): shaft, balcony, lantern, cap.
  p.box(0.2, -0.235, 0.275, 0.12, color);
  p.boxTint(0.255, -0.235, 0.275, 0.12, 0x000000, 0.17);
  p.box(0.21, -0.285, 0.265, -0.215, color);
  p.box(0.185, -0.225, 0.29, -0.198, shade(color, -0.2));
  gg.moveTo(p.X(0.205), p.Y(-0.282))
    .arc(p.X(0.2375), p.Y(-0.282), 0.0325 * U, Math.PI, 0)
    .closePath()
    .fill(color)
    .stroke(LINE);
  p.line(0.2375, -0.316, 0.2375, -0.358, 2);
  p.litArch(0.2375, -0.22 + 0.0, 0.025, 0.045);
  p.litArch(0.2375, -0.07, 0.03, 0.06);
  // Main block.
  p.softBox(-0.3, -0.045, 0.21, 0.17, 0.045, color);
  vigas(p, -0.26, 0.17, -0.01, 8);
  // Drum and onion dome.
  p.box(-0.19, -0.085, 0.03, -0.035, color);
  p.boxTint(-0.02, -0.085, 0.03, -0.035, 0x000000, 0.17);
  gg.moveTo(p.X(-0.185), p.Y(-0.08))
    .bezierCurveTo(p.X(-0.215), p.Y(-0.175), p.X(-0.105), p.Y(-0.19), p.X(-0.08), p.Y(-0.26))
    .bezierCurveTo(p.X(-0.055), p.Y(-0.19), p.X(0.055), p.Y(-0.175), p.X(0.025), p.Y(-0.08))
    .closePath()
    .fill(color)
    .stroke(LINE);
  gg.moveTo(p.X(-0.08), p.Y(-0.255))
    .bezierCurveTo(p.X(-0.06), p.Y(-0.19), p.X(0.05), p.Y(-0.175), p.X(0.022), p.Y(-0.085))
    .lineTo(p.X(-0.03), p.Y(-0.085))
    .bezierCurveTo(p.X(-0.02), p.Y(-0.15), p.X(-0.05), p.Y(-0.2), p.X(-0.08), p.Y(-0.255))
    .fill({ color: 0x000000, alpha: 0.18 });
  gg.moveTo(p.X(-0.165), p.Y(-0.095))
    .bezierCurveTo(p.X(-0.18), p.Y(-0.16), p.X(-0.13), p.Y(-0.18), p.X(-0.1), p.Y(-0.205))
    .stroke({ width: 3, color: 0xffffff, alpha: 0.35, cap: 'round' });
  p.line(-0.08, -0.26, -0.08, -0.305, 2);
  gg.circle(p.X(-0.08), p.Y(-0.31), 0.014 * U)
    .fill(GOLD)
    .stroke({ width: 1, color: INK });
  // Openings.
  p.litArch(-0.235, 0.085, 0.045, 0.06);
  p.litArch(-0.15, 0.085, 0.045, 0.06);
  p.litArch(0.13, 0.085, 0.045, 0.06);
  p.door(-0.01, 0.17, 0.085, 0.12);
}

// ---------------------------------------------------------------------------
// Pagoda: tiers of upturned eaves
// ---------------------------------------------------------------------------

/**
 * A curved roof whose eave line sits at `eave`, tips lifted at ±half, concave slopes up to a
 * ridge `h` above the eave, `ridge` half-wide.
 */
function eaveRoof(p: Pen, half: number, eave: number, h: number, ridge: number, color: number) {
  const { g } = p;
  const lift = 0.02 + half * 0.12;
  const top = eave - h;
  const roof = shade(color, -0.2);
  g.moveTo(p.X(-half), p.Y(eave - lift))
    .quadraticCurveTo(p.X(-half * 0.82), p.Y(eave), p.X(-half * 0.55), p.Y(eave))
    .lineTo(p.X(half * 0.55), p.Y(eave))
    .quadraticCurveTo(p.X(half * 0.82), p.Y(eave), p.X(half), p.Y(eave - lift))
    .quadraticCurveTo(p.X(half * 0.5), p.Y(eave - h * 0.3), p.X(ridge), p.Y(top))
    .lineTo(p.X(-ridge), p.Y(top))
    .quadraticCurveTo(p.X(-half * 0.5), p.Y(eave - h * 0.3), p.X(-half), p.Y(eave - lift))
    .closePath()
    .fill(roof)
    .stroke(LINE);
  // Sunlit left slope and a fascia line along the eave.
  g.moveTo(p.X(-half), p.Y(eave - lift))
    .quadraticCurveTo(p.X(-half * 0.5), p.Y(eave - h * 0.3), p.X(-ridge), p.Y(top))
    .lineTo(p.X(-ridge * 0.2), p.Y(top))
    .quadraticCurveTo(p.X(-half * 0.3), p.Y(eave - h * 0.25), p.X(-half * 0.55), p.Y(eave))
    .quadraticCurveTo(p.X(-half * 0.82), p.Y(eave), p.X(-half), p.Y(eave - lift))
    .fill({ color: 0xffffff, alpha: 0.22 });
  g.moveTo(p.X(-half * 0.9), p.Y(eave - lift * 0.55))
    .quadraticCurveTo(p.X(-half * 0.75), p.Y(eave - 0.016), p.X(-half * 0.5), p.Y(eave - 0.016))
    .lineTo(p.X(half * 0.5), p.Y(eave - 0.016))
    .quadraticCurveTo(p.X(half * 0.75), p.Y(eave - 0.016), p.X(half * 0.9), p.Y(eave - lift * 0.55))
    .stroke({ width: 1.2, color: INK, alpha: 0.4 });
}

/** Pagoda wall storey l..r (symmetric about x) with corner posts. */
function storey(p: Pen, half: number, top: number, bottom: number, color: number) {
  p.box(-half, top, half, bottom, color);
  p.boxTint(half * 0.45, top, half, bottom, 0x000000, 0.15);
  p.line(-half * 0.55, top, -half * 0.55, bottom, 1.6, 0.55);
  p.line(half * 0.55, top, half * 0.55, bottom, 1.6, 0.55);
}

function latticeDoor(p: Pen, cx: number, top: number, bottom: number, w: number) {
  p.g
    .rect(p.X(cx - w / 2), p.Y(top), w * U, (bottom - top) * U)
    .fill({ color: LIT, alpha: 0.95 })
    .stroke(FINE);
  p.line(cx, top, cx, bottom, 1, 0.7);
  p.line(cx - w / 2, (top + bottom) / 2, cx + w / 2, (top + bottom) / 2, 1, 0.7);
}

function finial(p: Pen, base: number, tip: number) {
  p.line(0, base, 0, tip + 0.015, 2.4);
  p.line(-0.018, base - (base - tip) * 0.35, 0.018, base - (base - tip) * 0.35, 1.6);
  p.g
    .circle(p.X(0), p.Y(tip + 0.014), 0.015 * U)
    .fill(GOLD)
    .stroke({ width: 1, color: INK });
}

function pagodaSettlement(g: Graphics, x: number, y: number, color: number) {
  const p = new Pen(g, x, y);
  p.shadow(0.15, 0.21, 0.06);
  p.box(-0.15, 0.105, 0.15, 0.15, shade(color, -0.4));
  storey(p, 0.11, -0.03, 0.11, color);
  latticeDoor(p, 0, 0.015, 0.11, 0.06);
  finial(p, -0.16, -0.25);
  eaveRoof(p, 0.2, -0.02, 0.145, 0.055, color);
}

function pagodaCity(g: Graphics, x: number, y: number, color: number) {
  const p = new Pen(g, x, y);
  p.shadow(0.18, 0.33, 0.075);
  // Back to front / top to bottom: each roof covers its storey's top and the next one's foot.
  finial(p, -0.29, -0.365);
  storey(p, 0.075, -0.24, -0.16, color);
  eaveRoof(p, 0.17, -0.23, 0.075, 0.018, color);
  storey(p, 0.115, -0.135, -0.06, color);
  p.window(0, -0.1, 0.05, 0.04);
  eaveRoof(p, 0.24, -0.125, 0.06, 0.08, color);
  p.box(-0.22, 0.13, 0.22, 0.18, shade(color, -0.4));
  storey(p, 0.165, -0.01, 0.13, color);
  latticeDoor(p, 0, 0.035, 0.13, 0.075);
  p.window(-0.115, 0.07, 0.04, 0.04);
  p.window(0.115, 0.07, 0.04, 0.04);
  eaveRoof(p, 0.31, 0.0, 0.07, 0.12, color);
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const PIECE_STYLES: Readonly<Record<PieceStyleId, PieceStyle>> = Object.freeze({
  classic: { id: 'classic', settlement: drawSettlement, city: drawCity },
  timber: { id: 'timber', settlement: timberSettlement, city: timberCity },
  longhouse: { id: 'longhouse', settlement: longhouseSettlement, city: longhouseCity },
  keep: { id: 'keep', settlement: keepSettlement, city: keepCity },
  adobe: { id: 'adobe', settlement: adobeSettlement, city: adobeCity },
  pagoda: { id: 'pagoda', settlement: pagodaSettlement, city: pagodaCity },
});

/** The style for an id; unknown/undefined -> classic. */
export function pieceStyle(id: string | undefined | null): PieceStyle {
  return id && Object.hasOwn(PIECE_STYLES, id)
    ? PIECE_STYLES[id as PieceStyleId]
    : PIECE_STYLES.classic;
}
