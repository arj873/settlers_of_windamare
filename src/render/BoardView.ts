/**
 * PixiJS board view. Draws a `GameState` (read-only), shows highlighted legal spots, and reports
 * clicks on vertices / edges / hexes. It never decides what is legal: callers pass the ids to
 * highlight (`setHighlights`) and map click events to actions.
 *
 *   const view = new BoardView(app);
 *   view.render(state);
 *   view.setHighlights({ vertices: legalSettlementSpots });
 *   view.on('vertexClick', (id) => dispatch({ type: 'buildSettlement', player, vertex: id }));
 *
 * Pan (drag) / zoom (wheel, pinch) are built in; double-click refits. The view refits on
 * renderer resize unless the user has moved it.
 */
import { Color, Container, Graphics, Text, type Application } from 'pixi.js';
import {
  TOPOLOGY,
  tokenPips,
  type EdgeId,
  type GameState,
  type HexId,
  type PlayerId,
  type Point,
  type VertexId,
} from '../engine';
import {
  drawCity,
  drawResourceIcon,
  drawRobber,
  drawRoad,
  drawSettlement,
  drawTerrainMotif,
  hexPoints,
  shade,
} from './art';
import {
  BACKDROP_RADIUS,
  HEX_SIZE as S,
  boardBounds,
  pick,
  screenToUnit,
  unitToScreen,
  type Hit,
  type PickCandidates,
  type ViewTransform,
} from './geometry';
import { BEACH, HIGHLIGHT, INK, SEA, TERRAIN_PALETTE, TOKEN, portColor } from './theme';
import { Viewport, type Insets } from './viewport';

export interface Highlights extends PickCandidates {
  /** Tint for the glow (CSS colour), e.g. the acting player's colour. Default: warm white. */
  color?: string;
}

export interface BoardEvents {
  vertexClick: VertexId;
  edgeClick: EdgeId;
  hexClick: HexId;
  /** Spot under the pointer (only highlighted spots while any highlight is active); null = none. */
  hover: Hit | null;
}

type Listener<K extends keyof BoardEvents> = (payload: BoardEvents[K]) => void;

interface PieceNode {
  sig: string;
  node: Container;
}

interface Glow {
  node: Container;
  glow: Graphics;
  kind: 'vertex' | 'edge' | 'hex';
}

const SERIF = 'Georgia, "Times New Roman", serif';
const SANS = '"Trebuchet MS", "Segoe UI", Helvetica, Arial, sans-serif';
const TEXT_RES = 4;

const pt = (p: Point): [number, number] => [p.x * S, p.y * S];

function label(
  text: string,
  size: number,
  fill: number,
  font = SERIF,
  weight: 'bold' | 'normal' = 'bold',
) {
  const t = new Text({
    text,
    style: { fontFamily: font, fontSize: size, fontWeight: weight, fill },
    resolution: TEXT_RES,
  });
  t.anchor.set(0.5);
  return t;
}

const easeOutBack = (t: number) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

export class BoardView {
  /** Add-to-stage container (the constructor already does this). */
  readonly root = new Container();

  private readonly world = new Container();
  private readonly seaLayer = new Container();
  private readonly landLayer = new Container();
  private readonly portLayer = new Container();
  private readonly tokenLayer = new Container();
  private readonly roadLayer = new Container();
  private readonly buildingLayer = new Container();
  private readonly robberLayer = new Container();
  private readonly glowLayer = new Container();
  private readonly hoverLayer = new Graphics();

  private readonly viewport: Viewport;
  private readonly listeners = new Map<keyof BoardEvents, Set<Listener<never>>>();

  private boardSig = '';
  private highlights: Highlights = {};
  private hover: Hit | null = null;
  private glows: Glow[] = [];

  private readonly pieces = new Map<string, PieceNode>();
  private seeded = false;
  private pops: { node: Container; t0: number }[] = [];

  private readonly robber = new Graphics();
  private robberTarget: Point = { x: 0, y: 0 };
  private robberPos: Point | null = null;

  private clock = 0;
  private readonly onResize = () => this.resize();
  private readonly tick = (ticker: { deltaMS: number }) => this.update(ticker.deltaMS);

  constructor(private readonly app: Application) {
    this.world.addChild(
      this.seaLayer,
      this.landLayer,
      this.portLayer,
      this.tokenLayer,
      this.roadLayer,
      this.buildingLayer,
      this.robberLayer,
      this.glowLayer,
      this.hoverLayer,
    );
    this.robberLayer.addChild(this.robber);
    this.root.addChild(this.world);
    app.stage.addChild(this.root);

    this.buildSea();

    this.viewport = new Viewport({
      canvas: app.canvas,
      bounds: boardBounds(),
      getSize: () => ({ width: app.screen.width, height: app.screen.height }),
      onChange: (v) => this.applyView(v),
      onTap: (p) => this.handleTap(p),
      onHover: (p) => this.handleHover(p),
    });

    app.renderer.on('resize', this.onResize);
    app.ticker.add(this.tick);
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /** Draw `state`. Cheap to call after every action: only what changed is rebuilt. */
  render(state: GameState): void {
    const sig = JSON.stringify([
      Object.values(state.board.hexes).map((h) => [h.id, h.terrain, h.token]),
      state.board.ports.map((p) => [p.kind, p.edge, p.waterHex]),
    ]);
    if (sig !== this.boardSig) {
      this.boardSig = sig;
      this.buildLand(state);
      this.buildPorts(state);
      this.buildTokens(state);
    }
    this.syncPieces(state);
    this.syncRobber(state);
  }

  /** Mark legal spots (they pulse and become hoverable/clickable); `{}` clears. */
  setHighlights(h: Highlights): void {
    this.highlights = h;
    this.buildGlows();
    this.hover = null;
    this.drawHover();
  }

  on<K extends keyof BoardEvents>(type: K, cb: Listener<K>): () => void {
    const set = this.listeners.get(type) ?? new Set<Listener<never>>();
    this.listeners.set(type, set);
    const fn = cb as Listener<never>;
    set.add(fn);
    return () => void set.delete(fn);
  }

  /** Re-read the renderer size (also called automatically on renderer resize). */
  resize(): void {
    this.viewport.resize();
  }

  /** Reset pan/zoom to fit the whole board. */
  fit(): void {
    this.viewport.fit();
  }

  /** Screen margins covered by HTML overlays (HUD panels); the fitted board avoids them. */
  setInsets(insets: Insets): void {
    this.viewport.setInsets(insets);
  }

  /**
   * Page position (CSS px, viewport-relative like `clientX/Y`) of a vertex, edge midpoint or
   * hex center; null for unknown ids. For the playtest harness (`?debug=1`).
   */
  screenPos(id: string): Point | null {
    const info =
      TOPOLOGY.vertex[id as VertexId] ?? TOPOLOGY.edge[id as EdgeId] ?? TOPOLOGY.hex[id as HexId];
    if (!info) return null;
    const p = unitToScreen(this.viewport.view, info);
    const r = this.app.canvas.getBoundingClientRect();
    return { x: p.x + r.left, y: p.y + r.top };
  }

  destroy(): void {
    this.app.renderer.off('resize', this.onResize);
    this.app.ticker.remove(this.tick);
    this.viewport.dispose();
    this.root.destroy({ children: true });
  }

  // -------------------------------------------------------------------------
  // Input
  // -------------------------------------------------------------------------

  private candidates(): PickCandidates | undefined {
    const h = this.highlights;
    const any = (h.vertices?.length ?? 0) + (h.edges?.length ?? 0) + (h.hexes?.length ?? 0) > 0;
    return any ? h : undefined;
  }

  private hitAt(screen: Point): Hit | null {
    const view = this.viewport.view;
    return pick(screenToUnit(view, screen), view.scale, this.candidates());
  }

  private emit<K extends keyof BoardEvents>(type: K, payload: BoardEvents[K]) {
    const set = this.listeners.get(type) as Set<Listener<K>> | undefined;
    if (set) for (const cb of [...set]) cb(payload);
    // (Set<Listener<never>> is stored; the cast restores the payload type for this event.)
  }

  private handleTap(p: Point) {
    const hit = this.hitAt(p);
    if (!hit) return;
    if (hit.kind === 'vertex') this.emit('vertexClick', hit.id);
    else if (hit.kind === 'edge') this.emit('edgeClick', hit.id);
    else this.emit('hexClick', hit.id);
  }

  private handleHover(p: Point | null) {
    const hit = p ? this.hitAt(p) : null;
    const same = hit?.kind === this.hover?.kind && hit?.id === this.hover?.id;
    if (same) return;
    this.hover = hit;
    this.app.canvas.style.cursor = hit && this.candidates() ? 'pointer' : '';
    this.drawHover();
    this.emit('hover', hit);
  }

  // -------------------------------------------------------------------------
  // View
  // -------------------------------------------------------------------------

  private applyView(v: ViewTransform) {
    this.world.position.set(v.x, v.y);
    this.world.scale.set(v.scale / S);
  }

  // -------------------------------------------------------------------------
  // Static layers
  // -------------------------------------------------------------------------

  private buildSea() {
    const R = BACKDROP_RADIUS * S;
    const g = new Graphics();
    // Wooden frame around a flat-top hexagonal sea.
    const turn = Math.PI / 6; // roundPoly puts a vertex on the vertical axis; we want one on the x axis
    g.roundPoly(0, 0, R + 0.22 * S, 6, 0.6 * S, turn)
      .fill(SEA.frame)
      .stroke({ width: 3, color: SEA.frameDark });
    g.roundPoly(0, 0, R + 0.1 * S, 6, 0.6 * S, turn).stroke({
      width: 2,
      color: SEA.frameLight,
      alpha: 0.8,
    });
    g.roundPoly(0, 0, R, 6, 0.55 * S, turn)
      .fill(SEA.deep)
      .stroke({ width: 4, color: SEA.frameDark });
    // Water hexes.
    TOPOLOGY.waterHexes.forEach((id, i) => {
      const w = TOPOLOGY.water[id];
      if (!w) return;
      const cx = w.x * S;
      const cy = w.y * S;
      g.poly(hexPoints(cx, cy, S * 1.0)).fill(i % 2 ? SEA.base : SEA.alt);
      g.poly(hexPoints(cx, cy, S * 0.97)).stroke({ width: 1.5, color: SEA.wave, alpha: 0.2 });
      for (const [dx, dy, wd] of [
        [-0.3, -0.12, 0.34],
        [0.28, 0.2, 0.3],
        [-0.12, 0.48, 0.26],
      ] as const) {
        const x = cx + (dx + ((i * 37) % 7) * 0.01) * S;
        const y = cy + dy * S;
        g.moveTo(x - (wd * S) / 2, y)
          .quadraticCurveTo(x - (wd * S) / 4, y - 0.07 * S, x, y)
          .quadraticCurveTo(x + (wd * S) / 4, y + 0.07 * S, x + (wd * S) / 2, y)
          .stroke({ width: 2.2, color: SEA.wave, alpha: 0.38, cap: 'round' });
      }
    });
    this.seaLayer.addChild(g);
  }

  private buildLand(state: GameState) {
    this.landLayer.removeChildren().forEach((c) => c.destroy({ children: true }));
    const shallow = new Graphics();
    const beach = new Graphics();
    const tiles = new Graphics();
    const motifs = new Container();
    for (const id of TOPOLOGY.landHexes) {
      const tile = state.board.hexes[id];
      const info = TOPOLOGY.hex[id];
      if (!tile || !info) continue;
      const cx = info.x * S;
      const cy = info.y * S;
      shallow.poly(hexPoints(cx, cy, S * 1.2)).fill({ color: 0x5fb1e0, alpha: 0.35 });
      beach.poly(hexPoints(cx, cy, S * 1.07)).fill(BEACH);
    }
    for (const id of TOPOLOGY.landHexes) {
      const tile = state.board.hexes[id];
      const info = TOPOLOGY.hex[id];
      if (!tile || !info) continue;
      const pal = TERRAIN_PALETTE[tile.terrain];
      const cx = info.x * S;
      const cy = info.y * S;
      tiles
        .poly(hexPoints(cx, cy, S * 1.0))
        .fill(pal.base)
        .stroke({ width: 2, color: pal.dark, alpha: 0.9 });
      tiles.poly(hexPoints(cx, cy, S * 0.9)).stroke({ width: 2, color: pal.light, alpha: 0.35 });
      const m = new Graphics();
      drawTerrainMotif(m, tile.terrain, cx, cy, tile.q, tile.r);
      motifs.addChild(m);
    }
    this.landLayer.addChild(shallow, beach, tiles, motifs);
  }

  private buildPorts(state: GameState) {
    this.portLayer.removeChildren().forEach((c) => c.destroy({ children: true }));
    const docks = new Graphics();
    const badges = new Container();
    const R = 0.37 * S;
    for (const port of state.board.ports) {
      const w = TOPOLOGY.water[port.waterHex];
      if (!w) continue;
      const [cx, cy] = [w.x * S, w.y * S];
      for (const v of port.vertices) {
        const vi = TOPOLOGY.vertex[v];
        if (!vi) continue;
        const [vx, vy] = [vi.x * S, vi.y * S];
        const d = Math.hypot(cx - vx, cy - vy);
        const ex = cx - ((cx - vx) / d) * R * 0.8;
        const ey = cy - ((cy - vy) / d) * R * 0.8;
        docks
          .moveTo(vx, vy)
          .lineTo(ex, ey)
          .stroke({ width: 0.12 * S, color: 0x3d2a18, cap: 'round' });
        docks
          .moveTo(vx, vy)
          .lineTo(ex, ey)
          .stroke({ width: 0.085 * S, color: 0xb98b55, cap: 'round' });
        docks
          .moveTo(vx, vy)
          .lineTo(ex, ey)
          .stroke({ width: 0.02 * S, color: 0xdcb887, alpha: 0.8, cap: 'round' });
        docks.circle(vx, vy, 0.045 * S).fill(0x3d2a18);
      }
      const b = new Container();
      b.position.set(cx, cy);
      const g = new Graphics();
      const col = portColor(port.kind);
      g.circle(1.5, 3, R).fill({ color: 0x000000, alpha: 0.3 });
      g.circle(0, 0, R)
        .fill(shade(col, port.kind === 'generic' ? 0 : 0.25))
        .stroke({ width: 3, color: INK });
      g.circle(0, 0, R * 0.86).stroke({ width: 1.5, color: shade(col, -0.4), alpha: 0.7 });
      if (port.kind === 'generic') {
        b.addChild(g);
        const t = label('3:1', 0.21 * S, TOKEN.text);
        t.position.set(0, -0.04 * S);
        const any = label('ANY', 0.085 * S, 0x6b5f45, SANS);
        any.position.set(0, 0.16 * S);
        b.addChild(t, any);
      } else {
        drawResourceIcon(g, port.kind, 0, -0.07 * S, 0.3 * S);
        b.addChild(g);
        const t = label('2:1', 0.15 * S, TOKEN.text);
        t.position.set(0, 0.2 * S);
        b.addChild(t);
      }
      badges.addChild(b);
    }
    this.portLayer.addChild(docks, badges);
  }

  private buildTokens(state: GameState) {
    this.tokenLayer.removeChildren().forEach((c) => c.destroy({ children: true }));
    for (const id of TOPOLOGY.landHexes) {
      const tile = state.board.hexes[id];
      const info = TOPOLOGY.hex[id];
      if (!tile || !info || tile.token === null) continue;
      const hot = tile.token === 6 || tile.token === 8;
      const c = new Container();
      c.position.set(info.x * S, info.y * S);
      const g = new Graphics();
      const R = 0.36 * S;
      g.circle(1.5, 3, R).fill({ color: 0x000000, alpha: 0.32 });
      g.circle(0, 0, R).fill(TOKEN.face).stroke({ width: 2.5, color: TOKEN.rim });
      g.circle(0, 0, R * 0.88).stroke({ width: 1, color: TOKEN.rim, alpha: 0.35 });
      const pips = tokenPips(tile.token);
      const gap = 0.07 * S;
      for (let i = 0; i < pips; i++) {
        g.circle((i - (pips - 1) / 2) * gap, 0.2 * S, 0.026 * S).fill(hot ? TOKEN.red : TOKEN.text);
      }
      const t = label(
        String(tile.token),
        (tile.token >= 10 ? 0.27 : 0.31) * S,
        hot ? TOKEN.red : TOKEN.text,
      );
      t.position.set(0, -0.05 * S);
      c.addChild(g, t);
      this.tokenLayer.addChild(c);
    }
  }

  // -------------------------------------------------------------------------
  // Dynamic layers
  // -------------------------------------------------------------------------

  private colorOf(state: GameState, owner: PlayerId): number {
    const css = state.players[owner]?.color ?? '#888888';
    return new Color(css).toNumber();
  }

  private syncPieces(state: GameState) {
    const wanted = new Map<string, { sig: string; make: () => Container; layer: Container }>();

    for (const [id, owner] of Object.entries(state.pieces.roads) as [EdgeId, PlayerId][]) {
      const color = this.colorOf(state, owner);
      wanted.set(id, {
        sig: `road:${color}`,
        layer: this.roadLayer,
        make: () => {
          const info = TOPOLOGY.edge[id];
          const [a, b] = (info?.vertices ?? []).map((v) => TOPOLOGY.vertex[v]);
          const c = new Container();
          if (!info || !a || !b) return c;
          c.position.set(...pt(info));
          const g = new Graphics();
          drawRoad(
            g,
            [a.x * S - info.x * S, a.y * S - info.y * S],
            [b.x * S - info.x * S, b.y * S - info.y * S],
            color,
          );
          c.addChild(g);
          return c;
        },
      });
    }

    for (const [id, b] of Object.entries(state.pieces.buildings) as [
      VertexId,
      { owner: PlayerId; kind: string },
    ][]) {
      const color = this.colorOf(state, b.owner);
      wanted.set(id, {
        sig: `${b.kind}:${color}`,
        layer: this.buildingLayer,
        make: () => {
          const info = TOPOLOGY.vertex[id];
          const c = new Container();
          if (!info) return c;
          c.position.set(...pt(info));
          const g = new Graphics();
          if (b.kind === 'city') drawCity(g, 0, 0, color);
          else drawSettlement(g, 0, 0, color);
          c.addChild(g);
          return c;
        },
      });
    }

    const fresh: Container[] = [];
    for (const [key, entry] of this.pieces) {
      const w = wanted.get(key);
      if (!w || w.sig !== entry.sig) {
        entry.node.destroy({ children: true });
        this.pieces.delete(key);
      }
    }
    for (const [key, w] of wanted) {
      if (this.pieces.has(key)) continue;
      const node = w.make();
      w.layer.addChild(node);
      this.pieces.set(key, { sig: w.sig, node });
      fresh.push(node);
    }
    // Pop-in only for a handful of new pieces (not when a whole position is loaded).
    if (this.seeded && fresh.length > 0 && fresh.length <= 3) {
      for (const node of fresh) {
        node.scale.set(0.2);
        this.pops.push({ node, t0: this.clock });
      }
    }
    this.seeded = true;
    // Keep roads ordered so overlaps are stable.
    this.roadLayer.children.sort((a, b) => a.y - b.y);
    this.buildingLayer.children.sort((a, b) => a.y - b.y);
  }

  private syncRobber(state: GameState) {
    const info = TOPOLOGY.hex[state.robber];
    if (!info) return;
    const hasToken = state.board.hexes[state.robber]?.token != null;
    const target = { x: info.x * S + (hasToken ? -0.47 * S : 0), y: info.y * S + 0.32 * S };
    this.robberTarget = target;
    if (!this.robberPos) {
      this.robberPos = { ...target };
      this.robber.clear();
      drawRobber(this.robber, 0, 0);
      this.robber.position.set(target.x, target.y);
    }
  }

  // -------------------------------------------------------------------------
  // Highlights + hover
  // -------------------------------------------------------------------------

  private glowColor(): number {
    return this.highlights.color ? new Color(this.highlights.color).toNumber() : HIGHLIGHT;
  }

  private buildGlows() {
    this.glowLayer.removeChildren().forEach((c) => c.destroy({ children: true }));
    this.glows = [];
    const color = this.glowColor();
    const add = (kind: Glow['kind'], at: Point, draw: (g: Graphics) => void) => {
      const node = new Container();
      node.position.set(...pt(at));
      const glow = new Graphics();
      draw(glow);
      node.addChild(glow);
      this.glowLayer.addChild(node);
      this.glows.push({ node, glow, kind });
    };

    for (const id of this.highlights.hexes ?? []) {
      const info = TOPOLOGY.hex[id];
      if (!info) continue;
      add('hex', info, (g) => {
        g.poly(hexPoints(0, 0, S * 0.94))
          .fill({ color, alpha: 0.2 })
          .stroke({ width: 5, color, alpha: 0.95, join: 'round' });
      });
    }
    for (const id of this.highlights.edges ?? []) {
      const info = TOPOLOGY.edge[id];
      const a = info && TOPOLOGY.vertex[info.vertices[0]];
      const b = info && TOPOLOGY.vertex[info.vertices[1]];
      if (!info || !a || !b) continue;
      add('edge', info, (g) => {
        const [ax, ay] = [(a.x - info.x) * S, (a.y - info.y) * S];
        const [bx, by] = [(b.x - info.x) * S, (b.y - info.y) * S];
        const k = 0.28;
        const p0 = [ax + (bx - ax) * k, ay + (by - ay) * k];
        const p1 = [bx - (bx - ax) * k, by - (by - ay) * k];
        g.moveTo(p0[0] ?? 0, p0[1] ?? 0)
          .lineTo(p1[0] ?? 0, p1[1] ?? 0)
          .stroke({ width: 0.2 * S, color, alpha: 0.35, cap: 'round' });
        g.moveTo(p0[0] ?? 0, p0[1] ?? 0)
          .lineTo(p1[0] ?? 0, p1[1] ?? 0)
          .stroke({ width: 0.08 * S, color, alpha: 0.95, cap: 'round' });
      });
    }
    for (const id of this.highlights.vertices ?? []) {
      const info = TOPOLOGY.vertex[id];
      if (!info) continue;
      add('vertex', info, (g) => {
        g.circle(0, 0, 0.2 * S).fill({ color, alpha: 0.3 });
        g.circle(0, 0, 0.2 * S).stroke({ width: 3, color, alpha: 0.95 });
        g.circle(0, 0, 0.06 * S).fill({ color, alpha: 1 });
      });
    }
  }

  private drawHover() {
    const g = this.hoverLayer;
    g.clear();
    const hit = this.hover;
    if (!hit) return;
    const color = this.glowColor();
    if (hit.kind === 'vertex') {
      const v = TOPOLOGY.vertex[hit.id];
      if (!v) return;
      g.circle(v.x * S, v.y * S, 0.27 * S)
        .fill({ color: 0xffffff, alpha: 0.35 })
        .stroke({ width: 3.5, color: 0xffffff });
    } else if (hit.kind === 'edge') {
      const e = TOPOLOGY.edge[hit.id];
      const a = e && TOPOLOGY.vertex[e.vertices[0]];
      const b = e && TOPOLOGY.vertex[e.vertices[1]];
      if (!a || !b) return;
      const k = 0.2;
      const [ax, ay, bx, by] = [a.x * S, a.y * S, b.x * S, b.y * S];
      const [x0, y0] = [ax + (bx - ax) * k, ay + (by - ay) * k];
      const [x1, y1] = [bx - (bx - ax) * k, by - (by - ay) * k];
      g.moveTo(x0, y0)
        .lineTo(x1, y1)
        .stroke({ width: 0.2 * S, color: 0xffffff, alpha: 0.4, cap: 'round' });
      g.moveTo(x0, y0)
        .lineTo(x1, y1)
        .stroke({ width: 0.1 * S, color: 0xffffff, cap: 'round' });
    } else {
      const h = TOPOLOGY.hex[hit.id];
      if (!h) return;
      g.poly(hexPoints(h.x * S, h.y * S, S * 0.97))
        .fill({ color, alpha: 0.28 })
        .stroke({ width: 6, color: 0xffffff, alpha: 0.9, join: 'round' });
    }
  }

  // -------------------------------------------------------------------------
  // Animation
  // -------------------------------------------------------------------------

  private update(dtMs: number) {
    this.clock += dtMs;
    const pulse = 0.5 + 0.5 * Math.sin(this.clock / 260);
    for (const g of this.glows) {
      g.glow.alpha = 0.55 + 0.45 * pulse;
      if (g.kind !== 'hex') g.node.scale.set(1 + 0.12 * pulse);
    }

    if (this.pops.length > 0) {
      this.pops = this.pops.filter((p) => {
        const t = Math.min(1, (this.clock - p.t0) / 280);
        if (p.node.destroyed) return false;
        p.node.scale.set(0.2 + 0.8 * easeOutBack(t));
        if (t >= 1) p.node.scale.set(1);
        return t < 1;
      });
    }

    const pos = this.robberPos;
    if (pos) {
      const k = 1 - Math.exp(-dtMs / 55);
      pos.x += (this.robberTarget.x - pos.x) * k;
      pos.y += (this.robberTarget.y - pos.y) * k;
      if (Math.hypot(this.robberTarget.x - pos.x, this.robberTarget.y - pos.y) < 0.3) {
        pos.x = this.robberTarget.x;
        pos.y = this.robberTarget.y;
      }
      // A little hop while travelling.
      const dist = Math.hypot(this.robberTarget.x - pos.x, this.robberTarget.y - pos.y);
      this.robber.position.set(pos.x, pos.y - Math.min(18, dist * 0.15));
    }
  }
}
