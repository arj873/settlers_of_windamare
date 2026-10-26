import { describe, expect, it } from 'vitest';
import { serveOptions, seatNames } from './options';

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
