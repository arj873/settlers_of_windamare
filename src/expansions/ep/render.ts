/**
 * Explorers & Pirates board drawer: the face-down parrot / goose hexes, fish shoals, spice farms,
 * the Council of Catan, gold fields and revealed sea; the frame; ships with their cargo, harbor
 * settlements and their basins, lair tokens and crews, fish hauls, spice sacks, the Council's
 * anchors, the setup's harbor spots and the pirate ships.
 */
import { Container, Graphics, Text } from 'pixi.js';
import {
  edgeInfo,
  vertexInfo,
  type EdgeId,
  type GameState,
  type HexId,
  type VertexId,
} from '../../engine';
import { hexPoints, shade } from '../../render/art';
import type { BoardDrawer, DrawContext } from '../../render/expansions';
import { drawPirate, drawShip, fogHex, goldHex, seaHex } from '../../render/seaArt';
import { INK, SEA } from '../../render/theme';
import { anchors } from './engine/geometry';
import { epBoard, T } from './engine/maps';
import { epSlice, type Cargo, type EpSlice } from './engine/state';

const EP = 'ep';
const slice = (s: GameState): EpSlice => epSlice(s);

// ---------------------------------------------------------------------------------------------
// Terrain painters
// ---------------------------------------------------------------------------------------------

/** A face-down hex: fog with the region's colour and its animal. */
function backHex(tint: number, animal: (g: Graphics, x: number, y: number, k: number) => void) {
  return (g: Graphics, cx: number, cy: number, S: number) => {
    fogHex(g, cx, cy, S);
    g.poly(hexPoints(cx, cy, S)).fill({ color: tint, alpha: 0.42 });
    g.poly(hexPoints(cx, cy, S * 0.86)).stroke({ width: 2, color: shade(tint, 0.45), alpha: 0.6 });
    animal(g, cx, cy - 0.42 * S, S * 0.3);
  };
}

function parrot(g: Graphics, x: number, y: number, k: number): void {
  g.ellipse(x, y + 0.1 * k, 0.42 * k, 0.6 * k)
    .fill(0x2fa35a)
    .stroke({ width: 1.5, color: INK });
  g.poly([x - 0.1 * k, y + 0.1 * k, x - 0.75 * k, y + 0.75 * k, x - 0.05 * k, y + 0.55 * k])
    .fill(0xd9433a)
    .stroke({ width: 1.2, color: INK, join: 'round' });
  g.circle(x + 0.12 * k, y - 0.3 * k, 0.28 * k)
    .fill(0x2fa35a)
    .stroke({ width: 1.5, color: INK });
  g.poly([x + 0.34 * k, y - 0.36 * k, x + 0.62 * k, y - 0.2 * k, x + 0.36 * k, y - 0.08 * k])
    .fill(0xf2c35a)
    .stroke({ width: 1.2, color: INK, join: 'round' });
  g.circle(x + 0.18 * k, y - 0.36 * k, 0.06 * k).fill(INK);
}

function goose(g: Graphics, x: number, y: number, k: number): void {
  g.ellipse(x - 0.1 * k, y + 0.25 * k, 0.6 * k, 0.36 * k)
    .fill(0xf6f1e4)
    .stroke({ width: 1.5, color: INK });
  g.moveTo(x + 0.3 * k, y + 0.1 * k)
    .quadraticCurveTo(x + 0.45 * k, y - 0.4 * k, x + 0.25 * k, y - 0.5 * k)
    .stroke({ width: 0.22 * k, color: 0xf6f1e4, cap: 'round' });
  g.circle(x + 0.25 * k, y - 0.5 * k, 0.17 * k)
    .fill(0xf6f1e4)
    .stroke({ width: 1.2, color: INK });
  g.poly([x + 0.38 * k, y - 0.55 * k, x + 0.66 * k, y - 0.46 * k, x + 0.38 * k, y - 0.4 * k])
    .fill(0xe58a2c)
    .stroke({ width: 1.2, color: INK, join: 'round' });
  g.circle(x + 0.27 * k, y - 0.55 * k, 0.04 * k).fill(INK);
}

function fish(g: Graphics, x: number, y: number, k: number, color = 0xd6e7f2): void {
  g.ellipse(x, y, 0.5 * k, 0.22 * k)
    .fill(color)
    .stroke({ width: 1.4, color: INK });
  g.poly([x - 0.42 * k, y, x - 0.75 * k, y - 0.22 * k, x - 0.75 * k, y + 0.22 * k])
    .fill(color)
    .stroke({ width: 1.4, color: INK, join: 'round' });
  g.circle(x + 0.28 * k, y - 0.04 * k, 0.05 * k).fill(INK);
}

function shoalHex(g: Graphics, cx: number, cy: number, S: number): void {
  seaHex(g, cx, cy, S);
  g.poly(hexPoints(cx, cy, S * 0.8)).fill({ color: 0x9fd3e8, alpha: 0.18 });
  fish(g, cx - 0.3 * S, cy - 0.35 * S, 0.3 * S);
  fish(g, cx + 0.32 * S, cy + 0.42 * S, 0.26 * S);
  fish(g, cx + 0.38 * S, cy - 0.12 * S, 0.2 * S);
}

function spiceHex(g: Graphics, cx: number, cy: number, S: number): void {
  const base = 0xc0652f;
  g.poly(hexPoints(cx, cy, S))
    .fill(base)
    .stroke({ width: 2, color: shade(base, -0.4), alpha: 0.9 });
  g.poly(hexPoints(cx, cy, S * 0.9)).stroke({ width: 2, color: shade(base, 0.4), alpha: 0.4 });
  // Rows of spice plants.
  for (const dy of [-0.5, -0.25, 0.3, 0.55]) {
    const y = cy + dy * S;
    const half = (0.75 - Math.abs(dy) * 0.5) * S;
    for (let x = cx - half; x <= cx + half; x += 0.16 * S) {
      g.circle(x, y, 0.05 * S).fill(0x6e8f2a);
      g.circle(x + 0.02 * S, y - 0.03 * S, 0.03 * S).fill(0xe0b030);
    }
  }
  // A hut.
  g.poly([cx - 0.62 * S, cy + 0.02 * S, cx - 0.44 * S, cy - 0.16 * S, cx - 0.26 * S, cy + 0.02 * S])
    .fill(0x8a4a20)
    .stroke({ width: 1.5, color: INK, join: 'round' });
  g.rect(cx - 0.58 * S, cy + 0.02 * S, 0.28 * S, 0.16 * S)
    .fill(0xe8d3a0)
    .stroke({ width: 1.5, color: INK });
}

function councilHex(g: Graphics, cx: number, cy: number, S: number): void {
  seaHex(g, cx, cy, S);
  // A rocky islet with a round, columned council hall.
  g.ellipse(cx, cy + 0.18 * S, 0.6 * S, 0.3 * S)
    .fill(0xb9a57a)
    .stroke({ width: 2, color: 0x6e5a36 });
  g.rect(cx - 0.36 * S, cy - 0.2 * S, 0.72 * S, 0.06 * S)
    .fill(0xefe6cf)
    .stroke({ width: 1.5, color: INK });
  for (let i = 0; i < 5; i++) {
    g.rect(cx - 0.32 * S + i * 0.15 * S, cy - 0.14 * S, 0.06 * S, 0.3 * S)
      .fill(0xf6efdc)
      .stroke({ width: 1, color: INK });
  }
  g.rect(cx - 0.4 * S, cy + 0.16 * S, 0.8 * S, 0.06 * S)
    .fill(0xefe6cf)
    .stroke({ width: 1.5, color: INK });
  g.poly([cx - 0.42 * S, cy - 0.2 * S, cx, cy - 0.46 * S, cx + 0.42 * S, cy - 0.2 * S])
    .fill(0xd9433a)
    .stroke({ width: 1.5, color: INK, join: 'round' });
}

// ---------------------------------------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------------------------------------

/** A settler (big pawn) or crew (small pawn with a bandana) in a player's colour. */
function pawn(g: Graphics, x: number, y: number, k: number, color: number, crew: boolean): void {
  const r = crew ? 0.7 : 1;
  g.circle(x, y - 0.55 * k * r, 0.26 * k * r)
    .fill(color)
    .stroke({ width: 1.4, color: INK });
  g.poly([
    x - 0.36 * k * r,
    y + 0.35 * k * r,
    x - 0.2 * k * r,
    y - 0.28 * k * r,
    x + 0.2 * k * r,
    y - 0.28 * k * r,
    x + 0.36 * k * r,
    y + 0.35 * k * r,
  ])
    .fill(color)
    .stroke({ width: 1.4, color: INK, join: 'round' });
  if (crew) g.rect(x - 0.26 * k * r, y - 0.68 * k * r, 0.52 * k * r, 0.1 * k * r).fill(0xd9433a);
}

function sack(g: Graphics, x: number, y: number, k: number, color = 0xb07a3a): void {
  g.poly([
    x - 0.3 * k,
    y + 0.35 * k,
    x - 0.34 * k,
    y - 0.05 * k,
    x - 0.12 * k,
    y - 0.3 * k,
    x + 0.12 * k,
    y - 0.3 * k,
    x + 0.34 * k,
    y - 0.05 * k,
    x + 0.3 * k,
    y + 0.35 * k,
  ])
    .fill(color)
    .stroke({ width: 1.3, color: INK, join: 'round' });
  g.rect(x - 0.14 * k, y - 0.36 * k, 0.28 * k, 0.08 * k)
    .fill(0xe8d3a0)
    .stroke({ width: 1, color: INK });
}

function anchor(g: Graphics, x: number, y: number, k: number, color = INK): void {
  g.moveTo(x, y - 0.5 * k)
    .lineTo(x, y + 0.45 * k)
    .stroke({ width: 0.14 * k, color, cap: 'round' });
  g.moveTo(x - 0.3 * k, y - 0.25 * k)
    .lineTo(x + 0.3 * k, y - 0.25 * k)
    .stroke({ width: 0.12 * k, color, cap: 'round' });
  g.arc(x, y + 0.05 * k, 0.42 * k, 0.25, Math.PI - 0.25).stroke({
    width: 0.13 * k,
    color,
    cap: 'round',
  });
  g.circle(x, y - 0.62 * k, 0.12 * k).stroke({ width: 0.1 * k, color });
}

function cargoIcon(g: Graphics, c: Cargo, x: number, y: number, k: number, color: number): void {
  if (c === 'settler') pawn(g, x, y, k, color, false);
  else if (c === 'crew') pawn(g, x, y, k, color, true);
  else if (c === 'fish') fish(g, x, y, k * 0.8, 0x7fb3d5);
  else sack(g, x, y, k * 0.9);
}

/** Cargo icons in a row centred on (x, y). */
function cargoRow(
  g: Graphics,
  cargo: readonly Cargo[],
  x: number,
  y: number,
  k: number,
  color: number,
): void {
  const w = 0.8 * k;
  cargo.forEach((c, i) => cargoIcon(g, c, x + (i - (cargo.length - 1) / 2) * w, y, k, color));
}

function label(text: string, size: number, color: number): Text {
  const t = new Text({
    text,
    style: { fontFamily: 'Georgia, serif', fontSize: size, fill: color, fontWeight: 'bold' },
    resolution: 2,
  });
  t.anchor.set(0.5);
  return t;
}

/** A round token with a die face (fish shoal) or a number. */
function dieFace(g: Graphics, x: number, y: number, r: number, n: number): void {
  g.roundRect(x - r, y - r, 2 * r, 2 * r, r * 0.3)
    .fill(0xf6efdc)
    .stroke({ width: 1.5, color: INK });
  const pip = (dx: number, dy: number) =>
    g.circle(x + dx * r * 0.5, y + dy * r * 0.5, r * 0.16).fill(INK);
  const P: Record<number, [number, number][]> = {
    1: [[0, 0]],
    2: [
      [-1, -1],
      [1, 1],
    ],
    3: [
      [-1, -1],
      [0, 0],
      [1, 1],
    ],
    4: [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ],
    5: [
      [-1, -1],
      [1, -1],
      [0, 0],
      [-1, 1],
      [1, 1],
    ],
    6: [
      [-1, -1],
      [1, -1],
      [-1, 0],
      [1, 0],
      [-1, 1],
      [1, 1],
    ],
  };
  for (const [dx, dy] of P[n] ?? []) pip(dx, dy);
}

// ---------------------------------------------------------------------------------------------
// Layers
// ---------------------------------------------------------------------------------------------

function edgeFrame(ctx: DrawContext, e: EdgeId): { x: number; y: number; angle: number } | null {
  const info = edgeInfo(ctx.topo, e);
  if (!info) return null;
  const a = vertexInfo(ctx.topo, info.vertices[0]);
  const b = vertexInfo(ctx.topo, info.vertices[1]);
  if (!a || !b) return null;
  let angle = Math.atan2(b.y - a.y, b.x - a.x);
  if (angle > Math.PI / 2) angle -= Math.PI;
  if (angle <= -Math.PI / 2) angle += Math.PI;
  const [x, y] = ctx.pt(info);
  return { x, y, angle };
}

const hexPt = (ctx: DrawContext, h: HexId): [number, number] | null => {
  const info = ctx.topo.hex[h] ?? ctx.topo.water[h];
  return info ? ctx.pt(info) : null;
};

function frameLayer(state: GameState, ctx: DrawContext): Container {
  const g = new Graphics();
  const inside = new Set(epBoard(state).inside);
  for (const w of Object.values(ctx.topo.water)) {
    if (inside.has(w.id)) continue;
    const [x, y] = ctx.pt(w);
    g.poly(hexPoints(x, y, ctx.S * 1.01)).fill({ color: SEA.frameDark, alpha: 0.5 });
  }
  for (const h of inside) {
    const info = ctx.topo.hex[h] ?? ctx.topo.water[h];
    if (!info) continue;
    for (const e of info.edges) {
      const ei = edgeInfo(ctx.topo, e);
      if (!ei) continue;
      const sides = [...ei.hexes, ...ei.seas];
      if (sides.every((x) => inside.has(x)) && sides.length === 2) continue;
      const [a, b] = ei.vertices.map((v) => vertexInfo(ctx.topo, v));
      if (!a || !b) continue;
      const [ax, ay] = ctx.pt(a);
      const [bx, by] = ctx.pt(b);
      g.moveTo(ax, ay)
        .lineTo(bx, by)
        .stroke({ width: 0.09 * ctx.S, color: SEA.frameDark, alpha: 0.7, cap: 'round' });
      g.moveTo(ax, ay)
        .lineTo(bx, by)
        .stroke({ width: 0.035 * ctx.S, color: SEA.frameLight, alpha: 0.85, cap: 'round' });
    }
  }
  return g;
}

/** Setup round 1: the marked harbor corners still free. */
function spotsLayer(state: GameState, ctx: DrawContext): Container {
  const g = new Graphics();
  const ph = state.phase;
  if (ph.kind !== 'setup' || ph.index >= state.players.length) return g;
  for (const v of epBoard(state).harborSpots) {
    if (state.pieces.buildings[v]) continue;
    const info = vertexInfo(ctx.topo, v);
    if (!info) continue;
    const [x, y] = ctx.pt(info);
    g.circle(x, y, 0.16 * ctx.S)
      .fill({ color: 0x2fa35a, alpha: 0.55 })
      .stroke({ width: 2, color: INK, alpha: 0.6 });
    anchor(g, x, y, 0.16 * ctx.S, 0xffffff);
  }
  return g;
}

function marksLayer(state: GameState, ctx: DrawContext): Container {
  const layer = new Container();
  const g = new Graphics();
  layer.addChild(g);
  const s = slice(state);
  const S = ctx.S;
  // Council anchors.
  for (const v of anchors(state)) {
    const info = vertexInfo(ctx.topo, v);
    if (!info) continue;
    const [x, y] = ctx.pt(info);
    g.circle(x, y, 0.15 * S)
      .fill(0xefe6cf)
      .stroke({ width: 2, color: INK });
    anchor(g, x, y, 0.12 * S);
  }
  // Fish shoals: their die face, and a haul if one is there.
  for (const [h, face] of Object.entries(s.shoals) as [HexId, number][]) {
    const p = hexPt(ctx, h);
    if (!p) continue;
    dieFace(g, p[0], p[1], 0.17 * S, face);
    if (s.hauls.includes(h)) {
      g.circle(p[0], p[1] + 0.42 * S, 0.2 * S).fill({ color: 0x0b2238, alpha: 0.55 });
      fish(g, p[0], p[1] + 0.42 * S, 0.24 * S, 0x7fb3d5);
    }
  }
  // Pirate lairs: a skull token until captured; crews on the hex.
  for (const [h, lair] of Object.entries(s.lairs) as [HexId, EpSlice['lairs'][HexId]][]) {
    const p = hexPt(ctx, h);
    if (!p) continue;
    if (!lair.captured) {
      g.circle(p[0], p[1], 0.24 * S)
        .fill(0x1d1b20)
        .stroke({ width: 2, color: 0xf2c35a });
      g.circle(p[0], p[1] - 0.03 * S, 0.11 * S).fill(0xf3ead2);
      g.rect(p[0] - 0.06 * S, p[1] + 0.05 * S, 0.12 * S, 0.06 * S).fill(0xf3ead2);
      g.circle(p[0] - 0.04 * S, p[1] - 0.04 * S, 0.025 * S).fill(INK);
      g.circle(p[0] + 0.04 * S, p[1] - 0.04 * S, 0.025 * S).fill(INK);
    }
    lair.crews.forEach((o, i) =>
      pawn(
        g,
        p[0] + (i - (lair.crews.length - 1) / 2) * 0.24 * S,
        p[1] + 0.48 * S,
        0.22 * S,
        ctx.colorOf(o),
        true,
      ),
    );
  }
  // Spice farms: the sacks still there and the befriended players' crews.
  for (const [h, farm] of Object.entries(s.spice) as [HexId, EpSlice['spice'][HexId]][]) {
    const p = hexPt(ctx, h);
    if (!p) continue;
    farm.sacks.forEach((o, i) => {
      const x = p[0] + 0.12 * S + (i - (farm.sacks.length - 1) / 2) * 0.17 * S;
      sack(g, x, p[1] - 0.3 * S, 0.22 * S, shade(ctx.colorOf(o), -0.1));
    });
    farm.crews.forEach((o, i) =>
      pawn(
        g,
        p[0] + (i - (farm.crews.length - 1) / 2) * 0.22 * S,
        p[1] + 0.5 * S,
        0.22 * S,
        ctx.colorOf(o),
        true,
      ),
    );
    const sym =
      farm.kind === 'swift' ? '»' : farm.kind === 'fast' ? '$' : String(farm.number ?? '☠');
    const t = label(sym, 0.26 * S, 0xfff3d6);
    t.position.set(p[0] + 0.5 * S, p[1] + 0.12 * S);
    g.circle(p[0] + 0.5 * S, p[1] + 0.12 * S, 0.17 * S).fill({ color: INK, alpha: 0.7 });
    layer.addChild(t);
  }
  return layer;
}

function harborLayer(state: GameState, ctx: DrawContext): Container {
  const g = new Graphics();
  const S = ctx.S;
  for (const [v, basin] of Object.entries(slice(state).harbors) as [VertexId, Cargo[]][]) {
    const b = state.pieces.buildings[v];
    const info = vertexInfo(ctx.topo, v);
    if (!b || !info) continue;
    const [x, y] = ctx.pt(info);
    const color = ctx.colorOf(b.owner);
    // A quay with an anchor under the settlement; the basin's cargo beside it.
    g.roundRect(x - 0.26 * S, y + 0.08 * S, 0.52 * S, 0.17 * S, 0.05 * S)
      .fill(0xe9e2cf)
      .stroke({ width: 2, color: INK });
    anchor(g, x, y + 0.165 * S, 0.11 * S, shade(color, -0.2));
    if (basin.length > 0) {
      g.roundRect(x + 0.2 * S, y - 0.32 * S, 0.12 * S + basin.length * 0.2 * S, 0.3 * S, 0.06 * S)
        .fill({ color: 0x0b2238, alpha: 0.6 })
        .stroke({ width: 1.5, color: 0xe9e2cf });
      cargoRow(g, basin, x + 0.3 * S + (basin.length - 1) * 0.1 * S, y - 0.14 * S, 0.22 * S, color);
    }
  }
  return g;
}

function shipsLayer(state: GameState, ctx: DrawContext): Container {
  const layer = new Container();
  const s = slice(state);
  const S = ctx.S;
  const onEdge = new Map<EdgeId, number>();
  const ships = [...s.ships].sort(
    (a, b) => (edgeInfo(ctx.topo, a.edge)?.y ?? 0) - (edgeInfo(ctx.topo, b.edge)?.y ?? 0),
  );
  for (const ship of ships) {
    const f = edgeFrame(ctx, ship.edge);
    if (!f) continue;
    const k = onEdge.get(ship.edge) ?? 0;
    onEdge.set(ship.edge, k + 1);
    const c = new Container();
    // A second ship on the same edge sits a little aside.
    const off = k === 0 ? 0 : 0.22 * S;
    c.position.set(f.x + Math.sin(f.angle) * off, f.y - Math.cos(f.angle) * off);
    const g = new Graphics();
    const color = ctx.colorOf(ship.owner);
    if (s.turn.selected === ship.id && state.turn.current === ship.owner && s.turn.movement) {
      g.ellipse(0, 0.05 * S, 0.42 * S, 0.22 * S)
        .fill({ color: 0xffffff, alpha: 0.35 })
        .stroke({ width: 3, color: 0xffe27a });
    }
    drawShip(g, S, color);
    g.rotation = f.angle;
    c.addChild(g);
    if (ship.cargo.length > 0) {
      const cg = new Graphics();
      cg.roundRect(
        -0.07 * S - ship.cargo.length * 0.1 * S,
        -0.62 * S,
        0.14 * S + ship.cargo.length * 0.2 * S,
        0.3 * S,
        0.06 * S,
      )
        .fill({ color: 0xf3ead2, alpha: 0.9 })
        .stroke({ width: 1.5, color: INK });
      cargoRow(cg, ship.cargo, 0, -0.45 * S, 0.22 * S, color);
      c.addChild(cg);
    }
    layer.addChild(c);
  }
  return layer;
}

function pirateLayer(state: GameState, ctx: DrawContext): Container {
  const layer = new Container();
  const pirate = slice(state).pirate;
  if (!pirate) return layer;
  const p = hexPt(ctx, pirate.hex);
  if (!p) return layer;
  const c = new Container();
  c.position.set(p[0], p[1] + 0.1 * ctx.S);
  const g = new Graphics();
  drawPirate(g, ctx.S, 0.95);
  // The owner's pennant.
  g.poly([-0.1 * ctx.S, -0.52 * ctx.S, -0.34 * ctx.S, -0.6 * ctx.S, -0.1 * ctx.S, -0.68 * ctx.S])
    .fill(ctx.colorOf(pirate.owner))
    .stroke({ width: 1.2, color: INK });
  c.addChild(g);
  layer.addChild(c);
  return layer;
}

export const epDrawer: BoardDrawer = {
  id: EP,
  terrain: {
    [T.parrot]: backHex(0x2fa35a, parrot),
    [T.goose]: backHex(0xe58a2c, goose),
    [T.fish]: shoalHex,
    [T.spice]: spiceHex,
    [T.council]: councilHex,
    gold: goldHex,
    sea: seaHex,
  },
  layers: [
    { key: 'frame', z: 'board', sig: (s) => s.settings.map, draw: frameLayer },
    {
      key: 'spots',
      z: 'board',
      sig: (s) =>
        `${s.phase.kind === 'setup' ? s.phase.index : -1}|${Object.keys(s.pieces.buildings).length}`,
      draw: spotsLayer,
    },
    {
      key: 'marks',
      z: 'board',
      sig: (s) => {
        const e = slice(s);
        return JSON.stringify([e.shoals, e.hauls, e.lairs, e.spice, s.settings.map]);
      },
      draw: marksLayer,
    },
    {
      key: 'harbors',
      z: 'pieces',
      sig: (s) => JSON.stringify(slice(s).harbors) + Object.keys(s.pieces.buildings).length,
      draw: harborLayer,
    },
    {
      key: 'ships',
      z: 'pieces',
      sig: (s) => {
        const e = slice(s);
        return JSON.stringify([e.ships, e.turn.selected, e.turn.movement, s.turn.current]);
      },
      draw: shipsLayer,
    },
    { key: 'pirate', z: 'top', sig: (s) => JSON.stringify(slice(s).pirate), draw: pirateLayer },
  ],
};
