/**
 * CATAN: Seafarers (docs/rules/seafarers.md), all nine scenarios for 3-4 players and the 5-6
 * player maps. Ships, the pirate, gold fields, the Longest Trade Route, special VP for new land,
 * fog, the Forgotten Tribe's gifts, Cloth for Catan, the Pirate Islands and the Wonders of Catan.
 *
 * Engine status per rule: docs/rules/seafarers.md §11.
 */
import { RESOURCES } from '../../../engine/constants';
import { log, resumePhase } from '../../../engine/actions/common';
import { cloneJson } from '../../../engine/expansions/ext';
import type { ExpansionModule, ScenarioDef, SetupOrder } from '../../../engine/expansions/types';
import { emptyDevCards } from '../../../engine/resources';
import { Rng } from '../../../engine/rng';
import { playerName } from '../../../engine/rules/text';
import { setupOrderOf, victoryPoints } from '../../../engine/selectors';
import type {
  ExpansionActionType,
  GameState,
  HexId,
  MapId,
  PlayerId,
  VertexId,
} from '../../../engine/types';
import { eventCardsOn, hasRobber } from '../../../engine/variants';
import {
  goldOwed,
  HANDLERS,
  OVERRIDES,
  SEA_ACTIONS,
  seaFilterLegal,
  seaLegal,
  wonderOf,
} from './actions';
import { cellHex, parseCell } from './coords';
import {
  areasAt,
  awardNewLand,
  discover,
  produceCloth,
  promptHarbor,
  queueGold,
  recordHome,
  specialVp,
  updateVillageLinks,
  villagesWithCloth,
} from './effects';
import {
  CLOTH_PER_VILLAGE,
  CLOTH_SUPPLY,
  clothVillages,
  fogStack,
  tribeGifts,
  wonderCards,
  WONDER_LEVELS,
  wonderMarks,
} from './features';
import { graph } from './geometry';
import { seaMaskFor } from './mask';
import {
  mapKeyOf,
  prepared,
  SEA_MAPS,
  SEAFARERS,
  seaBoard,
  variableBoard,
  type MapKey,
} from './maps';
import {
  calmHex,
  fleetPath,
  fleetVictims,
  fortressOf,
  loseRandom,
  pirateSeats,
  warships,
} from './pirates';
import { markClosedRoutes, SHIP, SHIP_COST, SHIP_LIMIT, tradeRouteLength } from './ships';
import {
  rulesOf,
  SCENARIOS,
  scenarioIdOf,
  scenarioKey,
  seaSlice,
  type GoldPhase,
  type Gift,
  type HarborPhase,
  type SeaSlice,
} from './state';

export { SEAFARERS } from './maps';
export * from './state';
export { SEA_ACTIONS } from './actions';

const keyOf = (state: Pick<GameState, 'settings'>) => mapKeyOf(state.settings.map) as MapKey;
const name = (s: GameState, p: PlayerId) => playerName(s, p);

// ---------------------------------------------------------------------------------------------
// Scenarios and the mode
// ---------------------------------------------------------------------------------------------

const scenarioDefs: ScenarioDef[] = SCENARIOS.map((r) => {
  const ids: MapId[] = r.maps.map((k) => `${SEAFARERS}/${k}` as const);
  return {
    id: scenarioIdOf(r.key),
    name: r.name,
    blurb: r.blurb,
    players: { min: 3, max: 6 },
    maps: [...new Set(ids)],
    mapFor: (n) => (n <= 3 ? ids[0] : n === 4 ? ids[1] : ids[2]) as MapId,
    vpToWin: r.vp,
  };
});

// ---------------------------------------------------------------------------------------------
// Setup (createGame -> init)
// ---------------------------------------------------------------------------------------------

function init(draft: GameState, rng: Rng): void {
  const key = keyOf(draft);
  const rules = rulesOf(draft);
  const variable = draft.settings.options[SEAFARERS]?.layout === 'variable';
  if (variable && (prepared(key).spec.shuffle.length > 0 || key.startsWith('pirates'))) {
    const gb = variableBoard(rng, key);
    draft.board = gb.board;
    draft.robber = gb.robber;
  }
  const n = draft.players.length;
  const data = prepared(key).spec.data;
  // New World (no printed map): the pirate starts on the frame, top centre (§2.10).
  const pirateAt = data === null ? '3,-1' : data.pirate;
  const own = seaBoard(draft).pirate;
  const slice: SeaSlice = {
    v: 1,
    ships: {},
    pirate:
      own !== undefined ? own : rules.pirate && pirateAt ? cellHex(parseCell(pirateAt)) : null,
    built: [],
    moved: false,
    chits: [],
    home: draft.players.map(() => []),
  };

  const fog = fogStack(key);
  if (fog) slice.fog = { terrains: rng.shuffle(fog.terrains), tokens: rng.shuffle(fog.tokens) };

  const gifts = tribeGifts(key);
  if (gifts) {
    const out: Record<string, Gift> = {};
    // The topmost development cards of the shuffled deck, face down (§2.6).
    for (const e of gifts.dev) {
      const card = draft.devDeck.pop();
      if (card) out[e] = { kind: 'dev', card };
    }
    for (const e of gifts.chit) out[e] = { kind: 'chit' };
    const kinds = rng.shuffle(prepared(key).spec.harborKinds);
    gifts.harbor.forEach((e, i) => (out[e] = { kind: 'harbor', port: kinds[i] ?? 'generic' }));
    slice.gifts = out;
    slice.harbors = draft.players.map(() => []);
  }

  const villages = clothVillages(key);
  if (villages) {
    slice.cloth = {
      villages: Object.fromEntries(
        villages.map((v) => [v.vertex, { token: v.token, cloth: CLOTH_PER_VILLAGE }]),
      ),
      supply: CLOTH_SUPPLY,
      held: draft.players.map(() => 0),
      links: {},
    };
  }

  const seats = pirateSeats(key, n);
  if (seats.length > 0) {
    slice.fleet = {
      at: 0,
      fortresses: seats.map((s, owner) => ({
        owner,
        vertex: s.fortress,
        beachhead: s.beachhead,
        chits: 3,
      })),
      spent: emptyDevCards(),
      gone: false,
    };
    // Each player starts with a settlement and a ship on the eastern coast (§2.8).
    seats.forEach((s, owner) => {
      draft.pieces.buildings[s.settlement] = { owner, kind: 'settlement' };
      slice.ships[s.ship] = { owner };
    });
  }

  if (key.startsWith('wonders')) {
    slice.wonders = {
      started: wonderCards(key).map(() => null),
      level: draft.players.map(() => 0),
    };
  }
  draft.ext[SEAFARERS] = slice;
}

function cloneSlice(x: unknown): SeaSlice {
  const s = x as SeaSlice;
  const out: SeaSlice = {
    ...s,
    ships: { ...s.ships },
    built: [...s.built],
    chits: [...s.chits],
    home: s.home.map((h) => [...h]),
  };
  if (s.fog) out.fog = { terrains: [...s.fog.terrains], tokens: [...s.fog.tokens] };
  if (s.gifts) out.gifts = { ...s.gifts };
  if (s.harbors) out.harbors = s.harbors.map((h) => [...h]);
  if (s.cloth) out.cloth = cloneJson(s.cloth);
  if (s.fleet) out.fleet = cloneJson(s.fleet);
  if (s.wonders) out.wonders = { started: [...s.wonders.started], level: [...s.wonders.level] };
  return out;
}

// ---------------------------------------------------------------------------------------------
// Where settlements may go
// ---------------------------------------------------------------------------------------------

/**
 * Vertices the scenario closes to building (vertexBlocked): the distance rule across a narrow
 * strait (FAQ #11), the Forgotten Tribe's islands without numbers, Cloth's villages, the Pirate
 * Islands outside the eastern island (beachheads stay open), the Wonders' marks during setup.
 */
function vertexClosed(state: GameState, v: VertexId): boolean {
  const g = graph(state);
  const buildings = state.pieces.buildings;
  if ((g.neighbors.get(v) ?? []).some((n) => buildings[n] !== undefined)) return true;
  const key = scenarioKey(state);
  const region = seaBoard(state).region;
  const land = (g.hexesAt.get(v) ?? []).filter((h) => {
    const t = state.board.hexes[h]?.terrain;
    return t !== undefined && t !== 'sea' && t !== 'fog';
  });
  switch (key) {
    case 'forgottenTribe':
      return !land.some((h) => state.board.hexes[h]?.token !== null);
    case 'clothForCatan':
      return land.every((h) => region[h] === 'V');
    case 'pirateIslands': {
      if (land.some((h) => region[h] === 'M')) return false;
      const forts = seaSlice(state).fleet?.fortresses ?? [];
      return !forts.some((f) => f.beachhead === v);
    }
    case 'wondersOfCatan': {
      if (state.phase.kind !== 'setup') return false;
      const m = wonderMarks(keyOf(state));
      return !!m && (m.strait.includes(v) || m.wasteland.includes(v) || m.bang.includes(v));
    }
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------------------------
// Production: gold fields, cloth, the pirate fleet
// ---------------------------------------------------------------------------------------------

/** Gold owed for `roll` (§4.3): 1 per settlement, 2 per city (1 under Epidemic), robber blocks. */
function goldForRoll(state: GameState, roll: number): number[] {
  const owed = state.players.map(() => 0);
  const blocked = hasRobber(state.settings) ? state.robber : null;
  const cityYield = eventCardsOn(state.settings) && state.lastEvent === 'epidemic' ? 1 : 2;
  const g = graph(state);
  for (const id of Object.keys(state.board.hexes) as HexId[]) {
    const hex = state.board.hexes[id];
    if (!hex || hex.terrain !== 'gold' || hex.token !== roll || id === blocked) continue;
    for (const v of g.hexVertices.get(id) ?? []) {
      const b = state.pieces.buildings[v];
      if (b) owed[b.owner] = (owed[b.owner] ?? 0) + (b.kind === 'city' ? cityYield : 1);
    }
  }
  return owed;
}

/** Pirate Islands: the fleet sails the lower die, then attacks around where it stops (§4.10). */
function sailFleet(draft: GameState): GoldPhase | undefined {
  const fleet = seaSlice(draft).fleet;
  if (!fleet || fleet.gone || !draft.dice) return undefined;
  const key = keyOf(draft);
  const path = fleetPath(key);
  const steps = Math.min(draft.dice[0], draft.dice[1]);
  fleet.at = (fleet.at + steps) % path.length;
  log(draft, null, `The pirate fleet sails ${steps}`);
  if (path[fleet.at] === calmHex(key)) {
    log(draft, null, 'The pirate fleet rests: no attack');
    return undefined;
  }
  const rng = new Rng(draft.rng);
  const pending = draft.players.map(() => 0);
  for (const p of fleetVictims(draft, draft.turn.current)) {
    const w = warships(draft, p);
    if (steps > w) {
      const cities = Object.values(draft.pieces.buildings).filter(
        (b) => b.owner === p && b.kind === 'city',
      ).length;
      const lost = loseRandom(draft, p, 1 + cities, rng);
      log(draft, p, `The pirates beat ${name(draft, p)} (${steps} vs ${w}): lost ${lost} cards`);
    } else if (w > steps) {
      pending[p] = 1;
      log(draft, p, `${name(draft, p)} beat the pirates (${w} vs ${steps})`);
    } else log(draft, p, `${name(draft, p)} held off the pirates (${w} vs ${steps})`);
  }
  draft.rng = rng.state;
  if (pending.every((n) => n === 0) || RESOURCES.every((r) => draft.bank[r] === 0))
    return undefined;
  return { kind: 'seafarers/gold', pending, then: { roll: true } };
}

// ---------------------------------------------------------------------------------------------
// Victory (Pirate Islands, Wonders, Cloth's end)
// ---------------------------------------------------------------------------------------------

function declare(draft: GameState, p: PlayerId, why: string): void {
  draft.winner = p;
  draft.phase = { kind: 'gameOver' };
  log(draft, p, `${name(draft, p)} wins ${why}!`);
}

/**
 * The scenario's own win test for the player whose turn it is (the core victory check calls it
 * after the awards are updated): Pirate Islands, your fortress taken AND the VP target (§4.10);
 * Wonders, a completed wonder, or the VP target with a strictly higher wonder (§4.11).
 */
function seaWins(state: GameState, p: PlayerId): boolean | undefined {
  const key = scenarioKey(state);
  const vp = victoryPoints(state, p);
  if (key === 'pirateIslands') {
    return fortressOf(state, p)?.chits === 0 && vp >= state.settings.vpToWin;
  }
  if (key === 'wondersOfCatan') {
    const level = seaSlice(state).wonders?.level ?? [];
    const mine = level[p] ?? 0;
    if (mine >= WONDER_LEVELS) return true;
    return vp >= state.settings.vpToWin && level.every((l, o) => o === p || l < mine);
  }
  return undefined;
}

/** Cloth for Catan: when 3 or fewer villages hold cloth at the end of a turn, the game ends. */
function clothEnd(draft: GameState, ended: PlayerId): void {
  const cloth = seaSlice(draft).cloth;
  if (!cloth || draft.phase.kind === 'gameOver' || villagesWithCloth(draft) > 3) return;
  const n = draft.players.length;
  const order = draft.players.map((_, i) => (ended + i) % n);
  const score = (p: PlayerId) => [victoryPoints(draft, p), cloth.held[p] ?? 0] as const;
  let best = order[0] as PlayerId;
  for (const p of order) {
    const [a, b] = score(p);
    const [c, d] = score(best);
    if (a > c || (a === c && b > d)) best = p;
  }
  log(draft, null, 'The villages have run out of cloth');
  declare(draft, best, `with ${victoryPoints(draft, best)} victory points`);
}

// ---------------------------------------------------------------------------------------------
// The module
// ---------------------------------------------------------------------------------------------

/** Cloth for Catan (S5 p.22): the snake order, then a third round clockwise; only it pays. */
function clothSetupOrder(state: GameState): SetupOrder | undefined {
  if (scenarioKey(state) !== 'clothForCatan') return undefined;
  const n = state.players.length;
  const s = state.settings.startingPlayer;
  const order: PlayerId[] = [];
  for (let i = 0; i < n; i++) order.push((s + i) % n);
  for (let i = n - 1; i >= 0; i--) order.push((s + i) % n);
  for (let i = 0; i < n; i++) order.push((s + i) % n);
  return { order, pays: order.map((_, i) => i >= 2 * n) };
}

export const seafarersModule: ExpansionModule = {
  id: SEAFARERS,
  name: 'Seafarers',
  icon: '⛵',
  players: { min: 3, max: 6 },
  // Rules doc §3.5 (the card) and §3.6 (settlements connect by road or ship).
  terms: { longestRoad: 'Longest Trade Route', route: 'road or ship' },
  maps: SEA_MAPS,
  scenarios: scenarioDefs,
  modes: [
    {
      id: SEAFARERS,
      name: 'Seafarers',
      blurb: 'Ships, islands, gold and the pirate',
      status: 'ready',
      expansions: [SEAFARERS],
      scenarios: scenarioDefs.map((s) => s.id),
      players: { min: 3, max: 6 },
    },
  ],
  options: [
    {
      key: 'layout',
      label: 'Map',
      description: 'The printed map, or the scenario’s variable set-up',
      type: 'choice',
      default: 'fixed',
      choices: [
        { value: 'fixed', label: 'Standard map' },
        { value: 'variable', label: 'Variable set-up' },
      ],
    },
  ],

  validate(settings) {
    const key = SCENARIOS.find((r) => scenarioIdOf(r.key) === settings.scenario)?.key;
    if (settings.eventCards && key === 'pirateIslands') {
      return 'The Pirate Islands fleet sails by the dice: Event Cards cannot be used';
    }
    if (settings.rules56) return 'The 5+ player rule set does not apply to Seafarers scenarios';
    if (settings.mapRules && Object.values(settings.mapRules).some(Boolean)) {
      return 'Map balance rules do not apply to Seafarers scenario maps';
    }
    return null;
  },

  init,
  cloneExt: cloneSlice,

  actions: HANDLERS as Readonly<Record<ExpansionActionType, (typeof HANDLERS)[string]>>,
  overrides: OVERRIDES,
  legal: seaLegal,
  filterLegal: seaFilterLegal,
  changesRoads: [
    SEA_ACTIONS.buildShip,
    SEA_ACTIONS.moveShip,
    SEA_ACTIONS.setupShip,
    SEA_ACTIONS.freeShip,
    SEA_ACTIONS.attackFortress,
  ],

  actors(state) {
    switch (state.phase.kind) {
      case 'seafarers/gold':
        return state.players.filter((p) => goldOwed(state, p.id) > 0).map((p) => p.id);
      case 'seafarers/placeHarbor':
        return [(state.phase as HarborPhase).player];
      case 'seafarers/moveShip':
      case 'seafarers/pirateSteal':
        return [state.turn.current];
      default:
        return undefined;
    }
  },

  hooks: {
    cost: (_state, item, base) => (item === SHIP ? SHIP_COST : base),

    pieceLimit(state, p, kind, base) {
      if (kind === SHIP) return SHIP_LIMIT - (wonderOf(state, p) === null ? 0 : 1);
      if (kind === 'settlement' && (fortressOf(state, p)?.chits ?? 0) > 0) return base - 1;
      return base;
    },

    setupOrder: clothSetupOrder,

    vertexBlocked: vertexClosed,

    edgeBlocked: (state, e) => seaSlice(state).ships[e] !== undefined,

    supply(state, base) {
      const key = mapKeyOf(state.settings.map);
      if (key === 'pirates3') {
        // 3 players: the VP cards leave the deck (§2.8).
        return { ...base, devDeck: { ...base.devDeck, victoryPoint: 0 } };
      }
      if (key === 'pirates4' || key === 'pirates56') {
        // 4+ players: VP cards act as Knights in every way and give no VP.
        const d = base.devDeck;
        return { ...base, devDeck: { ...d, knight: d.knight + d.victoryPoint, victoryPoint: 0 } };
      }
      return base;
    },

    victoryPoints(state, p) {
      const s = seaSlice(state);
      const land = s.chits.filter((c) => c.player === p && c.area !== 'gift');
      const gifts = s.chits.filter((c) => c.player === p && c.area === 'gift');
      const parts = [
        { label: 'New land', vp: land.reduce((n, c) => n + c.vp, 0) },
        { label: 'Gifts', vp: gifts.reduce((n, c) => n + c.vp, 0) },
        { label: 'Cloth', vp: s.cloth ? Math.floor((s.cloth.held[p] ?? 0) / 2) : 0 },
      ].filter((x) => x.vp !== 0);
      return { public: specialVp(state, p), parts };
    },

    statsCategory(state, action) {
      switch (action.type) {
        // Gold: production; a gold pick for beating the fleet: an event reward.
        case SEA_ACTIONS.pickGold: {
          const ph = state.phase as GoldPhase;
          return { gain: 'roll' in ph.then ? 'event' : 'production' };
        }
        case SEA_ACTIONS.stealCard:
          return { gain: 'steal', loss: 'stolen' };
        // Discovering land pays 1 card (fog); building pays for the piece.
        case SEA_ACTIONS.buildShip:
        case SEA_ACTIONS.moveShip:
        case SEA_ACTIONS.setupShip:
        case SEA_ACTIONS.freeShip:
        case SEA_ACTIONS.buildWonder:
          return { gain: 'event', loss: 'build' };
        case 'buildRoad':
        case 'placeFreeRoad':
        case 'placeSetupRoad':
          return { gain: 'event' };
        // The Pirate Islands fleet takes cards at the roll.
        case 'rollDice':
          return { loss: 'stolen' };
        default:
          return undefined;
      }
    },

    roadLength: (state, p, base) =>
      rulesOf(state).longestRoute ? Math.max(base, tradeRouteLength(state, p)) : 0,

    armySize: (state, _p, base) => (rulesOf(state).largestArmy ? base : 0),

    onRoll: (draft) => sailFleet(draft),

    afterProduction(draft, roll) {
      produceCloth(draft, roll);
      const owed = goldForRoll(draft, roll);
      if (owed.every((n) => n === 0) || RESOURCES.every((r) => draft.bank[r] === 0)) {
        return undefined;
      }
      return { kind: 'seafarers/gold', pending: owed, then: { phase: { kind: 'main' } } };
    },

    onStartTurn(draft) {
      const s = seaSlice(draft);
      s.built = [];
      s.moved = false;
    },

    afterAction(draft, action) {
      const p = action.player;
      switch (action.type) {
        case 'placeSetupSettlement': {
          recordHome(draft, p, action.vertex);
          markClosedRoutes(draft);
          // A paying starting settlement on gold: a free choice per gold hex (§2.1, Q5).
          const ph = draft.phase;
          if (
            ph.kind === 'setup' &&
            (setupOrderOf(draft).pays[ph.index] || draft.settings.turboMode)
          ) {
            const g = graph(draft);
            const gold = (g.hexesAt.get(action.vertex) ?? []).filter(
              (h) => draft.board.hexes[h]?.terrain === 'gold',
            ).length;
            queueGold(draft, p, gold);
          }
          break;
        }
        case 'placeSetupRoad':
        case 'buildRoad':
        case 'placeFreeRoad':
          discover(draft, p, action.edge);
          break;
        case 'buildSettlement':
          awardNewLand(draft, p, action.vertex);
          markClosedRoutes(draft);
          updateVillageLinks(draft);
          promptHarbor(draft, p);
          break;
        case 'endTurn':
          clothEnd(draft, p);
          break;
        default:
          break;
      }
      // Pirate Islands: a 7 has no robber; the roller robs any other player (§2.8).
      if (scenarioKey(draft) === 'pirateIslands' && draft.phase.kind === 'moveRobber') {
        const resume = draft.phase.resume;
        const candidates = draft.players
          .filter((o) => o.id !== draft.turn.current && RESOURCES.some((r) => o.resources[r] > 0))
          .map((o) => o.id);
        draft.phase =
          candidates.length > 0
            ? { kind: 'steal', candidates, resume }
            : resumePhase(draft, resume);
      }
    },

    wins: seaWins,

    maskFor: seaMaskFor,
  },
};

/** Bonus areas a vertex touches (UI hints). */
export { areasAt };
