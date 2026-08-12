// test/request-origin.test.js — auth redirects must follow the host the USER
// is on, not the server's own address.
//
// The bug this locks down (Unraid mirror, 2026-08-11): every redirect in
// app/auth/callback and app/auth/signout was built from
// `new URL(req.url).origin`, which Next resolves against the SERVER's listening
// address. On Vercel that is invisible because its proxy rewrites the request;
// on a container it is `http://localhost:3000`, so sign-in and sign-out both
// completed and then dumped the user onto localhost.
//
// Real-imports the pure lib (web/lib/request-origin.ts) with a minimal stub for
// the only thing it touches: `req.headers.get(...)` and `req.url`.

import { describe, it, expect } from 'vitest';
import { requestOrigin } from '../web/lib/request-origin.ts';

/** Minimal NextRequest stand-in: header bag + url. */
function req(headers, url = 'http://localhost:3000/auth/callback') {
  const lower = new Map(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]),
  );
  return { headers: { get: (k) => lower.get(k.toLowerCase()) ?? null }, url };
}

describe('requestOrigin', () => {
  it('uses the Host header when hit directly, NOT req.url', () => {
    // The regression: req.url says localhost, the user is on the LAN mirror.
    expect(requestOrigin(req({ host: '192.168.1.163:3000' }))).toBe(
      'http://192.168.1.163:3000',
    );
  });

  it('prefers x-forwarded-host over Host when a proxy is in front', () => {
    expect(
      requestOrigin(
        req({
          host: 'internal:3000',
          'x-forwarded-host': 'wolfpack.quest',
          'x-forwarded-proto': 'https',
        }),
      ),
    ).toBe('https://wolfpack.quest');
  });

  it('keeps the beta mirror on its own origin', () => {
    expect(
      requestOrigin(
        req({ 'x-forwarded-host': 'b.wolfpack.quest', 'x-forwarded-proto': 'https' }),
      ),
    ).toBe('https://b.wolfpack.quest');
  });

  it('takes the first proto when x-forwarded-proto is a list', () => {
    expect(
      requestOrigin(req({ host: 'wolfpack.quest', 'x-forwarded-proto': 'https, http' })),
    ).toBe('https://wolfpack.quest');
  });

  it('infers http for a bare IP with no proxy header (LAN has no cert)', () => {
    expect(requestOrigin(req({ host: '10.0.0.4:3000' }))).toBe('http://10.0.0.4:3000');
  });

  it('infers http for localhost', () => {
    expect(requestOrigin(req({ host: 'localhost:3000' }))).toBe('http://localhost:3000');
  });

  it('infers https for a real hostname with no proxy header', () => {
    expect(requestOrigin(req({ host: 'wolfpack.quest' }))).toBe('https://wolfpack.quest');
  });

  it('falls back to req.url only when there is no host header at all', () => {
    expect(requestOrigin(req({}, 'http://fallback.example:8080/x'))).toBe(
      'http://fallback.example:8080',
    );
  });
});
