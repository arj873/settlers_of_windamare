/**
 * Map thumbnails for the setup screen: plain SVG hexes, no images. Built from the engine's own
 * map data (`MAPS` / `topologyFor` / `generateBoard`), so a preview always has the real board's
 * shape, water ring and harbor spots. The beginner map shows its real layout; random maps show
 * one sample layout (a fixed seed), with the map's real terrain mix (e.g. two deserts on 5-6P).
 */
import {
  expansionById,
  generateBoard,
  mapDef,
  namespaceOf,
  parseHexId,
  Rng,
  topologyFor,
  type CoreTerrain,
  type Board,
  type HexId,
  type MapId,
  type PortKind,
  type Terrain,
} from '../../engine';

export interface PreviewHex {
  q: number;
  r: number;
}

export interface PreviewBoard {
  land: (PreviewHex & { terrain: Terrain; token?: number | null })[];
  water: PreviewHex[];
  /** Harbor markers on their water hexes. */
  harbors: (PreviewHex & { kind: PortKind })[];
}

const hexAt = (id: HexId): PreviewHex => {
  const { q, r } = parseHexId(id);
  return { q, r };
};

const cache = new Map<MapId, PreviewBoard>();

/** Can `map` be drawn now? A module map needs its module's rules loaded (s18). */
export function previewReady(map: MapId): boolean {
  return mapDef(map) !== undefined;
}

export function previewBoard(map: MapId): PreviewBoard {
  const hit = cache.get(map);
  if (hit) return hit;
  const { board } = generateBoard(map, Rng.fromSeed(`preview:${map}`));
  const out = previewOf(map, board);
  cache.set(map, out);
  return out;
}

/** The preview of a concrete board of `map` (e.g. a map-veto candidate), with its tokens. */
export function previewOf(map: MapId, board: Board): PreviewBoard {
  const topo = topologyFor(map);
  return {
    land: topo.landHexes.map((id) => ({
      ...hexAt(id),
      terrain: board.hexes[id]?.terrain ?? 'desert',
      token: board.hexes[id]?.token ?? null,
    })),
    water: topo.waterHexes.map(hexAt),
    harbors: board.ports.map((p) => ({ ...hexAt(p.waterHex), kind: p.kind })),
  };
}

/** The land hexes of a map (row-major, top row first). */
export function previewHexes(map: MapId): PreviewHex[] {
  return previewBoard(map).land.map(({ q, r }) => ({ q, r }));
}

export const PREVIEW_COLORS: Record<CoreTerrain, string> = {
  brick: '#c4532d',
  lumber: '#3f8f46',
  wool: '#9bcf6a',
  grain: '#e8c547',
  ore: '#7f8fa0',
  desert: '#d9c48f',
  gold: '#f0c419',
  sea: '#2f7fbf',
  fog: '#8a9099',
};

/** Preview colour of any terrain (a module's `TerrainInfo.color`; without one: grey). */
export function previewColor(t: Terrain): string {
  if (Object.hasOwn(PREVIEW_COLORS, t)) return PREVIEW_COLORS[t as CoreTerrain];
  const ns = namespaceOf(t);
  return (ns === null ? undefined : expansionById(ns)?.terrains?.[t]?.color) ?? '#9a9a9a';
}

const SQRT3 = Math.sqrt(3);

/** Unit-size (centre→corner = 1) hex centre. */
export function hexCenter(hx: PreviewHex): { x: number; y: number } {
  return { x: SQRT3 * (hx.q + hx.r / 2), y: 1.5 * hx.r };
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function corners(cx: number, cy: number, size: number): string {
  const pts: string[] = [];
  for (let k = 0; k < 6; k++) {
    const a = (Math.PI / 180) * (60 * k - 90); // pointy-top, first corner at N
    pts.push(`${(cx + size * Math.cos(a)).toFixed(2)},${(cy + size * Math.sin(a)).toFixed(2)}`);
  }
  return pts.join(' ');
}

function el(tag: string, attrs: Record<string, string>): SVGElement {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

/** A small SVG of the map's board: land by terrain, the water ring, harbor dots. */
export function mapPreviewSvg(map: MapId): SVGSVGElement {
  return previewSvg(previewBoard(map), false);
}

/** A concrete board (map veto): like mapPreviewSvg, plus the number tokens (6/8 in red). */
export function boardPreviewSvg(map: MapId, board: Board): SVGSVGElement {
  return previewSvg(previewOf(map, board), true);
}

function previewSvg({ land, water, harbors }: PreviewBoard, tokens: boolean): SVGSVGElement {
  const pad = 0.9;
  const centers = water.map(hexCenter);
  const minX = Math.min(...centers.map((c) => c.x)) - pad;
  const maxX = Math.max(...centers.map((c) => c.x)) + pad;
  const minY = Math.min(...centers.map((c) => c.y)) - pad;
  const maxY = Math.max(...centers.map((c) => c.y)) + pad;

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute(
    'viewBox',
    `${minX.toFixed(2)} ${minY.toFixed(2)} ${(maxX - minX).toFixed(2)} ${(maxY - minY).toFixed(2)}`,
  );
  svg.setAttribute('class', 'map-preview');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  for (const c of centers) {
    svg.append(
      el('polygon', {
        points: corners(c.x, c.y, 0.97),
        fill: '#3d8cc4',
        stroke: 'rgba(8,18,30,0.3)',
        'stroke-width': '0.06',
      }),
    );
  }
  for (const hx of land) {
    const c = hexCenter(hx);
    svg.append(
      el('polygon', {
        points: corners(c.x, c.y, 0.93),
        fill: previewColor(hx.terrain),
        stroke: 'rgba(8,18,30,0.55)',
        'stroke-width': '0.08',
      }),
    );
    if (tokens && hx.token) {
      svg.append(
        el('circle', { cx: c.x.toFixed(2), cy: c.y.toFixed(2), r: '0.42', fill: '#f4ead2' }),
      );
      const t = el('text', {
        x: c.x.toFixed(2),
        y: (c.y + 0.2).toFixed(2),
        'text-anchor': 'middle',
        'font-size': '0.58',
        'font-weight': '700',
        fill: hx.token === 6 || hx.token === 8 ? '#b3261e' : '#2b2118',
      });
      t.textContent = String(hx.token);
      svg.append(t);
    }
  }
  for (const hb of harbors) {
    const c = hexCenter(hb);
    svg.append(
      el('circle', {
        cx: c.x.toFixed(2),
        cy: c.y.toFixed(2),
        r: '0.36',
        fill: hb.kind === 'generic' ? '#f4ead2' : PREVIEW_COLORS[hb.kind],
        stroke: 'rgba(8,18,30,0.7)',
        'stroke-width': '0.08',
      }),
    );
  }
  return svg;
}
