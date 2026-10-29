/**
 * Board-view extension points for expansions (docs/EXPANSIONS.md §7).
 *
 * A module's `pack.ts` lists its drawer; it registers when the module loads (s18,
 * src/expansions/load.ts). BoardView only calls the drawers of the expansions active in the shown
 * game.
 */
import type { Container, Graphics } from 'pixi.js';
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

const drawers: BoardDrawer[] = [];

/** The board drawers of every loaded module. */
export const BOARD_DRAWERS: readonly BoardDrawer[] = drawers;

/** Add a module's board drawer (when the module loads; the same one again does nothing). */
export function registerDrawer(d: BoardDrawer): void {
  const have = drawers.find((x) => x.id === d.id);
  if (have === d) return;
  if (have) throw new Error(`a board drawer for ${d.id} is already registered`);
  drawers.push(d);
}

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
