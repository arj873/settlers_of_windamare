/**
 * Oil Springs board drawer: the three oil-spring hex arts (desert / forest / pasture with a
 * derrick and a slick), metropolis crowns on cities, and scorched hexes whose number token was
 * destroyed by pollution.
 */
import { Container, Graphics } from 'pixi.js';
import type { HexId, PlayerId, VertexId } from '../../engine';
import { drawTerrainMotif, hexPoints } from '../../render/art';
import type { BoardDrawer } from '../../render/expansions';
import { terrainPalette } from '../../render/theme';
import { OIL, SPRING_DESERT, SPRING_FOREST, SPRING_PASTURE, oilSlice } from './engine';

const SLICK = 0x17151c;
const DERRICK = 0x3a2a1c;
const GOLD = 0xf2c35a;

/** A spring hex: the base terrain's art, an oil slick and a derrick. */
function spring(base: 'desert' | 'lumber' | 'wool') {
  return (g: Graphics, cx: number, cy: number, S: number): void => {
    const pal = terrainPalette(base);
    g.poly(hexPoints(cx, cy, S))
      .fill(pal.base)
      .stroke({ width: 2, color: pal.dark, alpha: 0.9 });
    g.poly(hexPoints(cx, cy, S * 0.9)).stroke({ width: 2, color: pal.light, alpha: 0.35 });
    drawTerrainMotif(g, base, cx, cy, Math.round(cx), Math.round(cy));
    // The slick, below the number token.
    g.ellipse(cx + 0.08 * S, cy + 0.55 * S, 0.5 * S, 0.17 * S).fill({ color: SLICK, alpha: 0.9 });
    g.ellipse(cx + 0.18 * S, cy + 0.52 * S, 0.22 * S, 0.05 * S).fill({
      color: 0x7f6bd1,
      alpha: 0.55,
    });
    g.ellipse(cx - 0.12 * S, cy + 0.58 * S, 0.14 * S, 0.035 * S).fill({
      color: 0x3fb5a3,
      alpha: 0.5,
    });
    // The derrick on the left.
    const x = cx - 0.55 * S;
    const y = cy + 0.4 * S;
    const w = 0.16 * S;
    const top = y - 0.62 * S;
    g.moveTo(x - w, y)
      .lineTo(x, top)
      .lineTo(x + w, y)
      .stroke({ width: 0.045 * S, color: DERRICK, join: 'round' });
    for (const f of [0.3, 0.55, 0.8]) {
      const yy = y - f * 0.62 * S;
      const hw = w * (1 - f);
      g.moveTo(x - hw, yy)
        .lineTo(x + hw, yy)
        .stroke({ width: 0.03 * S, color: DERRICK });
    }
    g.moveTo(x - w, y)
      .lineTo(x + w * (1 - 0.55), y - 0.55 * 0.62 * S)
      .stroke({ width: 0.02 * S, color: DERRICK });
    g.moveTo(x + w, y)
      .lineTo(x - w * (1 - 0.55), y - 0.55 * 0.62 * S)
      .stroke({ width: 0.02 * S, color: DERRICK });
    g.circle(x, top, 0.045 * S).fill(0xd9433a);
    g.rect(x - 0.02 * S, y, 0.04 * S, 0.14 * S).fill(SLICK);
  };
}

export const oilDrawer: BoardDrawer = {
  id: OIL,
  terrain: {
    [SPRING_DESERT]: spring('desert'),
    [SPRING_FOREST]: spring('lumber'),
    [SPRING_PASTURE]: spring('wool'),
  },
  layers: [
    {
      key: 'destroyed',
      z: 'board',
      sig: (state) => oilSlice(state).destroyed.join(','),
      draw(state, ctx) {
        const layer = new Container();
        for (const id of oilSlice(state).destroyed as HexId[]) {
          const info = ctx.topo.hex[id];
          if (!info) continue;
          const [x, y] = ctx.pt(info);
          const S = ctx.S;
          const g = new Graphics();
          g.poly(hexPoints(x, y, S * 0.98)).fill({ color: 0x120f12, alpha: 0.55 });
          // A cracked, scorched look and a cross where the token used to be.
          g.moveTo(x - 0.5 * S, y - 0.3 * S)
            .lineTo(x - 0.1 * S, y)
            .lineTo(x - 0.25 * S, y + 0.45 * S);
          g.moveTo(x + 0.45 * S, y - 0.35 * S)
            .lineTo(x + 0.12 * S, y + 0.05 * S)
            .lineTo(x + 0.4 * S, y + 0.4 * S);
          g.stroke({ width: 0.035 * S, color: 0x000000, alpha: 0.6 });
          g.moveTo(x - 0.22 * S, y - 0.22 * S).lineTo(x + 0.22 * S, y + 0.22 * S);
          g.moveTo(x + 0.22 * S, y - 0.22 * S).lineTo(x - 0.22 * S, y + 0.22 * S);
          g.stroke({ width: 0.06 * S, color: 0xd9433a, alpha: 0.85, cap: 'round' });
          layer.addChild(g);
        }
        return layer;
      },
    },
    {
      key: 'metropolis',
      z: 'pieces',
      sig: (state) => JSON.stringify(oilSlice(state).metropolis),
      draw(state, ctx) {
        const layer = new Container();
        const metro = oilSlice(state).metropolis;
        for (const [v, owner] of Object.entries(metro) as [VertexId, PlayerId][]) {
          const info = ctx.topo.vertex[v];
          if (!info) continue;
          const [x, y] = ctx.pt(info);
          const S = ctx.S;
          const g = new Graphics();
          // A golden crown over the city and a ring in the owner's colour.
          g.circle(x, y - 0.04 * S, 0.27 * S).stroke({ width: 3, color: GOLD });
          g.circle(x, y - 0.04 * S, 0.3 * S).stroke({
            width: 1.5,
            color: ctx.colorOf(owner),
            alpha: 0.9,
          });
          const cy = y - 0.36 * S;
          g.poly([
            x - 0.13 * S,
            cy + 0.08 * S,
            x - 0.13 * S,
            cy - 0.07 * S,
            x - 0.065 * S,
            cy,
            x,
            cy - 0.1 * S,
            x + 0.065 * S,
            cy,
            x + 0.13 * S,
            cy - 0.07 * S,
            x + 0.13 * S,
            cy + 0.08 * S,
          ])
            .fill(GOLD)
            .stroke({ width: 1.5, color: 0x6b4a14 });
          layer.addChild(g);
        }
        return layer;
      },
    },
  ],
};
