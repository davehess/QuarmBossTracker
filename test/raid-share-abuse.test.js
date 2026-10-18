// test/raid-share-abuse.test.js — a share link that LEAKS (the guild lead, 2026-10-17: "account for abusing views of
// the external sharing links"). Tokens are not guessable; the risk is a valid link that is posted, scraped or looped.
//
// What is held here:
//   1. LIMITER    a fixed-window per-IP limiter and a rolling per-share ceiling: they limit after N, reset, and cap
//                 their own memory.
//   2. GUARDS     the client IP is read in the order x-real-ip, x-forwarded-for first hop, 'unknown'; over the limit
//                 an API route answers 429 + Retry-After + noindex; the hourly ceiling is per share.
//   3. MEMO       resolveShare reads the database once for two lookups, remembers a miss briefly, forgets on
//                 invalidate, and never lets an expiry outlive its date.
//   4. VIEWS      noteView writes at most once per (IP, share) per 30 minutes.
//   5. SOURCE     every share route limits BEFORE it looks the token up, revoke clears the memo and the cache tag,
//                 heavy reads sit behind unstable_cache with the share tag, robots are told to stay out.
//
// Source assertions run on comment-stripped text (stripJs): this repo's comments explain exactly the behaviour
// under test, so a match on raw text would pass on the comment alone.
//
// Run: npx vitest run test/raid-share-abuse.test.js

import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs } from './_source-slice.js';
import { createLimiter, createCeiling } from '../web/lib/rateLimit.ts';
import {
  clientIp, guardApi, ceilingApi, guardPage, ceilingPage, API_PER_MIN, PAGE_PER_MIN, PAGE_PER_HOUR,
} from '../web/lib/shareGuard.ts';
import { resolveShare, invalidateShare, clearShareMemo, noteView, clearViewMemo } from '../web/lib/raidShareLookup.ts';
import { newToken } from '../web/lib/raidShare.ts';

const src = (...p) => stripJs(fs.readFileSync(path.join(ROOT, ...p), 'utf8'));
const MIN = 60_000;
const HOUR = 3_600_000;

// ── 1. LIMITER ───────────────────────────────────────────────────────────────────────────────────────────────
describe('the fixed-window limiter', () => {
  it('lets N through, then refuses with a Retry-After inside the window', () => {
    const l = createLimiter(3, MIN);
    const t = 1_000_000;
    expect([1, 2, 3].map(() => l.hit('a', t).ok)).toEqual([true, true, true]);
    const r = l.hit('a', t + 10_000);
    expect(r.ok).toBe(false);
    expect(r.retryAfter).toBe(50);
  });
  it('is per key', () => {
    const l = createLimiter(1, MIN);
    expect(l.hit('a', 0).ok).toBe(true);
    expect(l.hit('a', 1).ok).toBe(false);
    expect(l.hit('b', 1).ok).toBe(true);
  });
  it('resets once the window has passed', () => {
    const l = createLimiter(1, MIN);
    expect(l.hit('a', 0).ok).toBe(true);
    expect(l.hit('a', MIN - 1).ok).toBe(false);
    expect(l.hit('a', MIN).ok).toBe(true);
  });
  it('caps its map, so a flood of new keys cannot grow memory', () => {
    const l = createLimiter(5, MIN, 50);
    for (let i = 0; i < 500; i++) l.hit('k' + i, i);
    expect(l.size()).toBeLessThanOrEqual(50);
  });
});

describe('the rolling ceiling', () => {
  it('refuses past the max inside the hour and does not count the refusals', () => {
    const c = createCeiling(3);
    const t = 10 * HOUR;
    expect([1, 2, 3].map(() => c.hit('s', t).ok)).toEqual([true, true, true]);
    const r = c.hit('s', t + 1000);
    expect(r.ok).toBe(false);
    expect(r.retryAfter).toBeGreaterThan(0);
  });
  it('lets the count roll off after an hour', () => {
    const c = createCeiling(2);
    const t = 10 * HOUR;
    c.hit('s', t); c.hit('s', t);
    expect(c.hit('s', t + HOUR - 1000).ok).toBe(false);
    expect(c.hit('s', t + HOUR + 6 * MIN).ok).toBe(true);
  });
  it('is per share', () => {
    const c = createCeiling(1);
    expect(c.hit('a', 0).ok).toBe(true);
    expect(c.hit('a', 1).ok).toBe(false);
    expect(c.hit('b', 1).ok).toBe(true);
  });
  it('caps its map', () => {
    const c = createCeiling(5, HOUR, 40);
    for (let i = 0; i < 400; i++) c.hit('s' + i, i);
    expect(c.size()).toBeLessThanOrEqual(40);
  });
});

// ── 2. GUARDS ────────────────────────────────────────────────────────────────────────────────────────────────
describe('the share guards', () => {
  const req = (headers = {}) => new Request('https://wolfpack.quest/api/share/raid/x/replay', { headers });

  it('reads the client address from x-real-ip, then the first x-forwarded-for hop, then "unknown"', () => {
    expect(clientIp(new Headers({ 'x-real-ip': '1.1.1.1', 'x-forwarded-for': '2.2.2.2, 3.3.3.3' }))).toBe('1.1.1.1');
    expect(clientIp(new Headers({ 'x-forwarded-for': '2.2.2.2, 3.3.3.3' }))).toBe('2.2.2.2');
    expect(clientIp(new Headers())).toBe('unknown');
  });

  it('an API caller over the per-minute limit gets a 429 with Retry-After and noindex; another caller does not', async () => {
    const ip = '198.51.100.7';
    for (let i = 0; i < API_PER_MIN; i++) expect(guardApi(req({ 'x-real-ip': ip }))).toBeNull();
    const res = guardApi(req({ 'x-real-ip': ip }));
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect(res.headers.get('X-Robots-Tag')).toMatch(/noindex/);
    expect((await res.json()).error).toMatch(/busy/i);
    expect(guardApi(req({ 'x-real-ip': '198.51.100.8' }))).toBeNull();
  });

  it('the page limit is per IP per share', () => {
    const a = newToken(), b = newToken();
    const h = new Headers({ 'x-real-ip': '198.51.100.9' });
    for (let i = 0; i < PAGE_PER_MIN; i++) expect(guardPage(h, a).ok).toBe(true);
    expect(guardPage(h, a).ok).toBe(false);
    expect(guardPage(h, b).ok).toBe(true);
  });

  it('a share over its hourly page ceiling is refused, whoever asks', () => {
    for (let i = 0; i < PAGE_PER_HOUR; i++) expect(ceilingPage('share-page-ceiling').ok).toBe(true);
    expect(ceilingPage('share-page-ceiling').ok).toBe(false);
    expect(ceilingPage('another-share').ok).toBe(true);
  });

  it('the hourly API ceiling answers a calm 429 for that share only', async () => {
    let res = null;
    for (let i = 0; i < 20_001 && !res; i++) res = ceilingApi('share-api-ceiling');
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBeTruthy();
    expect(ceilingApi('a-different-share')).toBeNull();
  });
});

// ── a client that counts what it is asked ────────────────────────────────────────────────────────────────────
function countingDb(row) {
  const calls = { selects: 0, updates: [] };
  return {
    calls,
    from() {
      const b = {
        select() { calls.selects++; return b; },
        eq() { return b; },
        update(v) { calls.updates.push(v); return b; },
        maybeSingle() { return Promise.resolve({ data: row, error: null }); },
        then(res, rej) { return Promise.resolve({ data: null, error: null }).then(res, rej); },
      };
      return b;
    },
  };
}
const NOW = Date.parse('2026-10-20T00:00:00Z');
const shareRow = (over = {}) => ({
  id: 'id-1', guild_id: 'wolfpack', from_at: '2026-10-14T13:08:00.000Z', to_at: '2026-10-14T14:08:00.000Z', title: 't',
  created_at: '2026-10-15T00:00:00Z', expires_at: '2026-11-01T00:00:00Z', revoked_at: null, view_count: 0, ...over,
});

// ── 3. MEMO ──────────────────────────────────────────────────────────────────────────────────────────────────
describe('resolveShare is remembered per process', () => {
  beforeEach(() => clearShareMemo());

  it('two lookups inside the TTL cost one database read', async () => {
    const db = countingDb(shareRow());
    const t = newToken();
    expect(await resolveShare(db, t, NOW)).not.toBeNull();
    expect(await resolveShare(db, t, NOW + 59_000)).not.toBeNull();
    expect(db.calls.selects).toBe(1);
  });
  it('reads again once the 60 s TTL has passed', async () => {
    const db = countingDb(shareRow());
    const t = newToken();
    await resolveShare(db, t, NOW);
    await resolveShare(db, t, NOW + 61_000);
    expect(db.calls.selects).toBe(2);
  });
  it('a miss is remembered too, for about 30 s', async () => {
    const db = countingDb(null);
    const t = newToken();
    expect(await resolveShare(db, t, NOW)).toBeNull();
    expect(await resolveShare(db, t, NOW + 29_000)).toBeNull();
    expect(db.calls.selects).toBe(1);
    await resolveShare(db, t, NOW + 31_000);
    expect(db.calls.selects).toBe(2);
  });
  it('a malformed token never reaches the database or the memo', async () => {
    const db = countingDb(shareRow());
    expect(await resolveShare(db, 'nope', NOW)).toBeNull();
    expect(db.calls.selects).toBe(0);
  });
  it('invalidating a share by id forces a re-read (a revoke is seen at once on this instance)', async () => {
    const t = newToken();
    const live = countingDb(shareRow());
    expect(await resolveShare(live, t, NOW)).not.toBeNull();
    invalidateShare('id-1');
    const revoked = countingDb(shareRow({ revoked_at: '2026-10-19T00:00:00Z' }));
    expect(await resolveShare(revoked, t, NOW + 1000)).toBeNull();
    expect(revoked.calls.selects).toBe(1);
  });
  it('invalidating a different share leaves this one remembered', async () => {
    const db = countingDb(shareRow());
    const t = newToken();
    await resolveShare(db, t, NOW);
    invalidateShare('some-other-id');
    await resolveShare(db, t, NOW + 1000);
    expect(db.calls.selects).toBe(1);
  });
  it('a remembered share still expires on its date', async () => {
    const db = countingDb(shareRow({ expires_at: new Date(NOW + 30_000).toISOString() }));
    const t = newToken();
    expect(await resolveShare(db, t, NOW)).not.toBeNull();
    expect(await resolveShare(db, t, NOW + 40_000)).toBeNull();
    expect(db.calls.selects).toBe(1);
  });
});

// ── 4. VIEWS ─────────────────────────────────────────────────────────────────────────────────────────────────
describe('noteView counts one visitor once per half hour', () => {
  beforeEach(() => clearViewMemo());
  const GAP = 30 * MIN;

  it('writes the first view, skips the repeats inside 30 minutes, writes again after', async () => {
    const db = countingDb(null);
    const row = { id: 'v1', view_count: 4 };
    await noteView(db, row, '203.0.113.1', NOW);
    await noteView(db, row, '203.0.113.1', NOW + 5 * MIN);
    await noteView(db, row, '203.0.113.1', NOW + GAP - 1);
    expect(db.calls.updates).toEqual([{ view_count: 5 }]);
    await noteView(db, row, '203.0.113.1', NOW + GAP);
    expect(db.calls.updates).toEqual([{ view_count: 5 }, { view_count: 6 }]);
  });
  it('counts a different visitor, and a different share, separately', async () => {
    const db = countingDb(null);
    await noteView(db, { id: 'v2', view_count: 0 }, '203.0.113.2', NOW);
    await noteView(db, { id: 'v2', view_count: 1 }, '203.0.113.3', NOW);
    await noteView(db, { id: 'v3', view_count: 0 }, '203.0.113.2', NOW);
    expect(db.calls.updates.length).toBe(3);
  });
  it('two page loads racing in from one visitor write once', async () => {
    const db = countingDb(null);
    const row = { id: 'v4', view_count: 0 };
    await Promise.all([noteView(db, row, '203.0.113.4', NOW), noteView(db, row, '203.0.113.4', NOW)]);
    expect(db.calls.updates.length).toBe(1);
  });
});

// ── 5. SOURCE ────────────────────────────────────────────────────────────────────────────────────────────────
describe('the share routes are wired to the guards', () => {
  const routes = ['replay', 'bosses', 'map', 'mesh'].map(r => [r, src('web', 'app', 'api', 'share', 'raid', '[token]', r, 'route.ts')]);

  it.each(routes)('/%s limits the caller BEFORE it looks the token up, and checks the share ceiling after', (_n, s) => {
    const guard = s.indexOf('guardApi(req)');
    const look = s.indexOf('resolveShare(');
    const ceil = s.indexOf('ceilingApi(');
    expect(guard).toBeGreaterThan(-1);
    expect(look).toBeGreaterThan(guard);
    expect(ceil).toBeGreaterThan(look);
  });

  it('the page limits before the lookup and takes the ceiling after it', () => {
    const s = src('web', 'app', 'share', 'raid', '[token]', 'page.tsx');
    const guard = s.indexOf('guardPage(');
    const look = s.indexOf('resolveShare(');
    expect(guard).toBeGreaterThan(-1);
    expect(look).toBeGreaterThan(guard);
    expect(s.indexOf('ceilingPage(')).toBeGreaterThan(look);
    expect(s).toMatch(/noteView\(sb, share\.row, clientIp\(/);
  });

  it('revoking clears the process memo and revalidates the share tag', () => {
    const s = src('web', 'app', 'api', 'raid', 'shares', '[id]', 'route.ts');
    expect(s).toMatch(/invalidateShare\(params\.id\)/);
    expect(s).toMatch(/revalidateTag\(shareTag\(params\.id\)\)/);
  });

  it('the replay and bosses reads are kept across visitors, tagged by share, with the lookup outside', () => {
    for (const r of ['replay', 'bosses']) {
      const s = src('web', 'app', 'api', 'share', 'raid', '[token]', r, 'route.ts');
      expect(s).toMatch(/unstable_cache\(/);
      expect(s).toMatch(/tags: \[shareTag\(share\.row\.id\)\]/);
      expect(s).toMatch(/revalidate: SHARE_CACHE_S/);
      expect(s.indexOf('resolveShare(')).toBeLessThan(s.indexOf('unstable_cache('));
    }
  });

  it('robots.txt keeps crawlers out of /share/ and /api/, and the share responses carry noindex', () => {
    const r = src('web', 'app', 'robots.ts');
    expect(r).toMatch(/disallow: \['\/share\/', '\/api\/'\]/);
    const cfg = src('web', 'next.config.js');
    expect(cfg).toMatch(/source: '\/share\/:path\*'/);
    expect(cfg).toMatch(/source: '\/api\/share\/:path\*'/);
    expect(cfg).toMatch(/X-Robots-Tag/);
    expect(src('web', 'app', 'share', 'raid', '[token]', 'page.tsx')).toMatch(/robots: \{ index: false, follow: false/);
  });
});
