import { describe, expect, it } from 'vitest';
import { onlineOptions, serveOptions, seatNames } from './options';

describe('serveOptions', () => {
  it('defaults to 3 human seats on a random board', () => {
    const o = serveOptions({}, 'pt-x');
    expect(o).toMatchObject({ seats: 3, map: null, seed: 'pt-x', vp: null, headed: false });
    if ('error' in o) throw new Error(o.error);
    expect(o.query).toEqual({
      seats: 'hhh',
      names: 'Seat1,Seat2,Seat3',
      seed: 'pt-x',
      layout: 'random',
      debug: '1',
    });
  });

  it('supports 3 to 8 seats and passes the map through', () => {
    const o = serveOptions({ seats: '6', map: 'base56', vp: '12', seed: 's', headed: '' }, 'x');
    if ('error' in o) throw new Error(o.error);
    expect(o.seats).toBe(6);
    expect(o.headed).toBe(true);
    expect(o.query).toMatchObject({ seats: 'hhhhhh', map: 'base56', vp: '12', seed: 's' });
    expect(o.query.names).toBe(seatNames(6).join(','));
    expect(o.query.layout).toBeUndefined();
  });

  it('maps base / baseRandom onto the layout param builds know today', () => {
    const base = serveOptions({ map: 'base' }, 'x');
    const rnd = serveOptions({ map: 'BASERANDOM' }, 'x');
    expect('query' in base && base.query).toMatchObject({ layout: 'beginner', map: 'base' });
    expect('query' in rnd && rnd.query).toMatchObject({ layout: 'random', map: 'baseRandom' });
  });

  it('rejects bad input with a message', () => {
    expect(serveOptions({ seats: '2' }, 'x')).toHaveProperty('error');
    expect(serveOptions({ seats: '9' }, 'x')).toHaveProperty('error');
    expect(serveOptions({ vp: '50' }, 'x')).toHaveProperty('error');
    expect(serveOptions({ timer: '2' }, 'x')).toHaveProperty('error');
    const timed = serveOptions({ timer: '30' }, 'x');
    expect('query' in timed && timed.query.timer).toBe('30');
    expect(serveOptions({ map: 'moon' }, 'x')).toHaveProperty('error');
  });
});

describe('onlineOptions', () => {
  const ok = (flags: Record<string, string>) => {
    const o = onlineOptions(flags);
    if ('error' in o) throw new Error(o.error);
    return o;
  };

  it('defaults to 3 humans, no bots, timer off, random base board', () => {
    expect(ok({})).toEqual({
      humans: 3,
      bots: 0,
      total: 3,
      map: 'baseRandom',
      timer: null,
      vp: null,
      headed: false,
      remote: null,
    });
  });

  it('adds bots to the seat count and picks a map that fits', () => {
    expect(ok({ seats: '2', bots: '1' })).toMatchObject({ total: 3, map: 'baseRandom' });
    expect(ok({ seats: '3', bots: '3' })).toMatchObject({ total: 6, map: 'base56' });
    expect(ok({ seats: '4', bots: '4' })).toMatchObject({ total: 8, map: 'base78' });
  });

  it('rejects tables the room would refuse', () => {
    expect(onlineOptions({ seats: '2' })).toHaveProperty('error');
    expect(onlineOptions({ seats: '4', bots: '1', map: 'base' })).toHaveProperty('error');
    expect(onlineOptions({ seats: '9' })).toHaveProperty('error');
    expect(onlineOptions({ timer: '20' })).toHaveProperty('error');
    expect(onlineOptions({ remote: 'ftp://x' })).toHaveProperty('error');
  });

  it('takes timer, vp, headed and a remote origin', () => {
    expect(
      ok({ seats: '3', timer: '60', vp: '5', headed: '', remote: 'http://x.dev:8787/a' }),
    ).toMatchObject({
      timer: 60,
      vp: 5,
      headed: true,
      remote: 'http://x.dev:8787',
    });
  });
});
