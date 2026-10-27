/**
 * T&B + Seafarers board drawer: a hex carrying a second number disc (C3: the number of the hex
 * the lake or the watering hole replaced, Rivers' 2 and 12) shows it beside its own token.
 * Everything else is drawn by the Seafarers and T&B drawers.
 */
import { Container } from 'pixi.js';
import type { BoardDrawer } from '../../render/expansions';
import { disc } from '../tb/render';
import { TBSEA, tbseaBoard } from './engine';

export const tbseaDrawer: BoardDrawer = {
  id: TBSEA,
  layers: [
    {
      key: 'extraTokens',
      z: 'board',
      sig: (state) => JSON.stringify(tbseaBoard(state.board).extraTokens ?? []),
      draw: (state, ctx) => {
        const c = new Container();
        for (const x of tbseaBoard(state.board).extraTokens ?? []) {
          const info = ctx.topo.hex[x.hex];
          if (!info) continue;
          const [px, py] = ctx.pt(info);
          // Up and to the right of the hex's own token, overlapping it a little.
          disc(c, x.number, px + 0.3 * ctx.S, py - 0.32 * ctx.S, 0.2 * ctx.S);
        }
        return c;
      },
    },
  ],
};
