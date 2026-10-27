/**
 * The progress cards Barbarian Attack + C&K changes (docs/rules/combos.md §10): Intrigue takes a
 * barbarian prisoner, Taxation (the Bishop) robs one hex without a robber, Treason (the Deserter)
 * puts your knight on the deserter's path, Invention (the Inventor) swaps the island's inner
 * numbers only, the Merchant leaves a conquered hex. Smith and Warlord work on the path knights.
 * Medicine's city counts as a city built (barbarians land).
 */
import { log, ok, fail } from '../../../engine/actions/common';
import { terrainKind } from '../../../engine/expansions/hooks';
import { buildingsOf, cardsInHand } from '../../../engine/selectors';
import { topologyOf } from '../../../engine/topology';
import type {
  Action,
  ActionResult,
  EdgeId,
  GameState,
  HexId,
  PlayerId,
} from '../../../engine/types';
import {
  ckPlayer,
  ckSlice,
  inventorHexes,
  mainTurn,
  merchantHexes,
  playBlocker,
  spendCard,
  stealRandom,
  type KnightLevel,
  type ProgressCard,
} from '../../ck/engine';
import { isConqueredBuilding, isConqueredHex, tbBoard } from '../../tb/engine';
import { takePrisoner, treasonSources } from '../../tb/engine/ba';
import { pn } from '../../tb/engine/common';
import { inSupply, knightAt, knightEdges, promote, promoteBlocker } from './knights';
import { asPhase, backSlice, phaseOf, type BackPhase } from './state';

/** Cards with a flow of their own here; Inventor and Merchant keep C&K's flow, filtered. */
export const OWN_CARDS: readonly ProgressCard[] = [
  'intrigue',
  'bishop',
  'deserter',
  'smith',
  'warlord',
];
export const CHANGED_CARDS: readonly ProgressCard[] = [
  ...OWN_CARDS,
  'inventor',
  'merchant',
  'medicine',
];

const coastal = (state: GameState, h: HexId) => (tbBoard(state).coast ?? []).includes(h);
const opponents = (state: GameState, p: PlayerId) =>
  state.players.map((x) => x.id).filter((q) => q !== p);

/** Invention: only the island's inner numbers move (the coast's numbers call the barbarians). */
export const innerInventorHexes = (state: GameState): HexId[] =>
  inventorHexes(state).filter((h) => !coastal(state, h));

/** The Merchant never goes on a conquered hex (it would be removed at once). */
export const freeMerchantHexes = (state: GameState, p: PlayerId): HexId[] =>
  merchantHexes(state, p).filter((h) => !isConqueredHex(state, h));

/** Opponents with an unconquered building on `h` and a card to lose (Taxation). */
export function taxVictims(state: GameState, p: PlayerId, h: HexId): PlayerId[] {
  const out = new Set<PlayerId>();
  for (const v of topologyOf(state).hex[h]?.vertices ?? []) {
    const b = state.pieces.buildings[v];
    if (!b || b.owner === p || isConqueredBuilding(state, v)) continue;
    if (cardsInHand(state, b.owner) > 0) out.add(b.owner);
  }
  return [...out].sort((a, b) => a - b);
}

export function taxHexes(state: GameState, p: PlayerId): HexId[] {
  return (Object.keys(state.board.hexes) as HexId[])
    .filter((h) => {
      const t = state.board.hexes[h]?.terrain;
      return t !== undefined && terrainKind(t) === 'land' && taxVictims(state, p, h).length > 0;
    })
    .sort();
}

const deserterVictims = (state: GameState, p: PlayerId): PlayerId[] =>
  opponents(state, p).filter((q) => knightEdges(state, q).length > 0);

export const smithTargets = (state: GameState, p: PlayerId, done: readonly EdgeId[]): EdgeId[] =>
  knightEdges(state, p)
    .filter((e) => !done.includes(e) && promoteBlocker(state, p, e, true) === null)
    .sort();

/** Why `p` cannot play a changed `card` now (null: playable). */
export function cardBlocker(state: GameState, p: PlayerId, card: ProgressCard): string | null {
  const m = mainTurn(state, p);
  if (m) return m;
  if (!ckPlayer(state, p).progress.includes(card)) return 'you do not have that card';
  switch (card) {
    case 'intrigue':
      return treasonSources(state, []).length > 0 ? null : 'no barbarian on the island';
    case 'bishop':
      return taxHexes(state, p).length > 0 ? null : 'no hex with an opponent to rob';
    case 'deserter':
      return deserterVictims(state, p).length > 0 ? null : 'no opponent has a knight';
    case 'smith':
      return smithTargets(state, p, []).length > 0 ? null : 'no knight can be promoted';
    case 'warlord':
      return knightEdges(state, p).some((e) => knightAt(state, e)?.active === false)
        ? null
        : 'no inactive knight';
    // C&K's own flows, with the pair's limits on top of C&K's checks.
    case 'inventor':
      return (
        playBlocker(state, p, card) ??
        (innerInventorHexes(state).length >= 2 ? null : 'no inner numbers to swap')
      );
    case 'merchant':
      return (
        playBlocker(state, p, card) ??
        (freeMerchantHexes(state, p).length > 0 ? null : 'no unconquered hex next to you')
      );
    case 'medicine':
      return (
        playBlocker(state, p, card) ??
        (buildingsOf(state, p, 'settlement').some((v) => !isConqueredBuilding(state, v))
          ? null
          : 'every settlement of yours is conquered')
      );
    default:
      return null;
  }
}

/** Play one of OWN_CARDS (validated): spend it, then its effect or its phase. */
export function playOwnCard(draft: GameState, p: PlayerId, card: ProgressCard): void {
  spendCard(draft, p, card);
  switch (card) {
    case 'intrigue':
      draft.phase = asPhase({ kind: 'back/intrigue' });
      return;
    case 'bishop':
      draft.phase = asPhase({ kind: 'back/taxation' });
      return;
    case 'deserter':
      draft.phase = asPhase({ kind: 'back/deserter', victim: null });
      return;
    case 'smith':
      draft.phase = asPhase({ kind: 'back/smith', left: 2, done: [] });
      return;
    case 'warlord':
      for (const k of Object.values(backSlice(draft).knights)) {
        if (k.owner === p && !k.active) {
          k.active = true;
          k.activatedOn = draft.turn.number;
        }
      }
      log(draft, p, `${pn(draft, p)} activated all their knights`);
      return;
    default:
      return;
  }
}

// ---------------------------------------------------------------------------------------------
// The card phases
// ---------------------------------------------------------------------------------------------

const main = (draft: GameState): ActionResult => {
  draft.phase = { kind: 'main' };
  return ok(draft);
};

/** Handle a card-phase action (null: not one of them). */
export function cardAction(draft: GameState, a: Record<string, unknown> & Action): ActionResult {
  const phase = phaseOf(draft) as BackPhase;
  const p = a.player;
  if (draft.turn.current !== p && a.type !== 'back/deserterKnight') return fail('not your turn');
  switch (a.type) {
    case 'back/intrigueHex': {
      if (phase.kind !== 'back/intrigue') return fail('no Intrigue to resolve');
      const h = a['hex'] as HexId;
      if (!treasonSources(draft, []).includes(h)) return fail('no barbarian there');
      takePrisoner(draft, p, h);
      return main(draft);
    }
    case 'back/taxHex': {
      if (phase.kind !== 'back/taxation') return fail('no Taxation to resolve');
      const h = a['hex'] as HexId;
      const victims = typeof h === 'string' ? taxVictims(draft, p, h) : [];
      if (victims.length === 0) return fail('nobody to rob there');
      for (const q of victims) stealRandom(draft, p, q);
      log(draft, p, `${pn(draft, p)} taxed ${victims.map((q) => pn(draft, q)).join(', ')}`);
      return main(draft);
    }
    case 'back/deserterPlayer': {
      if (phase.kind !== 'back/deserter' || phase.victim !== null) return fail('no Treason step');
      const v = a['victim'];
      if (typeof v !== 'number' || !deserterVictims(draft, p).includes(v)) {
        return fail('pick an opponent with a knight');
      }
      draft.phase = asPhase({ kind: 'back/deserter', victim: v });
      return ok(draft);
    }
    case 'back/deserterKnight': {
      if (phase.kind !== 'back/deserter' || phase.victim === null) return fail('no Treason step');
      if (p !== phase.victim) return fail('the opponent picks the knight');
      const e = a['edge'] as EdgeId;
      const k = typeof e === 'string' ? knightAt(draft, e) : undefined;
      if (!k || k.owner !== p) return fail('pick one of your knights');
      const s = backSlice(draft);
      Reflect.deleteProperty(s.knights, e);
      log(draft, p, `${pn(draft, p)}'s knight deserted`);
      const thief = draft.turn.current;
      const level = ([k.level, 1] as KnightLevel[]).find((l) => inSupply(draft, thief, l) > 0);
      if (level !== undefined) {
        s.knights[e] = { ...k, owner: thief, level, activatedOn: null, promotedOn: null };
        log(draft, thief, `${pn(draft, thief)} placed the deserter on its path`);
      }
      return main(draft);
    }
    case 'back/smithKnight': {
      if (phase.kind !== 'back/smith') return fail('no Smith to resolve');
      const e = a['edge'] as EdgeId;
      if (typeof e !== 'string' || !smithTargets(draft, p, phase.done).includes(e)) {
        return fail('that knight cannot be promoted');
      }
      promote(draft, e);
      const done = [...phase.done, e];
      const left = phase.left - 1;
      if (left <= 0 || smithTargets(draft, p, done).length === 0) return main(draft);
      draft.phase = asPhase({ kind: 'back/smith', left, done });
      return ok(draft);
    }
    case 'back/smithDone':
      if (phase.kind !== 'back/smith') return fail('no Smith to resolve');
      return main(draft);
    default:
      return fail('unknown card step');
  }
}

/** Legal actions of the card phases. */
export function cardLegal(state: GameState): Action[] {
  const phase = phaseOf(state) as BackPhase;
  const p = state.turn.current;
  const out: Action[] = [];
  const add = (a: Record<string, unknown>) => out.push(a as unknown as Action);
  switch (phase.kind) {
    case 'back/intrigue':
      for (const hex of treasonSources(state, []))
        add({ type: 'back/intrigueHex', player: p, hex });
      break;
    case 'back/taxation':
      for (const hex of taxHexes(state, p)) add({ type: 'back/taxHex', player: p, hex });
      break;
    case 'back/deserter':
      if (phase.victim === null) {
        for (const victim of deserterVictims(state, p)) {
          add({ type: 'back/deserterPlayer', player: p, victim });
        }
      } else {
        for (const edge of knightEdges(state, phase.victim)) {
          add({ type: 'back/deserterKnight', player: phase.victim, edge });
        }
      }
      break;
    case 'back/smith':
      for (const edge of smithTargets(state, p, phase.done)) {
        add({ type: 'back/smithKnight', player: p, edge });
      }
      add({ type: 'back/smithDone', player: p });
      break;
    default:
      break;
  }
  return out;
}

/** The Merchant on a hex that has just been conquered leaves the board (the sheet). */
export function merchantConquered(draft: GameState): void {
  const s = ckSlice(draft);
  if (!s.merchant || !isConqueredHex(draft, s.merchant.hex)) return;
  const owner = s.merchant.owner;
  s.merchant = null;
  log(
    draft,
    owner,
    `The barbarians took the merchant's hex: ${pn(draft, owner)} loses the merchant`,
  );
}
