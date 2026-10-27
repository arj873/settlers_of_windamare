/**
 * What a piece costs, as resource card faces (#35). Shared by the build bar's hover / long-press
 * tooltips and anything else that shows a price next to a spot or a card: one component, one
 * look. A card the hand does not cover is dimmed and ringed (`.is-missing`). Pure DOM builders.
 */
import { RESOURCES, type Resource, type ResourceCounts } from '../engine';
import { h, type Child } from './dom';
import { resCardFace } from './widgets';
import './costView.css';

export type Cost = Partial<Record<Resource, number>>;

/** Cards of `cost` that `hand` does not cover (empty when it does, or without a hand). */
export function missingCards(cost: Cost, hand: ResourceCounts | null | undefined): Cost {
  const out: Cost = {};
  if (!hand) return out;
  for (const r of RESOURCES) {
    const short = (cost[r] ?? 0) - hand[r];
    if (short > 0) out[r] = short;
  }
  return out;
}

/** "1 brick, 1 lumber" (empty cost: "free"). */
export function costLabel(cost: Cost): string {
  const parts = RESOURCES.flatMap((r) => ((cost[r] ?? 0) > 0 ? [`${cost[r]} ${r}`] : []));
  return parts.length > 0 ? parts.join(', ') : 'free';
}

/**
 * One face per card of `cost`, in resource order; with a `hand`, the cards it lacks are marked
 * missing (the last ones of each resource).
 */
export function costCards(cost: Cost, hand: ResourceCounts | null = null, size = 18): HTMLElement {
  const missing = missingCards(cost, hand);
  return h(
    'span',
    { class: 'cost-cards', attrs: { role: 'img', 'aria-label': `Cost: ${costLabel(cost)}` } },
    ...RESOURCES.flatMap((r) => {
      const n = cost[r] ?? 0;
      const short = missing[r] ?? 0;
      return Array.from({ length: n }, (_, i) => {
        const face = resCardFace(r, size);
        if (i >= n - short) face.classList.add('is-missing');
        return face;
      });
    }),
  );
}

/**
 * The tooltip body: title, the cost row and either "You have everything" or what is missing,
 * then any `extra` lines (why a disabled button cannot be used).
 */
export function costTip(
  title: string,
  cost: Cost | null,
  hand: ResourceCounts | null,
  extra: Child[] = [],
): HTMLElement {
  const missing = cost ? missingCards(cost, hand) : {};
  const short = Object.keys(missing).length > 0;
  return h(
    'span',
    { class: 'why cost-tip', attrs: { role: 'tooltip' } },
    h('b', {}, title),
    cost &&
      h(
        'span',
        { class: 'why-line cost-line' },
        h('span', { class: 'cost-head' }, 'Cost'),
        costCards(cost, hand),
      ),
    cost &&
      hand &&
      h(
        'span',
        { class: `why-line cost-have${short ? ' is-short' : ''}` },
        short ? `Missing ${costLabel(missing)}` : 'You have the cards',
        short && costCards(missing, null, 14),
      ),
    ...extra,
  );
}
