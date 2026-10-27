import { describe, expect, it } from 'vitest';
import { onlineOutcome, outcomeHeadline } from './outcome';

const scan = (sent: number, seq: number | null, errors: { n: number; message: string }[] = []) => ({
  sent,
  seq,
  errors: errors.map((e) => ({ ...e, code: 'illegal' })),
});

describe('onlineOutcome', () => {
  it('no move sent: a screen-only click', () => {
    expect(onlineOutcome(scan(3, 10), scan(3, 11))).toEqual({ kind: 'local' });
  });

  it('sent and a new game state arrived: applied', () => {
    expect(onlineOutcome(scan(3, 10), scan(4, 11))).toEqual({ kind: 'applied', from: 10, to: 11 });
  });

  it('sent, no new state yet: pending', () => {
    expect(onlineOutcome(scan(3, 10), scan(4, 10))).toEqual({ kind: 'pending' });
  });

  it('a new server error after the send wins over a seq change', () => {
    const before = scan(3, 10, [{ n: 1, message: 'old' }]);
    const after = scan(4, 11, [
      { n: 1, message: 'old' },
      { n: 2, message: 'Not your turn' },
    ]);
    expect(onlineOutcome(before, after)).toEqual({
      kind: 'refused',
      code: 'illegal',
      message: 'Not your turn',
    });
  });

  it('an old error is not this click', () => {
    const errs = [{ n: 1, message: 'old' }];
    expect(onlineOutcome(scan(3, 10, errs), scan(4, 11, errs)).kind).toBe('applied');
  });
});

describe('outcomeHeadline', () => {
  it('says plainly what happened', () => {
    expect(outcomeHeadline(null, 'clicked [Roll dice]', 15)).toBe('OK: clicked [Roll dice]');
    expect(outcomeHeadline({ kind: 'applied', from: 1, to: 2 }, 'clicked [X]', 15)).toMatch(
      /^OK: .*server applied it \(game seq 1 -> 2\)/,
    );
    expect(
      outcomeHeadline({ kind: 'refused', code: 'stale', message: 'Too late' }, 'clicked [X]', 15),
    ).toMatch(/^REFUSED BY THE SERVER: .*"Too late"/);
    expect(outcomeHeadline({ kind: 'pending' }, 'clicked [X]', 15)).toMatch(
      /^SENT, NO ANSWER YET: .*within 15 s.*Do NOT click again/,
    );
  });
});
