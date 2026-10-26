/**
 * DEMO expansion "Oasis" (F1): a toy mode that exercises the expansion framework end to end. It is
 * the worked example for real expansions (docs/EXPANSIONS.md §10); copy its shape, not its rules.
 *
 * Rules (house-made, not official):
 *  - Map: the random 19-hex board with the desert replaced by an Oasis hex ('demo/oasis', no
 *    token, the robber starts there).
 *  - Wells: a new piece on a vertex holding one of your own buildings (1 brick + 1 grain, 3 per
 *    player, main phase). When a hex next to a well produces, the well's owner gets 1 more card.
 *    Every 2 wells are worth 1 public VP.
 *  - Bloom: on a roll of 2 or 12 the roller picks 1 free resource from the bank (a 'demo/bloom'
 *    phase) before continuing.
 *  - Oasis income: at the end of your turn, if you have a building on the Oasis, take 1 wool.
 *  - Option friendlyRobber (default on): the robber may not be moved to a hex next to a building
 *    of a player with 2 or fewer public VP (unless no other hex is possible).
 */
import { RESOURCES } from '../../../engine/constants';
import { log, ok, fail, isCurrent, type LegalGenerator } from '../../../engine/actions/common';
import { randomBoard } from '../../../engine/board';
import { extSlice } from '../../../engine/expansions/ext';
import { costOf, pieceLimit } from '../../../engine/expansions/hooks';
import type { ExpansionModule } from '../../../engine/expansions/types';
import { FRAME_STD19, MAPS, type CustomMapDef } from '../../../engine/maps';
import { hasResources, isResource } from '../../../engine/resources';
import { playerName } from '../../../engine/rules/text';
import { publicVictoryPoints } from '../../../engine/selectors';
import { hexVertices, isBoardVertex, topologyOf } from '../../../engine/topology';
import type {
  Action,
  GameState,
  HexId,
  PlayerId,
  Resource,
  ResourceCounts,
  VertexId,
} from '../../../engine/types';

export const DEMO = 'demo';
export const OASIS = 'demo/oasis';
export const WELL = 'demo/well';
export const WELL_COST: ResourceCounts = { brick: 1, lumber: 0, wool: 0, grain: 1, ore: 0 };
export const WELL_LIMIT = 3;
export const BLOOM_ROLLS: readonly number[] = [2, 12];

/** The demo's state slice (state.ext.demo). `v` = slice version (for future migrations). */
export interface DemoSlice {
  v: 1;
  /** Vertex -> owner. A well sits on its owner's building. */
  wells: Record<VertexId, PlayerId>;
}

export type DemoAction =
  | { type: 'demo/buildWell'; player: PlayerId; vertex: VertexId }
  | { type: 'demo/pickBloom'; player: PlayerId; resource: Resource };

export interface BloomPhase {
  kind: 'demo/bloom';
  [key: string]: unknown;
}

export function demoSlice(state: Pick<GameState, 'ext'>): DemoSlice {
  return extSlice<DemoSlice>(state, DEMO);
}

export function wellsOf(state: GameState, player: PlayerId): VertexId[] {
  const wells = demoSlice(state).wells;
  return (Object.keys(wells) as VertexId[]).filter((v) => wells[v] === player);
}

export function oasisHex(state: GameState): HexId | undefined {
  return (Object.keys(state.board.hexes) as HexId[]).find(
    (h) => state.board.hexes[h]?.terrain === OASIS,
  );
}

/** Why `player` cannot build a well on `v` right now, or null. */
export function wellBlocker(state: GameState, player: PlayerId, v: VertexId): string | null {
  if (state.phase.kind !== 'main') return 'can only build a well in the main phase';
  if (!isCurrent(state, player)) return 'not your turn';
  if (!isBoardVertex(topologyOf(state), v)) return 'invalid vertex';
  if (state.pieces.buildings[v]?.owner !== player) return 'a well needs your own building';
  if (demoSlice(state).wells[v] !== undefined) return 'there is already a well';
  if (wellsOf(state, player).length >= pieceLimit(state, player, WELL)) return 'no wells left';
  const hand = state.players[player]?.resources;
  if (!hand || !hasResources(hand, costOf(state, WELL) ?? WELL_COST)) return 'cannot afford a well';
  return null;
}

/** Hexes the robber may go to under the friendly-robber option (all other land hexes if none). */
export function friendlyRobberHexes(state: GameState): HexId[] {
  const t = topologyOf(state);
  const all = t.landHexes.filter((h) => h !== state.robber);
  const poor = new Set(
    state.players.filter((p) => publicVictoryPoints(state, p.id) <= 2).map((p) => p.id),
  );
  const ok = all.filter((h) =>
    hexVertices(t, h).every((v) => {
      const b = state.pieces.buildings[v];
      return b === undefined || !poor.has(b.owner);
    }),
  );
  return ok.length > 0 ? ok : all;
}

const friendly = (state: GameState) => state.settings.options[DEMO]?.friendlyRobber === true;

const demoLegal: LegalGenerator = (state) => {
  const player = state.turn.current;
  const out: Action[] = [];
  if (state.phase.kind === 'demo/bloom') {
    for (const r of RESOURCES) {
      if (state.bank[r] > 0) out.push({ type: 'demo/pickBloom', player, resource: r });
    }
    return out;
  }
  if (state.phase.kind !== 'main') return out;
  for (const b of Object.keys(state.pieces.buildings) as VertexId[]) {
    if (wellBlocker(state, player, b) === null) {
      out.push({ type: 'demo/buildWell', player, vertex: b });
    }
  }
  return out;
};

export const OASIS_MAP: CustomMapDef = {
  id: 'demo/oasis19',
  name: 'Oasis (19 hexes)',
  frame: FRAME_STD19,
  minPlayers: 3,
  maxPlayers: 4,
  layout: 'custom',
  bankPerResource: MAPS.baseRandom.bankPerResource,
  devDeck: MAPS.baseRandom.devDeck,
  generate(rng) {
    const { board, robber } = randomBoard(rng, 'baseRandom');
    const hexes = { ...board.hexes };
    const desert = hexes[robber];
    if (desert) hexes[robber] = { ...desert, terrain: OASIS, token: null };
    return { board: { ...board, hexes }, robber };
  },
};

export const demoModule: ExpansionModule = {
  id: DEMO,
  name: 'Oasis (demo)',
  players: { min: 3, max: 4 },
  terrains: { [OASIS]: { kind: 'land', name: 'Oasis' } },
  maps: [OASIS_MAP],
  scenarios: [
    {
      id: 'demo/oasis',
      name: 'Oasis',
      blurb: 'Wells, blooms and a friendly robber',
      players: { min: 3, max: 4 },
      maps: [OASIS_MAP.id],
      mapFor: () => OASIS_MAP.id,
      vpToWin: 10,
    },
  ],
  modes: [
    {
      id: DEMO,
      name: 'Oasis (demo)',
      blurb: 'Framework demo: wells and blooms',
      status: 'demo',
      expansions: [DEMO],
      scenarios: ['demo/oasis'],
      players: { min: 3, max: 4 },
    },
  ],
  options: [
    {
      key: 'friendlyRobber',
      label: 'Friendly robber',
      description: 'The robber spares players with 2 or fewer points',
      type: 'boolean',
      default: true,
    },
  ],

  init(draft) {
    const slice: DemoSlice = { v: 1, wells: {} };
    draft.ext[DEMO] = slice;
  },

  cloneExt(slice) {
    const s = slice as DemoSlice;
    return { v: s.v, wells: { ...s.wells } };
  },

  actions: {
    'demo/buildWell': (draft, action) => {
      const v = action.vertex;
      if (typeof v !== 'string') return fail('invalid vertex');
      const err = wellBlocker(draft, action.player, v);
      if (err) return fail(err);
      const hand = draft.players[action.player]?.resources;
      const cost = costOf(draft, WELL) ?? WELL_COST;
      if (!hand) return fail('invalid player');
      for (const r of RESOURCES) {
        hand[r] -= cost[r];
        draft.bank[r] += cost[r];
      }
      demoSlice(draft).wells[v] = action.player;
      log(draft, action.player, `${playerName(draft, action.player)} dug a well`);
      return ok(draft);
    },
    'demo/pickBloom': (draft, action) => {
      if (draft.phase.kind !== 'demo/bloom') return fail('nothing is blooming');
      if (!isCurrent(draft, action.player)) return fail('not your bloom');
      const r = action.resource;
      if (!isResource(r)) return fail('invalid resource');
      if (draft.bank[r] <= 0) return fail(`the bank has no ${r}`);
      const p = draft.players[action.player];
      if (!p) return fail('invalid player');
      p.resources[r] += 1;
      draft.bank[r] -= 1;
      log(draft, action.player, `${playerName(draft, action.player)} received 1 ${r} (bloom)`);
      draft.phase = { kind: 'main' };
      return ok(draft);
    },
  },

  legal: demoLegal,

  overrides: {
    moveRobber: (draft, action, next) => {
      if (friendly(draft) && !friendlyRobberHexes(draft).includes(action.hex)) {
        return fail('the friendly robber spares players with 2 or fewer points');
      }
      return next(draft, action);
    },
  },

  filterLegal(state, actions) {
    if (state.phase.kind !== 'moveRobber' || !friendly(state)) return actions;
    const allowed = new Set(friendlyRobberHexes(state));
    return actions.filter((a) => a.type !== 'moveRobber' || allowed.has(a.hex));
  },

  hooks: {
    cost: (_state, item, base) => (item === WELL ? WELL_COST : base),
    pieceLimit: (_state, _player, kind, base) => (kind === WELL ? WELL_LIMIT : base),

    production(state, roll, owed, ctx) {
      const wells = demoSlice(state).wells;
      const t = topologyOf(state);
      for (const id of Object.keys(state.board.hexes) as HexId[]) {
        const hex = state.board.hexes[id];
        if (!hex || hex.token !== roll || id === ctx.blocked || !isResource(hex.terrain)) continue;
        for (const v of hexVertices(t, id)) {
          const owner = wells[v];
          const hand = owner === undefined ? undefined : owed[owner];
          if (hand) hand[hex.terrain] += 1;
        }
      }
    },

    afterProduction(draft, roll) {
      if (!BLOOM_ROLLS.includes(roll)) return undefined;
      if (!RESOURCES.some((r) => draft.bank[r] > 0)) return undefined;
      log(draft, draft.turn.current, 'The oasis blooms');
      const phase: BloomPhase = { kind: 'demo/bloom' };
      return phase;
    },

    victoryPoints: (state, player) => ({ public: Math.floor(wellsOf(state, player).length / 2) }),

    onEndTurn(draft, player) {
      const oasis = oasisHex(draft);
      if (!oasis || draft.bank.wool <= 0) return;
      const t = topologyOf(draft);
      if (!hexVertices(t, oasis).some((v) => draft.pieces.buildings[v]?.owner === player)) return;
      const p = draft.players[player];
      if (!p) return;
      p.resources.wool += 1;
      draft.bank.wool -= 1;
      log(draft, player, `${playerName(draft, player)} received 1 wool (oasis)`);
    },
  },
};
