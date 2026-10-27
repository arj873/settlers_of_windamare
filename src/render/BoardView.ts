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
 * Pan (drag) / zoom (wheel, pinch) are built in; double-click refits. The view refits on every
 * renderer resize, and on inset changes until the user pans or zooms.
 */
import { Color, Container, EventsTicker, Graphics, Text, Ticker, type Application } from 'pixi.js';
import {
  TOPOLOGY,
  edgeInfo,
  terrainKind,
  tokenPips,
  topologyOf,
  vertexInfo,
  type EdgeId,
  type GameState,
  type HexId,
  type PlayerId,
  type Point,
  type Topology,
  type VertexId,
} from '../engine';
import {
  drawCity,
  drawResourceIcon,
  drawRobber,
  drawRoad,
  drawRoadJoint,
  drawSettlement,
  drawTerrainMotif,
  hexPoints,
  shade,
} from './art';
import * as art from './art';
import { allSites, drawersFor, terrainPainter, tokenPlace, type DrawContext } from './expansions';
import {
  HEX_SIZE as S,
  backdropRadius,
  boardBounds,
  fitBounds,
  pick,
  screenToUnit,
  textResolution,
  unitToScreen,
  type Hit,
  type PickCandidates,
  type ViewTransform,
} from './geometry';
import { FrameScheduler } from './frames';
import {
  MAX_LIVE_MARKS,
  MAX_RECAP_MARKS,
  markFrame,
  newSites,
  type PieceSite,
  type Sites,
} from './marks';
import { BEACH, HIGHLIGHT, INK, SEA, TOKEN, portColor, terrainPalette } from './theme';
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

/** #33: a fading ring over a just-built piece, in the builder's colour. */
interface Mark {
  g: Graphics;
  t0: number;
  color: number;
  /** Ring radius at rest, design px. */
  r: number;
  /** The turn-start recap: fainter, one ring. */
  soft: boolean;
}

/** How long a "just built" mark lasts (ms); the recap's is shorter. */
const MARK_MS = 1700;
const RECAP_MS = 1300;

const SERIF = 'Georgia, "Times New Roman", serif';
const SANS = '"Trebuchet MS", "Segoe UI", Helvetica, Arial, sans-serif';
/** Quiet time (ms) after the last zoom before board text is re-rasterized for the new scale. */
const RETEXT_DELAY = 150;

const pt = (p: Point): [number, number] => [p.x * S, p.y * S];

/** `resolution`: texels per design px, so the glyphs match the screen (`textResolution`). */
function label(
  text: string,
  size: number,
  fill: number,
  resolution: number,
  font = SERIF,
  weight: 'bold' | 'normal' = 'bold',
) {
  const t = new Text({
    text,
    style: { fontFamily: font, fontSize: size, fontWeight: weight, fill },
    resolution,
  });
  t.anchor.set(0.5);
  return t;
}

const devicePixelRatio = () =>
  typeof window !== 'undefined' && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;

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
  private readonly jointLayer = new Container();
  private readonly roadLayer = new Container();
  private readonly buildingLayer = new Container();
  private readonly robberLayer = new Container();
  /** Expansion drawer layers (render/expansions.ts), by z-slot. */
  private readonly extBoardLayer = new Container();
  private readonly extPiecesLayer = new Container();
  private readonly extTopLayer = new Container();
  /** `${expansion}:${key}` -> what is drawn and its signature. */
  private readonly extNodes = new Map<string, PieceNode>();
  private readonly glowLayer = new Container();
  /** #33: rings over just-built pieces. */
  private readonly markLayer = new Container();
  private marks: Mark[] = [];
  /** The pieces of the last rendered state (null before the first): new ones get a mark. */
  private sites: Sites | null = null;
  /** The last rendered state (marks take the builder's colour from it). */
  private shown: GameState | null = null;
  private readonly hoverLayer = new Graphics();

  private readonly viewport: Viewport;
  private readonly listeners = new Map<keyof BoardEvents, Set<Listener<never>>>();

  private boardSig = '';
  /** Topology of the board being shown (the base board until the first render). */
  private topo: Topology = TOPOLOGY;
  private highlights: Highlights = {};
  private hover: Hit | null = null;
  private glows: Glow[] = [];

  private readonly pieces = new Map<string, PieceNode>();
  private seeded = false;
  private pops: { node: Container; t0: number }[] = [];

  private readonly robber = new Graphics();
  private robberTarget: Point = { x: 0, y: 0 };
  private robberPos: Point | null = null;

  /** Resolution the board text is rasterized at, and the one the current zoom wants. */
  private textRes = 1;
  private wantTextRes = 1;
  private viewChangedAt = 0;
  private unwatchDpr: (() => void) | null = null;

  private clock = 0;
  /** False: animations jump to their end and glows hold still (headless playtest pages). */
  private animated = true;
  private readonly frames: FrameScheduler;
  private readonly onResize = () => {
    this.resize();
    this.wantTextRes = this.textResFor(this.viewport.view.scale);
    this.frames.invalidate();
  };
  private readonly tick = (ticker: { deltaMS: number }) => {
    Ticker.system.update();
    this.update(this.animated ? ticker.deltaMS : 1e6);
    this.frames.endFrame(this.animated && this.animating());
  };

  constructor(private readonly app: Application) {
    this.frames = new FrameScheduler(app.ticker);
    this.world.addChild(
      this.seaLayer,
      this.landLayer,
      this.portLayer,
      this.tokenLayer,
      this.extBoardLayer,
      this.roadLayer,
      this.jointLayer,
      this.buildingLayer,
      this.extPiecesLayer,
      this.markLayer,
      this.robberLayer,
      this.extTopLayer,
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
      fitBounds: fitBounds(),
      getSize: () => ({ width: app.screen.width, height: app.screen.height }),
      onChange: (v) => this.applyView(v),
      onTap: (p) => this.handleTap(p),
      onHover: (p) => this.handleHover(p),
    });

    // The board reads its own pointer input (Viewport). Pixi's event system would hit-test the
    // stage on every pointer move and, through the system ticker, on every animation frame.
    Object.assign(app.renderer.events.features, {
      move: false,
      globalMove: false,
      click: false,
      wheel: false,
    });
    EventsTicker.removeTickerListener();
    // What is left on the system ticker is housekeeping (texture GC), which only matters after
    // a change: run it in the board's frames rather than on an endless animation-frame loop.
    Ticker.system.autoStart = false;
    Ticker.system.stop();

    app.renderer.on('resize', this.onResize);
    app.ticker.add(this.tick);
    this.watchPixelRatio();
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /** Draw `state`. Cheap to call after every action: only what changed is rebuilt. */
  render(state: GameState): void {
    this.shown = state;
    const topo = topologyOf(state);
    if (topo !== this.topo) {
      // A different board frame: new sea, new fit bounds. (Big boards get proper art in T12.)
      this.topo = topo;
      this.buildSea();
      this.viewport.setBounds(boardBounds(topo), fitBounds(topo));
    }
    const sig = JSON.stringify([
      Object.values(state.board.hexes).map((h) => [h.id, h.terrain, h.token]),
      state.board.ports.map((p) => [p.kind, p.edge, p.waterHex]),
      state.settings.expansions,
    ]);
    if (sig !== this.boardSig) {
      this.boardSig = sig;
      this.textRes = this.wantTextRes;
      this.buildLand(state);
      this.buildPorts(state);
      this.buildTokens(state);
      // Another board: its pieces are a position, not builds.
      this.sites = null;
    }
    this.syncPieces(state);
    this.syncRobber(state);
    this.syncExtLayers(state);
    this.markNewPieces(state);
    this.frames.invalidate();
  }

  /**
   * #33 recap: briefly mark the pieces of `state` that `since` (an earlier state of this game,
   * e.g. at the end of the viewer's last turn) did not have. Fainter than a live build mark.
   */
  markSince(since: GameState): void {
    if (!this.sites) return;
    const added = newSites(allSites(since), this.sites);
    if (added.length === 0 || added.length > MAX_RECAP_MARKS) return;
    for (const s of added) this.addMark(s, true);
  }

  /** Mark legal spots (they pulse and become hoverable/clickable); `{}` clears. */
  setHighlights(h: Highlights): void {
    this.highlights = h;
    this.buildGlows();
    this.hover = null;
    this.drawHover();
  }

  /**
   * The board draws only when something changed or moves. `false` also stops the motion: pop-ins
   * and robber travel jump to their end and glows hold still (headless playtest pages).
   */
  setAnimated(on: boolean): void {
    this.animated = on;
    this.frames.invalidate();
  }

  on<K extends keyof BoardEvents>(type: K, cb: Listener<K>): () => void {
    const set = this.listeners.get(type) ?? new Set<Listener<never>>();
    this.listeners.set(type, set);
    const fn = cb as Listener<never>;
    set.add(fn);
    return () => void set.delete(fn);
  }

  /** Re-read the renderer size (also called automatically on renderer resize); a new size refits. */
  resize(): void {
    this.viewport.resize();
  }

  /** Reset pan/zoom to fit the whole board. */
  fit(): void {
    this.viewport.fit();
  }

  /**
   * Screen margins covered by the permanent HUD panels (the fitted board fits inside them) and
   * by transient overlays (`avoid`: the fitted board slides away from them without zooming).
   * A camera the user panned or zoomed keeps its framing.
   */
  setInsets(insets: Insets, avoid?: Insets): void {
    this.viewport.setInsets(insets, avoid);
  }

  /** False once the user panned or zoomed, until the next refit. */
  isFitted(): boolean {
    return this.viewport.isFitted;
  }

  /**
   * Page position (CSS px, viewport-relative like `clientX/Y`) of a vertex, edge midpoint or
   * hex center; null for unknown ids. For the playtest harness (`?debug=1`).
   */
  screenPos(id: string): Point | null {
    const info =
      vertexInfo(this.topo, id as VertexId) ??
      edgeInfo(this.topo, id as EdgeId) ??
      this.topo.hex[id as HexId] ??
      this.topo.water[id as HexId];
    if (!info) return null;
    const p = unitToScreen(this.viewport.view, info);
    const r = this.app.canvas.getBoundingClientRect();
    return { x: p.x + r.left, y: p.y + r.top };
  }

  /** Redraw the sea and frame after `setFrameColors` (a UI theme change). */
  retheme(): void {
    this.buildSea();
    this.frames.invalidate();
  }

  /** Resolution board text is currently rasterized at (texels per design px; tests, harness). */
  textResolution(): number {
    return this.textRes;
  }

  destroy(): void {
    this.unwatchDpr?.();
    this.app.renderer.off('resize', this.onResize);
    this.app.ticker.remove(this.tick);
    Ticker.system.autoStart = true;
    Ticker.system.start();
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
    return pick(screenToUnit(view, screen), view.scale, this.candidates(), this.topo);
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
    this.wantTextRes = this.textResFor(v.scale);
    this.viewChangedAt = this.clock;
    this.frames.invalidate();
  }

  private textResFor(pxPerUnit: number): number {
    return textResolution(pxPerUnit, this.app.renderer.resolution);
  }

  /**
   * Board text is a bitmap drawn at design size: re-rasterize it for the current zoom (once the
   * zoom has settled), so it is never minified many times over without mipmaps (smeared when
   * zoomed out) nor magnified (soft when zoomed in). Graphics are vector and need nothing.
   */
  private retext() {
    this.textRes = this.wantTextRes;
    const walk = (c: Container) => {
      for (const child of c.children) {
        if (child instanceof Text) child.resolution = this.textRes;
        else walk(child);
      }
    };
    walk(this.portLayer);
    walk(this.tokenLayer);
  }

  /**
   * Keep the renderer at the device pixel ratio. `app.init` reads it once; browser zoom or a
   * move to another monitor changes it, and a stale canvas resolution is scaled (blurred) by the
   * browser. The media query only matches the current ratio, so it is re-armed on every change.
   */
  private watchPixelRatio() {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const sync = () => {
      const dpr = devicePixelRatio();
      const { width, height } = this.app.screen;
      if (this.app.renderer.resolution !== dpr) this.app.renderer.resize(width, height, dpr);
    };
    const arm = () => {
      const mq = window.matchMedia(`(resolution: ${devicePixelRatio()}dppx)`);
      const onChange = () => {
        sync();
        arm();
      };
      mq.addEventListener('change', onChange, { once: true });
      this.unwatchDpr = () => mq.removeEventListener('change', onChange);
    };
    sync();
    arm();
  }

  // -------------------------------------------------------------------------
  // Static layers
  // -------------------------------------------------------------------------

  private buildSea() {
    this.seaLayer.removeChildren().forEach((c) => c.destroy({ children: true }));
    const R = backdropRadius(this.topo) * S;
    const ox = this.topo.center.x * S;
    const oy = this.topo.center.y * S;
    const g = new Graphics();
    // Wooden frame around a flat-top hexagonal sea.
    const turn = Math.PI / 6; // roundPoly puts a vertex on the vertical axis; we want one on the x axis
    g.roundPoly(ox, oy, R + 0.22 * S, 6, 0.6 * S, turn)
      .fill(SEA.frame)
      .stroke({ width: 3, color: SEA.frameDark });
    g.roundPoly(ox, oy, R + 0.1 * S, 6, 0.6 * S, turn).stroke({
      width: 2,
      color: SEA.frameLight,
      alpha: 0.8,
    });
    g.roundPoly(ox, oy, R, 6, 0.55 * S, turn)
      .fill(SEA.deep)
      .stroke({ width: 4, color: SEA.frameDark });
    // Water hexes.
    this.topo.waterHexes.forEach((id, i) => {
      const w = this.topo.water[id];
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
    for (const id of this.topo.landHexes) {
      const tile = state.board.hexes[id];
      const info = this.topo.hex[id];
      // Board hexes that are sea or fog (scenario boards) get no beach.
      if (!tile || !info || terrainKind(tile.terrain) !== 'land') continue;
      const cx = info.x * S;
      const cy = info.y * S;
      shallow.poly(hexPoints(cx, cy, S * 1.2)).fill({ color: 0x5fb1e0, alpha: 0.35 });
      beach.poly(hexPoints(cx, cy, S * 1.07)).fill(BEACH);
    }
    for (const id of this.topo.landHexes) {
      const tile = state.board.hexes[id];
      const info = this.topo.hex[id];
      if (!tile || !info) continue;
      const cx = info.x * S;
      const cy = info.y * S;
      const painter = terrainPainter(state, tile.terrain);
      if (painter) {
        const m = new Graphics();
        painter(m, cx, cy, S);
        motifs.addChild(m);
        continue;
      }
      const pal = terrainPalette(tile.terrain);
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
      // A harbour lies on a frame water hex, or on a board hex revealed as sea (New World).
      const w = this.topo.water[port.waterHex] ?? this.topo.hex[port.waterHex];
      if (!w) continue;
      const [cx, cy] = [w.x * S, w.y * S];
      for (const v of port.vertices) {
        const vi = this.topo.vertex[v];
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
        const t = label('3:1', 0.21 * S, TOKEN.text, this.textRes);
        t.position.set(0, -0.04 * S);
        const any = label('ANY', 0.085 * S, 0x6b5f45, this.textRes, SANS);
        any.position.set(0, 0.16 * S);
        b.addChild(t, any);
      } else {
        drawResourceIcon(g, port.kind, 0, -0.07 * S, 0.3 * S);
        b.addChild(g);
        const t = label('2:1', 0.15 * S, TOKEN.text, this.textRes);
        t.position.set(0, 0.2 * S);
        b.addChild(t);
      }
      badges.addChild(b);
    }
    this.portLayer.addChild(docks, badges);
  }

  private buildTokens(state: GameState) {
    this.tokenLayer.removeChildren().forEach((c) => c.destroy({ children: true }));
    for (const id of this.topo.landHexes) {
      const tile = state.board.hexes[id];
      const info = this.topo.hex[id];
      if (!tile || !info || tile.token === null) continue;
      const hot = tile.token === 6 || tile.token === 8;
      const c = new Container();
      const at = tokenPlace(state, id);
      c.position.set((info.x + (at?.dx ?? 0)) * S, (info.y + (at?.dy ?? 0)) * S);
      if (at) c.scale.set(at.scale);
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
        this.textRes,
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

  /** Pegs on building-free vertices with roads: neutral at junctions (2+), rounded end at dead ends. */
  private wantRoadJoints(
    state: GameState,
    wanted: Map<string, { sig: string; make: () => Container; layer: Container }>,
  ) {
    for (const v of Object.values(this.topo.vertex)) {
      if (state.pieces.buildings[v.id]) continue;
      const owners = v.edges.flatMap((e) => {
        const owner = state.pieces.roads[e];
        return owner === undefined ? [] : [owner];
      });
      if (owners.length === 0) continue;
      const color = owners.length === 1 ? this.colorOf(state, owners[0] as PlayerId) : undefined;
      wanted.set(`joint:${v.id}`, {
        sig: `joint:${color ?? 'peg'}`,
        layer: this.jointLayer,
        make: () => {
          const c = new Container();
          c.position.set(...pt(v));
          const g = new Graphics();
          drawRoadJoint(g, 0, 0, color);
          c.addChild(g);
          return c;
        },
      });
    }
  }

  private syncPieces(state: GameState) {
    const wanted = new Map<string, { sig: string; make: () => Container; layer: Container }>();

    for (const [id, owner] of Object.entries(state.pieces.roads) as [EdgeId, PlayerId][]) {
      const color = this.colorOf(state, owner);
      // Earthquake event: the damaged road is "turned sideways" (drawn faded, rotated a bit).
      const damaged = state.damagedRoads?.[owner] === id;
      wanted.set(id, {
        sig: `road:${color}${damaged ? ':damaged' : ''}`,
        layer: this.roadLayer,
        make: () => {
          const info = this.topo.edge[id];
          const [a, b] = (info?.vertices ?? []).map((v) => this.topo.vertex[v]);
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
          if (damaged) {
            g.alpha = 0.55;
            g.rotation = 0.35;
          }
          c.addChild(g);
          return c;
        },
      });
    }

    this.wantRoadJoints(state, wanted);

    for (const [id, b] of Object.entries(state.pieces.buildings) as [
      VertexId,
      { owner: PlayerId; kind: string },
    ][]) {
      const color = this.colorOf(state, b.owner);
      wanted.set(id, {
        sig: `${b.kind}:${color}`,
        layer: this.buildingLayer,
        make: () => {
          const info = this.topo.vertex[id];
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

  /** Expansion layers: rebuilt only when their signature changes; dropped when no longer active. */
  private syncExtLayers(state: GameState) {
    const slot = { board: this.extBoardLayer, pieces: this.extPiecesLayer, top: this.extTopLayer };
    const seen = new Set<string>();
    const ctx: DrawContext = {
      topo: this.topo,
      S,
      colorOf: (owner) => this.colorOf(state, owner),
      pt,
      art,
    };
    for (const d of drawersFor(state)) {
      for (const layer of d.layers ?? []) {
        const key = `${d.id}:${layer.key}`;
        seen.add(key);
        const sig = layer.sig(state);
        const old = this.extNodes.get(key);
        if (old && old.sig === sig) continue;
        old?.node.destroy({ children: true });
        const node = layer.draw(state, ctx);
        slot[layer.z].addChild(node);
        this.extNodes.set(key, { sig, node });
      }
    }
    for (const [key, entry] of this.extNodes) {
      if (seen.has(key)) continue;
      entry.node.destroy({ children: true });
      this.extNodes.delete(key);
    }
  }

  /** #33: a ring in the builder's colour over every piece built (or moved) since the last render. */
  private markNewPieces(state: GameState) {
    const sites = allSites(state);
    const before = this.sites;
    this.sites = sites;
    if (!before) return;
    const added = newSites(before, sites);
    if (added.length > MAX_LIVE_MARKS) return;
    for (const s of added) this.addMark(s, false);
  }

  private addMark(site: PieceSite, soft: boolean) {
    const at =
      vertexInfo(this.topo, site.at as VertexId) ??
      edgeInfo(this.topo, site.at as EdgeId) ??
      this.topo.hex[site.at as HexId] ??
      this.topo.water[site.at as HexId];
    if (!at) return;
    const g = new Graphics();
    g.position.set(...pt(at));
    this.markLayer.addChild(g);
    const css = this.shown?.players[site.owner]?.color ?? '#ffffff';
    const color = new Color(css).toNumber();
    const r = (site.kind === 'road' || /ship/.test(site.kind) ? 0.36 : 0.42) * S;
    this.marks.push({ g, t0: this.clock, color, r, soft });
    this.frames.invalidate();
  }

  private syncRobber(state: GameState) {
    // settings.robberMode 'none': there is no robber piece; NO_ROBBER (off the board, e.g. the
    // Seafarers robber waiting beside the board, T&B without a robber): hidden.
    const info = this.topo.hex[state.robber];
    this.robber.visible = state.settings.robberMode !== 'none' && info !== undefined;
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
      const info = this.topo.hex[id] ?? this.topo.water[id];
      if (!info) continue;
      add('hex', info, (g) => {
        g.poly(hexPoints(0, 0, S * 0.94))
          .fill({ color, alpha: 0.2 })
          .stroke({ width: 5, color, alpha: 0.95, join: 'round' });
      });
    }
    for (const id of this.highlights.edges ?? []) {
      const info = edgeInfo(this.topo, id);
      const a = info && vertexInfo(this.topo, info.vertices[0]);
      const b = info && vertexInfo(this.topo, info.vertices[1]);
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
      const info = vertexInfo(this.topo, id);
      if (!info) continue;
      add('vertex', info, (g) => {
        g.circle(0, 0, 0.2 * S).fill({ color, alpha: 0.3 });
        g.circle(0, 0, 0.2 * S).stroke({ width: 3, color, alpha: 0.95 });
        g.circle(0, 0, 0.06 * S).fill({ color, alpha: 1 });
      });
    }
  }

  private drawHover() {
    this.frames.invalidate();
    const g = this.hoverLayer;
    g.clear();
    const hit = this.hover;
    if (!hit) return;
    const color = this.glowColor();
    if (hit.kind === 'vertex') {
      const v = vertexInfo(this.topo, hit.id);
      if (!v) return;
      g.circle(v.x * S, v.y * S, 0.27 * S)
        .fill({ color: 0xffffff, alpha: 0.35 })
        .stroke({ width: 3.5, color: 0xffffff });
    } else if (hit.kind === 'edge') {
      const e = edgeInfo(this.topo, hit.id);
      const a = e && vertexInfo(this.topo, e.vertices[0]);
      const b = e && vertexInfo(this.topo, e.vertices[1]);
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
      const h = this.topo.hex[hit.id] ?? this.topo.water[hit.id];
      if (!h) return;
      g.poly(hexPoints(h.x * S, h.y * S, S * 0.97))
        .fill({ color, alpha: 0.28 })
        .stroke({ width: 6, color: 0xffffff, alpha: 0.9, join: 'round' });
    }
  }

  // -------------------------------------------------------------------------
  // Animation
  // -------------------------------------------------------------------------

  /** Whether the next frame differs from this one with no further change. */
  private animating(): boolean {
    const r = this.robberPos;
    const t = this.robberTarget;
    return (
      this.glows.length > 0 ||
      this.pops.length > 0 ||
      this.marks.length > 0 ||
      this.wantTextRes !== this.textRes ||
      (r !== null && (r.x !== t.x || r.y !== t.y))
    );
  }

  private update(dtMs: number) {
    this.clock += dtMs;
    if (this.wantTextRes !== this.textRes && this.clock - this.viewChangedAt >= RETEXT_DELAY) {
      this.retext();
    }
    const pulse = this.animated ? 0.5 + 0.5 * Math.sin(this.clock / 260) : 1;
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

    if (this.marks.length > 0) {
      this.marks = this.marks.filter((m) => {
        const t = (this.clock - m.t0) / (m.soft ? RECAP_MS : MARK_MS);
        const { rings, glow } = markFrame(t, m.soft);
        m.g.clear();
        if (t >= 1) {
          m.g.destroy();
          return false;
        }
        if (glow > 0) m.g.circle(0, 0, m.r * 0.8).fill({ color: m.color, alpha: glow });
        for (const ring of rings) {
          const r = m.r * ring.scale;
          // A dark under-stroke keeps light colours (white, yellow) visible on any terrain.
          m.g.circle(0, 0, r).stroke({ width: 0.1 * S, color: 0x1a1208, alpha: ring.alpha * 0.35 });
          m.g.circle(0, 0, r).stroke({ width: 0.06 * S, color: m.color, alpha: ring.alpha });
        }
        return true;
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
