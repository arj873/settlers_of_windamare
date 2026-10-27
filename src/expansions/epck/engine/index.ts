/**
 * Explorers & Pirates + Cities & Knights (the 2025 combination sheet, docs/rules/combos.md §7):
 * the official combination, composed from the two modules plus the rules only the pair has.
 *
 * Composition order (`before`): epck, ck, ep. Where both modules hook the same first-wins point
 * this module decides:
 * - setupBuilding / setupOrder: the first placement is a city (it pays), the second the harbor
 *   settlement (E&P marks it a harbor: `isHarborStep`);
 * - afterProduction: C&K commodities and the Aqueduct, then E&P's gold (fields, compensation);
 * - onSeven: E&P's pirate is active from the first 7 (the sheet keeps the E&P rule; C&K's
 *   sleeping robber is about the robber, which E&P does not have). The Aqueduct also works on a
 *   7: 1 gold at once, 1 resource of choice after the 7.
 * E&P's own seams (`citiesInPlay`): cities exist, the setup rounds swap. C&K's: knights never
 * stand beside an unexplored hex (`besideFog`). Knights walk roads only, so they stay on their
 * island; crews are not knights (barbarians, Treason) and knights do no missions.
 */
import { RESOURCES } from '../../../engine/constants';
import { fail, log, ok, resumePhase } from '../../../engine/actions/common';
import { startRobber } from '../../../engine/actions/robber';
import { cloneJson } from '../../../engine/expansions/ext';
import type { ExpansionModule, ExtHandler, ExtWrap } from '../../../engine/expansions/types';
import { hasResources } from '../../../engine/resources';
import type { Rng } from '../../../engine/rng';
import { playerName, stealSecret } from '../../../engine/rules/text';
import { buildingsOf, piecesLeft, setupPlayerAt } from '../../../engine/selectors';
import type {
  Action,
  GameState,
  HexId,
  Phase,
  PlayerId,
  ResourceCounts,
  VertexId,
} from '../../../engine/types';
import { hasRobber, isRobberProtected } from '../../../engine/variants';
import {
  ABILITY_LEVEL,
  CK,
  COMMODITIES,
  ckModule,
  ckPlayer,
  ckSlice,
  fromRoller,
  goodCount,
  inventorHexes,
  isCommodity,
  isGood,
  levelOf,
  mainTurn,
  moveGood,
  phaseOf,
  spendCard,
  stealRandom,
  type Commodity,
  type Good,
} from '../../ck/engine';
import { EP, epModule, epSlice, rulesOf, type PirateStealPhase } from '../../ep/engine';
import {
  fastFarms,
  inMovement,
  pirateTargets,
  startPirate,
  whyAction,
} from '../../ep/engine/actions';
import { isCoastal, sidesOf } from '../../ep/engine/geometry';
import { harborsLeft, isHarbor } from '../../ep/engine/ships';
import { offerResponses, offerTargets, offerTurnBlocker } from '../../ep/engine/trade';

export const EPCK = 'epck';
export const EPCK_MODE = 'ep+ck';

/**
 * The E&P scenarios with the variable setup (city first, harbor second). Land Ho! starts from
 * printed pieces with no city placement and no pirate, so it is not offered (ours).
 */
export const EPCK_SCENARIOS = ['ep/pirateLairs', 'ep/fish', 'ep/spices', 'ep/full'] as const;

/** "5 more VPs than required by the Explorers & Pirates scenario". */
export const EPCK_VP_BONUS = 5;

/** Cost item of Medicine's harbor settlement (costOf, the HUD card). */
export const MEDICINE_HARBOR_ITEM = 'epck/medicineHarbor';

/** Medicine's harbor settlement: 1 grain and 1 ore (a city stays 1 grain, 2 ore). */
export const MEDICINE_HARBOR_COST: ResourceCounts = {
  brick: 0,
  lumber: 0,
  wool: 0,
  grain: 1,
  ore: 1,
};

export interface EpckSlice {
  v: 1;
  /** Aqueduct players of the 7 just rolled, who take their resource once the 7 is over. */
  aqueduct: PlayerId[];
}

export type Item = Good | 'gold';
export type ItemBundle = Partial<Record<Item, number>>;

export type EpckAction =
  | { type: 'epck/fastGold'; player: PlayerId; commodity: Commodity }
  | { type: 'epck/medicineHarbor'; player: PlayerId; vertex: VertexId }
  | {
      type: 'epck/offerTrade';
      player: PlayerId;
      give: ItemBundle;
      want: ItemBundle;
      to: PlayerId[];
    };

export const epckSlice = (state: Pick<GameState, 'ext'>): EpckSlice => state.ext[EPCK] as EpckSlice;

const pn = playerName;
const goldOf = (state: GameState, p: PlayerId) => epSlice(state).gold[p] ?? 0;
const isVertex = (x: unknown): x is VertexId => typeof x === 'string' && x.startsWith('v:');
const act = (a: Record<string, unknown>): Action => a as unknown as Action;

// ---------------------------------------------------------------------------------------------
// Fast Gold with a commodity
// ---------------------------------------------------------------------------------------------

/** Why `p` may not sell 1 `c` for 1 gold with a Fast Gold farm now. */
export function fastGoldBlocker(state: GameState, p: PlayerId, c: unknown): string | null {
  const w = whyAction(state, p);
  if (w) return w;
  if (!isCommodity(c)) return 'pick a commodity';
  const s = epSlice(state);
  if (s.turn.fastGold >= fastFarms(s, p)) return 'no Fast Gold left this turn';
  return goodCount(state, p, c) > 0 ? null : `you have no ${c}`;
}

const fastGold: ExtHandler = (draft, action) => {
  const c = action['commodity'];
  const err = fastGoldBlocker(draft, action.player, c);
  if (err) return fail(err);
  const s = epSlice(draft);
  moveGood(draft, action.player, 'bank', c as Commodity);
  s.gold[action.player] = goldOf(draft, action.player) + 1;
  s.turn.fastGold += 1;
  log(
    draft,
    action.player,
    `${pn(draft, action.player)} sold 1 ${String(c)} for 1 gold (Fast Gold)`,
  );
  return ok(draft);
};

// ---------------------------------------------------------------------------------------------
// Cities and harbor settlements; Medicine
// ---------------------------------------------------------------------------------------------

/** `p`'s settlement on `v` that is not a harbor settlement (a city or a harbor may grow from it). */
const plainSettlement = (state: GameState, p: PlayerId, v: VertexId): boolean => {
  const b = state.pieces.buildings[v];
  return b?.owner === p && b.kind === 'settlement' && !isHarbor(state, v);
};

const hand = (state: GameState, p: PlayerId): ResourceCounts | undefined =>
  state.players[p]?.resources;

/** Medicine's city: a plain settlement, a city piece left, 1 grain + 2 ore. */
export function medicineCityBlocker(state: GameState, p: PlayerId, v: VertexId): string | null {
  if (!plainSettlement(state, p, v)) return 'pick one of your settlements (not a harbor)';
  if (piecesLeft(state, p).city <= 0) return 'no cities left';
  const h = hand(state, p);
  return h && hasResources(h, ckCost()) ? null : 'needs 1 wheat and 2 ore';
}

/** Medicine's harbor settlement: a plain coastal settlement, a harbor left, 1 grain + 1 ore. */
export function medicineHarborBlocker(state: GameState, p: PlayerId, v: VertexId): string | null {
  if (!plainSettlement(state, p, v)) return 'pick one of your settlements';
  if (!isCoastal(state, v)) return 'a harbor settlement must be on the coast';
  if (harborsLeft(state, p) <= 0) return 'no harbor settlements left';
  const h = hand(state, p);
  return h && hasResources(h, MEDICINE_HARBOR_COST) ? null : 'needs 1 wheat and 1 ore';
}

function ckCost(): ResourceCounts {
  return { brick: 0, lumber: 0, wool: 0, grain: 1, ore: 2 };
}

const medicineCities = (state: GameState, p: PlayerId) =>
  buildingsOf(state, p, 'settlement').filter((v) => medicineCityBlocker(state, p, v) === null);
const medicineHarbors = (state: GameState, p: PlayerId) =>
  buildingsOf(state, p, 'settlement').filter((v) => medicineHarborBlocker(state, p, v) === null);

const inMedicine = (state: GameState): boolean => {
  const ph = phaseOf(state);
  return ph.kind === 'ck/card' && (ph as { card?: string }).card === 'medicine';
};

const medicineHarbor: ExtHandler = (draft, action) => {
  const v = action['vertex'];
  if (!inMedicine(draft)) return fail('play Medicine first');
  if (draft.turn.current !== action.player) return fail('not your turn');
  if (!isVertex(v)) return fail('invalid vertex');
  const err = medicineHarborBlocker(draft, action.player, v);
  if (err) return fail(err);
  const h = hand(draft, action.player) as ResourceCounts;
  for (const r of RESOURCES) {
    h[r] -= MEDICINE_HARBOR_COST[r];
    draft.bank[r] += MEDICINE_HARBOR_COST[r];
  }
  epSlice(draft).harbors[v] = [];
  log(draft, action.player, `${pn(draft, action.player)} built a harbor settlement (Medicine)`);
  draft.phase = { kind: 'main' };
  return ok(draft);
};

/**
 * Hexes whose number the Inventor may move: C&K's, minus the gold fields (their number is the
 * flipped lair token, not a number disc; ours).
 */
export const inventorDiscs = (state: GameState): HexId[] =>
  inventorHexes(state).filter((h) => state.board.hexes[h]?.terrain !== 'gold');

const inInventor = (state: GameState): boolean => {
  const ph = phaseOf(state);
  return ph.kind === 'ck/card' && (ph as { card?: string }).card === 'inventor';
};

const CHANGED_CARDS: readonly unknown[] = ['medicine', 'bishop', 'inventor'];

/** Why `p` may not play `card` here, for the cards this combination changes (else undefined). */
export function cardBlocker(
  state: GameState,
  p: PlayerId,
  card: unknown,
): string | null | undefined {
  if (!CHANGED_CARDS.includes(card)) return undefined;
  const m = mainTurn(state, p);
  if (m) return m;
  if (inMovement(state)) return 'progress cards are played in the Action phase';
  if (!ckPlayer(state, p).progress.includes(card as 'bishop')) return 'you do not have that card';
  if (card === 'inventor') return inventorDiscs(state).length >= 2 ? null : 'no tokens to swap';
  if (card === 'medicine') {
    return medicineCities(state, p).length + medicineHarbors(state, p).length > 0
      ? null
      : 'no settlement you can upgrade';
  }
  // Taxation (the Bishop): activate the pirate ship instead of moving the robber.
  if (!rulesOf(state).pirate || !hasRobber(state.settings)) return 'there is no pirate';
  return pirateTargets(state).length > 0 ? null : 'the pirate cannot move';
}

// ---------------------------------------------------------------------------------------------
// Player trades with commodities and gold
// ---------------------------------------------------------------------------------------------

const isItem = (k: string): k is Item => k === 'gold' || isGood(k);

function isItemBundle(x: unknown): x is ItemBundle {
  return (
    typeof x === 'object' &&
    x !== null &&
    !Array.isArray(x) &&
    Object.entries(x).every(
      ([k, v]) => isItem(k) && typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 99,
    )
  );
}

const itemCount = (state: GameState, p: PlayerId, i: Item) =>
  i === 'gold' ? goldOf(state, p) : goodCount(state, p, i);

/** Validate an `epck/offerTrade`: resources, commodities and gold, a commodity or gold in it. */
export function offerBlocker(state: GameState, a: Record<string, unknown>): string | null {
  const p = a['player'] as PlayerId;
  const t = offerTurnBlocker(state, p);
  if (t) return t;
  const give = a['give'];
  const want = a['want'];
  if (!isItemBundle(give) || !isItemBundle(want)) return 'invalid cards';
  const kinds = (b: ItemBundle) => (Object.keys(b) as Item[]).filter((k) => (b[k] ?? 0) > 0);
  if (kinds(give).length === 0 || kinds(want).length === 0) {
    return 'both sides of a trade must be non-empty';
  }
  if (kinds(give).some((k) => kinds(want).includes(k))) return 'cannot give and want the same';
  if (![...kinds(give), ...kinds(want)].some((k) => k === 'gold' || isCommodity(k))) {
    return 'use the normal trade offer';
  }
  if (kinds(give).some((k) => itemCount(state, p, k) < (give[k] ?? 0))) {
    return 'you do not have what you offer';
  }
  return offerTargets(state, p, a['to']) ? null : 'offer must be addressed to other players';
}

const resPart = (b: ItemBundle): ResourceCounts => ({
  brick: b.brick ?? 0,
  lumber: b.lumber ?? 0,
  wool: b.wool ?? 0,
  grain: b.grain ?? 0,
  ore: b.ore ?? 0,
});
const comPart = (b: ItemBundle) => ({
  paper: b.paper ?? 0,
  cloth: b.cloth ?? 0,
  coin: b.coin ?? 0,
});

const offerTrade: ExtHandler = (draft, action) => {
  const err = offerBlocker(draft, action);
  if (err) return fail(err);
  const give = action['give'] as ItemBundle;
  const want = action['want'] as ItemBundle;
  const to = action['to'] as PlayerId[];
  draft.phase = {
    kind: 'trade',
    offer: {
      from: action.player,
      give: resPart(give),
      want: resPart(want),
      responses: offerResponses(draft, to),
    },
  };
  // The modules' acceptTrade / confirmTrade overrides move these parts.
  ckSlice(draft).trade = { give: comPart(give), want: comPart(want) };
  epSlice(draft).trade = { give: give.gold ?? 0, want: want.gold ?? 0 };
  draft.turn.tradeOffers += 1;
  const describe = (b: ItemBundle) =>
    (Object.entries(b) as [Item, number][])
      .filter(([, n]) => n > 0)
      .map(([k, n]) => `${n} ${k}`)
      .join(', ');
  log(
    draft,
    action.player,
    `${pn(draft, action.player)} offers ${describe(give)} for ${describe(want)}`,
  );
  return ok(draft);
};

function offerLegal(state: GameState, p: PlayerId): Action[] {
  if (offerTurnBlocker(state, p) !== null) return [];
  const to = state.players.filter((x) => x.id !== p).map((x) => x.id);
  const out: Action[] = [];
  const offer = (give: ItemBundle, want: ItemBundle) =>
    act({ type: 'epck/offerTrade', player: p, give, want, to });
  if (goldOf(state, p) > 0) out.push(offer({ gold: 1 }, { paper: 1 }));
  for (const c of COMMODITIES) {
    if (goodCount(state, p, c) > 0) out.push(offer({ [c]: 1 }, { gold: 1 }));
  }
  for (const r of RESOURCES) {
    if (goldOf(state, p) > 0) out.push(offer({ gold: 1 }, { [r]: 1 }));
    if (goodCount(state, p, r) > 0) out.push(offer({ [r]: 1 }, { gold: 1 }));
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// The 7: the pirate (awake from the start), the Aqueduct with gold, steals take commodities
// ---------------------------------------------------------------------------------------------

/** Aqueduct players (science level 3+): on a 7 they get nothing, so 1 gold + 1 resource. */
const aqueductPlayers = (state: GameState): PlayerId[] =>
  fromRoller(state).filter((p) => levelOf(state, p, 'science') >= ABILITY_LEVEL);

function sevenPhase(draft: GameState, pending: readonly number[]): Phase {
  const aq = aqueductPlayers(draft);
  for (const p of aq) {
    epSlice(draft).gold[p] = goldOf(draft, p) + 1;
    log(draft, p, `${pn(draft, p)} received 1 gold (Aqueduct)`);
  }
  epckSlice(draft).aqueduct = aq;
  if (pending.some((n) => n > 0)) return { kind: 'discard', pending: [...pending] };
  return hasRobber(draft.settings) ? { kind: 'moveRobber', resume: 'main' } : { kind: 'main' };
}

/** After a discard action: once every discard of a 7 is done, the pirate moves (C&K would sleep). */
function afterDiscard(draft: GameState, wasSeven: boolean): void {
  if (wasSeven && draft.phase.kind === 'main') startRobber(draft, 'main');
}

const discardWrap = (draft: GameState, next: () => ReturnType<ExtHandler>) => {
  const wasSeven = draft.phase.kind === 'discard';
  const r = next();
  if (r.ok) afterDiscard(draft, wasSeven);
  return r;
};

/** Ship owners beside `h` (other than `p`, not protected) holding commodities. */
function commodityVictims(state: GameState, p: PlayerId, h: HexId): PlayerId[] {
  const sides = new Set(sidesOf(state, h));
  const owners = new Set(
    epSlice(state)
      .ships.filter((x) => sides.has(x.edge))
      .map((x) => x.owner),
  );
  return [...owners].filter(
    (o) =>
      o !== p &&
      !isRobberProtected(state, o) &&
      COMMODITIES.some((c) => goodCount(state, o, c) > 0),
  );
}

const placePirate: ExtWrap = (draft, action, next) => {
  const before = draft.phase as { kind: string; resume?: 'main' | 'preRoll' };
  const resume = before.kind === 'ep/pirate' ? (before.resume ?? 'main') : 'main';
  const r = next(draft, action);
  if (!r.ok) return r;
  const pirate = epSlice(draft).pirate;
  if (!pirate) return r;
  const extra = commodityVictims(draft, action.player, pirate.hex);
  const ph = draft.phase as PirateStealPhase;
  const known = ph.kind === 'ep/pirateSteal' ? ph.candidates : [];
  const candidates = [...new Set([...known, ...extra])].sort((a, b) => a - b);
  if (candidates.length > known.length) {
    draft.phase = { kind: 'ep/pirateSteal', candidates, resume } as unknown as Phase;
  }
  return r;
};

/** The pirate robs a random resource or commodity card (gold only from a player without cards). */
const pirateSteal: ExtWrap = (draft, action, next) => {
  const ph = draft.phase as PirateStealPhase;
  const victim = action['victim'];
  if (
    ph.kind !== 'ep/pirateSteal' ||
    draft.turn.current !== action.player ||
    typeof victim !== 'number' ||
    !ph.candidates.includes(victim) ||
    !COMMODITIES.some((c) => goodCount(draft, victim, c) > 0)
  ) {
    return next(draft, action);
  }
  const card = stealRandom(draft, action.player, victim);
  log(
    draft,
    action.player,
    `${pn(draft, action.player)}’s pirates robbed ${pn(draft, victim)}`,
    stealSecret(draft, action.player, victim, [card], ' (pirates)'),
  );
  draft.phase = resumePhase(draft, ph.resume);
  return ok(draft);
};

// ---------------------------------------------------------------------------------------------
// The module
// ---------------------------------------------------------------------------------------------

/** C&K actions that belong to the Action phase (none in the Movement phase, §3.4). */
const CK_ACTION_PHASE = [
  'ck/buildKnight',
  'ck/activateKnight',
  'ck/promoteKnight',
  'ck/selectKnight',
  'ck/buildWall',
  'ck/improve',
  'ck/play',
  'ck/bankTrade',
  'ck/offerTrade',
] as const;

const movementGuard: ExtWrap = (draft, action, next) =>
  inMovement(draft) ? fail('no trading or building in the Movement phase') : next(draft, action);

const wraps: Record<`${string}/${string}`, ExtWrap> = {
  ...Object.fromEntries(CK_ACTION_PHASE.map((t) => [t, movementGuard])),
  'ck/play': (draft, action, next) => {
    const card = action['card'];
    const err = cardBlocker(draft, action.player, card);
    if (err === undefined) return movementGuard(draft, action, next);
    if (err) return fail(err);
    if (card === 'inventor') return next(draft, action);
    spendCard(draft, action.player, card as 'medicine' | 'bishop');
    if (card === 'medicine') {
      draft.phase = { kind: 'ck/card', card: 'medicine' } as unknown as Phase;
    } else {
      log(draft, action.player, 'Taxation: the pirate ship is activated');
      startPirate(draft, 'main');
    }
    return ok(draft);
  },
  'ck/pickVertex': (draft, action, next) => {
    const v = action['vertex'];
    if (inMedicine(draft) && isVertex(v)) {
      const err = medicineCityBlocker(draft, action.player, v);
      if (err) return fail(err);
    }
    return next(draft, action);
  },
  'ck/pickHex': (draft, action, next) =>
    inInventor(draft) && draft.board.hexes[action['hex'] as HexId]?.terrain === 'gold'
      ? fail('the number of a gold field stays (it is the lair token)')
      : next(draft, action),
  'ck/discard': (draft, action, next) => discardWrap(draft, () => next(draft, action)),
  'ep/placePirate': placePirate,
  'ep/pirateSteal': pirateSteal,
};

function legal(state: GameState): Action[] {
  const p = state.turn.current;
  const out: Action[] = [];
  if (state.phase.kind === 'main' && !inMovement(state)) {
    for (const c of COMMODITIES) {
      if (fastGoldBlocker(state, p, c) === null) {
        out.push(act({ type: 'epck/fastGold', player: p, commodity: c }));
      }
    }
    for (const card of ['medicine', 'bishop'] as const) {
      if (cardBlocker(state, p, card) === null) out.push(act({ type: 'ck/play', player: p, card }));
    }
    out.push(...offerLegal(state, p));
  }
  if (inMedicine(state)) {
    for (const vertex of medicineHarbors(state, p)) {
      out.push(act({ type: 'epck/medicineHarbor', player: p, vertex }));
    }
  }
  return out;
}

function filterLegal(state: GameState, actions: Action[]): Action[] {
  const movement = inMovement(state);
  const seen = new Set<string>();
  return actions.filter((a) => {
    const x = a as unknown as Record<string, unknown>;
    // One combined offer form: commodities and gold go through epck/offerTrade.
    if (a.type === 'ck/offerTrade' || a.type === 'ep/offerTrade') return false;
    if (movement && (CK_ACTION_PHASE as readonly string[]).includes(a.type)) return false;
    if (a.type === 'buildCity') return !isHarbor(state, a.vertex);
    if (a.type === 'ck/play') {
      const err = cardBlocker(state, a.player, x['card']);
      if (err === undefined) return true;
      const key = `play:${String(x['card'])}`;
      if (err !== null || seen.has(key)) return false;
      seen.add(key);
      return true;
    }
    if (a.type === 'ck/pickVertex' && inMedicine(state)) {
      return medicineCityBlocker(state, a.player, x['vertex'] as VertexId) === null;
    }
    if (a.type === 'ck/pickHex' && inInventor(state)) {
      return state.board.hexes[x['hex'] as HexId]?.terrain !== 'gold';
    }
    return true;
  });
}

function init(draft: GameState, rng: Rng): void {
  draft.ext[EPCK] = { v: 1, aqueduct: [] } satisfies EpckSlice;
  // "Return 1 field and 1 forest instead of 2 fields": one forest of the island is a field.
  const forests = (Object.keys(draft.board.hexes) as HexId[])
    .filter((h) => draft.board.hexes[h]?.terrain === 'lumber')
    .sort();
  const h = forests.length > 0 ? rng.pick(forests) : undefined;
  const tile = h ? draft.board.hexes[h] : undefined;
  if (h && tile) {
    draft.board = {
      ...draft.board,
      hexes: { ...draft.board.hexes, [h]: { ...tile, terrain: 'grain' } },
    };
  }
}

export const epckModule: ExpansionModule = {
  id: EPCK,
  name: 'Explorers & Pirates + Cities & Knights',
  requires: [CK, EP],
  before: [CK, EP],
  players: { min: 3, max: 4 },
  modes: [
    {
      id: EPCK_MODE,
      name: 'Explorers & Pirates + Cities & Knights',
      blurb: 'Cities, knights and barbarians on the islands of the explorers',
      status: 'ready',
      expansions: [EPCK],
      scenarios: EPCK_SCENARIOS,
      players: { min: 3, max: 4 },
      vpBonus: EPCK_VP_BONUS,
    },
  ],

  validate(settings) {
    if (!EPCK_SCENARIOS.includes(settings.scenario as (typeof EPCK_SCENARIOS)[number])) {
      return 'Explorers & Pirates + Cities & Knights is played on Pirate Lairs, Fish, Spices or the full game';
    }
    return null;
  },

  init,
  cloneExt: (slice) => cloneJson(slice),

  actions: {
    'epck/fastGold': fastGold,
    'epck/medicineHarbor': medicineHarbor,
    'epck/offerTrade': offerTrade,
  },
  wraps,
  overrides: {
    buildCity: (draft, action, next) =>
      isHarbor(draft, action.vertex)
        ? fail('a harbor settlement cannot become a city')
        : next(draft, action),
    discard: (draft, action, next) => discardWrap(draft, () => next(draft, action)),
  },
  legal,
  filterLegal,

  hooks: {
    cost: (_state, item, base) => (item === MEDICINE_HARBOR_ITEM ? MEDICINE_HARBOR_COST : base),

    // City first (it pays its hexes), harbor settlement second.
    setupBuilding: (state, index) => (index < state.players.length ? 'city' : 'settlement'),
    setupOrder(state) {
      const n = state.players.length;
      const order = Array.from({ length: 2 * n }, (_, i) =>
        setupPlayerAt(i, n, state.settings.startingPlayer),
      );
      return { order, pays: order.map((_, i) => i < n) };
    },

    onSeven: sevenPhase,

    afterProduction(draft, roll, paid) {
      const aqueduct = ckModule.hooks?.afterProduction?.(draft, roll, paid);
      epModule.hooks?.afterProduction?.(draft, roll, paid);
      return aqueduct ?? { kind: 'main' };
    },

    afterAction(draft) {
      // E&P turns a robber move into its pirate (startPirate); do it here first, so the 7's
      // Aqueduct can follow once the pirate is done.
      if (draft.phase.kind === 'moveRobber') {
        const resume = draft.phase.resume === 'preRoll' ? 'preRoll' : 'main';
        if (rulesOf(draft).pirate) startPirate(draft, resume);
        else draft.phase = resumePhase(draft, resume);
      }
      const s = epckSlice(draft);
      if (s.aqueduct.length > 0 && draft.phase.kind === 'main') {
        const queue = RESOURCES.some((r) => draft.bank[r] > 0) ? s.aqueduct : [];
        s.aqueduct = [];
        if (queue.length > 0) draft.phase = { kind: 'ck/aqueduct', queue } as unknown as Phase;
      }
    },
  },
};
