/**
 * CATAN: Explorers & Pirates (docs/rules/explorers-pirates.md), 6th edition: Land Ho!, Pirate
 * Lairs, Fish for Catan, Spices for Catan and the full game, for 3-4 players, and the 5-6 player
 * extension (paired players' turns, the core Second Settler step). Harbor settlements, ships that
 * sail and carry settlers and crews, exploring face-down hexes, gold, pirate ships, pirate lairs,
 * fish, spice and the Council's mission tracks.
 *
 * Harbor settlements are settlement pieces flagged in the slice (`harbors`, with their basin):
 * they produce 1 card like a settlement, the victoryPoints hook adds the second VP, and
 * pieceLimit gives the settlement piece back. There are no cities, development cards, robber,
 * ports, Longest Road or Largest Army.
 *
 * Engine status per rule: docs/rules/explorers-pirates.md §11.
 */
import { RESOURCES } from '../../../engine/constants';
import { log, resumePhase } from '../../../engine/actions/common';
import { cloneJson, doubledToHexId } from '../../../engine/expansions/ext';
import type { ExpansionModule, ScenarioDef } from '../../../engine/expansions/types';
import { cornerVertex, parseHexId, sideEdge, type Corner, type Side } from '../../../engine/hex';
import { emptyResources, isResource } from '../../../engine/resources';
import type { Rng } from '../../../engine/rng';
import { playerName } from '../../../engine/rules/text';
import type {
  ExpansionActionType,
  GameState,
  HexId,
  MapId,
  PlayerId,
  ResourceCounts,
} from '../../../engine/types';
import { setupPlacementOf } from '../../../engine/variants';
import {
  A,
  afterSetupSettlement,
  epFilterLegal,
  epLegal,
  edgeClosed,
  HANDLERS,
  OVERRIDES,
  startPirate,
  vertexClosed,
} from './actions';
import { graph } from './geometry';
import {
  decksOf,
  DISCS,
  EP_MAPS,
  epBoard,
  FISH_HAULS,
  LAIR_TOKENS,
  mapIdOf,
  mapKeyOf,
  mapsOf,
  specOf,
  T,
  type Content,
  type MapKey,
} from './maps';
import { maskEp } from './mask';
import { missionsOf, missionVp, newTrack, totalMissionVp, vpParts } from './missions';
import { harborsOf } from './ships';
import {
  citiesInPlay,
  EP,
  freshTurn,
  ITEM,
  LIMIT,
  COST,
  rulesOf,
  SCENARIOS,
  scenarioIdOf,
  START_GOLD,
  epSlice,
  type EpSlice,
  type Hidden,
  type PirateStealPhase,
} from './state';

export * from './state';
export * from './trade';
export { A as EP_ACTIONS } from './actions';

const name = (s: GameState, p: PlayerId) => playerName(s, p);

// ---------------------------------------------------------------------------------------------
// Scenarios and the mode
// ---------------------------------------------------------------------------------------------

const scenarioDefs: ScenarioDef[] = SCENARIOS.map((row) => {
  const keys = mapsOf(row.key);
  const small = keys.find((k) => !specOf(k).big) as MapKey;
  const big = keys.find((k) => specOf(k).big);
  return {
    id: scenarioIdOf(row.key),
    name: row.name,
    blurb: row.blurb,
    players: { min: 3, max: big ? 6 : 4 },
    maps: keys.map(mapIdOf),
    mapFor: (n: number): MapId => mapIdOf(n >= 5 && big ? big : small),
    vpToWin: row.vp,
    pairedTurns56: true,
  };
});

// ---------------------------------------------------------------------------------------------
// Setup (createGame -> init)
// ---------------------------------------------------------------------------------------------

function hiddenOf(c: Content): Hidden {
  if (typeof c === 'string') return { terrain: c };
  if ('shoal' in c) return { terrain: T.fish, shoal: c.shoal };
  return {
    terrain: T.spice,
    spice: c.spice,
    ...(c.number === undefined ? {} : { number: c.number }),
  };
}

/** Deal the region decks face down (§2.2 step 3). Fish 3-4: 2 of the 3 parrot shoals. */
function dealRegions(
  rng: Rng,
  key: MapKey,
  board: ReturnType<typeof epBoard>,
): Record<HexId, Hidden> {
  const decks = decksOf(key);
  const out: Record<HexId, Hidden> = {};
  for (const region of ['parrot', 'goose'] as const) {
    let deck = [...decks[region]];
    if (region === 'parrot' && decks.parrotShoalsUsed !== undefined) {
      const shoals = rng.shuffle(deck.filter((c) => typeof c !== 'string' && 'shoal' in c));
      const keep = shoals.slice(0, decks.parrotShoalsUsed);
      deck = [...deck.filter((c) => typeof c === 'string' || !('shoal' in c)), ...keep];
    }
    const hexes = (Object.keys(board.region) as HexId[])
      .filter((h) => board.region[h] === region)
      .sort();
    const bag = rng.shuffle(deck);
    if (bag.length !== hexes.length) throw new Error(`${key}: ${region} deck does not fit`);
    hexes.forEach((h, i) => (out[h] = hiddenOf(bag[i] as Content)));
  }
  return out;
}

/** Land Ho!'s printed starting pieces (§2.4), by seat: Blue, Red, Orange, White. */
// prettier-ignore
const LAND_HO: readonly {
  settlement: [number, number, Corner]; road: [number, number, Side];
  harbor: [number, number, Corner]; ship: [number, number, Side];
}[] = [
  { settlement: [3, 0, 'S'], road: [3, 0, 'SE'], harbor: [4, 5, 'SE'], ship: [5, 6, 'NE'] },
  { settlement: [2, 5, 'SE'], road: [3, 6, 'NE'], harbor: [5, 0, 'S'], ship: [5, 0, 'SE'] },
  { settlement: [1, 2, 'SW'], road: [1, 2, 'SW'], harbor: [3, 2, 'SE'], ship: [4, 3, 'NE'] },
  { settlement: [0, 3, 'SE'], road: [2, 3, 'SW'], harbor: [4, 3, 'S'], ship: [4, 3, 'SE'] },
];

const at = (c: number, r: number) => parseHexId(doubledToHexId(c, r, 1));
export const landHoPieces = LAND_HO.map((x) => ({
  settlement: cornerVertex(
    at(x.settlement[0], x.settlement[1]).q,
    x.settlement[1],
    x.settlement[2],
  ),
  road: sideEdge(at(x.road[0], x.road[1]).q, x.road[1], x.road[2]),
  harbor: cornerVertex(at(x.harbor[0], x.harbor[1]).q, x.harbor[1], x.harbor[2]),
  ship: sideEdge(at(x.ship[0], x.ship[1]).q, x.ship[1], x.ship[2]),
}));

/** Land Ho!: the printed pieces, starting cards for the settlement, then the first turn. */
function fixedStart(draft: GameState, s: EpSlice): void {
  const n = draft.players.length;
  const gains: ResourceCounts[] = draft.players.map(() => emptyResources());
  landHoPieces.slice(0, n).forEach((x, p) => {
    draft.pieces.buildings[x.settlement] = { owner: p, kind: 'settlement' };
    draft.pieces.buildings[x.harbor] = { owner: p, kind: 'settlement' };
    draft.pieces.roads[x.road] = p;
    s.harbors[x.harbor] = [];
    s.ships.push({ id: s.nextShip++, owner: p, edge: x.ship, cargo: ['settler'] });
    for (const h of graph(draft).hexesAt.get(x.settlement) ?? []) {
      const t = draft.board.hexes[h]?.terrain;
      const hand = draft.players[p]?.resources;
      if (!isResource(t) || !hand || draft.bank[t] <= 0) continue;
      hand[t] += 1;
      draft.bank[t] -= 1;
      (gains[p] as ResourceCounts)[t] += 1;
    }
  });
  // Statistics: the starting cards count as setup gains (Σ gained − Σ lost = hand).
  if (draft.stats) {
    const st = draft.stats;
    draft.stats = {
      ...st,
      players: st.players.map((ps, p) => ({
        ...ps,
        gained: { ...ps.gained, setup: { ...(gains[p] ?? emptyResources()) } },
        built: { ...ps.built, settlement: 2, road: 1 },
      })),
    };
  }
  log(draft, null, 'The printed starting pieces are placed');
  log(draft, null, 'Setup complete');
  draft.turn.number = 1;
  draft.turn.current = draft.settings.startingPlayer;
  draft.phase = { kind: 'preRoll' };
}

function init(draft: GameState, rng: Rng): void {
  const key = mapKeyOf(draft.settings.map) as MapKey;
  const big = specOf(key).big;
  const rules = rulesOf(draft);
  const board = epBoard(draft);
  const discs = big ? DISCS.big : DISCS.small;
  const slice: EpSlice = {
    v: 1,
    gold: draft.players.map(() => START_GOLD),
    harbors: {},
    ships: [],
    nextShip: 0,
    hidden: dealRegions(rng, key, board),
    discs: { parrot: rng.shuffle([...discs.parrot]), goose: rng.shuffle([...discs.goose]) },
    lairTokens: rules.lairs ? rng.shuffle([...(big ? LAIR_TOKENS.big : LAIR_TOKENS.small)]) : [],
    lairs: {},
    shoals: {},
    hauls: [],
    haulSupply: rules.fish ? (big ? FISH_HAULS.big : FISH_HAULS.small) : 0,
    spice: {},
    pirate: null,
    tracks: Object.fromEntries(missionsOf(rules).map((m) => [m, newTrack(draft.players.length)])),
    clock: 0,
    turn: freshTurn(),
  };
  draft.ext[EP] = slice;
  if (rules.fixedStart) fixedStart(draft, slice);
}

function cloneSlice(x: unknown): EpSlice {
  const s = x as EpSlice;
  return {
    ...s,
    gold: [...s.gold],
    harbors: Object.fromEntries(
      Object.entries(s.harbors).map(([v, c]) => [v, [...c]]),
    ) as EpSlice['harbors'],
    ships: s.ships.map((x) => ({ ...x, cargo: [...x.cargo] })),
    hidden: { ...s.hidden },
    discs: { parrot: [...s.discs.parrot], goose: [...s.discs.goose] },
    lairTokens: [...s.lairTokens],
    lairs: cloneJson(s.lairs),
    shoals: { ...s.shoals },
    hauls: [...s.hauls],
    spice: cloneJson(s.spice),
    pirate: s.pirate ? { ...s.pirate } : null,
    tracks: cloneJson(s.tracks),
    turn: cloneJson(s.turn),
    ...(s.trade ? { trade: { ...s.trade } } : {}),
  };
}

// ---------------------------------------------------------------------------------------------
// Production: gold fields and gold compensation (§3.2)
// ---------------------------------------------------------------------------------------------

/** Gold for `roll`: 2 per building at a captured gold field; 1 to anyone the roll paid nothing. */
function produceGold(draft: GameState, roll: number, paid: readonly ResourceCounts[]): void {
  const s = epSlice(draft);
  const g = graph(draft);
  const got = draft.players.map(() => 0);
  for (const [h, lair] of Object.entries(s.lairs) as [HexId, EpSlice['lairs'][HexId]][]) {
    if (!lair.captured || draft.board.hexes[h]?.token !== roll) continue;
    for (const v of g.hexVertices.get(h) ?? []) {
      const b = draft.pieces.buildings[v];
      if (b) got[b.owner] = (got[b.owner] ?? 0) + 2;
    }
  }
  for (const pl of draft.players) {
    const cards = RESOURCES.reduce((n, r) => n + (paid[pl.id]?.[r] ?? 0), 0);
    const fromField = got[pl.id] ?? 0;
    if (fromField > 0) log(draft, pl.id, `${name(draft, pl.id)} received ${fromField} gold`);
    // FAQ-6: gold from a gold field is not a resource; compensation still applies.
    if (cards === 0) {
      got[pl.id] = fromField + 1;
      log(draft, pl.id, `${name(draft, pl.id)} received 1 gold (no resources)`);
    }
    s.gold[pl.id] = (s.gold[pl.id] ?? 0) + (got[pl.id] ?? 0);
  }
}

// ---------------------------------------------------------------------------------------------
// The module
// ---------------------------------------------------------------------------------------------

const PIECES: Readonly<Record<string, number>> = {
  [ITEM.harbor]: LIMIT.harbor,
  [ITEM.ship]: LIMIT.ship,
  [ITEM.settler]: LIMIT.settler,
  [ITEM.crew]: LIMIT.crew,
};

export const epModule: ExpansionModule = {
  id: EP,
  name: 'Explorers & Pirates',
  conflicts: ['seafarers'],
  players: { min: 3, max: 6 },
  terrains: {
    [T.parrot]: { kind: 'fog', name: 'Unexplored (parrot)', color: '#3f8f5a' },
    [T.goose]: { kind: 'fog', name: 'Unexplored (goose)', color: '#d0813a' },
    [T.fish]: { kind: 'sea', name: 'Fish shoal', color: '#3d7fb0' },
    [T.spice]: { kind: 'land', name: 'Spice farm', color: '#b5562c' },
    [T.council]: { kind: 'sea', name: 'Council of Catan', color: '#c9b37a' },
  },
  maps: EP_MAPS,
  scenarios: scenarioDefs,
  modes: [
    {
      id: EP,
      name: 'Explorers & Pirates',
      blurb: 'Sail, explore, settle; pirates, fish and spice',
      status: 'ready',
      expansions: [EP],
      scenarios: scenarioDefs.map((s) => s.id),
      players: { min: 3, max: 6 },
    },
  ],

  validate(settings) {
    const official = setupPlacementOf(settings);
    if (
      settings.setupPlacement &&
      (official.first.building !== 'settlement' ||
        official.second.building !== 'settlement' ||
        official.first.restriction !== 'normal' ||
        official.second.restriction !== 'normal')
    ) {
      return 'Explorers & Pirates has its own setup (a harbor settlement, then a settlement)';
    }
    if (settings.specialBuildPhase) {
      return 'Explorers & Pirates 5-6 uses the paired players’ turn, not the special building phase';
    }
    if (settings.rules56) return 'The 5+ player rule set does not apply to Explorers & Pirates';
    if (settings.mapRules && Object.values(settings.mapRules).some(Boolean)) {
      return 'Map balance rules do not apply to the Explorers & Pirates maps';
    }
    const big = mapKeyOf(settings.map)?.endsWith('56') ?? false;
    if (settings.secondSettler && !big) {
      return 'The paired players’ turn is for 5-6 players in Explorers & Pirates';
    }
    if (big && !settings.secondSettler) {
      return 'Explorers & Pirates 5-6 is played with the paired players’ turn';
    }
    return null;
  },

  init,
  cloneExt: cloneSlice,

  actions: HANDLERS as unknown as Readonly<
    Record<ExpansionActionType, (typeof HANDLERS)[keyof typeof HANDLERS]>
  >,
  overrides: OVERRIDES,
  legal: epLegal,
  filterLegal: epFilterLegal,
  changesRoads: [A.setupRoad, A.land],

  actors(state) {
    switch (state.phase.kind) {
      case 'ep/setupFleet':
      case 'ep/pirate':
      case 'ep/pirateSteal':
        return [state.turn.current];
      default:
        return undefined;
    }
  },

  hooks: {
    cost: (_state, item, base) => COST[item] ?? base,

    pieceLimit(state, p, kind, base) {
      if (kind === 'city') return citiesInPlay(state) ? base : 0;
      // A harbor settlement frees its settlement piece (§4.2).
      if (kind === 'settlement') return base + harborsOf(state, p).length;
      if (kind === ITEM.crew && !rulesOf(state).crews) return 0;
      return PIECES[kind] ?? base;
    },

    vertexBlocked: vertexClosed,
    edgeBlocked: edgeClosed,

    // No harbors (ports) and no 4:1: every resource trades 3:1 with the supply (§3.3); a better
    // rate from another module stays (C&K's merchant, Merchant Fleet).
    bankTradeRatio: (_state, _p, _r, base) => Math.min(base, 3),

    // Event Cards give the numbers only (E&P + T&B sheet: "ignoring the effects").
    onRoll(draft) {
      const e = draft.lastEvent;
      if (draft.settings.eventCards && e && e !== 'none') {
        draft.lastEvent = 'none';
        log(draft, null, 'Explorers & Pirates uses only the number of the event card');
      }
      return undefined;
    },

    roadLength: () => 0,
    armySize: () => 0,

    victoryPoints(state, p) {
      const v = missionVp(state, p);
      return { public: totalMissionVp(v), parts: vpParts(v) };
    },

    afterProduction(draft, roll, paid) {
      produceGold(draft, roll, paid);
      return undefined;
    },

    onStartTurn(draft) {
      epSlice(draft).turn = freshTurn();
    },

    // Online views: face-down hexes, disc and lair token stacks (engine/mask.ts).
    maskFor: maskEp,

    // No winner during the setup's fleet step (tiny VP targets).
    deferVictory: (state) => state.phase.kind === 'ep/setupFleet',

    afterAction(draft, action) {
      const s = epSlice(draft);
      if (s.trade && draft.phase.kind !== 'trade') s.trade = null;
      if (action.type === 'placeSetupSettlement') {
        afterSetupSettlement(draft, action.vertex);
      }
      // A 7 (or Robber Attacks): no robber; the roller activates their pirate ship (§4.7).
      if (draft.phase.kind === 'moveRobber') {
        const resume = draft.phase.resume;
        if (rulesOf(draft).pirate) startPirate(draft, resume === 'preRoll' ? 'preRoll' : 'main');
        else draft.phase = resumePhase(draft, resume);
      }
    },

    statsCategory(state, action) {
      switch (action.type) {
        case A.moveShip:
          return { gain: 'event' };
        case A.buildShip:
          return { gain: 'event', loss: 'build' };
        case A.buildHarbor:
        case A.buildSettler:
        case A.buildCrew:
        case A.extraMove:
          return { loss: 'build' };
        case A.buyWithGold:
          return { gain: 'bank' };
        case A.sellForGold:
        case A.fastGold:
          return { loss: 'bank' };
        case A.pirateSteal: {
          const ph = state.phase as PirateStealPhase;
          return ph.kind === 'ep/pirateSteal' ? { gain: 'steal', loss: 'stolen' } : undefined;
        }
        default:
          return undefined;
      }
    },
  },
};

/** Gold of a player (UI). */
export const goldOf = (state: GameState, p: PlayerId): number => epSlice(state).gold[p] ?? 0;
