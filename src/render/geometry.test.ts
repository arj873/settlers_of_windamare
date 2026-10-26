import { describe, expect, it } from 'vitest';
import { MAP_IDS, TOPOLOGY, hexCenter, topologyFor } from '../engine';
import {
  HEX_SIZE,
  PORT_REACH,
  boardBounds,
  clampView,
  distToSegment,
  fitBounds,
  fitView,
  hexAt,
  pick,
  pickRadii,
  screenToUnit,
  textResolution,
  unitToScreen,
  zoomAt,
} from './geometry';

describe('view transform', () => {
  it('round-trips screen <-> unit', () => {
    const view = { x: 120, y: -40, scale: 37.5 };
    const p = { x: 3.25, y: -1.5 };
    const back = screenToUnit(view, unitToScreen(view, p));
    expect(back.x).toBeCloseTo(p.x);
    expect(back.y).toBeCloseTo(p.y);
  });

  it('fitView centers the bounds and fits the tighter axis', () => {
    const b = boardBounds();
    for (const [w, h] of [
      [1280, 720],
      [400, 800],
      [800, 800],
    ] as const) {
      const v = fitView(b, w, h, 20);
      const tl = unitToScreen(v, { x: b.minX, y: b.minY });
      const br = unitToScreen(v, { x: b.maxX, y: b.maxY });
      expect((tl.x + br.x) / 2).toBeCloseTo(w / 2);
      expect((tl.y + br.y) / 2).toBeCloseTo(h / 2);
      expect(tl.x).toBeGreaterThanOrEqual(20 - 1e-6);
      expect(tl.y).toBeGreaterThanOrEqual(20 - 1e-6);
      expect(br.x).toBeLessThanOrEqual(w - 20 + 1e-6);
      expect(br.y).toBeLessThanOrEqual(h - 20 + 1e-6);
      // At least one axis touches the padding.
      const touchesX = Math.abs(tl.x - 20) < 1e-6;
      const touchesY = Math.abs(tl.y - 20) < 1e-6;
      expect(touchesX || touchesY).toBe(true);
    }
  });

  it('fitView survives a zero-size screen', () => {
    const v = fitView(boardBounds(), 0, 0);
    expect(Number.isFinite(v.scale) && v.scale > 0).toBe(true);
  });

  it('zoomAt keeps the anchor point fixed', () => {
    const view = { x: 50, y: 70, scale: 40 };
    const anchor = { x: 300, y: 210 };
    const before = screenToUnit(view, anchor);
    const zoomed = zoomAt(view, 1.7, anchor, 10, 400);
    const after = screenToUnit(zoomed, anchor);
    expect(zoomed.scale).toBeCloseTo(68);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it('zoomAt clamps the scale', () => {
    const view = { x: 0, y: 0, scale: 40 };
    expect(zoomAt(view, 100, { x: 0, y: 0 }, 10, 80).scale).toBe(80);
    expect(zoomAt(view, 0.001, { x: 0, y: 0 }, 10, 80).scale).toBe(10);
  });

  it('clampView keeps the board center on screen', () => {
    const b = boardBounds();
    const far = { x: 5000, y: -5000, scale: 50 };
    const c = clampView(far, b, 800, 600);
    const center = unitToScreen(c, { x: 0, y: 0 });
    expect(center.x).toBe(800);
    expect(center.y).toBe(0);
    const ok = fitView(b, 800, 600);
    expect(clampView(ok, b, 800, 600)).toBe(ok);
  });
});

describe('hit-testing', () => {
  const ppu = 50;

  it('finds every vertex at its own position', () => {
    for (const id of TOPOLOGY.vertices) {
      const v = TOPOLOGY.vertex[id]!;
      expect(pick({ x: v.x, y: v.y }, ppu)).toEqual({ kind: 'vertex', id });
    }
  });

  it('finds every edge at its midpoint', () => {
    for (const id of TOPOLOGY.edges) {
      const e = TOPOLOGY.edge[id]!;
      expect(pick({ x: e.x, y: e.y }, ppu)).toEqual({ kind: 'edge', id });
    }
  });

  it('finds every land hex at its center, and nothing in the water', () => {
    for (const id of TOPOLOGY.landHexes) {
      const h = TOPOLOGY.hex[id]!;
      expect(pick({ x: h.x, y: h.y }, ppu)).toEqual({ kind: 'hex', id });
      expect(hexAt({ x: h.x, y: h.y })).toBe(id);
    }
    for (const id of TOPOLOGY.waterHexes) {
      const w = TOPOLOGY.water[id]!;
      expect(hexAt({ x: w.x, y: w.y })).toBeNull();
      expect(pick({ x: w.x, y: w.y }, ppu)).toBeNull();
    }
  });

  it('hexAt agrees with hexCenter for points near a center', () => {
    const c = hexCenter(1, -2);
    expect(hexAt({ x: c.x + 0.4, y: c.y - 0.3 })).toBe('h:1,-2');
    expect(hexAt({ x: 0.01, y: -0.01 })).toBe('h:0,0');
  });

  it('prefers the nearer of a vertex and an edge', () => {
    const e = TOPOLOGY.edge['e:0,0,E']!;
    const v = TOPOLOGY.vertex[e.vertices[0]]!;
    // On the edge, just 0.06 off the vertex: both are in reach, the vertex is nearer.
    const toward = { x: (e.x - v.x) * 0.12 + v.x, y: (e.y - v.y) * 0.12 + v.y };
    expect(pick(toward, ppu)).toEqual({ kind: 'vertex', id: e.vertices[0] });
    // At the midpoint the edge wins.
    expect(pick({ x: e.x, y: e.y }, ppu)).toEqual({ kind: 'edge', id: 'e:0,0,E' });
  });

  it('misses a point far from every vertex/edge but inside a hex gives the hex', () => {
    expect(pick({ x: 0, y: 0 }, ppu)).toEqual({ kind: 'hex', id: 'h:0,0' });
  });

  it('restricts to candidates', () => {
    const e = TOPOLOGY.edge['e:0,0,E']!;
    const mid = { x: e.x, y: e.y };
    expect(pick(mid, ppu, { vertices: [] })).toBeNull();
    expect(pick(mid, ppu, { hexes: ['h:0,0'] })).toEqual({ kind: 'hex', id: 'h:0,0' });
    expect(pick(mid, ppu, { edges: ['e:0,0,SE'] })).toBeNull();
    expect(pick(mid, ppu, { edges: ['e:0,0,E'] })).toEqual({ kind: 'edge', id: 'e:0,0,E' });
    // A hex that is not a candidate is not returned even though the point is inside it.
    expect(pick({ x: 0, y: 0 }, ppu, { hexes: ['h:1,0'] })).toBeNull();
  });

  it('keeps radii usable at any zoom', () => {
    for (const z of [5, 20, 50, 200, 800]) {
      const r = pickRadii(z);
      expect(r.vertex).toBeGreaterThanOrEqual(0.16);
      expect(r.vertex).toBeLessThanOrEqual(0.34);
      expect(r.edge).toBeGreaterThanOrEqual(0.1);
      expect(r.edge).toBeLessThanOrEqual(0.24);
    }
    // Zoomed in far, the picking zone shrinks in unit space but stays finger-sized in pixels.
    expect(pickRadii(400).vertex).toBeLessThan(pickRadii(50).vertex);
  });

  it('still hits every vertex after zooming (pick works in unit space)', () => {
    const view = fitView(boardBounds(), 1000, 700);
    const zoomed = zoomAt(view, 3, { x: 300, y: 200 }, 1, 1e4);
    for (const id of TOPOLOGY.vertices) {
      const v = TOPOLOGY.vertex[id]!;
      const s = unitToScreen(zoomed, { x: v.x, y: v.y });
      const hit = pick(screenToUnit(zoomed, { x: s.x + 3, y: s.y - 3 }), zoomed.scale);
      expect(hit).toEqual({ kind: 'vertex', id });
    }
  });

  it('distToSegment handles degenerate and clamped cases', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 2, y: 0 };
    expect(distToSegment({ x: 1, y: 1 }, a, b)).toBeCloseTo(1);
    expect(distToSegment({ x: 5, y: 0 }, a, b)).toBeCloseTo(3);
    expect(distToSegment({ x: 3, y: 4 }, a, a)).toBeCloseTo(5);
  });
});

describe('fitBounds', () => {
  it('holds every land hex and every harbor badge, inside the drawn board', () => {
    for (const map of MAP_IDS) {
      const topo = topologyFor(map);
      const fit = fitBounds(topo);
      const board = boardBounds(topo);
      const inside = (x: number, y: number) =>
        x >= fit.minX - 1e-9 &&
        x <= fit.maxX + 1e-9 &&
        y >= fit.minY - 1e-9 &&
        y <= fit.maxY + 1e-9;
      for (const id of topo.landHexes) {
        const h = topo.hex[id];
        expect(h && inside(h.x, h.y - 1) && inside(h.x, h.y + 1)).toBe(true);
        expect(
          h && inside(h.x - Math.sqrt(3) / 2, h.y) && inside(h.x + Math.sqrt(3) / 2, h.y),
        ).toBe(true);
      }
      for (const slot of topo.portSlots) {
        const w = topo.water[slot.waterHex];
        expect(w && inside(w.x - PORT_REACH, w.y - PORT_REACH)).toBe(true);
        expect(w && inside(w.x + PORT_REACH, w.y + PORT_REACH)).toBe(true);
      }
      expect(fit.minX).toBeGreaterThan(board.minX);
      expect(fit.maxY).toBeLessThan(board.maxY);
    }
  });
});

describe('textResolution', () => {
  it('gives 1 to 1.41 texels per device pixel at any zoom and pixel ratio', () => {
    for (const dpr of [0.67, 1, 1.25, 1.5, 2, 3]) {
      for (let pxPerUnit = 20; pxPerUnit <= 400; pxPerUnit *= 1.07) {
        const devicePx = (pxPerUnit / HEX_SIZE) * dpr;
        if (devicePx < 0.25 || devicePx > 8) continue; // clamped (tested below)
        const ratio = textResolution(pxPerUnit, dpr) / devicePx;
        expect(ratio).toBeGreaterThanOrEqual(1 - 1e-9);
        expect(ratio).toBeLessThanOrEqual(Math.SQRT2 + 1e-9);
      }
    }
  });

  it('follows the zoom in coarse steps, so small zooms do not re-rasterize', () => {
    expect(textResolution(57, 1)).toBeCloseTo(Math.SQRT1_2); // fitted base78 at 1918x938
    expect(textResolution(60, 1)).toBe(textResolution(65, 1));
    expect(textResolution(57, 2)).toBeCloseTo(textResolution(57, 1) * 2);
    let prev = 0;
    for (let pxPerUnit = 10; pxPerUnit < 1000; pxPerUnit += 3) {
      const r = textResolution(pxPerUnit, 1);
      expect(r).toBeGreaterThanOrEqual(prev);
      prev = r;
    }
  });

  it('is clamped and safe for odd input', () => {
    expect(textResolution(5000, 3)).toBe(8);
    expect(textResolution(1, 1)).toBe(0.25);
    expect(textResolution(0, 1)).toBe(1);
    expect(textResolution(Number.NaN, 1)).toBe(1);
    expect(textResolution(100, 0)).toBe(1);
  });
});
