/**
 * Catan for Two + C&K board drawer: the neutral knights (C&K's shields in the neutral players'
 * colours, never active). T&B draws the neutral roads and settlements, C&K the players' knights.
 */
import { Color, Container, Graphics } from 'pixi.js';
import type { GameState, VertexId } from '../../engine';
import type { BoardDrawer } from '../../render/expansions';
import { ckSlice, type Knight } from '../ck/engine';
import { drawKnight } from '../ck/render';
import { NEUTRAL_COLORS } from '../tb/engine';
import { TWOCK, neutralOf } from './engine';

const neutralKnights = (state: GameState) =>
  (Object.entries(ckSlice(state)?.knights ?? {}) as [VertexId, Knight][]).filter(
    ([, k]) => neutralOf(state, k.owner) !== null,
  );

export const twockDrawer: BoardDrawer = {
  id: TWOCK,
  layers: [
    {
      key: 'neutralKnights',
      z: 'pieces',
      sig: (state) =>
        neutralKnights(state)
          .map(([v, k]) => `${v}:${k.owner}${k.level}`)
          .sort()
          .join('|'),
      draw: (state, ctx) => {
        const c = new Container();
        const g = new Graphics();
        for (const [v, k] of neutralKnights(state)) {
          const info = ctx.topo.vertex[v];
          const i = neutralOf(state, k.owner);
          if (!info || i === null) continue;
          const [x, y] = ctx.pt(info);
          // Never active: always the dimmed (inactive) shield.
          drawKnight(g, x, y, ctx.S, k, new Color(NEUTRAL_COLORS[i]).toNumber(), ctx.art.shade);
        }
        c.addChild(g);
        return c;
      },
    },
  ],
};
