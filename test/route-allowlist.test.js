// test/route-allowlist.test.js — the guest / hub route allowlists are DENY BY DEFAULT, and they cannot drift from the router.
//
// Enforcement model (utils/mimicLink.js requireAgentAuth): a guest session, a hub session and a player session are each
// checked against an exact-path allowlist (GUEST_ALLOWED_ROUTES, FREE_ROUTES / PAID_HUB_ROUTES) BEFORE any handler runs.
// Anything not listed answers 403. So a route added to index.js later is refused to those sessions until someone lists it.
// This test pins that: it parses every /api route the bot's router registers and checks that
//   1. no route outside the lists is reachable for a guest or a hub session (any method, with a query, with a suffix);
//   2. every route on a list still exists in the router (a stale entry fails here);
//   3. a route that does not exist yet is refused by default;
//   4. the lists hold exactly what hub/guest sessions legitimately use today (a widened list is a visible diff here).
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { BOT_INDEX, readSource, stripJs } from './_source-slice.js';

const nodeRequire = createRequire(BOT_INDEX);
const mimicLink = nodeRequire('./utils/mimicLink');

const SRC = stripJs(readSource(BOT_INDEX));

// Every /api path the HTTP router matches: `req.url === '/api/..'` (exact) and `req.url.startsWith('/api/..')` (prefix).
function routerPaths() {
  const out = new Map();   // path → 'exact' | 'prefix'
  for (const m of SRC.matchAll(/req\.url\s*===\s*'(\/api\/[^'?]+)'/g)) if (!out.has(m[1])) out.set(m[1], 'exact');
  for (const m of SRC.matchAll(/req\.url\.startsWith\('(\/api\/[^']+)'\)/g)) out.set(m[1], 'prefix');
  return out;
}
const ROUTES = routerPaths();
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

// The URLs a request could use to reach a route: the path, with a query, and (for a prefix route) with a suffix.
function variants(p, kind) {
  const v = [p, `${p}?x=1`];
  if (kind === 'prefix') v.push(`${p}x`, `${p}/x`);
  return v;
}

const GUEST = new Set(mimicLink.GUEST_ALLOWED_ROUTES.map(([m, p]) => `${m} ${p}`));
const HUB = new Set(mimicLink.PAID_HUB_ROUTES.map(([m, p]) => `${m} ${p}`));

describe('route allowlists are deny by default', () => {
  it('the parser finds the router (guards against the regexes silently matching nothing)', () => {
    expect(ROUTES.size).toBeGreaterThan(60);
    expect(ROUTES.has('/api/agent/encounter')).toBe(true);
    expect(ROUTES.has('/api/agent/poll')).toBe(true);
  });

  it('a guest session reaches only its allowlisted routes', () => {
    for (const [p, kind] of ROUTES) {
      for (const method of METHODS) {
        for (const url of variants(p, kind)) {
          const path = url.split('?')[0];
          const expected = GUEST.has(`${method} ${path}`);
          expect(mimicLink.guestRouteAllowed(method, url), `${method} ${url}`).toBe(expected);
        }
      }
    }
  });

  it('a hub or player session reaches only its allowlisted routes', () => {
    for (const [p, kind] of ROUTES) {
      for (const method of METHODS) {
        for (const url of variants(p, kind)) {
          const path = url.split('?')[0];
          const expected = HUB.has(`${method} ${path}`);
          expect(mimicLink.hubRouteAllowed(method, url), `${method} ${url}`).toBe(expected);
        }
      }
    }
  });

  it('a route added later is refused to guest and hub sessions until it is listed', () => {
    for (const url of ['/api/agent/brand-new-route', '/api/agent/', '/api/admin/anything', '/api/web/wishlist', '/api/agent/encounter/../bosskill', '/api/agent/ENCOUNTER']) {
      for (const method of METHODS) {
        expect(mimicLink.guestRouteAllowed(method, url), `guest ${method} ${url}`).toBe(false);
        expect(mimicLink.hubRouteAllowed(method, url), `hub ${method} ${url}`).toBe(false);
      }
    }
  });

  it('the free hub list is a subset of the hub list, and the hub list adds only the parse upload', () => {
    const free = new Set(mimicLink.FREE_ROUTES.map(([m, p]) => `${m} ${p}`));
    for (const r of free) expect(HUB.has(r)).toBe(true);
    expect([...HUB].filter((r) => !free.has(r))).toEqual(['POST /api/agent/encounter']);
  });

  it('every listed route still exists in the router (no stale entries)', () => {
    const all = new Set([...GUEST, ...HUB]);
    for (const entry of all) {
      const p = entry.split(' ')[1];
      const hit = [...ROUTES].some(([rp, kind]) => (kind === 'exact' ? rp === p : p.startsWith(rp)));
      expect(hit, `${entry} is allowlisted but the router has no such route`).toBe(true);
    }
  });

  it('the lists hold exactly what guest and hub sessions use today', () => {
    expect([...GUEST].sort()).toEqual([
      'GET /api/agent/latest-version',
      'GET /api/agent/poll',
      'POST /api/agent/encounter',
    ]);
    expect([...HUB].sort()).toEqual([
      'GET /api/agent/latest-version',
      'GET /api/agent/poll',
      'POST /api/agent/encounter',
      'POST /api/agent/pop_flags',
      'POST /api/mimic-link/poll',
      'POST /api/mimic-link/revoke',
      'POST /api/mimic-link/start',
    ]);
  });
});
