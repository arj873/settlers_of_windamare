import { describe, expect, it } from 'vitest';
import type { CreateRoomResponse, RoomSummary } from '../net/api';
import { SERVER_LIMITS } from './limits';
import { roomFetch } from './room';
import { createRouter, IP_HEADER, type RouterDeps } from './router';
import { FakeRuntime } from './testRuntime';

const HOST = 'https://game.example';

/** Router wired to one FakeRuntime per room code (a fake Durable Object namespace). */
function setup(over: Partial<RouterDeps> = {}) {
  const rooms = new Map<string, FakeRuntime>();
  const calls: { code: string; url: string; ip: string | null }[] = [];
  let byte = 0;
  const deps: RouterDeps = {
    room: (code) => ({
      fetch: async (req) => {
        calls.push({ code, url: req.url, ip: req.headers.get(IP_HEADER) });
        let rt = rooms.get(code);
        if (!rt) {
          rt = new FakeRuntime();
          await rt.load();
          rooms.set(code, rt);
        }
        // Node's Response cannot carry status 101; 200 + a marker stands in for the upgrade.
        return roomFetch(rt.core, req, async (ip) => new Response(`upgraded ${ip}`));
      },
    }),
    assets: { fetch: async () => new Response('static') },
    allowedOrigins: [],
    randomBytes: (n) => Uint8Array.from({ length: n }, () => byte++),
    now: () => 0,
    ...over,
  };
  return { route: createRouter(deps), rooms, calls };
}

const req = (path: string, init: RequestInit = {}) => new Request(`${HOST}${path}`, init);
const upgrade = { headers: { upgrade: 'websocket' } };

describe('router', () => {
  it('POST /api/rooms creates a room with a 6-char code', async () => {
    const { route, rooms } = setup();
    const res = await route(req('/api/rooms', { method: 'POST' }));
    expect(res.status).toBe(201);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = (await res.json()) as CreateRoomResponse;
    expect(body.roomId).toBe('234567'); // bytes 0..5 -> alphabet[0..5]
    expect(body.hostToken).toMatch(/^[A-Za-z0-9_-]{16,128}$/);
    expect(rooms.get('234567')!.core.exists).toBe(true);
  });

  it('retries on a code collision, gives up after createAttempts', async () => {
    const { route, calls } = setup({ randomBytes: (n) => new Uint8Array(n) }); // always 222222
    expect((await route(req('/api/rooms', { method: 'POST' }))).status).toBe(201);
    const res = await route(req('/api/rooms', { method: 'POST' }));
    expect(res.status).toBe(503);
    expect(calls.filter((c) => c.url.endsWith('/create'))).toHaveLength(
      1 + SERVER_LIMITS.createAttempts,
    );

    let first = true;
    const flip = setup({
      randomBytes: (n) => {
        const b = new Uint8Array(n).fill(first ? 0 : 1);
        first = false;
        return b;
      },
    });
    const taken = new FakeRuntime();
    await taken.load();
    await taken.core.create('222222');
    flip.rooms.set('222222', taken);
    const ok = await flip.route(req('/api/rooms', { method: 'POST' }));
    expect(((await ok.json()) as CreateRoomResponse).roomId).toBe('333333');
  });

  it('GET /api/rooms/:code: case-insensitive, 404 for unknown or malformed codes', async () => {
    const { route, calls } = setup();
    const { roomId } = (await (
      await route(req('/api/rooms', { method: 'POST' }))
    ).json()) as CreateRoomResponse;
    const res = await route(req(`/api/rooms/${roomId.toLowerCase()}`));
    expect(res.status).toBe(200);
    expect((await res.json()) as RoomSummary).toEqual({
      roomId,
      phase: 'lobby',
      seats: 4,
      taken: 0,
      connected: 0,
    });
    expect((await route(req('/api/rooms/ZZZZZZ'))).status).toBe(404);
    const before = calls.length;
    for (const bad of ['ABC', 'ABCDE0', 'ABCDEO', 'ABCDE1', 'ABCDEI', 'ABCDEFG']) {
      expect((await route(req(`/api/rooms/${bad}`))).status).toBe(404);
    }
    expect(calls.length).toBe(before); // malformed codes never reach a Durable Object
  });

  it('WebSocket upgrade at /api/rooms/:code/ws and /ws/:code, with the client IP', async () => {
    const { route, calls } = setup();
    const { roomId } = (await (
      await route(req('/api/rooms', { method: 'POST' }))
    ).json()) as CreateRoomResponse;
    const ip = { 'cf-connecting-ip': '5.6.7.8', [IP_HEADER]: 'spoofed' };
    const a = await route(
      req(`/api/rooms/${roomId}/ws`, { headers: { ...upgrade.headers, ...ip } }),
    );
    expect(await a.text()).toBe('upgraded 5.6.7.8');
    expect(calls.at(-1)!.ip).toBe('5.6.7.8');
    const b = await route(req(`/ws/${roomId}`, upgrade));
    expect(await b.text()).toBe('upgraded unknown');
    expect((await route(req(`/api/rooms/${roomId}/ws`))).status).toBe(426);
    expect((await route(req('/api/rooms/ZZZZZZ/ws', upgrade))).status).toBe(404);
  });

  it('origin check: same host, loopback dev, ALLOWED_ORIGINS; others 403', async () => {
    const { route } = setup({ allowedOrigins: ['https://friend.example'] });
    const post = (origin: string) =>
      route(req('/api/rooms', { method: 'POST', headers: { origin } }));
    expect((await post(HOST)).status).toBe(201);
    expect((await post('https://friend.example')).status).toBe(201);
    expect((await post('https://evil.example')).status).toBe(403);
    expect((await post('null')).status).toBe(403);
    expect(
      (
        await route(
          req('/api/rooms/234567/ws', {
            headers: { ...upgrade.headers, origin: 'https://evil.example' },
          }),
        )
      ).status,
    ).toBe(403);
  });

  it('rate limits room creation per IP', async () => {
    const { route } = setup();
    const post = () =>
      route(req('/api/rooms', { method: 'POST', headers: { 'cf-connecting-ip': '7.7.7.7' } }));
    for (let i = 0; i < SERVER_LIMITS.create.burst; i++) expect((await post()).status).toBe(201);
    expect((await post()).status).toBe(429);
    const other = await route(
      req('/api/rooms', { method: 'POST', headers: { 'cf-connecting-ip': '8.8.8.8' } }),
    );
    expect(other.status).toBe(201);
  });

  it('methods, unknown API paths, static fallback', async () => {
    const { route } = setup();
    expect((await route(req('/api/rooms'))).status).toBe(405);
    expect((await route(req('/api/rooms/234567', { method: 'DELETE' }))).status).toBe(405);
    expect((await route(req('/api/nope'))).status).toBe(404);
    expect(await (await route(req('/room/234567'))).text()).toBe('static');
  });
});
