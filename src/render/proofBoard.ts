/**
 * Placeholder board drawing from T1 (proof that engine -> Pixi works).
 * T4 replaces this with the real board view; delete freely.
 */
import { Container, Graphics, Text } from 'pixi.js';
import { CORNERS, cornerPoint, TOPOLOGY, type GameState, type Terrain } from '../engine';

export const TERRAIN_COLORS: Record<Terrain, number> = {
  brick: 0xc0583a,
  lumber: 0x2e7d32,
  wool: 0x9ccc65,
  grain: 0xf2c94c,
  ore: 0x8d99ae,
  desert: 0xe6d3a3,
};
const WATER = 0x2b6cb0;

/** Draws all hexes in unit coordinates scaled by `size` px, centered on (0, 0). */
export function drawProofBoard(state: GameState, size: number): Container {
  const root = new Container();

  const hexagon = (q: number, r: number, fill: number) =>
    new Graphics()
      .poly(
        CORNERS.flatMap((c) => {
          const p = cornerPoint(q, r, c);
          return [p.x * size, p.y * size];
        }),
      )
      .fill(fill)
      .stroke({ width: 2, color: 0x1a202c });

  for (const id of TOPOLOGY.waterHexes) {
    const w = TOPOLOGY.water[id];
    if (w) root.addChild(hexagon(w.q, w.r, WATER));
  }

  for (const id of TOPOLOGY.landHexes) {
    const tile = state.board.hexes[id];
    const info = TOPOLOGY.hex[id];
    if (!tile || !info) continue;
    root.addChild(hexagon(tile.q, tile.r, TERRAIN_COLORS[tile.terrain]));
    if (tile.token !== null) {
      const red = tile.token === 6 || tile.token === 8;
      const disc = new Graphics()
        .circle(info.x * size, info.y * size, size * 0.3)
        .fill(0xfdf6e3)
        .stroke({ width: 1, color: 0x333333 });
      const label = new Text({
        text: String(tile.token),
        style: {
          fontFamily: 'sans-serif',
          fontSize: size * 0.3,
          fontWeight: 'bold',
          fill: red ? 0xc0392b : 0x222222,
        },
      });
      label.anchor.set(0.5);
      label.position.set(info.x * size, info.y * size);
      root.addChild(disc, label);
    }
  }

  return root;
}
