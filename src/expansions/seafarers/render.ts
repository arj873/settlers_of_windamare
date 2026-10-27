/**
 * Seafarers board drawer: gold, fog and revealed-sea hexes; the frame's inner border; ships and
 * warships; the pirate and the Pirate Islands fleet; Forgotten Tribe gifts; Cloth villages;
 * fortresses and beachheads; the Wonders' marked corners; special-VP chits under settlements.
 */
import { Container, Graphics, Text } from 'pixi.js';
import { edgeInfo, vertexInfo, type EdgeId, type GameState, type VertexId } from '../../engine';
import { hexPoints } from '../../render/art';
import type { BoardDrawer, DrawContext } from '../../render/expansions';
import { drawPirate, drawShip, fogHex, goldHex, seaHex } from '../../render/seaArt';
import { INK } from '../../render/theme';
import { calmHex, fleetHex, fleetPath } from './engine/pirates';
import { wonderMarks } from './engine/features';
import { mapKeyOf, seaBoard, type MapKey } from './engine/maps';
import { seaSlice, type MoveShipPhase, type SeaSlice } from './engine/state';

const SEAFARERS = 'seafarers';
const keyOf = (s: GameState) => mapKeyOf(s.settings.map) as MapKey;
const slice = (s: GameState): SeaSlice => seaSlice(s);

function castle(g: Graphics, S: number, color: number): void {
  const w = 0.24 * S;
  const h = 0.26 * S;
  g.ellipse(2, 0.04 * S, 0.3 * S, 0.06 * S).fill({ color: 0x000000, alpha: 0.3 });
  const pts = [
    -w,
    0,
    -w,
    -h,
    -w * 0.6,
    -h,
    -w * 0.6,
    -h * 0.85,
    -w * 0.2,
    -h * 0.85,
    -w * 0.2,
    -h,
    w * 0.2,
    -h,
    w * 0.2,
    -h * 0.85,
    w * 0.6,
    -h * 0.85,
    w * 0.6,
    -h,
    w,
    -h,
    w,
    0,
  ];
  g.poly(pts).fill(color).stroke({ width: 2.2, color: INK, join: 'round' });
  g.rect(-0.05 * S, -0.12 * S, 0.1 * S, 0.12 * S).fill(INK);
}

function coin(g: Graphics, x: number, y: number, r: number): void {
  g.circle(x + 1, y + 1.5, r).fill({ color: 0x000000, alpha: 0.3 });
  g.circle(x, y, r).fill(0xf2c35a).stroke({ width: 1.5, color: 0x7a5410 });
  g.circle(x, y, r * 0.6).stroke({ width: 1, color: 0xb88a2a, alpha: 0.9 });
}

function label(
  text: string,
  size: number,
  color: number,
  weight: 'bold' | 'normal' = 'bold',
): Text {
  const t = new Text({
    text,
    style: { fontFamily: 'Georgia, serif', fontSize: size, fill: color, fontWeight: weight },
    resolution: 2,
  });
  t.anchor.set(0.5);
  return t;
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

function shipsLayer(state: GameState, ctx: DrawContext): Container {
  const layer = new Container();
  const s = slice(state);
  const moving =
    state.phase.kind === 'seafarers/moveShip' ? (state.phase as MoveShipPhase).from : null;
  const entries = (Object.entries(s.ships) as [EdgeId, SeaSlice['ships'][EdgeId]][]).sort(
    ([a], [b]) => (edgeInfo(ctx.topo, a)?.y ?? 0) - (edgeInfo(ctx.topo, b)?.y ?? 0),
  );
  for (const [e, ship] of entries) {
    const f = edgeFrame(ctx, e);
    if (!f) continue;
    const c = new Container();
    c.position.set(f.x, f.y);
    const g = new Graphics();
    drawShip(g, ctx.S, ctx.colorOf(ship.owner), ship.warship === true);
    g.rotation = f.angle;
    if (e === moving) c.alpha = 0.4;
    c.addChild(g);
    layer.addChild(c);
  }
  return layer;
}

function frameLayer(state: GameState, ctx: DrawContext): Container {
  const g = new Graphics();
  const inside = new Set(seaBoard(state).inside);
  // The frame (outside the playing area) is darker; harbour hexes on it stay as they are.
  const harbors = new Set(state.board.ports.map((p) => p.waterHex));
  for (const w of Object.values(ctx.topo.water)) {
    if (inside.has(w.id) || harbors.has(w.id)) continue;
    const [x, y] = ctx.pt(w);
    g.poly(hexPoints(x, y, ctx.S * 1.01)).fill({ color: 0x0b2238, alpha: 0.45 });
  }
  for (const h of inside) {
    const info = ctx.topo.hex[h] ?? ctx.topo.water[h];
    if (!info) continue;
    for (const e of info.edges) {
      const sides = [
        ...(edgeInfo(ctx.topo, e)?.hexes ?? []),
        ...(edgeInfo(ctx.topo, e)?.seas ?? []),
      ];
      const out = sides.find((x) => !inside.has(x));
      if (sides.length === 2 && out === undefined) continue;
      const ei = edgeInfo(ctx.topo, e);
      if (!ei) continue;
      const [a, b] = ei.vertices.map((v) => vertexInfo(ctx.topo, v));
      if (!a || !b) continue;
      const [ax, ay] = ctx.pt(a);
      const [bx, by] = ctx.pt(b);
      g.moveTo(ax, ay)
        .lineTo(bx, by)
        .stroke({ width: 0.09 * ctx.S, color: 0x0b2238, alpha: 0.5, cap: 'round' });
      g.moveTo(ax, ay)
        .lineTo(bx, by)
        .stroke({ width: 0.035 * ctx.S, color: 0xe8dcc0, alpha: 0.85, cap: 'round' });
    }
  }
  return g;
}

function pirateLayer(state: GameState, ctx: DrawContext): Container {
  const layer = new Container();
  const s = slice(state);
  const at = s.pirate ?? fleetHex(state);
  if (!at) return layer;
  const info = ctx.topo.hex[at] ?? ctx.topo.water[at];
  if (!info) return layer;
  const c = new Container();
  const [x, y] = ctx.pt(info);
  c.position.set(x, y + 0.12 * ctx.S);
  const g = new Graphics();
  drawPirate(g, ctx.S, s.fleet ? 1.15 : 0.9);
  c.addChild(g);
  layer.addChild(c);
  return layer;
}

function fleetPathLayer(state: GameState, ctx: DrawContext): Container {
  const layer = new Container();
  const key = keyOf(state);
  const path = fleetPath(key);
  if (path.length === 0 || slice(state).fleet?.gone) return layer;
  const g = new Graphics();
  const pts = path.map((h) => ctx.topo.water[h] ?? ctx.topo.hex[h]).filter((x) => x !== undefined);
  pts.forEach((p, i) => {
    const q = pts[(i + 1) % pts.length];
    if (!q) return;
    const [ax, ay] = ctx.pt(p);
    const [bx, by] = ctx.pt(q);
    const n = 6;
    for (let k = 0; k < n; k += 2) {
      g.moveTo(ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n)
        .lineTo(ax + ((bx - ax) * (k + 1)) / n, ay + ((by - ay) * (k + 1)) / n)
        .stroke({ width: 3, color: 0x111111, alpha: 0.45, cap: 'round' });
    }
    g.circle(ax, ay, 0.07 * ctx.S).fill({ color: 0x111111, alpha: 0.5 });
  });
  layer.addChild(g);
  const calm = calmHex(key);
  const ci = calm ? ctx.topo.water[calm] : undefined;
  if (ci) {
    const t = label('!', 0.7 * ctx.S, 0xffffff);
    const [x, y] = ctx.pt(ci);
    t.position.set(x, y - 0.3 * ctx.S);
    layer.addChild(t);
  }
  return layer;
}

function fortressLayer(state: GameState, ctx: DrawContext): Container {
  const layer = new Container();
  const fleet = slice(state).fleet;
  if (!fleet) return layer;
  for (const f of fleet.fortresses) {
    const color = ctx.colorOf(f.owner);
    const bh = vertexInfo(ctx.topo, f.beachhead);
    if (bh && !state.pieces.buildings[f.beachhead]) {
      const g = new Graphics();
      const [x, y] = ctx.pt(bh);
      g.circle(x, y, 0.2 * ctx.S).stroke({ width: 4, color: INK, alpha: 0.6 });
      g.circle(x, y, 0.2 * ctx.S).stroke({ width: 2.5, color });
      layer.addChild(g);
    }
    if (f.chits === 0) continue;
    const fv = vertexInfo(ctx.topo, f.vertex);
    if (!fv) continue;
    const c = new Container();
    c.position.set(...ctx.pt(fv));
    const g = new Graphics();
    for (let i = 0; i < f.chits; i++)
      coin(g, (-0.18 + i * 0.18) * ctx.S, 0.12 * ctx.S, 0.08 * ctx.S);
    castle(g, ctx.S, color);
    c.addChild(g);
    layer.addChild(c);
  }
  return layer;
}

function giftLayer(state: GameState, ctx: DrawContext): Container {
  const layer = new Container();
  const gifts = slice(state).gifts;
  if (!gifts) return layer;
  for (const [e, gift] of Object.entries(gifts) as [
    EdgeId,
    NonNullable<SeaSlice['gifts']>[EdgeId],
  ][]) {
    const f = edgeFrame(ctx, e);
    if (!f) continue;
    const g = new Graphics();
    const S = ctx.S;
    g.position.set(f.x, f.y);
    if (gift.kind === 'chit') {
      coin(g, 0, 0, 0.13 * S);
    } else if (gift.kind === 'dev') {
      g.roundRect(-0.11 * S + 1.5, -0.15 * S + 2, 0.22 * S, 0.3 * S, 3).fill({
        color: 0x000000,
        alpha: 0.3,
      });
      g.roundRect(-0.11 * S, -0.15 * S, 0.22 * S, 0.3 * S, 3)
        .fill(0x5b3f8c)
        .stroke({ width: 2, color: 0xe8dcc0 });
      g.poly([0, -0.08 * S, 0.06 * S, 0, 0, 0.08 * S, -0.06 * S, 0]).fill(0xf2c35a);
    } else {
      g.circle(0, 0, 0.15 * S)
        .fill(0xe9e2cf)
        .stroke({ width: 2, color: INK });
      // Anchor.
      g.moveTo(0, -0.09 * S)
        .lineTo(0, 0.08 * S)
        .stroke({ width: 2, color: INK });
      g.moveTo(-0.06 * S, -0.04 * S)
        .lineTo(0.06 * S, -0.04 * S)
        .stroke({ width: 2, color: INK });
      g.arc(0, 0.01 * S, 0.08 * S, 0.2, Math.PI - 0.2).stroke({ width: 2, color: INK });
      g.circle(0, -0.11 * S, 0.025 * S).stroke({ width: 1.5, color: INK });
    }
    layer.addChild(g);
  }
  return layer;
}

function villageLayer(state: GameState, ctx: DrawContext): Container {
  const layer = new Container();
  const cloth = slice(state).cloth;
  if (!cloth) return layer;
  for (const [v, village] of Object.entries(cloth.villages) as [
    VertexId,
    { token: number; cloth: number },
  ][]) {
    const info = vertexInfo(ctx.topo, v);
    if (!info) continue;
    const S = ctx.S;
    const c = new Container();
    c.position.set(...ctx.pt(info));
    const g = new Graphics();
    // A hut with the village's number on a token, and its cloth as little bolts.
    g.circle(1.5, 2, 0.24 * S).fill({ color: 0x000000, alpha: 0.3 });
    g.circle(0, 0, 0.24 * S)
      .fill(0xf1e4c3)
      .stroke({ width: 2, color: INK });
    const links = cloth.links[v] ?? [];
    links.forEach((p, i) => {
      g.arc(0, 0, 0.29 * S, -Math.PI / 2 + i * 1.2, -Math.PI / 2 + i * 1.2 + 1.0).stroke({
        width: 4,
        color: ctx.colorOf(p),
      });
    });
    for (let i = 0; i < village.cloth; i++) {
      const x = (-0.2 + i * 0.1) * S;
      g.roundRect(x - 0.035 * S, 0.27 * S, 0.07 * S, 0.12 * S, 2)
        .fill(0x9b3d8f)
        .stroke({ width: 1, color: INK });
    }
    c.addChild(g);
    const hot = village.token === 6 || village.token === 8;
    const t = label(String(village.token), 0.24 * S, hot ? 0xc0392b : 0x2b2118);
    c.addChild(t);
    layer.addChild(c);
  }
  return layer;
}

function marksLayer(state: GameState, ctx: DrawContext): Container {
  const layer = new Container();
  const m = wonderMarks(keyOf(state));
  if (!m) return layer;
  const g = new Graphics();
  const S = ctx.S;
  const square = (v: VertexId, color: number) => {
    const info = vertexInfo(ctx.topo, v);
    if (!info || state.pieces.buildings[v]) return;
    const [x, y] = ctx.pt(info);
    g.rect(x - 0.09 * S, y - 0.09 * S, 0.18 * S, 0.18 * S)
      .fill(color)
      .stroke({ width: 2, color: INK });
  };
  for (const v of m.strait) square(v, 0x8e44ad);
  for (const v of m.wasteland) square(v, 0x8b5a2b);
  layer.addChild(g);
  if (state.phase.kind === 'setup') {
    for (const v of m.bang) {
      const info = vertexInfo(ctx.topo, v);
      if (!info) continue;
      const t = label('!', 0.3 * S, 0xd9433a);
      t.position.set(...ctx.pt(info));
      layer.addChild(t);
    }
  }
  return layer;
}

function chitLayer(state: GameState, ctx: DrawContext): Container {
  const layer = new Container();
  const byVertex = new Map<VertexId, number>();
  for (const c of slice(state).chits) {
    if (c.vertex) byVertex.set(c.vertex, (byVertex.get(c.vertex) ?? 0) + c.vp);
  }
  for (const [v, vp] of byVertex) {
    const info = vertexInfo(ctx.topo, v);
    if (!info) continue;
    const [x, y] = ctx.pt(info);
    const g = new Graphics();
    coin(g, x + 0.2 * ctx.S, y + 0.16 * ctx.S, 0.11 * ctx.S);
    layer.addChild(g);
    const t = label(`+${vp}`, 0.12 * ctx.S, 0x4a3208);
    t.position.set(x + 0.2 * ctx.S, y + 0.16 * ctx.S);
    layer.addChild(t);
  }
  return layer;
}

const pirateSig = (s: GameState) =>
  `${slice(s).pirate ?? ''}|${JSON.stringify(slice(s).fleet?.at ?? null)}|${slice(s).fleet?.gone ?? ''}`;

export const seafarersDrawer: BoardDrawer = {
  id: SEAFARERS,
  terrain: { gold: goldHex, fog: fogHex, sea: seaHex },
  layers: [
    { key: 'frame', z: 'board', sig: (s) => s.settings.map, draw: frameLayer },
    {
      key: 'fleetPath',
      z: 'board',
      sig: (s) => `${s.settings.map}|${slice(s).fleet?.gone ?? ''}`,
      draw: fleetPathLayer,
    },
    {
      key: 'marks',
      z: 'board',
      sig: (s) => `${s.phase.kind === 'setup'}|${Object.keys(s.pieces.buildings).length}`,
      draw: marksLayer,
    },
    {
      key: 'gifts',
      z: 'board',
      sig: (s) => Object.keys(slice(s).gifts ?? {}).join(','),
      draw: giftLayer,
    },
    {
      key: 'ships',
      z: 'pieces',
      sig: (s) =>
        JSON.stringify([
          slice(s).ships,
          s.phase.kind === 'seafarers/moveShip' ? (s.phase as MoveShipPhase).from : null,
        ]),
      draw: shipsLayer,
    },
    {
      key: 'villages',
      z: 'pieces',
      sig: (s) =>
        JSON.stringify(slice(s).cloth?.villages ?? null) +
        JSON.stringify(slice(s).cloth?.links ?? null),
      draw: villageLayer,
    },
    {
      key: 'fortress',
      z: 'pieces',
      sig: (s) =>
        JSON.stringify(slice(s).fleet?.fortresses ?? null) + Object.keys(s.pieces.buildings).length,
      draw: fortressLayer,
    },
    { key: 'chits', z: 'pieces', sig: (s) => JSON.stringify(slice(s).chits), draw: chitLayer },
    { key: 'pirate', z: 'top', sig: pirateSig, draw: pirateLayer },
  ],
  // #33: a new or moved ship gets the "just built" mark.
  sites: (s) =>
    Object.entries(slice(s).ships).map(
      ([e, ship]) =>
        [
          `sea:${e}`,
          { at: e as EdgeId, owner: ship.owner, kind: ship.warship ? 'warship' : 'ship' },
        ] as const,
    ),
};
