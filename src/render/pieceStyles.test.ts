import { Graphics } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { PIECE_STYLE_IDS } from '../ui/profile/model';
import { SEAT_COLORS } from '../ui/setup/model';
import { drawCity, drawSettlement } from './art';
import { HEX_SIZE as U } from './geometry';
import { PIECE_STYLES, pieceStyle } from './pieceStyles';

const COLORS = SEAT_COLORS.map((c) => parseInt(c.color.slice(1), 16));
const RED = 0xd64541;
const BLUE = 0x3a7bd5;

/**
 * Footprints in hex units around the vertex, including the outline stroke and the drop shadow
 * (offset 2 px right, below the base). Classic is the reference; the C&K wall ring and
 * metropolis tower are sized for it.
 */
const LIMITS = {
  settlement: { minX: -0.23, maxX: 0.26, minY: -0.29, maxY: 0.235 },
  city: { minX: -0.36, maxX: 0.4, minY: -0.385, maxY: 0.275 },
} as const;

function boundsOf(draw: (g: Graphics) => void) {
  const g = new Graphics();
  draw(g);
  const b = g.getLocalBounds();
  return { minX: b.minX / U, maxX: b.maxX / U, minY: b.minY / U, maxY: b.maxY / U };
}

describe('piece styles', () => {
  it('registers exactly the profile style ids', () => {
    expect(Object.keys(PIECE_STYLES).sort()).toEqual([...PIECE_STYLE_IDS].sort());
    for (const id of PIECE_STYLE_IDS) expect(PIECE_STYLES[id].id).toBe(id);
  });

  it('falls back to classic for unknown ids', () => {
    expect(pieceStyle('nope')).toBe(PIECE_STYLES.classic);
    expect(pieceStyle(undefined)).toBe(PIECE_STYLES.classic);
    expect(pieceStyle(null)).toBe(PIECE_STYLES.classic);
    expect(pieceStyle('')).toBe(PIECE_STYLES.classic);
    expect(pieceStyle('toString')).toBe(PIECE_STYLES.classic);
    expect(pieceStyle('pagoda')).toBe(PIECE_STYLES.pagoda);
  });

  it('classic is the original art', () => {
    expect(PIECE_STYLES.classic.settlement).toBe(drawSettlement);
    expect(PIECE_STYLES.classic.city).toBe(drawCity);
  });

  for (const id of PIECE_STYLE_IDS) {
    for (const kind of ['settlement', 'city'] as const) {
      it(`${id} ${kind} draws within its footprint in every seat colour`, () => {
        const lim = LIMITS[kind];
        for (const color of COLORS) {
          const b = boundsOf((g) => PIECE_STYLES[id][kind](g, 0, 0, color));
          expect(b.maxX - b.minX).toBeGreaterThan(0.2);
          expect(b.maxY - b.minY).toBeGreaterThan(0.2);
          expect(b.minX).toBeGreaterThanOrEqual(lim.minX);
          expect(b.maxX).toBeLessThanOrEqual(lim.maxX);
          expect(b.minY).toBeGreaterThanOrEqual(lim.minY);
          expect(b.maxY).toBeLessThanOrEqual(lim.maxY);
        }
      });
    }

    it(`${id} city is bigger than its settlement`, () => {
      const s = boundsOf((g) => PIECE_STYLES[id].settlement(g, 0, 0, RED));
      const c = boundsOf((g) => PIECE_STYLES[id].city(g, 0, 0, RED));
      expect(c.maxX - c.minX).toBeGreaterThan((s.maxX - s.minX) * 1.3);
      expect(c.minY).toBeLessThan(s.minY);
    });

    it(`${id} draws relative to the vertex`, () => {
      const a = boundsOf((g) => PIECE_STYLES[id].city(g, 0, 0, BLUE));
      const b = boundsOf((g) => PIECE_STYLES[id].city(g, 250, -120, BLUE));
      expect(b.minX - a.minX).toBeCloseTo(2.5, 6);
      expect(b.minY - a.minY).toBeCloseTo(-1.2, 6);
    });
  }
});
