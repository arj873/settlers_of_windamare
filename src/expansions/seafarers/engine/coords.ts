/**
 * The rules doc's map coordinates (docs/rules/seafarers.md §2.0) to engine ids.
 *
 * The printed Seafarers maps are flat-top hexes in 7 vertical columns; a cell is `(c, r)` with
 * `c + r` even (r = half rows). The engine is pointy-top axial, so the board is turned 90° counter-
 * clockwise (§2.0.3): axial r = 6 - c, q = (r_book + c - 6) / 2. Clockwise stays clockwise.
 */
import { cornerVertex, hexId, sideEdge, type Corner, type Side } from '../../../engine/hex';
import type { EdgeId, HexId, VertexId } from '../../../engine/types';

/** A flat-top cell of the rules doc. */
export type Cell = readonly [c: number, r: number];

/** Flat-top side / neighbour names of the doc. */
export type BookSide = 'N' | 'NE' | 'SE' | 'S' | 'SW' | 'NW';
/** Flat-top corner names of the doc. */
export type BookCorner = 'NE' | 'E' | 'SE' | 'SW' | 'W' | 'NW';

/** Frames of §2.0.1: the last half-row of columns 0/6, 1/3/5 and 2/4. */
export type FrameKind = 'SHORT' | 'TALL' | 'XTALL' | 'A' | 'B';
const FRAME_ROWS: Record<FrameKind, readonly [number, number, number]> = {
  SHORT: [8, 9, 10],
  TALL: [10, 11, 12],
  XTALL: [12, 13, 14],
  A: [14, 15, 16],
  B: [16, 17, 18],
};

const SIDE_MAP: Record<BookSide, Side> = {
  N: 'W',
  NE: 'NW',
  SE: 'NE',
  S: 'E',
  SW: 'SE',
  NW: 'SW',
};
const CORNER_MAP: Record<BookCorner, Corner> = {
  E: 'N',
  NE: 'NW',
  NW: 'SW',
  W: 'S',
  SW: 'SE',
  SE: 'NE',
};
const NEIGHBOR: Record<BookSide, Cell> = {
  N: [0, -2],
  S: [0, 2],
  NE: [1, -1],
  SE: [1, 1],
  NW: [-1, -1],
  SW: [-1, 1],
};

export function axialOf([c, r]: Cell): { q: number; r: number } {
  if ((c + r) % 2 !== 0) throw new Error(`(${c},${r}) is not a cell (c + r must be even)`);
  return { q: (r + c - 6) / 2 + 0, r: 6 - c + 0 };
}

export function cellHex(cell: Cell): HexId {
  const { q, r } = axialOf(cell);
  return hexId(q, r);
}

export function cellVertex(cell: Cell, corner: BookCorner): VertexId {
  const { q, r } = axialOf(cell);
  return cornerVertex(q, r, CORNER_MAP[corner]);
}

export function cellEdge(cell: Cell, side: BookSide): EdgeId {
  const { q, r } = axialOf(cell);
  return sideEdge(q, r, SIDE_MAP[side]);
}

export function cellNeighbor([c, r]: Cell, side: BookSide): Cell {
  const [dc, dr] = NEIGHBOR[side];
  return [c + dc, r + dr];
}

/** Every cell inside a frame (the playing area), column by column, top to bottom. */
export function footprint(kind: FrameKind): Cell[] {
  const [r0, r1, r2] = FRAME_ROWS[kind];
  const last = [r0, r1, r2, r1, r2, r1, r0];
  const first = [2, 1, 0, 1, 0, 1, 2];
  const out: Cell[] = [];
  for (let c = 0; c < 7; c++) {
    for (let r = first[c] as number; r <= (last[c] as number); r += 2) out.push([c, r]);
  }
  return out;
}

/** The frame: cells next to the footprint but outside it (harbours, pirate, robber may sit there). */
export function frameRing(cells: readonly Cell[]): Cell[] {
  const inside = new Set(cells.map(([c, r]) => `${c},${r}`));
  const ring = new Map<string, Cell>();
  for (const cell of cells) {
    for (const side of Object.keys(NEIGHBOR) as BookSide[]) {
      const n = cellNeighbor(cell, side);
      const k = `${n[0]},${n[1]}`;
      if (!inside.has(k)) ring.set(k, n);
    }
  }
  return [...ring.values()];
}

/** "3,7" -> [3, 7]. */
export function parseCell(s: string): Cell {
  const m = /^(-?\d+),(-?\d+)$/.exec(s.trim());
  if (!m) throw new Error(`bad cell "${s}"`);
  return [Number(m[1]), Number(m[2])];
}
