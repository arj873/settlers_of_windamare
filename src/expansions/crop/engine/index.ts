/**
 * Catan: Crop Trust (official free scenario by Klaus & Benjamin Teuber with the Crop Trust, 2018):
 * the fields grow five crops; harvesting takes crop tokens off the board for food, seeds can be
 * stored in the seed vault for rewards, every settlement and city reveals a random crop-loss
 * event, and the island can collapse. Rules and open questions: docs/rules/crop-trust.md.
 *
 * Framework use: the `production` hook cancels grain from fields, `afterProduction` opens the
 * harvest rounds as a multi-actor phase (`actors`), `afterAction` reveals event tokens for built
 * pieces and for Longest Road / Largest Army and ends the game on a crop collapse.
 */
import { log, ok, fail, isCurrent, type LegalGenerator } from '../../../engine/actions/common';
import { costOf } from '../../../engine/expansions/hooks';
import type { ExpansionModule, ExtHandler } from '../../../engine/expansions/types';
import { addResources, hasResources, subtractResources } from '../../../engine/resources';
import { Rng } from '../../../engine/rng';
import { changesRoads, updateAwards } from '../../../engine/rules/awards';
import { playerName } from '../../../engine/rules/text';
import { getPlayer, victoryPoints } from '../../../engine/selectors';
import { hexVertices, topologyOf, vertexInfo } from '../../../engine/topology';
import { hasRobber, setupPlacementOf } from '../../../engine/variants';
import type {
  Action,
  DevCardType,
  GameState,
  HexId,
  PlayerId,
  VertexId,
} from '../../../engine/types';
import { CROP_FIRST19, CROP_RANDOM19 } from './maps';
import {
  CROP,
  DEPOSIT,
  DEPOSIT_COST,
  EMPTY_FIELDS_END,
  EXTINCT_END,
  HEX_LIMIT,
  ROW_SIZE,
  SPECIES,
  SPECIES_NAME,
  TOKENS_PER_SPECIES,
  VAULT_SIZE,
  cropSlice,
  emptyCounts,
  emptyFields,
  eventLabel,
  fieldsHexes,
  isSpecies,
  recordVp,
  storedCount,
  totalOf,
  type CropAction,
  type CropCounts,
  type CropEvent,
  type CropSlice,
  type HarvestPhase,
  type ReplantPhase,
  type Row,
  type Species,
} from './state';

export * from './state';
export { CROP_FIRST19, CROP_RANDOM19 } from './maps';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

/** Crop tokens put on a fields hex by its number (rulebook, variable setup). */
const START_CROPS: Record<number, readonly Species[]> = {
  2: ['quinoa'],
  3: ['quinoa', 'maize'],
  4: ['quinoa', 'maize', 'wheat'],
  5: ['quinoa', 'maize', 'wheat', 'beans'],
  6: ['quinoa', 'maize', 'wheat', 'beans', 'rice'],
};
const startCrops = (token: number): readonly Species[] =>
  START_CROPS[token > 7 ? 14 - token : token] ?? [];

/** Seed vault species by seat, from the starting player clockwise. */
const VAULT_SEEDS: readonly Species[] = ['rice', 'beans', 'wheat', 'maize'];

const NUMBER_GROUPS: readonly (readonly number[])[] = [
  [2, 3, 11, 12],
  [4, 5, 9, 10],
  [5, 6, 8, 9],
];

/** The 41 event tokens: 15 regional, 10 small, 10 large, 6 monoculture (counts assumed). */
function eventTokens(): CropEvent[] {
  const out: CropEvent[] = [];
  for (const s of SPECIES) {
    for (const n of NUMBER_GROUPS) out.push({ k: 'regional', s, n: [...n] });
    out.push({ k: 'small', s }, { k: 'small', s }, { k: 'large', s }, { k: 'large', s });
  }
  for (let i = 0; i < 6; i++) out.push({ k: 'mono' });
  return out;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** Fields hexes next to a settlement or city of `p`. */
export function adjacentFields(state: GameState, p: PlayerId): HexId[] {
  const t = topologyOf(state);
  const crops = cropSlice(state).crops;
  const out = new Set<HexId>();
  for (const [v, b] of Object.entries(state.pieces.buildings) as [
    VertexId,
    { owner: PlayerId },
  ][]) {
    if (b.owner !== p) continue;
    for (const h of vertexInfo(t, v)?.hexes ?? []) if (crops[h]) out.add(h);
  }
  return [...out].sort();
}

export const rowOf = (state: GameState, p: PlayerId, row: Row): Species[] =>
  cropSlice(state).record[p]?.[row] ?? [];

/** Why `p` cannot store `species` taken from `hex` into `row` now, or null. */
export function depositBlocker(
  state: GameState,
  p: PlayerId,
  hex: HexId,
  species: Species,
  row: Row,
): string | null {
  if (state.phase.kind !== 'main') return 'can only store seeds in the main phase';
  if (!isCurrent(state, p)) return 'not your turn';
  const s = cropSlice(state);
  if (s.deposited) return 'you already stored seeds this turn';
  const hand = state.players[p]?.resources;
  if (!hand || !hasResources(hand, costOf(state, DEPOSIT) ?? DEPOSIT_COST)) {
    return 'storing seeds costs 1 lumber and 1 ore';
  }
  if (!adjacentFields(state, p).includes(hex))
    return 'that fields hex is not next to your buildings';
  if ((s.crops[hex]?.[species] ?? 0) < 1) return `there is no ${species} on that hex`;
  if (s.extinct.includes(species)) return `${species} is extinct`;
  const r = rowOf(state, p, row);
  if (r.includes(species)) return `${species} is already in that row`;
  if (r.length >= ROW_SIZE) return 'that row is full';
  return null;
}

/** Hexes the next replanted token may go to: not full, not used by this replant. */
export function plantSpots(state: GameState, phase: ReplantPhase): HexId[] {
  const crops = cropSlice(state).crops;
  return fieldsHexes(state).filter(
    (h) => !phase.used.includes(h) && totalOf(crops[h] as CropCounts) < HEX_LIMIT,
  );
}

const harvestValid = (state: GameState, e: { hex: HexId }): boolean =>
  totalOf(cropSlice(state).crops[e.hex] as CropCounts) > 0 && state.bank.grain > 0;

/** Drop leading harvest entries that can no longer harvest (empty hex, empty bank). */
function trimQueue(state: GameState, queue: HarvestPhase['queue']): void {
  while (queue[0] && !harvestValid(state, queue[0])) queue.shift();
}

/** Who gets the harvest rounds of `hex` for a roll by the current player. */
function harvestQueue(state: GameState, hex: HexId): HarvestPhase['queue'] {
  const t = topologyOf(state);
  const n = state.players.length;
  const kinds = state.players.map(() => ({ any: false, city: false }));
  for (const v of hexVertices(t, hex)) {
    const b = state.pieces.buildings[v];
    const k = b && kinds[b.owner];
    if (b && k) {
      k.any = true;
      if (b.kind === 'city') k.city = true;
    }
  }
  const order = Array.from({ length: n }, (_, i) => (state.turn.current + i) % n);
  return [
    ...order.filter((p) => kinds[p]?.any).map((player) => ({ hex, player })),
    ...order.filter((p) => kinds[p]?.city).map((player) => ({ hex, player })),
  ];
}

// ---------------------------------------------------------------------------
// Extinction, collapse and the end of the game
// ---------------------------------------------------------------------------

/** A species with no token on the board and none in a vault is extinct: its supply goes to the box. */
function refreshExtinct(draft: GameState, inHand?: Species): void {
  const s = cropSlice(draft);
  for (const sp of SPECIES) {
    if (s.extinct.includes(sp) || sp === inHand) continue;
    const onBoard = fieldsHexes(draft).some((h) => (s.crops[h]?.[sp] ?? 0) > 0);
    const inVault = s.vault.some((v) => v.species === sp && v.count > 0);
    if (onBoard || inVault) continue;
    s.extinct.push(sp);
    s.box[sp] += s.supply[sp];
    s.supply[sp] = 0;
    log(draft, null, `${SPECIES_NAME[sp]} is extinct!`);
  }
}

function collapseReason(state: GameState): string | null {
  const s = cropSlice(state);
  if (emptyFields(state).length >= EMPTY_FIELDS_END) {
    return `${EMPTY_FIELDS_END} fields hexes have no crops left`;
  }
  if (s.extinct.length >= EXTINCT_END) return `${EXTINCT_END} species are extinct`;
  return null;
}

/**
 * The crop collapse ends the game: the player with the most stored crop tokens wins (ties: most
 * VP, then they share, shown as the first of them). The player whose harvest caused it cannot win.
 */
function endCollapse(draft: GameState, reason: string, harvester?: PlayerId): void {
  const ranked = draft.players
    .filter((p) => p.id !== harvester)
    .map((p) => ({ id: p.id, stored: storedCount(draft, p.id), vp: victoryPoints(draft, p.id) }));
  const best = ranked.reduce(
    (b, r) => (r.stored > b.stored || (r.stored === b.stored && r.vp > b.vp) ? r : b),
    ranked[0] ?? { id: 0, stored: 0, vp: 0 },
  );
  const winners = ranked.filter((r) => r.stored === best.stored && r.vp === best.vp);
  const names = winners.map((w) => playerName(draft, w.id)).join(' and ');
  draft.winner = winners[0]?.id ?? null;
  draft.phase = { kind: 'gameOver' };
  log(
    draft,
    draft.winner,
    `Crop collapse (${reason})! ${names} ${winners.length > 1 ? 'share the win' : 'wins'} with ${best.stored} stored crops`,
  );
}

/** End the game if the island collapsed. Returns true when it did. */
function checkCollapse(draft: GameState, harvester?: PlayerId): boolean {
  const why = collapseReason(draft);
  if (why === null) return false;
  endCollapse(draft, why, harvester);
  return true;
}

// ---------------------------------------------------------------------------
// Event tokens
// ---------------------------------------------------------------------------

/** Draw from the supply stack; when it is empty the used tokens are shuffled into a new one. */
function drawEvent(draft: GameState): CropEvent | undefined {
  const s = cropSlice(draft);
  if (s.stack.length === 0 && s.used.length > 0) {
    const rng = new Rng(draft.rng);
    s.stack = rng.shuffle(s.used);
    s.used = [];
    draft.rng = rng.state;
  }
  return s.stack.pop();
}

function removeCrops(s: CropSlice, hex: HexId, sp: Species, n: number): number {
  const counts = s.crops[hex];
  if (!counts) return 0;
  const k = Math.min(n, counts[sp]);
  counts[sp] -= k;
  s.supply[sp] += k;
  return k;
}

/** Remove `n` tokens of `sp`: hexes next to `p`'s buildings first, then any other. */
function removeSome(draft: GameState, p: PlayerId, sp: Species, n: number): void {
  const s = cropSlice(draft);
  const near = adjacentFields(draft, p);
  const order = [...near, ...fieldsHexes(draft).filter((h) => !near.includes(h))];
  let left = n;
  for (const group of [near, order.filter((h) => !near.includes(h))]) {
    while (left > 0) {
      const hex = group
        .filter((h) => (s.crops[h]?.[sp] ?? 0) > 0)
        .sort((a, b) => (s.crops[b]?.[sp] ?? 0) - (s.crops[a]?.[sp] ?? 0) || (a < b ? -1 : 1))[0];
      if (hex === undefined) break;
      left -= removeCrops(s, hex, sp, 1);
    }
  }
}

function resolveEvent(draft: GameState, ev: CropEvent, p: PlayerId): void {
  const s = cropSlice(draft);
  switch (ev.k) {
    case 'regional':
      for (const h of fieldsHexes(draft)) {
        const token = draft.board.hexes[h]?.token;
        if (token != null && ev.n.includes(token)) removeCrops(s, h, ev.s, TOKENS_PER_SPECIES);
      }
      break;
    case 'small':
      removeSome(draft, p, ev.s, 2);
      break;
    case 'large':
      removeSome(draft, p, ev.s, 3);
      break;
    default:
      for (const h of fieldsHexes(draft)) {
        const counts = s.crops[h];
        if (!counts) continue;
        const kinds = SPECIES.filter((sp) => counts[sp] > 0);
        if (kinds.length === 1) removeCrops(s, h, kinds[0] as Species, TOKENS_PER_SPECIES);
      }
  }
  refreshExtinct(draft);
}

/** Reveal `token` for `p` (a token of an extinct species goes back to the box and another is drawn). */
function reveal(draft: GameState, token: CropEvent | undefined, p: PlayerId): void {
  const s = cropSlice(draft);
  let ev = token;
  while (ev && 's' in ev && s.extinct.includes(ev.s)) {
    s.boxed += 1;
    ev = drawEvent(draft);
  }
  if (!ev) return;
  log(draft, p, `${playerName(draft, p)} reveals an event: ${eventLabel(ev)}`);
  resolveEvent(draft, ev, p);
  s.used.push(ev);
}

function afterAction(draft: GameState, action: Action): void {
  if (draft.phase.kind === 'gameOver') return;
  const s = cropSlice(draft);
  const p = action.player;
  const mine = s.pieces[p];
  if (action.type === 'buildSettlement' && mine) {
    reveal(draft, mine.settlement.pop(), p);
  } else if (action.type === 'buildCity' && mine) {
    reveal(draft, mine.city.pop(), p);
    // The settlement piece goes back to the supply with a fresh token under it.
    const fresh = drawEvent(draft);
    if (fresh) mine.settlement.push(fresh);
  }
  // (A deposit waits for its replanting: the collapse is checked when the last seed is planted.)
  if (draft.phase.kind !== 'crop/replant' && checkCollapse(draft)) return;

  // Longest Road / Largest Army: whoever takes the card reveals its token, which is then replaced.
  const before = { ...draft.awards };
  updateAwards(draft, { roads: changesRoads(action.type) });
  for (const card of ['longestRoad', 'largestArmy'] as const) {
    const owner = draft.awards[card];
    if (owner === before[card] || owner === null) continue;
    const token = s.cards[card];
    s.cards[card] = null;
    reveal(draft, token ?? undefined, owner);
    s.cards[card] = drawEvent(draft) ?? null;
    if (checkCollapse(draft)) return;
  }
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/** After the harvest queue changes: continue to the next entry or back to the main phase. */
function advanceHarvest(draft: GameState, phase: HarvestPhase): void {
  trimQueue(draft, phase.queue);
  if (phase.queue.length === 0) draft.phase = { kind: 'main' };
}

function finishReplant(draft: GameState, leftover: number, species: Species): void {
  const s = cropSlice(draft);
  s.supply[species] += leftover;
  draft.phase = { kind: 'main' };
  refreshExtinct(draft);
  checkCollapse(draft);
}

const actions: Record<`crop/${string}`, ExtHandler> = {
  'crop/harvest': (draft, action) => {
    const phase = draft.phase;
    if (phase.kind !== 'crop/harvest') return fail('nothing to harvest');
    const ph = phase as HarvestPhase;
    const head = ph.queue[0];
    if (!head || head.player !== action.player) return fail('not your harvest');
    const sp = action['species'];
    const s = cropSlice(draft);
    if (!isSpecies(sp) || (s.crops[head.hex]?.[sp] ?? 0) < 1)
      return fail('no such crop on that hex');
    if (draft.bank.grain < 1) return fail('the bank has no food');
    removeCrops(s, head.hex, sp, 1);
    getPlayer(draft, action.player).resources.grain += 1;
    draft.bank.grain -= 1;
    log(draft, action.player, `${playerName(draft, action.player)} harvested ${sp} (+1 food)`);
    ph.queue.shift();
    advanceHarvest(draft, ph);
    refreshExtinct(draft);
    // Whoever's harvest causes the collapse loses.
    checkCollapse(draft, action.player);
    return ok(draft);
  },

  'crop/skipHarvest': (draft, action) => {
    const phase = draft.phase;
    if (phase.kind !== 'crop/harvest') return fail('nothing to harvest');
    const ph = phase as HarvestPhase;
    if (ph.queue[0]?.player !== action.player) return fail('not your harvest');
    ph.queue.shift();
    advanceHarvest(draft, ph);
    return ok(draft);
  },

  'crop/deposit': (draft, action) => {
    const { hex, species, row } = action as unknown as CropAction & { type: 'crop/deposit' };
    if (typeof hex !== 'string' || !isSpecies(species) || (row !== 'top' && row !== 'bottom')) {
      return fail('invalid seed deposit');
    }
    const err = depositBlocker(draft, action.player, hex, species, row);
    if (err) return fail(err);
    const p = action.player;
    const s = cropSlice(draft);
    const pl = getPlayer(draft, p);
    // 1. pay
    const cost = costOf(draft, DEPOSIT) ?? DEPOSIT_COST;
    pl.resources = subtractResources(pl.resources, cost);
    draft.bank = addResources(draft.bank, cost);
    // 2. record the crop (it leaves the board); the 2nd token of a row pays a development card
    removeCrops(s, hex, species, 1);
    s.supply[species] -= 1; // ... it is not returned to the supply
    const record = (s.record[p] ??= { top: [], bottom: [] });
    record[row].push(species);
    log(draft, p, `${playerName(draft, p)} stored ${species} in the seed vault (${row} row)`);
    if (record[row].length === 2) {
      const card = draft.devDeck.pop() as DevCardType | undefined;
      if (card) {
        pl.newDevCards[card] += 1;
        log(draft, p, `${playerName(draft, p)} received a development card`);
      }
    }
    // 3. fill the empty vault space with 4 tokens of the same crop
    const old = s.vault[p] ?? { species, count: 0 };
    const take = Math.min(VAULT_SIZE, s.supply[species]);
    s.supply[species] -= take;
    s.vault[p] = { species, count: take };
    s.deposited = true;
    // 4. replant the old vault tokens on different fields hexes
    const replant: ReplantPhase = {
      kind: 'crop/replant',
      species: old.species,
      left: old.count,
      used: [],
    };
    if (old.count > 0 && plantSpots(draft, replant).length > 0) {
      draft.phase = replant;
    } else {
      finishReplant(draft, old.count, old.species);
    }
    return ok(draft);
  },

  'crop/plant': (draft, action) => {
    const phase = draft.phase;
    if (phase.kind !== 'crop/replant') return fail('nothing to replant');
    if (!isCurrent(draft, action.player)) return fail('not your turn');
    const ph = phase as ReplantPhase;
    const hex = action.hex;
    if (typeof hex !== 'string' || !plantSpots(draft, ph).includes(hex)) {
      return fail('cannot plant on that hex');
    }
    const counts = cropSlice(draft).crops[hex];
    if (!counts) return fail('cannot plant on that hex');
    counts[ph.species] += 1;
    ph.left -= 1;
    ph.used.push(hex);
    log(draft, action.player, `${playerName(draft, action.player)} replanted ${ph.species}`);
    if (ph.left === 0 || plantSpots(draft, ph).length === 0) {
      finishReplant(draft, ph.left, ph.species);
    }
    return ok(draft);
  },
};

// ---------------------------------------------------------------------------
// Legal actions
// ---------------------------------------------------------------------------

export const cropLegal: LegalGenerator = (state) => {
  const out: Action[] = [];
  const phase = state.phase;
  const s = cropSlice(state);
  const push = (a: CropAction) => out.push(a as unknown as Action);
  if (phase.kind === 'crop/harvest') {
    const head = (phase as HarvestPhase).queue[0];
    if (!head) return out;
    for (const species of SPECIES) {
      if ((s.crops[head.hex]?.[species] ?? 0) > 0 && state.bank.grain > 0) {
        push({ type: 'crop/harvest', player: head.player, species });
      }
    }
    push({ type: 'crop/skipHarvest', player: head.player });
    return out;
  }
  if (phase.kind === 'crop/replant') {
    for (const hex of plantSpots(state, phase as ReplantPhase)) {
      push({ type: 'crop/plant', player: state.turn.current, hex });
    }
    return out;
  }
  if (phase.kind !== 'main') return out;
  const p = state.turn.current;
  for (const hex of adjacentFields(state, p)) {
    for (const species of SPECIES) {
      for (const row of ['top', 'bottom'] as const) {
        if (depositBlocker(state, p, hex, species, row) === null) {
          push({ type: 'crop/deposit', player: p, hex, species, row });
        }
      }
    }
  }
  return out;
};

// ---------------------------------------------------------------------------
// The module
// ---------------------------------------------------------------------------

export const cropModule: ExpansionModule = {
  id: CROP,
  name: 'Crop Trust',
  icon: '🌱',
  players: { min: 3, max: 4 },
  maps: [CROP_FIRST19, CROP_RANDOM19],
  scenarios: [
    {
      id: 'crop/cropTrust',
      name: 'Crop Trust',
      blurb: 'Harvest, store seeds, keep the crops alive: the rulebook layout',
      players: { min: 3, max: 4 },
      maps: [CROP_FIRST19.id],
      mapFor: () => CROP_FIRST19.id,
      vpToWin: 10,
    },
    {
      id: 'crop/cropTrustVariable',
      name: 'Crop Trust (variable)',
      blurb: 'The same rules on a shuffled board',
      players: { min: 3, max: 4 },
      maps: [CROP_RANDOM19.id],
      mapFor: () => CROP_RANDOM19.id,
      vpToWin: 10,
    },
  ],
  modes: [
    {
      id: CROP,
      name: 'Crop Trust',
      blurb: 'A semi-cooperative race to save the seeds',
      status: 'ready',
      expansions: [CROP],
      scenarios: ['crop/cropTrust', 'crop/cropTrustVariable'],
      players: { min: 3, max: 4 },
    },
  ],

  init(draft, rng) {
    const n = draft.players.length;
    const crops: Record<HexId, CropCounts> = {};
    const supply = emptyCounts();
    for (const sp of SPECIES) supply[sp] = TOKENS_PER_SPECIES;
    for (const id of Object.keys(draft.board.hexes).sort() as HexId[]) {
      const tile = draft.board.hexes[id];
      if (tile?.terrain !== 'grain') continue;
      const counts = emptyCounts();
      for (const sp of startCrops(tile.token ?? 0)) {
        counts[sp] += 1;
        supply[sp] -= 1;
      }
      crops[id] = counts;
    }
    const vault: CropSlice['vault'] = [];
    const first = draft.settings.startingPlayer;
    for (let i = 0; i < n; i++) {
      const sp = VAULT_SEEDS[i] as Species;
      supply[sp] -= VAULT_SIZE;
      vault[(first + i) % n] = { species: sp, count: VAULT_SIZE };
    }
    const deck = rng.shuffle(eventTokens());
    const pieces: CropSlice['pieces'] = [];
    // A token lies under each piece left after setup: 3 settlements + 4 cities, or one more
    // settlement and one city fewer per setup round that places a city (settings.setupPlacement).
    const place = setupPlacementOf(draft.settings);
    const setupCities = [place.first, place.second].filter((r) => r.building === 'city').length;
    for (let p = 0; p < n; p++) {
      pieces.push({
        settlement: deck.splice(-(3 + setupCities)),
        city: deck.splice(-(4 - setupCities)),
      });
    }
    const cards = { longestRoad: deck.pop() ?? null, largestArmy: deck.pop() ?? null };
    const slice: CropSlice = {
      v: 1,
      crops,
      supply,
      box: emptyCounts(),
      extinct: [],
      vault,
      record: draft.players.map(() => ({ top: [], bottom: [] })),
      stack: deck,
      used: [],
      boxed: 0,
      pieces,
      cards,
      deposited: false,
    };
    draft.ext[CROP] = slice;
  },

  cloneExt(slice) {
    const s = slice as CropSlice;
    const copyCounts = (c: CropCounts): CropCounts => ({ ...c });
    const copyEvent = (e: CropEvent): CropEvent =>
      e.k === 'regional' ? { ...e, n: [...e.n] } : { ...e };
    return {
      v: s.v,
      crops: Object.fromEntries(Object.entries(s.crops).map(([h, c]) => [h, copyCounts(c)])),
      supply: copyCounts(s.supply),
      box: copyCounts(s.box),
      extinct: [...s.extinct],
      vault: s.vault.map((v) => ({ ...v })),
      record: s.record.map((r) => ({ top: [...r.top], bottom: [...r.bottom] })),
      stack: s.stack.map(copyEvent),
      used: s.used.map(copyEvent),
      boxed: s.boxed,
      pieces: s.pieces.map((p) => ({
        settlement: p.settlement.map(copyEvent),
        city: p.city.map(copyEvent),
      })),
      cards: {
        longestRoad: s.cards.longestRoad && copyEvent(s.cards.longestRoad),
        largestArmy: s.cards.largestArmy && copyEvent(s.cards.largestArmy),
      },
      deposited: s.deposited,
    } satisfies CropSlice;
  },

  actions,
  legal: cropLegal,

  actors(state) {
    const phase = state.phase;
    if (phase.kind !== 'crop/harvest') return undefined;
    const head = (phase as HarvestPhase).queue[0];
    return head ? [head.player] : undefined;
  },

  hooks: {
    cost: (_state, item, base) => (item === DEPOSIT ? DEPOSIT_COST : base),

    // Fields no longer pay grain on a roll: they are harvested in rounds (afterProduction).
    production(state, roll, owed, ctx) {
      const t = topologyOf(state);
      for (const id of fieldsHexes(state)) {
        if (state.board.hexes[id]?.token !== roll || id === ctx.blocked) continue;
        for (const v of hexVertices(t, id)) {
          const b = state.pieces.buildings[v];
          const hand = b && owed[b.owner];
          if (b && hand) hand.grain -= b.kind === 'city' ? ctx.cityYield : 1;
        }
      }
    },

    afterProduction(draft, roll) {
      const queue: HarvestPhase['queue'] = [];
      const blocked = hasRobber(draft.settings) ? draft.robber : null;
      for (const id of fieldsHexes(draft)) {
        if (draft.board.hexes[id]?.token !== roll || id === blocked) continue;
        queue.push(...harvestQueue(draft, id));
      }
      trimQueue(draft, queue);
      if (queue.length === 0) return undefined;
      const phase: HarvestPhase = { kind: 'crop/harvest', roll, queue };
      return phase;
    },

    victoryPoints: (state, player) => ({ public: recordVp(state, player) }),

    onStartTurn(draft) {
      cropSlice(draft).deposited = false;
    },

    afterAction,
  },
};
