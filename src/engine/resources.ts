import { DEV_CARD_TYPES, RESOURCES } from './constants';
import type { DevCardCounts, Resource, ResourceBundle, ResourceCounts } from './types';

export function emptyResources(): ResourceCounts {
  return { brick: 0, lumber: 0, wool: 0, grain: 0, ore: 0 };
}

export function emptyDevCards(): DevCardCounts {
  return { knight: 0, victoryPoint: 0, roadBuilding: 0, yearOfPlenty: 0, monopoly: 0 };
}

export function isResource(x: unknown): x is Resource {
  return typeof x === 'string' && (RESOURCES as readonly string[]).includes(x);
}

/** Bundle -> full counts. Throws nothing; non-numbers become NaN — use `isValidBundle` on untrusted input. */
export function toCounts(bundle: ResourceBundle): ResourceCounts {
  const out = emptyResources();
  for (const r of RESOURCES) out[r] = bundle[r] ?? 0;
  return out;
}

/** Validate an untrusted bundle: only resource keys, non-negative integers. */
export function isValidBundle(bundle: unknown): bundle is ResourceBundle {
  if (typeof bundle !== 'object' || bundle === null || Array.isArray(bundle)) return false;
  return Object.entries(bundle).every(
    ([k, v]) => isResource(k) && typeof v === 'number' && Number.isInteger(v) && v >= 0,
  );
}

export function addResources(a: ResourceCounts, b: ResourceBundle): ResourceCounts {
  const out = { ...a };
  for (const r of RESOURCES) out[r] += b[r] ?? 0;
  return out;
}

/** a - b. May go negative; check `hasResources` first. */
export function subtractResources(a: ResourceCounts, b: ResourceBundle): ResourceCounts {
  const out = { ...a };
  for (const r of RESOURCES) out[r] -= b[r] ?? 0;
  return out;
}

export function hasResources(have: ResourceCounts, need: ResourceBundle): boolean {
  return RESOURCES.every((r) => have[r] >= (need[r] ?? 0));
}

export function totalResources(counts: ResourceBundle): number {
  return RESOURCES.reduce((sum, r) => sum + (counts[r] ?? 0), 0);
}

export function totalDevCards(counts: DevCardCounts): number {
  return DEV_CARD_TYPES.reduce((sum, t) => sum + counts[t], 0);
}
