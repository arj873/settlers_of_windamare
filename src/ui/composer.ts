/** Pure form logic: trade composer, discard picker. (New-game setup lives in ./setup.) No DOM. */
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
  resourceWord,
} from '../engine';

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
    if (draft.give[r] > hand[r]) return `You only have ${hand[r]} ${resourceWord(r)}`;
    if (draft.give[r] > 0 && draft.want[r] > 0)
      return `Cannot trade ${resourceWord(r)} for ${resourceWord(r)}`;
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
    if (selection[r] > hand[r]) return `You only have ${hand[r]} ${resourceWord(r)}`;
  }
  const total = totalResources(selection);
  if (total < required) return `Choose ${required - total} more`;
  if (total > required) return `Too many: remove ${total - required}`;
  return null;
}

export function discardAction(player: PlayerId, selection: ResourceCounts): Action {
  return { type: 'discard', player, resources: toBundle(selection) };
}

/** One row of the discard dialog: what you hold, what is picked, and how far "+" may go. */
export interface DiscardRow {
  resource: Resource;
  held: number;
  picked: number;
  /** Most that can be picked for this row right now (0 for a card you do not hold). */
  max: number;
  /** Held minus picked: what stays in the hand. */
  left: number;
}

/** Every resource gets a row, so a missing card reads as "you have 0", not as a missing row. */
export function discardRows(
  hand: ResourceCounts,
  selection: ResourceCounts,
  required: number,
): DiscardRow[] {
  const picked = totalResources(selection);
  return RESOURCES.map((resource) => ({
    resource,
    held: hand[resource],
    picked: selection[resource],
    max: Math.min(hand[resource], required - (picked - selection[resource])),
    left: hand[resource] - selection[resource],
  }));
}

/** Status line under the rows: what is still to pick, or that the pick is complete. */
export function discardStatus(
  hand: ResourceCounts,
  required: number,
  selection: ResourceCounts,
): { text: string; ok: boolean } {
  const error = validateDiscard(hand, required, selection);
  return error === null
    ? { text: `Discarding ${required} of ${required}`, ok: true }
    : { text: error, ok: false };
}
