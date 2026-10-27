import type { Graphics } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { drawTerrainMotif } from './art';

/** A stand-in Graphics that records every fill colour (all calls chain). */
function recorder() {
  const fills: number[] = [];
  const g: Record<string, unknown> = new Proxy(
    {},
    {
      get: (_t, key) =>
        key === 'fill'
          ? (c: number | { color: number }) => {
              fills.push(typeof c === 'number' ? c : c.color);
              return g;
            }
          : () => g,
    },
  );
  return { g: g as unknown as Graphics, fills };
}

describe('terrain motifs', () => {
  // #50: the mountains hex shows ore (the ore icon's rocks with gold nuggets), not only peaks.
  it('the ore hex draws ore: faceted rocks and gold nuggets', () => {
    const { g, fills } = recorder();
    drawTerrainMotif(g, 'ore', 0, 0, 0, 0);
    expect(fills).toContain(0xbac7d4); // the ore icon's lit facet
    expect(fills).toContain(0xf0c040); // gold nuggets
  });

  it('brick hills draw no ore', () => {
    const { g, fills } = recorder();
    drawTerrainMotif(g, 'brick', 0, 0, 0, 0);
    expect(fills).not.toContain(0xbac7d4);
    expect(fills).not.toContain(0xf0c040);
  });

  it('is deterministic per hex', () => {
    const a = recorder();
    const b = recorder();
    drawTerrainMotif(a.g, 'ore', 10, 20, 1, -1);
    drawTerrainMotif(b.g, 'ore', 10, 20, 1, -1);
    expect(a.fills).toEqual(b.fills);
  });
});
