/**
 * Barbarian Attack + C&K board drawer: the path knights as C&K's shields (rank chevrons, gold rim
 * when active) on the middle of their path. T&B draws the barbarians, castle and conquest; C&K
 * the walls, metropolises and merchant.
 */
import { Container, Graphics } from 'pixi.js';
import type { EdgeId, GameState } from '../../engine';
import type { BoardDrawer } from '../../render/expansions';
import type { Knight } from '../ck/engine';
import { drawKnight } from '../ck/render';
import { BACK, backSlice } from './engine';

const knights = (state: GameState) =>
  Object.entries(backSlice(state)?.knights ?? {}) as [EdgeId, Knight][];

export const backDrawer: BoardDrawer = {
  id: BACK,
  layers: [
    {
      key: 'pathKnights',
      z: 'pieces',
      sig: (state) =>
        knights(state)
          .map(([e, k]) => `${e}:${k.owner}${k.level}${k.active ? 'a' : 'i'}`)
          .sort()
          .join('|'),
      draw: (state, ctx) => {
        const c = new Container();
        const g = new Graphics();
        for (const [e, k] of knights(state)) {
          const info = ctx.topo.edge[e];
          if (!info) continue;
          const [x, y] = ctx.pt(info);
          drawKnight(g, x, y, ctx.S * 0.85, k, ctx.colorOf(k.owner), ctx.art.shade);
        }
        c.addChild(g);
        return c;
      },
    },
  ],
};
