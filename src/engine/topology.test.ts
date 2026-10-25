import { describe, expect, it } from 'vitest';
import {
  edgeId,
  hexCenter,
  hexDistance,
  hexId,
  parseEdgeId,
  parseHexId,
  parseVertexId,
  sideEdge,
  vertexId,
  type Side,
} from './hex';
import { TOPOLOGY as T } from './topology';
import type { HexId } from './types';

describe('topology counts', () => {
  it('has the standard board sizes', () => {
    expect(T.landHexes).toHaveLength(19);
    expect(T.waterHexes).toHaveLength(18);
    expect(T.vertices).toHaveLength(54);
    expect(T.edges).toHaveLength(72);
    expect(T.coastalEdges).toHaveLength(30);
    expect(T.portSlots).toHaveLength(9);
  });

  it('has unique ids', () => {
    expect(new Set(T.landHexes).size).toBe(19);
    expect(new Set(T.waterHexes).size).toBe(18);
    expect(new Set(T.vertices).size).toBe(54);
    expect(new Set(T.edges).size).toBe(72);
  });

  it('ids round-trip through the parsers', () => {
    for (const h of T.landHexes) {
      const { q, r } = parseHexId(h);
      expect(hexId(q, r)).toBe(h);
    }
    for (const v of T.vertices) {
      const { q, r, corner } = parseVertexId(v);
      expect(vertexId(q, r, corner)).toBe(v);
    }
    for (const e of T.edges) {
      const { q, r, side } = parseEdgeId(e);
      expect(edgeId(q, r, side)).toBe(e);
    }
  });

  it('never prints -0 in ids', () => {
    for (const id of [...T.landHexes, ...T.waterHexes, ...T.vertices, ...T.edges]) {
      expect(id).not.toMatch(/-0(?!\d)/);
    }
  });

  it('degree bounds', () => {
    for (const h of T.landHexes) {
      const info = T.hex[h];
      expect(info?.vertices).toHaveLength(6);
      expect(info?.edges).toHaveLength(6);
      expect(info?.neighbors.length).toBeGreaterThanOrEqual(3);
      expect(info?.neighbors.length).toBeLessThanOrEqual(6);
    }
    for (const v of T.vertices) {
      const info = T.vertex[v];
      expect(info?.hexes.length).toBeGreaterThanOrEqual(1);
      expect(info?.hexes.length).toBeLessThanOrEqual(3);
      expect(info?.edges.length).toBeGreaterThanOrEqual(2);
      expect(info?.edges.length).toBeLessThanOrEqual(3);
      expect(info?.vertices.length).toBe(info?.edges.length);
    }
    for (const e of T.edges) {
      const info = T.edge[e];
      expect(new Set(info?.vertices).size).toBe(2);
      expect(info?.hexes.length).toBeGreaterThanOrEqual(1);
      expect(info?.hexes.length).toBeLessThanOrEqual(2);
      expect(info?.edges.length).toBeGreaterThanOrEqual(2);
      expect(info?.edges.length).toBeLessThanOrEqual(4);
    }
  });

  it('coastal: 30 edges with one hex, 30 vertices with fewer than three hexes', () => {
    expect(T.edges.filter((e) => T.edge[e]?.coastal)).toHaveLength(30);
    expect(T.vertices.filter((v) => T.vertex[v]?.coastal)).toHaveLength(30);
    for (const e of T.coastalEdges) expect(T.edge[e]?.hexes).toHaveLength(1);
  });
});

describe('adjacency symmetry', () => {
  it('hex <-> vertex', () => {
    for (const h of T.landHexes) {
      for (const v of T.hex[h]?.vertices ?? []) expect(T.vertex[v]?.hexes).toContain(h);
    }
    for (const v of T.vertices) {
      for (const h of T.vertex[v]?.hexes ?? []) expect(T.hex[h]?.vertices).toContain(v);
    }
  });

  it('hex <-> edge', () => {
    for (const h of T.landHexes) {
      for (const e of T.hex[h]?.edges ?? []) expect(T.edge[e]?.hexes).toContain(h);
    }
    for (const e of T.edges) {
      for (const h of T.edge[e]?.hexes ?? []) expect(T.hex[h]?.edges).toContain(e);
    }
  });

  it('vertex <-> edge', () => {
    for (const v of T.vertices) {
      for (const e of T.vertex[v]?.edges ?? []) expect(T.edge[e]?.vertices).toContain(v);
    }
    for (const e of T.edges) {
      for (const v of T.edge[e]?.vertices ?? []) expect(T.vertex[v]?.edges).toContain(e);
    }
  });

  it('vertex <-> vertex, connected by exactly one edge', () => {
    for (const v of T.vertices) {
      for (const w of T.vertex[v]?.vertices ?? []) {
        expect(w).not.toBe(v);
        expect(T.vertex[w]?.vertices).toContain(v);
        const shared = (T.vertex[v]?.edges ?? []).filter((e) => T.vertex[w]?.edges.includes(e));
        expect(shared).toHaveLength(1);
      }
    }
  });

  it('edge <-> edge, sharing exactly one vertex', () => {
    for (const e of T.edges) {
      for (const f of T.edge[e]?.edges ?? []) {
        expect(f).not.toBe(e);
        expect(T.edge[f]?.edges).toContain(e);
        const shared = (T.edge[e]?.vertices ?? []).filter((v) => T.edge[f]?.vertices.includes(v));
        expect(shared).toHaveLength(1);
      }
    }
  });

  it('hex <-> hex', () => {
    for (const h of T.landHexes) {
      for (const n of T.hex[h]?.neighbors ?? []) expect(T.hex[n]?.neighbors).toContain(h);
    }
  });

  it('hex side i joins corners i and i+1', () => {
    for (const h of T.landHexes) {
      const info = T.hex[h];
      info?.edges.forEach((e, i) => {
        expect([...(T.edge[e]?.vertices ?? [])].sort()).toEqual(
          [info.vertices[i], info.vertices[(i + 1) % 6]].sort(),
        );
      });
    }
  });
});

describe('geometry', () => {
  it('every hex corner is at distance 1 from the center', () => {
    for (const h of T.landHexes) {
      const info = T.hex[h];
      if (!info) throw new Error();
      for (const v of info.vertices) {
        const p = T.vertex[v];
        expect(Math.hypot((p?.x ?? 0) - info.x, (p?.y ?? 0) - info.y)).toBeCloseTo(1);
      }
    }
  });

  it('origin hex is centered at 0,0', () => {
    expect(hexCenter(0, 0)).toEqual({ x: 0, y: 0 });
  });
});

describe('port slots', () => {
  it('sit on coastal edges next to their water hex, with 18 distinct vertices', () => {
    const vertices = T.portSlots.flatMap((p) => p.vertices);
    expect(new Set(vertices).size).toBe(18);
    expect(new Set(T.portSlots.map((p) => p.waterHex)).size).toBe(9);
    for (const slot of T.portSlots) {
      expect(T.edge[slot.edge]?.coastal).toBe(true);
      expect(T.water[slot.waterHex]).toBeDefined();
      const land = parseHexId(T.edge[slot.edge]?.hexes[0] ?? 'h:99,99');
      expect(hexDistance(land, parseHexId(slot.waterHex))).toBe(1);
      expect(hexDistance(parseHexId(slot.waterHex), { q: 0, r: 0 })).toBe(3);
    }
  });

  it('have 2,3,2 free coastal edges between them, 3-fold symmetric (5th-edition frame)', () => {
    const idx = T.portSlots.map((p) => T.coastalEdges.indexOf(p.edge));
    const gaps = idx.map((i, k) => ((idx[(k + 1) % 9] ?? 0) - i + 30) % 30);
    expect(gaps).toEqual([3, 4, 3, 3, 4, 3, 3, 4, 3]);
  });

  it('match the rulebook frame: each port faces this land hex, on this side', () => {
    // Rulebook 2020, Illustration A. A port between two land hexes faces the non-corner one.
    const expected: [HexId, Side][] = [
      ['h:0,-2', 'NW'], // above mountains 10
      ['h:1,-2', 'NE'], // pasture 2
      ['h:2,-1', 'NE'], // hills 10
      ['h:2,0', 'E'], // mountains 8
      ['h:1,1', 'SE'], // pasture 5
      ['h:-1,2', 'SE'], // fields 6
      ['h:-2,2', 'SW'], // hills 5
      ['h:-2,1', 'W'], // forest 8
      ['h:-1,-1', 'W'], // fields 12
    ];
    expect(T.portSlots.map((p) => p.edge)).toEqual(
      expected.map(([h, side]) => {
        const { q, r } = parseHexId(h);
        return sideEdge(q, r, side);
      }),
    );
  });
});
