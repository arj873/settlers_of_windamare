/**
 * Crop Trust invariants for the simulator: every crop species keeps its 18 tokens, hexes hold at
 * most 7, extinct species are gone, the Crop Storage Records follow the row rules, all 41 event
 * tokens are accounted for, and the tokens under unbuilt pieces match the pieces left.
 */
import { pieceLimit, type GameState, type HexId, type PlayerId } from '../../engine';
import type { BotExtension } from '../../bots/expansions';
import type { Violation } from '../../bots/invariants';
import {
  CROP,
  HEX_LIMIT,
  ROW_SIZE,
  SPECIES,
  TOKENS_PER_SPECIES,
  VAULT_SIZE,
  type CropCounts,
  type CropSlice,
  type HarvestPhase,
  type ReplantPhase,
} from './engine';

function check(state: GameState): Violation[] {
  const out: Violation[] = [];
  const bad = (message: string, player?: PlayerId) =>
    out.push({
      code: 'expansion',
      message: `crop: ${message}`,
      ...(player === undefined ? {} : { player }),
    });
  const s = state.ext[CROP] as CropSlice | undefined;
  const n = state.players.length;
  if (!s || s.v !== 1 || typeof s.crops !== 'object' || !Array.isArray(s.vault)) {
    return [{ code: 'expansion', message: 'crop: missing or malformed slice' }];
  }
  const hexes = Object.keys(s.crops) as HexId[];
  for (const h of hexes) {
    const tile = state.board.hexes[h];
    if (tile?.terrain !== 'grain') bad(`crops on ${h}, which is not a fields hex`);
    const total = SPECIES.reduce((a, sp) => a + (s.crops[h] as CropCounts)[sp], 0);
    if (total > HEX_LIMIT) bad(`${h} holds ${total} crop tokens (max ${HEX_LIMIT})`);
  }
  if (hexes.length !== 5) bad(`${hexes.length} fields hexes, expected 5`);

  // Tokens in a replanting hand are neither on the board nor in the supply.
  const hand = (sp: string) =>
    state.phase.kind === 'crop/replant' && (state.phase as ReplantPhase).species === sp
      ? (state.phase as ReplantPhase).left
      : 0;
  for (const sp of SPECIES) {
    const board = hexes.reduce((a, h) => a + (s.crops[h] as CropCounts)[sp], 0);
    const vault = s.vault.reduce((a, v) => a + (v.species === sp ? v.count : 0), 0);
    const record = s.record.reduce(
      (a, r) => a + r.top.filter((x) => x === sp).length + r.bottom.filter((x) => x === sp).length,
      0,
    );
    const total = board + s.supply[sp] + s.box[sp] + vault + record + hand(sp);
    // A deposit that wins the game (VP) ends it before the seeds are replanted: they are in hand.
    const missing = state.phase.kind === 'gameOver' ? VAULT_SIZE : 0;
    if (total > TOKENS_PER_SPECIES || total < TOKENS_PER_SPECIES - missing) {
      bad(`${sp}: ${total} tokens, expected ${TOKENS_PER_SPECIES}`);
    }
    if (s.extinct.includes(sp) && board + vault + hand(sp) + s.supply[sp] > 0) {
      bad(`${sp} is extinct but still in play`);
    }
    if (!s.extinct.includes(sp) && s.box[sp] > 0) bad(`${sp} tokens in the box but not extinct`);
  }

  if (s.vault.length !== n) bad('one seed vault entry per player expected');
  s.vault.forEach((v, p) => {
    if (v.count < 0 || v.count > VAULT_SIZE) bad(`player ${p}'s vault holds ${v.count}`, p);
  });
  s.record.forEach((r, p) => {
    for (const row of [r.top, r.bottom]) {
      if (row.length > ROW_SIZE || new Set(row).size !== row.length) {
        bad(`player ${p}'s record row is invalid: ${row.join(',')}`, p);
      }
    }
  });

  const events =
    s.stack.length +
    s.used.length +
    s.boxed +
    s.pieces.reduce((a, p) => a + p.settlement.length + p.city.length, 0) +
    (s.cards.longestRoad ? 1 : 0) +
    (s.cards.largestArmy ? 1 : 0);
  if (events !== 41) bad(`${events} event tokens, expected 41`);
  if (state.turn.number > 0) {
    state.players.forEach((p) => {
      const pool = s.pieces[p.id];
      const settlements = Object.values(state.pieces.buildings).filter(
        (b) => b.owner === p.id && b.kind === 'settlement',
      ).length;
      const cities = Object.values(state.pieces.buildings).filter(
        (b) => b.owner === p.id && b.kind === 'city',
      ).length;
      if (pool?.settlement.length !== pieceLimit(state, p.id, 'settlement') - settlements) {
        bad(
          `player ${p.id}: ${pool?.settlement.length} settlement tokens for ${settlements} built`,
          p.id,
        );
      }
      if (pool?.city.length !== pieceLimit(state, p.id, 'city') - cities) {
        bad(`player ${p.id}: ${pool?.city.length} city tokens for ${cities} built`, p.id);
      }
    });
  }

  const phase = state.phase;
  if (phase.kind === 'crop/harvest') {
    const q = (phase as HarvestPhase).queue;
    if (q.length === 0) bad('harvest phase with an empty queue');
    for (const e of q)
      if (!s.crops[e.hex] || state.players[e.player] === undefined) bad('bad harvest entry');
  }
  if (phase.kind === 'crop/replant') {
    const r = phase as ReplantPhase;
    if (r.left < 1 || r.left > VAULT_SIZE) bad(`replant with ${r.left} tokens left`);
  }
  // The winner is the player with the most stored crops after a collapse, or someone at the VP
  // target; either way a finished game has one.
  if ((phase.kind === 'gameOver') !== (state.winner !== null)) {
    bad(`phase ${phase.kind} but winner = ${String(state.winner)}`);
  }
  return out;
}

export const cropBots: BotExtension = {
  id: CROP,
  invariants: check,
  // A crop collapse is won with the most stored crops, not with the VP target.
  relax: ['winner'],
};
