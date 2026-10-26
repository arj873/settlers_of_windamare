/**
 * Origin check for API calls and socket upgrades (cross-site WebSocket hijacking). Browsers
 * always send Origin on WebSocket upgrades and POSTs; a request without one is not from a web
 * page (curl, scripts) and gains nothing it could not do by forging the header, so it passes.
 */

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Allowed: no Origin; the same host as the request; one of `extra` (exact origins, e.g.
 * "https://example.com"); or any loopback origin when the server itself is on loopback
 * (`wrangler dev`, Vite on another port).
 */
export function originAllowed(origin: string | null, requestUrl: URL, extra: readonly string[]) {
  if (origin === null) return true;
  let o: URL;
  try {
    o = new URL(origin);
  } catch {
    return false; // includes the opaque "null" origin (sandboxed frames, file://)
  }
  if (o.protocol !== 'https:' && o.protocol !== 'http:') return false;
  if (o.host === requestUrl.host) return true;
  if (extra.includes(o.origin)) return true;
  return LOOPBACK.has(o.hostname) && LOOPBACK.has(requestUrl.hostname);
}

/** `ALLOWED_ORIGINS` var: comma or space separated origins. */
export function parseOrigins(raw: string | undefined): string[] {
  if (!raw) return [];
  const out: string[] = [];
  for (const part of raw.split(/[\s,]+/)) {
    if (!part) continue;
    try {
      out.push(new URL(part).origin);
    } catch {
      // ignore junk entries
    }
  }
  return out;
}
