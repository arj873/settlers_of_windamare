/** Pure form logic: trade composer, discard picker, new-game config. No DOM. */
import {
  emptyResources,
  RESOURCES,
  totalResources,
  type Action,
  type ActionOf,
  type PlayerId,
  type Resource,
  type ResourceBundle,
  type ResourceCounts,
} from '../engine';
import type { Controller, NewGameConfig, SeatConfig } from './types';

// ---------------------------------------------------------------------------
// Player trade composer
// ---------------------------------------------------------------------------

export interface TradeDraft {
  give: ResourceCounts;
  want: ResourceCounts;
  to: PlayerId[];
}

/** Most of one resource the offerer can ask for. */
export const MAX_WANT = 9;

export function emptyDraft(recipients: PlayerId[]): TradeDraft {
  return { give: emptyResources(), want: emptyResources(), to: [...recipients] };
}

/** Non-zero entries only. */
export function toBundle(counts: ResourceCounts): ResourceBundle {
  const out: ResourceBundle = {};
  for (const r of RESOURCES) if (counts[r] > 0) out[r] = counts[r];
  return out;
}

/**
 * Change one stepper. Give is capped by the hand, want by MAX_WANT. A resource cannot be on both
 * sides, so raising one side zeroes the other.
 */
export function stepDraft(
  draft: TradeDraft,
  side: 'give' | 'want',
  resource: Resource,
  delta: number,
  hand: ResourceCounts,
): TradeDraft {
  const cap = side === 'give' ? hand[resource] : MAX_WANT;
  const next = Math.max(0, Math.min(cap, draft[side][resource] + delta));
  const other = side === 'give' ? 'want' : 'give';
  const out: TradeDraft = {
    give: { ...draft.give },
    want: { ...draft.want },
    to: [...draft.to],
  };
  out[side][resource] = next;
  if (next > 0) out[other][resource] = 0;
  return out;
}

export function toggleRecipient(draft: TradeDraft, player: PlayerId): TradeDraft {
  const to = draft.to.includes(player)
    ? draft.to.filter((p) => p !== player)
    : [...draft.to, player].sort((a, b) => a - b);
  return { ...draft, to };
}

/** null = valid. */
export function validateDraft(draft: TradeDraft, hand: ResourceCounts): string | null {
  if (totalResources(draft.give) === 0) return 'Choose what you give';
  if (totalResources(draft.want) === 0) return 'Choose what you want';
  for (const r of RESOURCES) {
    if (draft.give[r] > hand[r]) return `You only have ${hand[r]} ${r}`;
    if (draft.give[r] > 0 && draft.want[r] > 0) return `Cannot trade ${r} for ${r}`;
  }
  if (draft.to.length === 0) return 'Choose at least one player';
  return null;
}

export function draftToAction(
  player: PlayerId,
  draft: TradeDraft,
  hand: ResourceCounts,
): ActionOf<'offerTrade'> | null {
  if (validateDraft(draft, hand) !== null) return null;
  return {
    type: 'offerTrade',
    player,
    give: toBundle(draft.give),
    want: toBundle(draft.want),
    to: [...draft.to],
  };
}

// ---------------------------------------------------------------------------
// Discard
// ---------------------------------------------------------------------------

/** Change one discard stepper: 0..hand, and never beyond `required` in total. */
export function stepDiscard(
  selection: ResourceCounts,
  resource: Resource,
  delta: number,
  hand: ResourceCounts,
  required: number,
): ResourceCounts {
  const others = totalResources(selection) - selection[resource];
  const cap = Math.min(hand[resource], required - others);
  return { ...selection, [resource]: Math.max(0, Math.min(cap, selection[resource] + delta)) };
}

/** null = valid: exactly `required` cards, none you do not hold. */
export function validateDiscard(
  hand: ResourceCounts,
  required: number,
  selection: ResourceCounts,
): string | null {
  for (const r of RESOURCES) {
    if (selection[r] < 0 || !Number.isInteger(selection[r])) return 'Invalid amount';
    if (selection[r] > hand[r]) return `You only have ${hand[r]} ${r}`;
  }
  const total = totalResources(selection);
  if (total < required) return `Choose ${required - total} more`;
  if (total > required) return `Too many: remove ${total - required}`;
  return null;
}

export function discardAction(player: PlayerId, selection: ResourceCounts): Action {
  return { type: 'discard', player, resources: toBundle(selection) };
}

// ---------------------------------------------------------------------------
// New game
// ---------------------------------------------------------------------------

export const SEAT_COLORS: readonly { name: string; color: string }[] = [
  { name: 'Red', color: '#d64541' },
  { name: 'Blue', color: '#3a7bd5' },
  { name: 'White', color: '#ecf0f1' },
  { name: 'Orange', color: '#f39c12' },
  { name: 'Green', color: '#3fae6a' },
  { name: 'Purple', color: '#9b59b6' },
];

export interface SeatDraft {
  name: string;
  color: string;
  controller: Controller;
}

export interface NewGameDraft {
  seats: SeatDraft[];
  layout: 'beginner' | 'random';
  seed: string;
}

export function defaultNewGame(seatCount: 3 | 4 = 4): NewGameDraft {
  const seats: SeatDraft[] = [];
  for (let i = 0; i < seatCount; i++) {
    const c = SEAT_COLORS[i];
    seats.push({
      name: i === 0 ? 'You' : c ? c.name : `Player ${i + 1}`,
      color: c ? c.color : '#888',
      controller: i === 0 ? 'human' : 'bot',
    });
  }
  return { seats, layout: 'beginner', seed: '' };
}

/** Grow/shrink to `count` seats, keeping the existing ones and picking unused colors for new ones. */
export function resizeSeats(draft: NewGameDraft, count: 3 | 4): NewGameDraft {
  const seats = draft.seats.slice(0, count);
  while (seats.length < count) {
    const used = new Set(seats.map((s) => s.color));
    const c = SEAT_COLORS.find((x) => !used.has(x.color)) ?? SEAT_COLORS[0];
    seats.push({
      name: c?.name ?? `Player ${seats.length + 1}`,
      color: c?.color ?? '#888',
      controller: 'bot',
    });
  }
  return { ...draft, seats };
}

/** Give seat `index` the color; whoever had it gets the seat's old color (colors stay unique). */
export function pickSeatColor(draft: NewGameDraft, index: number, color: string): NewGameDraft {
  const seat = draft.seats[index];
  if (!seat || seat.color === color) return draft;
  const seats = draft.seats.map((s, i) => {
    if (i === index) return { ...s, color };
    if (s.color === color) return { ...s, color: seat.color };
    return s;
  });
  return { ...draft, seats };
}

/** Trim names, fill blanks, make duplicates unique, drop an empty seed. */
export function buildNewGameConfig(draft: NewGameDraft): NewGameConfig {
  const taken = new Set<string>();
  const players: SeatConfig[] = draft.seats.map((s, i) => {
    const base = s.name.trim().slice(0, 16) || `Player ${i + 1}`;
    let name = base;
    for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base} ${n}`;
    taken.add(name.toLowerCase());
    return { name, color: s.color, controller: s.controller };
  });
  const seed = draft.seed.trim();
  return seed ? { players, layout: draft.layout, seed } : { players, layout: draft.layout };
}
