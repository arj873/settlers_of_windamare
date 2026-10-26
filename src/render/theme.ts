/** Colour palette for the board view. Numbers are 0xRRGGBB. */
import type { CoreTerrain, PortKind, Resource, Terrain } from '../engine';

export interface TerrainPalette {
  base: number;
  dark: number;
  light: number;
}

export const TERRAIN_PALETTE: Record<CoreTerrain, TerrainPalette> = {
  brick: { base: 0xc4623f, dark: 0x93421f, light: 0xdc8660 },
  lumber: { base: 0x2f6b3a, dark: 0x1d4a28, light: 0x4a9158 },
  wool: { base: 0x9fd16c, dark: 0x78ad47, light: 0xc0e590 },
  grain: { base: 0xe8c24c, dark: 0xc3992a, light: 0xf6dc80 },
  ore: { base: 0x7a8795, dark: 0x56626e, light: 0xa6b2be },
  desert: { base: 0xe4cf98, dark: 0xc5a966, light: 0xf2e3b8 },
  // Expansion terrains in the core (docs/EXPANSIONS.md §6).
  gold: { base: 0xf0c419, dark: 0xb8860b, light: 0xffe27a },
  sea: { base: 0x2f7fbf, dark: 0x1f5d8f, light: 0x5fb1e0 },
  fog: { base: 0x8a9099, dark: 0x5f656e, light: 0xb5bac2 },
};

/** Grey for terrains without a palette entry or drawer. */
export const UNKNOWN_TERRAIN: TerrainPalette = { base: 0x9a9a9a, dark: 0x6a6a6a, light: 0xc4c4c4 };

/** Palette of any terrain (namespaced ones without an entry are grey). */
export function terrainPalette(t: Terrain): TerrainPalette {
  return Object.hasOwn(TERRAIN_PALETTE, t) ? TERRAIN_PALETTE[t as CoreTerrain] : UNKNOWN_TERRAIN;
}

/** Flat terrain colours (kept from the T1 proof board; other layers may import it). */
export const TERRAIN_COLORS: Record<CoreTerrain, number> = {
  brick: TERRAIN_PALETTE.brick.base,
  lumber: TERRAIN_PALETTE.lumber.base,
  wool: TERRAIN_PALETTE.wool.base,
  grain: TERRAIN_PALETTE.grain.base,
  ore: TERRAIN_PALETTE.ore.base,
  desert: TERRAIN_PALETTE.desert.base,
  gold: TERRAIN_PALETTE.gold.base,
  sea: TERRAIN_PALETTE.sea.base,
  fog: TERRAIN_PALETTE.fog.base,
};

/** Accent colour per resource (port badges, icons). */
export const RESOURCE_COLORS: Record<Resource, number> = {
  brick: TERRAIN_PALETTE.brick.base,
  lumber: TERRAIN_PALETTE.lumber.base,
  wool: TERRAIN_PALETTE.wool.base,
  grain: TERRAIN_PALETTE.grain.base,
  ore: TERRAIN_PALETTE.ore.base,
};

export const PORT_GENERIC_COLOR = 0xe9e2cf;

export const SEA = {
  base: 0x2b74ae,
  alt: 0x2a6ba3,
  wave: 0x6fb0e0,
  deep: 0x1b5384,
  frame: 0x7b5431,
  frameDark: 0x4e3320,
  frameLight: 0xa57a4c,
};

/** Recolour the board frame (the UI theme calls this, then `BoardView.retheme()`). */
export function setFrameColors(c: Pick<typeof SEA, 'frame' | 'frameDark' | 'frameLight'>): void {
  SEA.frame = c.frame;
  SEA.frameDark = c.frameDark;
  SEA.frameLight = c.frameLight;
}

export const BEACH = 0xf0dfae;
export const INK = 0x1c1c24;

export const TOKEN = {
  face: 0xf8efd8,
  rim: 0x8c7a55,
  text: 0x2a2620,
  red: 0xc0281f,
};

export const HIGHLIGHT = 0xfff0a0;

export function portColor(kind: PortKind): number {
  return kind === 'generic' ? PORT_GENERIC_COLOR : RESOURCE_COLORS[kind];
}
