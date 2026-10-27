/**
 * Cities & Knights board drawer: city walls (a stone ring under the city), knights (a shield in
 * the owner's colour, 1-3 rank chevrons for basic / strong / mighty, gold rim and pennant when
 * active, dimmed when inactive), metropolises (a gate tower in the track's colour over the city),
 * the merchant (a cone on its hex) and the sleeping robber ("z z" until the first attack).
 */
import { Container, Graphics } from 'pixi.js';
import { hasRobber, type GameState, type VertexId } from '../../engine';
import type { BoardDrawer, DrawContext } from '../../render/expansions';
import { CK, TRACKS, ckSlice, type Knight, type Track } from './engine';

const INK = 0x2a1708;
const GOLD = 0xf2c35a;
/** Gate / flag colours of the tracks (yellow trade, blue politics, green science). */
export const TRACK_COLOR: Readonly<Record<Track, number>> = {
  trade: 0xe2b52e,
  politics: 0x3d6fd6,
  science: 0x3f9d4b,
};

/** A knight shield at (x, y). */
export function drawKnight(
  g: Graphics,
  x: number,
  y: number,
  S: number,
  k: Knight,
  color: number,
  shade: (c: number, a: number) => number,
): void {
  const w = S * (0.15 + 0.02 * k.level);
  const top = y - w * 1.05;
  const bottom = y + w * 1.15;
  const fill = k.active ? color : shade(color, -0.45);
  const shield = [x - w, top, x + w, top, x + w, y + w * 0.1, x, bottom, x - w, y + w * 0.1];
  g.ellipse(x + 2, bottom - 1, w * 0.9, w * 0.25).fill({ color: 0x000000, alpha: 0.3 });
  if (k.active) {
    g.poly(shield.map((v, i) => (i % 2 === 0 ? x + (v - x) * 1.22 : y + (v - y) * 1.18))).fill({
      color: GOLD,
      alpha: 0.85,
    });
  }
  g.poly(shield).fill(fill).stroke({ width: 2.2, color: INK, join: 'round' });
  g.poly([x - w, top, x, top, x, bottom, x - w, y + w * 0.1]).fill({
    color: 0xffffff,
    alpha: k.active ? 0.18 : 0.06,
  });
  // Rank chevrons: 1 basic, 2 strong, 3 mighty.
  const ink = k.active ? 0xffffff : 0xb9b2a6;
  for (let i = 0; i < k.level; i++) {
    const cy = top + w * (0.45 + 0.5 * i);
    g.moveTo(x - w * 0.55, cy)
      .lineTo(x, cy + w * 0.32)
      .lineTo(x + w * 0.55, cy)
      .stroke({ width: Math.max(1.6, S * 0.035), color: ink, cap: 'round', join: 'round' });
  }
  if (k.active) {
    // Pennant on a pole: ready to defend.
    const px = x + w * 0.95;
    g.moveTo(px, top + w * 0.2)
      .lineTo(px, top - w * 0.9)
      .stroke({ width: 1.6, color: INK });
    g.poly([px, top - w * 0.9, px + w * 0.75, top - w * 0.62, px, top - w * 0.35])
      .fill(GOLD)
      .stroke({ width: 1, color: INK });
  }
}

/** A stone wall ring under a city at (x, y). */
export function drawWall(g: Graphics, x: number, y: number, S: number): void {
  const r = S * 0.4;
  g.ellipse(x + 2, y + S * 0.12, r * 1.05, r * 0.55).fill({ color: 0x000000, alpha: 0.3 });
  g.ellipse(x, y + S * 0.08, r, r * 0.52)
    .fill(0x8f877b)
    .stroke({ width: 2, color: INK });
  // Crenellations along the front rim.
  for (let i = -3; i <= 3; i++) {
    const cx = x + (i / 3.4) * r;
    const cy = y + S * 0.08 + Math.sqrt(Math.max(0, 1 - (i / 3.4) ** 2)) * r * 0.52;
    g.rect(cx - S * 0.03, cy - S * 0.06, S * 0.06, S * 0.06)
      .fill(0xb3ab9d)
      .stroke({ width: 1, color: INK });
  }
}

/** A metropolis gate tower in `color` over a city at (x, y). */
export function drawMetropolis(g: Graphics, x: number, y: number, S: number, color: number): void {
  const w = S * 0.12;
  const base = y - S * 0.08;
  const top = y - S * 0.55;
  g.rect(x - w, top, 2 * w, base - top)
    .fill(color)
    .stroke({ width: 2, color: INK });
  for (const dx of [-w, -w / 3, w / 3]) {
    g.rect(x + dx, top - S * 0.06, (2 * w) / 3 - 1, S * 0.06)
      .fill(color)
      .stroke({ width: 1.2, color: INK });
  }
  // Gate arch.
  g.roundRect(x - w * 0.45, base - S * 0.16, w * 0.9, S * 0.16, w * 0.45).fill(INK);
  g.circle(x, top + S * 0.12, S * 0.035).fill(GOLD);
}

/** The merchant cone standing at (x, y). */
export function drawMerchant(g: Graphics, x: number, y: number, S: number, color: number): void {
  const h = S * 0.42;
  g.ellipse(x + 2, y + 1, S * 0.13, S * 0.05).fill({ color: 0x000000, alpha: 0.35 });
  g.poly([x - S * 0.12, y, x, y - h, x + S * 0.12, y])
    .fill(0xf1e6c8)
    .stroke({ width: 2, color: INK, join: 'round' });
  g.circle(x, y - h, S * 0.07)
    .fill(0xf1e6c8)
    .stroke({ width: 2, color: INK });
  g.ellipse(x, y - S * 0.02, S * 0.12, S * 0.035)
    .fill(color)
    .stroke({ width: 1.2, color: INK });
}

const knightsSig = (state: GameState) => {
  const s = ckSlice(state);
  return Object.entries(s.knights)
    .map(([v, k]) => `${v}:${k.owner}${k.level}${k.active ? 'a' : 'i'}`)
    .sort()
    .join('|');
};

function layer(draw: (g: Graphics, ctx: DrawContext) => void) {
  return (_s: GameState, ctx: DrawContext): Container => {
    const c = new Container();
    const g = new Graphics();
    draw(g, ctx);
    c.addChild(g);
    return c;
  };
}

export const ckDrawer: BoardDrawer = {
  id: CK,
  layers: [
    {
      key: 'walls',
      z: 'board',
      sig: (state) => Object.keys(ckSlice(state).walls).sort().join(','),
      draw: (state, ctx) =>
        layer((g) => {
          for (const v of Object.keys(ckSlice(state).walls) as VertexId[]) {
            const info = ctx.topo.vertex[v];
            if (!info) continue;
            const [x, y] = ctx.pt(info);
            drawWall(g, x, y, ctx.S);
          }
        })(state, ctx),
    },
    {
      key: 'knights',
      z: 'pieces',
      sig: knightsSig,
      draw: (state, ctx) =>
        layer((g) => {
          for (const [v, k] of Object.entries(ckSlice(state).knights) as [VertexId, Knight][]) {
            // Knights of no seat are Catan for Two's neutral knights: `twock` draws them.
            if (!state.players[k.owner]) continue;
            // A knight may stand on a sea vertex (on its owner's ship, Seafarers + C&K).
            const info = ctx.topo.vertex[v] ?? ctx.topo.seaVertex[v];
            if (!info) continue;
            const [x, y] = ctx.pt(info);
            drawKnight(g, x, y, ctx.S, k, ctx.colorOf(k.owner), ctx.art.shade);
          }
        })(state, ctx),
    },
    {
      key: 'metropolis',
      z: 'pieces',
      sig: (state) => JSON.stringify(ckSlice(state).metropolis),
      draw: (state, ctx) =>
        layer((g) => {
          for (const t of TRACKS) {
            const m = ckSlice(state).metropolis[t];
            const info = m ? ctx.topo.vertex[m.vertex] : undefined;
            if (!info) continue;
            const [x, y] = ctx.pt(info);
            drawMetropolis(g, x, y, ctx.S, TRACK_COLOR[t]);
          }
        })(state, ctx),
    },
    {
      key: 'merchant',
      z: 'top',
      sig: (state) => JSON.stringify(ckSlice(state).merchant),
      draw: (state, ctx) =>
        layer((g) => {
          const m = ckSlice(state).merchant;
          const info = m ? ctx.topo.hex[m.hex] : undefined;
          if (!m || !info) return;
          const [x, y] = ctx.pt(info);
          drawMerchant(g, x - ctx.S * 0.45, y + ctx.S * 0.3, ctx.S, ctx.colorOf(m.owner));
        })(state, ctx),
    },
    {
      key: 'sleepingRobber',
      z: 'top',
      sig: (state) => `${ckSlice(state).attacks > 0 ? 'awake' : 'asleep'}:${state.robber}`,
      draw: (state, ctx) =>
        layer((g) => {
          if (ckSlice(state).attacks > 0 || !hasRobber(state.settings)) return;
          const info = ctx.topo.hex[state.robber];
          if (!info) return;
          const [x, y] = ctx.pt(info);
          // "z z": the robber sleeps until the barbarians first attack (CK-30).
          for (const [dx, dy, s] of [
            [0.22, -0.55, 0.12],
            [0.36, -0.72, 0.09],
          ] as const) {
            const zx = x + dx * ctx.S;
            const zy = y + dy * ctx.S;
            const z = s * ctx.S;
            g.moveTo(zx - z / 2, zy - z / 2)
              .lineTo(zx + z / 2, zy - z / 2)
              .lineTo(zx - z / 2, zy + z / 2)
              .lineTo(zx + z / 2, zy + z / 2)
              .stroke({
                width: Math.max(2, ctx.S * 0.04),
                color: 0xffffff,
                cap: 'round',
                join: 'round',
              });
          }
        })(state, ctx),
    },
  ],
};
