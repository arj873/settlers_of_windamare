/**
 * Board-view extension points for expansions (docs/EXPANSIONS.md §7).
 *
 * ADDING A MODULE: one import below and one entry at the END of BOARD_DRAWERS. BoardView only
 * calls the drawers of the expansions active in the shown game.
 */
import type { Container, Graphics } from 'pixi.js';
import { cropDrawer } from '../expansions/crop/render';
import { demoDrawer } from '../expansions/demo/render';
import { oilDrawer } from '../expansions/oil/render';
import { ckDrawer } from '../expansions/ck/render';
import { seafarersDrawer } from '../expansions/seafarers/render';
import { tbDrawer } from '../expansions/tb/render';
import { epDrawer } from '../expansions/ep/render';
import { backDrawer } from '../expansions/back/render';
import { twockDrawer } from '../expansions/twock/render';
import type { ExpansionId, GameState, HexId, PlayerId, Point, Topology } from '../engine';
import type * as art from './art';
import { pieceSites, type PieceSite } from './marks';

export interface DrawContext {
  topo: Topology;
  /** Design px per unit (hex size). Multiply unit coordinates by it. */
  S: number;
  /** A player's colour as 0xRRGGBB. */
  colorOf(owner: PlayerId): number;
  /** Unit point -> design px [x, y]. */
  pt(p: Point): [number, number];
  /** The base piece painters (drawRoad, drawSettlement, drawCity, hexPoints, shade, ...). */
  art: typeof art;
}

export interface DrawerLayer {
  /** Unique within the drawer. */
  key: string;
  /** 'board' = above number tokens (below roads), 'pieces' = above buildings, 'top' = above the robber. */
  z: 'board' | 'pieces' | 'top';
  /** Cheap signature of what the layer shows; `draw` reruns only when it changes. */
  sig(state: GameState): string;
  draw(state: GameState, ctx: DrawContext): Container;
}

export interface BoardDrawer {
  id: ExpansionId;
  /** Painters for namespaced terrains: fill + motif of one hex centred at (cx, cy), in px. */
  terrain?: Readonly<Record<string, (g: Graphics, cx: number, cy: number, S: number) => void>>;
  layers?: readonly DrawerLayer[];
  /**
   * Where a hex's number token sits when not at its centre: offset and scale in hex sizes (T&B's
   * numbered trade hexes keep the centre for the plaza). Read from static board data only.
   */
  tokenAt?(state: GameState, hex: HexId): TokenPlace | undefined;
  /**
   * #33: the module's pieces as [unique key, site] (ships, knights, walls...), so a newly built
   * or moved one gets the same "just built" mark as base pieces. Optional.
   */
  sites?(state: GameState): readonly (readonly [string, PieceSite])[];
}

export interface TokenPlace {
  dx: number;
  dy: number;
  scale: number;
}

/** The first active drawer's token place for `hex`, or undefined (the hex centre). */
export function tokenPlace(state: GameState, hex: HexId): TokenPlace | undefined {
  for (const d of drawersFor(state)) {
    const at = d.tokenAt?.(state, hex);
    if (at) return at;
  }
  return undefined;
}

export const BOARD_DRAWERS: readonly BoardDrawer[] = [
  demoDrawer,
  oilDrawer,
  cropDrawer,
  ckDrawer,
  seafarersDrawer,
  tbDrawer,
  epDrawer,
  backDrawer,
  twockDrawer,
  // new modules go here, one per line
];

/** The drawers of the expansions active in `state`, in settings order. */
export function drawersFor(state: Pick<GameState, 'settings'>): BoardDrawer[] {
  const ids = state.settings.expansions as readonly ExpansionId[] | undefined;
  if (!ids || ids.length === 0) return [];
  return ids.flatMap((id) => BOARD_DRAWERS.filter((d) => d.id === id));
}

/** Every piece of `state`: base pieces plus the active modules' `sites` (#33). */
export function allSites(state: GameState): Map<string, PieceSite> {
  return pieceSites(
    state,
    drawersFor(state).flatMap((d) => d.sites?.(state) ?? []),
  );
}

/** The painter for a terrain among the active drawers, or undefined (core palette). */
export function terrainPainter(
  state: Pick<GameState, 'settings'>,
  terrain: string,
): ((g: Graphics, cx: number, cy: number, S: number) => void) | undefined {
  for (const d of drawersFor(state)) {
    const f = d.terrain?.[terrain];
    if (f) return f;
  }
  return undefined;
}
