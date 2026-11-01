// test/raidmimic-beta-host.test.js — b.raidmimic.com (the guild lead, 2026-11-01: "b.raidmimic.com should also exist",
// like b.wolfpack.quest). The Vercel domain is pinned to the beta branch; in code it is a raidmimic host (landing page,
// bare shell, sign-in paths) that is NEVER indexed, and its robots.txt disallows everything.
//
// Run: npx vitest run test/raidmimic-beta-host.test.js

import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs } from './_source-slice.js';
import {
  RAIDMIMIC_HOSTS, RAIDMIMIC_INDEXED_HOSTS, isRaidmimicHost, isRaidmimicBetaHost, isRaidmimicOrigin, raidmimicSeo, raidmimicLandingTarget,
} from '../web/lib/raidmimicHost.ts';
import { isEqmimicHost } from '../web/lib/eqmimicHost.ts';

const code = (rel) => stripJs(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const noindex = { robots: { index: false, follow: false } };

describe('b.raidmimic.com is a raidmimic host', () => {
  it('is in the host list, any case or port, and an origin the sign-in callback treats as raidmimic', () => {
    expect(RAIDMIMIC_HOSTS).toContain('b.raidmimic.com');
    for (const h of ['b.raidmimic.com', 'B.RaidMimic.COM', 'b.raidmimic.com:443']) expect(isRaidmimicHost(h), h).toBe(true);
    expect(isRaidmimicOrigin('https://b.raidmimic.com')).toBe(true);
    expect(isEqmimicHost('b.raidmimic.com')).toBe(false);
  });
  it('only that exact beta host: no other subdomain, no lookalike', () => {
    for (const h of ['c.raidmimic.com', 'b.www.raidmimic.com', 'b.raidmimic.com.evil.com', 'xb.raidmimic.com', 'b.raidmimic.net']) expect(isRaidmimicHost(h), h).toBe(false);
    expect(isRaidmimicBetaHost('b.raidmimic.com')).toBe(true);
    for (const h of ['raidmimic.com', 'www.raidmimic.com', 'b.wolfpack.quest', '', null, undefined]) expect(isRaidmimicBetaHost(h), String(h)).toBe(false);
  });
  it('is not in the indexed list', () => {
    expect(RAIDMIMIC_INDEXED_HOSTS).not.toContain('b.raidmimic.com');
  });
});

describe('b.raidmimic.com is never indexed', () => {
  afterEach(() => { delete process.env.NEXT_PUBLIC_IS_BETA; });
  it('raidmimicSeo is noindex/nofollow with no canonical, for every page, even on a build that is not the beta build', () => {
    expect(process.env.NEXT_PUBLIC_IS_BETA).not.toBe('1');
    for (const p of ['/', '/setup', '/register']) {
      expect(raidmimicSeo('b.raidmimic.com', p), p).toEqual(noindex);
      expect(raidmimicSeo('B.RAIDMIMIC.COM:443', p), p).toEqual(noindex);
    }
  });
  it('the apex hosts are still indexed with raidmimic.com as canonical', () => {
    expect(raidmimicSeo('raidmimic.com', '/')).toEqual({ robots: { index: true, follow: true }, alternates: { canonical: 'https://raidmimic.com/' } });
  });
  it('robots.txt on b.raidmimic.com disallows all and names no sitemap; the other hosts are unchanged', async () => {
    const { GET } = await import('../web/app/raidmimic/robots.txt/route.ts');
    const beta = await GET(new Request('https://b.raidmimic.com/robots.txt', { headers: { host: 'b.raidmimic.com' } })).text();
    expect(beta).toBe('User-agent: *\nDisallow: /\n');
    expect(beta).not.toMatch(/Allow:|Sitemap/);
    for (const h of ['raidmimic.com', 'www.raidmimic.net']) {
      const body = await GET(new Request(`https://${h}/robots.txt`, { headers: { host: h } })).text();
      expect(body, h).toBe('User-agent: *\nAllow: /\n\nSitemap: https://raidmimic.com/sitemap.xml\n');
    }
    expect(await GET(new Request('https://raidmimic.com/robots.txt', { headers: { host: 'raidmimic.com' } })).text()).toMatch(/^User-agent: \*\nAllow: \/\n/);
  });
});

describe('the middleware serves it like a raidmimic host', () => {
  function fakeNextServer() {
    class NextRequest {
      constructor(url, init = {}) {
        const nu = new URL(url);
        nu.clone = () => new URL(nu.href);
        this.url = url; this.method = init.method || 'GET';
        this.headers = new Headers(init.headers || {}); this.nextUrl = nu;
      }
    }
    const res = (h) => ({ headers: new Headers(h) });
    return { NextRequest, NextResponse: { next: () => res({ 'x-middleware-next': '1' }), rewrite: (u) => res({ 'x-middleware-rewrite': String(u) }) } };
  }
  async function run(url) {
    vi.resetModules();
    process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://example.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= 'anon-test-key';
    const fake = fakeNextServer();
    vi.doMock('next/server', () => fake);
    vi.doMock('@supabase/ssr', () => ({ createServerClient: () => { throw new Error('a front-door branch must not build a session client'); } }));
    const { middleware } = await import('../web/middleware.ts');
    const res = await middleware(new fake.NextRequest(url, { headers: { host: new URL(url).host } }), { waitUntil() {} });
    const to = res.headers.get('x-middleware-rewrite');
    return to ? new URL(to) : null;
  }
  it('/ and anything else -> the landing page, /setup and /register -> their pages, /robots.txt -> the robots file; query dropped', async () => {
    for (const [u, p] of [
      ['https://b.raidmimic.com/?v=b', '/raidmimic'], ['https://b.raidmimic.com/me?x=1', '/raidmimic'],
      ['https://b.raidmimic.com/setup?x=1', '/raidmimic/setup'], ['https://b.raidmimic.com/register?x=1', '/raidmimic/register'],
      ['https://b.raidmimic.com/robots.txt', '/raidmimic/robots.txt'],
    ]) {
      const to = await run(u);
      expect(to.pathname, u).toBe(p);
      expect(to.search, u).toBe('');
    }
    expect(raidmimicLandingTarget('/register').pathname).toBe('/raidmimic/register');
  });
  it('the layout gives it the bare shell through the same helper (no second host list anywhere)', () => {
    expect(code('web/app/layout.tsx')).toMatch(/isRaidmimicHost\(headers\(\)\.get\('host'\)\)/);
    for (const f of ['web/middleware.ts', 'web/app/auth/callback/route.ts', 'web/app/layout.tsx']) {
      expect(code(f), f).not.toMatch(/raidmimic\.(com|net|quest)'/);
    }
  });
});
