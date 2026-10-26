/**
 * T&B scenario pairs with Fishing on Catan (the 2025 sheets, traders-barbarians.md §8.1): the
 * other scenario's 19-hex board from T&B's own generator, plus Fishing's six fishing grounds.
 * No lake (Rivers, Barbarian Attack, Traders & Barbarians); with the Caravans the lake replaces a
 * forest next to the oasis and the 12 shares the hex of the 2.
 */
import type { CustomMapDef, GeneratedBoard } from '../../../engine/maps';
import type { Rng } from '../../../engine/rng';
import { hexNeighbors, topologyFor } from '../../../engine/topology';
import type { HexId, HexTile, MapId, ScenarioId } from '../../../engine/types';
import { fishingGrounds, TB_MAPS } from '../../tb/engine/maps';
import type { TbBoard } from '../../tb/engine/state';

export const TBPAIR = 'tbpair';
const TB = 'tb';
const GROUND_NUMBERS: readonly number[] = [4, 5, 6, 8, 9, 10];
/** The lake's numbers (T&B's 3-4 player lake). */
const LAKE_NUMBERS: readonly number[] = [2, 3, 11, 12];

export interface FishPair {
  id: ScenarioId;
  /** The other T&B scenario, and its 19-hex map. */
  other: ScenarioId;
  base: MapId;
  name: string;
  blurb: string;
  /** The sheet's target (the old boot's owner needs 1 more). */
  vp: number;
}

// prettier-ignore
export const FISH_PAIRS: readonly FishPair[] = [
  { id: 'tbpair/fishRivers', other: 'tb/rivers', base: 'tb/rivers19', vp: 10,
    name: 'Fishermen + Rivers', blurb: 'No lake; 6 fish pay for a bridge' },
  { id: 'tbpair/fishTraders', other: 'tb/traders', base: 'tb/traders19', vp: 12,
    name: 'Fishermen + Traders & Barbarians', blurb: 'No lake, no robber; 2 fish = 2 more wagon MP' },
  { id: 'tbpair/fishBa', other: 'tb/barbarianAttack', base: 'tb/ba19', vp: 12,
    name: 'Fishermen + Barbarian Attack', blurb: 'No lake; 2 fish move a knight up to 5 paths; conquered buildings catch nothing' },
  { id: 'tbpair/fishCaravans', other: 'tb/caravans', base: 'tb/caravans19', vp: 12,
    name: 'Fishermen + Caravans', blurb: 'The lake beside the oasis; the 2 and the 12 share a hex' },
];

export const mapIdOf = (pair: FishPair): `${string}/${string}` =>
  `${TBPAIR}/${pair.id.slice(TBPAIR.length + 1)}19`;

function baseMap(pair: FishPair): CustomMapDef {
  const m = TB_MAPS.find((x) => x.id === pair.base);
  if (!m) throw new Error(`unknown T&B map ${pair.base}`);
  return m;
}

const withTb = (gb: GeneratedBoard, ext: TbBoard): GeneratedBoard => ({
  ...gb,
  board: { ...gb.board, ext: { ...gb.board.ext, [TB]: ext } },
});

/**
 * Fishing + Caravans: a forest next to the oasis turns into the lake; its number takes the place
 * of the 2, which joins the 12 (that hex produces on both). Red numbers never move.
 */
function lakeByOasis(rng: Rng, map: CustomMapDef, players: number): GeneratedBoard {
  const topo = topologyFor(map.id);
  for (let attempt = 0; ; attempt++) {
    const gb = map.generate(rng, players);
    const hexes = gb.board.hexes;
    const oasis = Object.values(hexes).find((h) => h.terrain === 'tb/oasis')?.id as HexId;
    const forests = hexNeighbors(topo, oasis).filter((h) => {
      const t = hexes[h];
      return t?.terrain === 'lumber' && t.token !== 6 && t.token !== 8 && t.token !== 2;
    });
    if (forests.length === 0) {
      if (attempt < 50) continue;
      throw new Error('no forest beside the oasis');
    }
    const lake = rng.pick(forests);
    const moved = hexes[lake]?.token ?? null;
    const two = Object.values(hexes).find((h) => h.token === 2);
    const twelve = Object.values(hexes).find((h) => h.token === 12);
    const out: Record<HexId, HexTile> = { ...hexes };
    out[lake] = { ...(hexes[lake] as HexTile), terrain: 'tb/lake', token: null };
    if (two) out[two.id] = { ...two, token: moved };
    const ext = (gb.board.ext?.[TB] ?? {}) as TbBoard;
    const lakes = [{ hex: lake, numbers: [...LAKE_NUMBERS] }];
    return withTb(
      { board: { ...gb.board, hexes: out }, robber: gb.robber },
      { ...ext, lakes, twoOnTwelve: twelve?.id ?? null },
    );
  }
}

function generate(pair: FishPair, rng: Rng, players: number): GeneratedBoard {
  const map = baseMap(pair);
  const gb =
    pair.other === 'tb/caravans' ? lakeByOasis(rng, map, players) : map.generate(rng, players);
  const ext = (gb.board.ext?.[TB] ?? {}) as TbBoard;
  const grounds = fishingGrounds(rng, topologyFor(map.id), gb.board, [...GROUND_NUMBERS]);
  return withTb(gb, { ...ext, grounds });
}

function mapDefOf(pair: FishPair): CustomMapDef {
  return {
    id: mapIdOf(pair),
    name: `${pair.name} (19 hexes)`,
    get frame() {
      return baseMap(pair).frame;
    },
    minPlayers: 3,
    maxPlayers: 4,
    layout: 'custom',
    get bankPerResource(): number {
      return baseMap(pair).bankPerResource;
    },
    get devDeck() {
      return baseMap(pair).devDeck;
    },
    generate: (rng, players) => generate(pair, rng, players),
  };
}

export const TBPAIR_MAPS: readonly CustomMapDef[] = FISH_PAIRS.map(mapDefOf);
