/** Demo expansion board drawer (F1 example): the Oasis terrain and wells on vertices. */
import { Container, Graphics } from 'pixi.js';
import type { PlayerId, VertexId } from '../../engine';
import type { BoardDrawer } from '../../render/expansions';
import { DEMO, OASIS, demoSlice } from './engine';

function drawOasis(g: Graphics, cx: number, cy: number, S: number): void {
  const pts: number[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 2;
    pts.push(cx + S * Math.cos(a), cy + S * Math.sin(a));
  }
  g.poly(pts).fill(0xe7d39a).stroke({ width: 2, color: 0xb59a5a, alpha: 0.9 });
  // A pond with two palms.
  g.ellipse(cx, cy + 0.12 * S, 0.34 * S, 0.2 * S).fill(0x3fa7d6);
  g.ellipse(cx - 0.06 * S, cy + 0.08 * S, 0.16 * S, 0.06 * S).fill({
    color: 0xffffff,
    alpha: 0.35,
  });
  for (const dx of [-0.3, 0.32]) {
    const x = cx + dx * S;
    const y = cy - 0.1 * S;
    g.moveTo(x, y + 0.18 * S)
      .lineTo(x + 0.03 * S, y - 0.16 * S)
      .stroke({ width: 0.05 * S, color: 0x7a5230, cap: 'round' });
    for (const a of [-2.6, -1.9, -1.2, -0.5]) {
      g.moveTo(x + 0.03 * S, y - 0.16 * S)
        .lineTo(
          x + 0.03 * S + Math.cos(a) * 0.2 * S,
          y - 0.16 * S + Math.sin(a) * 0.12 * S + 0.05 * S,
        )
        .stroke({ width: 0.04 * S, color: 0x2f7d3a, cap: 'round' });
    }
  }
}

export const demoDrawer: BoardDrawer = {
  id: DEMO,
  terrain: { [OASIS]: drawOasis },
  layers: [
    {
      key: 'wells',
      z: 'pieces',
      sig: (state) => JSON.stringify(demoSlice(state).wells),
      draw(state, ctx) {
        const layer = new Container();
        const wells = demoSlice(state).wells;
        for (const [v, owner] of Object.entries(wells) as [VertexId, PlayerId][]) {
          const info = ctx.topo.vertex[v];
          if (!info) continue;
          const [x, y] = ctx.pt(info);
          const g = new Graphics();
          // A small round well next to the building (offset so both stay visible).
          const ox = x + 0.17 * ctx.S;
          const oy = y + 0.13 * ctx.S;
          g.circle(ox, oy, 0.1 * ctx.S)
            .fill(0x6b4a2b)
            .stroke({ width: 3, color: ctx.colorOf(owner) });
          g.circle(ox, oy, 0.055 * ctx.S).fill(0x3fa7d6);
          layer.addChild(g);
        }
        return layer;
      },
    },
  ],
};
