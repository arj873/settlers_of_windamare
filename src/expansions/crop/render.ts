/**
 * Crop Trust board drawer: the crop tokens lying on each fields hex (up to 7, coloured by
 * species, drawn under the number token), and a faded stamp on fields hexes that ran empty.
 */
import { Container, Graphics } from 'pixi.js';
import type { BoardDrawer } from '../../render/expansions';
import { CROP, SPECIES, SPECIES_COLOR, cropSlice, totalOf, type CropCounts } from './engine';

/** Token slots on a hex, unit offsets from its centre: 4 in the first row, 3 in the second. */
const SLOTS: readonly (readonly [number, number])[] = [
  [-0.36, 0.5],
  [-0.12, 0.5],
  [0.12, 0.5],
  [0.36, 0.5],
  [-0.24, 0.72],
  [0, 0.72],
  [0.24, 0.72],
];

export const cropDrawer: BoardDrawer = {
  id: CROP,
  layers: [
    {
      key: 'crops',
      z: 'board',
      sig: (state) => JSON.stringify(cropSlice(state).crops),
      draw(state, ctx) {
        const layer = new Container();
        const S = ctx.S;
        const crops = cropSlice(state).crops;
        for (const [id, counts] of Object.entries(crops) as [
          `h:${number},${number}`,
          CropCounts,
        ][]) {
          const info = ctx.topo.hex[id];
          if (!info) continue;
          const [cx, cy] = ctx.pt(info);
          const g = new Graphics();
          if (totalOf(counts) === 0) {
            // An empty field: a dark furrow mark.
            g.moveTo(cx - 0.3 * S, cy + 0.55 * S).lineTo(cx + 0.3 * S, cy + 0.55 * S);
            g.moveTo(cx - 0.22 * S, cy + 0.7 * S).lineTo(cx + 0.22 * S, cy + 0.7 * S);
            g.stroke({ width: 0.04 * S, color: 0x5a3b1a, alpha: 0.7, cap: 'round' });
            layer.addChild(g);
            continue;
          }
          let slot = 0;
          for (const sp of SPECIES) {
            for (let i = 0; i < counts[sp] && slot < SLOTS.length; i++, slot++) {
              const [dx, dy] = SLOTS[slot] as readonly [number, number];
              const x = cx + dx * S;
              const y = cy + dy * S;
              const r = 0.095 * S;
              g.circle(x, y, r)
                .fill(SPECIES_COLOR[sp])
                .stroke({ width: 1.6, color: 0x2a1708, alpha: 0.9 });
              g.circle(x - 0.03 * S, y - 0.035 * S, r * 0.35).fill({
                color: 0xffffff,
                alpha: 0.45,
              });
            }
          }
          layer.addChild(g);
        }
        return layer;
      },
    },
  ],
};
