/**
 * Map thumbnails for the setup screen: plain SVG hexes, no images.
 * TODO(T12): the hex lists below are local stand-ins; switch them to the engine's per-map layouts.
 */
import type { MapId } from '../types';

export interface PreviewHex {
  q: number;
  r: number;
}

/** Hexes per row, top to bottom. Rows are centred on each other (half-hex offsets). */
const ROWS: Record<MapId, number[]> = {
  base: [3, 4, 5, 4, 3],
  baseRandom: [3, 4, 5, 4, 3],
  base56: [3, 4, 5, 6, 5, 4, 3],
  base78: [4, 5, 6, 7, 6, 5, 4],
};

export function previewHexes(map: MapId): PreviewHex[] {
  const rows = ROWS[map];
  const mid = (rows.length - 1) / 2;
  const out: PreviewHex[] = [];
  rows.forEach((count, i) => {
    const r = i - mid;
    // Centre the row: x = √3 (q + r/2) must average to 0. The floor keeps q integral on
    // boards whose rows differ by one hex (5-6P, 7-8P) - the whole shape just shifts half a hex.
    const q0 = Math.floor(-(count - 1) / 2 - r / 2);
    for (let j = 0; j < count; j++) out.push({ q: q0 + j, r });
  });
  return out;
}

export type PreviewTerrain = 'brick' | 'lumber' | 'wool' | 'grain' | 'ore' | 'desert';

export const PREVIEW_COLORS: Record<PreviewTerrain, string> = {
  brick: '#c4532d',
  lumber: '#3f8f46',
  wool: '#9bcf6a',
  grain: '#e8c547',
  ore: '#7f8fa0',
  desert: '#d9c48f',
};

const CYCLE: PreviewTerrain[] = [
  'lumber',
  'wool',
  'grain',
  'brick',
  'ore',
  'wool',
  'grain',
  'lumber',
];

/** Fixed, deterministic terrain per hex (desert nearest the middle). "Random" uses a different order. */
export function previewTerrain(map: MapId, hexes: PreviewHex[]): PreviewTerrain[] {
  const step = map === 'baseRandom' ? 5 : 3;
  let desert = 0;
  let best = Infinity;
  hexes.forEach((hx, i) => {
    const d = hexCenter(hx).x ** 2 + hexCenter(hx).y ** 2;
    if (d < best) {
      best = d;
      desert = i;
    }
  });
  return hexes.map((_, i) =>
    i === desert ? 'desert' : (CYCLE[(i * step + (i >> 2)) % CYCLE.length] ?? 'wool'),
  );
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

/** A small decorative SVG of the map's board shape. */
export function mapPreviewSvg(map: MapId): SVGSVGElement {
  const hexes = previewHexes(map);
  const terrain = previewTerrain(map, hexes);
  const pad = 1.1;
  const centers = hexes.map(hexCenter);
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
  centers.forEach((c, i) => {
    const poly = document.createElementNS(SVG_NS, 'polygon');
    poly.setAttribute('points', corners(c.x, c.y, 0.93));
    poly.setAttribute('fill', PREVIEW_COLORS[terrain[i] ?? 'desert']);
    poly.setAttribute('stroke', 'rgba(8,18,30,0.55)');
    poly.setAttribute('stroke-width', '0.08');
    svg.append(poly);
  });
  return svg;
}
