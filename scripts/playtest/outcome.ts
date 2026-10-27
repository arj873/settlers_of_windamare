/**
 * What an online click led to, from two scans of the page's RoomClient (before / after). Pure,
 * unit-tested; serve.ts polls until the outcome is no longer `pending` (or gives up).
 */
import type { OnlineScan } from './protocol';

export type Outcome =
  /** The click sent no move: a screen-only change (opened a dialog, picked a build mode...). */
  | { kind: 'local' }
  /** A move went out and the server answered with a new game state. */
  | { kind: 'applied'; from: number | null; to: number | null }
  /** A move went out and the server refused it. */
  | { kind: 'refused'; code: string; message: string }
  /** A move went out; no answer yet. */
  | { kind: 'pending' };

type Scan = Pick<OnlineScan, 'sent' | 'seq' | 'errors'>;

const lastError = (s: Scan) => s.errors.at(-1)?.n ?? 0;

export function onlineOutcome(before: Scan, after: Scan): Outcome {
  if (after.sent === before.sent) return { kind: 'local' };
  const err = after.errors.find((e) => e.n > lastError(before));
  if (err) return { kind: 'refused', code: err.code, message: err.message };
  if (after.seq !== before.seq) return { kind: 'applied', from: before.seq, to: after.seq };
  return { kind: 'pending' };
}

/** First line of an acting command's reply. */
export function outcomeHeadline(o: Outcome | null, did: string, waitedSec: number): string {
  if (!o || o.kind === 'local') return `OK: ${did}`;
  switch (o.kind) {
    case 'applied':
      return `OK: ${did}; the server applied it (game seq ${o.from ?? '-'} -> ${o.to ?? '-'}).`;
    case 'refused':
      return `REFUSED BY THE SERVER: ${did}, but the server answered "${o.message}" (${o.code}).`;
    case 'pending':
      return (
        `SENT, NO ANSWER YET: ${did}; the move went to the server but no new game state came ` +
        `back within ${waitedSec} s. Do NOT click again: run \`status\` (or \`wait\`) first, it may still apply.`
      );
  }
}
