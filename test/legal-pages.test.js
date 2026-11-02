// test/legal-pages.test.js — the pre-launch legal pages (the guild lead's checklist, 2026-11-01).
//
// What is pinned:
//   - web/lib/legal.ts: the contact address, the terms version and date, the minimum age, and where the pages live per host;
//   - the three Raid Mimic pages (privacy, terms, refunds) and wolfpack.quest/terms exist, name themselves (the tab AND the
//     Discord card, web/lib/pageMeta.ts), and are served on the raidmimic hosts by the REAL middleware;
//   - the words that must be there ("coming" for payments and self-serve delete, the AI-training promise, the age floor) and
//     the words that must NOT be (a governing-law or venue clause, placeholder text);
//   - the terms-acceptance record: the migration (RLS on, no policies, the key), the helper (fail-open, one row per version),
//     and both sign-in callbacks calling it after the session is good and without letting its result gate sign-in;
//   - the agreement line next to every sign-up button on the raidmimic surfaces, the "Animated with AI tools" label, the
//     renewal line under the Pro Guild price, the footer links, the sitemap.
//
// Source-text assertions run over COMMENT-STRIPPED source (CLAUDE.md "comments satisfy text assertions"); behaviour is run, not
// read, wherever it can be. Root tests must not need react or next (DECISIONS §501), so pages are read as text.
//
// Run: npx vitest run test/legal-pages.test.js

import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs, stripSql } from './_source-slice.js';
import * as L from '../web/lib/legal.ts';
import { metaForPath } from '../web/lib/pageMeta.ts';
import { recordTermsAcceptance, termsAcceptanceRow } from '../web/lib/termsAcceptance.ts';
import { raidmimicLandingTarget, raidmimicSeo } from '../web/lib/raidmimicHost.ts';
import { STORY_WORDS, GUILD_PRICE } from '../web/lib/raidmimicStory.ts';

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const code = (rel) => stripJs(read(rel));
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));

const PAGES = {
  privacy: 'web/app/raidmimic/privacy/page.tsx',
  terms: 'web/app/raidmimic/terms/page.tsx',
  refunds: 'web/app/raidmimic/refunds/page.tsx',
};
// Everything the three pages say, as one comment-stripped string (their shared frame included).
const legalText = () => [...Object.values(PAGES), 'web/app/raidmimic/_legal/LegalParts.tsx', 'web/lib/legal.ts'].map(code).join('\n');

afterEach(() => { vi.resetModules(); vi.unstubAllEnvs(); });

// ── 1. The shared facts ─────────────────────────────────────────────────────────────────────────────────────────
describe('web/lib/legal.ts', () => {
  it('the contact address, the terms version and date, and the minimum age', () => {
    expect(L.CONTACT_EMAIL).toBe('hello@raidmimic.com');
    expect(L.CONTACT_HREF).toBe('mailto:hello@raidmimic.com');
    expect(L.TERMS_VERSION).toBe('2026-11-01');
    expect(L.LEGAL_UPDATED).toBe('November 1, 2026');
    expect(L.MIN_AGE).toBe(13);
    // stay=1 (2026-11-02, redirect by default): /guilds sends a one-guild player to their guild's site, and "Your data" is the
    // page's own section, so the link must not be bounced.
    expect(L.YOUR_DATA_PATH).toBe('/guilds?stay=1#your-data');
  });
  it('the header says the address still has to be created (so nobody ships it believing it exists)', () => {
    expect(read('web/lib/legal.ts')).toMatch(/still has to CREATE/);
  });
  it('the legal pages are at the root of a raidmimic host and at their real paths on the Wolf Pack hosts; /terms is real on both', () => {
    expect(L.legalPaths(true)).toEqual({ home: '/', privacy: '/privacy', terms: '/terms', refunds: '/refunds' });
    expect(L.legalPaths(false)).toEqual({ home: '/raidmimic', privacy: '/raidmimic/privacy', terms: '/terms', refunds: '/raidmimic/refunds' });
  });
});

// ── 2. The pages exist and name themselves ──────────────────────────────────────────────────────────────────────
describe('the pages', () => {
  it.each(Object.entries(PAGES))('%s: a real page, a server component, metadata from the shared words, noindex off a raidmimic host', (name, rel) => {
    expect(exists(rel), rel).toBe(true);
    const src = code(rel);
    expect(src).not.toMatch(/['"]use client['"]/);
    expect(src).toMatch(/export function generateMetadata\(\)/);
    expect(src).toMatch(new RegExp(`LEGAL_META\\.${name}`));
    expect(src).toMatch(new RegExp(`raidmimicSeo\\(headers\\(\\)\\.get\\('host'\\), '/${name}'\\)`));
    expect(src).toMatch(/<LegalShell\b/);
  });
  it('each carries the [beta] tag (a NEW page ships live with it) in its title and through the shared frame', () => {
    for (const k of ['privacy', 'terms', 'refunds']) expect(L.LEGAL_META[k].title).toMatch(/^\[beta\] /);
    expect(code('web/app/raidmimic/_legal/LegalParts.tsx')).toMatch(/<NewPageTag\b/);
  });
  it('wolfpack.quest/terms is a real route that serves the same page, with its own generateMetadata', () => {
    expect(exists('web/app/terms/page.tsx')).toBe(true);
    const src = code('web/app/terms/page.tsx');
    expect(src).toMatch(/from '\.\.\/raidmimic\/terms\/page'/);
    expect(src).toMatch(/export function generateMetadata\(\)/);
    expect(src).toMatch(/export default Page/);
  });
  it('the Discord card (pageMeta) names every new route, with the same words as the tab', () => {
    const want = { '/raidmimic/privacy': 'privacy', '/raidmimic/terms': 'terms', '/raidmimic/refunds': 'refunds', '/terms': 'terms' };
    for (const [route, k] of Object.entries(want)) {
      const m = metaForPath(route);
      expect(m.title, route).toBe(L.LEGAL_META[k].title);
      expect(m.description, route).toBe(L.LEGAL_META[k].description);
      expect(m.title, route).not.toMatch(/^WolfPack\.quest/);
    }
  });
  it('indexed on the raidmimic hosts with raidmimic.com as canonical, noindex everywhere else', () => {
    for (const p of ['/privacy', '/terms', '/refunds']) {
      expect(raidmimicSeo('raidmimic.com', p)).toEqual({ robots: { index: true, follow: true }, alternates: { canonical: `https://raidmimic.com${p}` } });
      for (const h of ['wolfpack.quest', 'b.wolfpack.quest', 'b.raidmimic.com']) expect(raidmimicSeo(h, p), `${h}${p}`).toEqual({ robots: { index: false, follow: false } });
    }
  });
});

describe('what the pages must say', () => {
  it('privacy: who runs it and how to reach them, the guild owns its records, the subprocessors, no AI training, age, cookies, rights', () => {
    const src = code(PAGES.privacy);
    expect(src).toMatch(/CONTACT_EMAIL/);
    expect(src).toMatch(/Raid Mimic team/);
    for (const who of ['Supabase', 'Railway', 'Vercel', 'GitHub', 'Anthropic', 'Discord']) expect(src, who).toContain(who);
    expect(src).toMatch(/A guild owns its members’ raid records/);
    expect(src).toMatch(/never used to train AI models/i);
    expect(src).toMatch(/not for children under \{MIN_AGE\}/i);
    expect(src).toMatch(/No ads, no selling, no tracking scripts/);
    expect(src).toMatch(/sign-in cookie/);
    expect(src).toMatch(/How long we keep it/);
    expect(src).toMatch(/Never used to train AI models/);
  });
  it('privacy: download and delete yourself under Your data (shipped 2026-11-01), with email for the rest', () => {
    const src = code(PAGES.privacy);
    expect(src).toMatch(/Download and delete it yourself:<\/B> sign in and open/);
    expect(src).not.toMatch(/being built now/);
    expect(src).toMatch(/href=\{YOUR_DATA_PATH\}/);
    expect(src).toMatch(/Anything else/);
  });
  it('terms: free tier, Pro billing (monthly, renews, cancel in one click, keep Pro to the paid month’s end, payments coming), acceptable use, the fan-site notice, AGPL, lock-out, as-is, age', () => {
    const src = code(PAGES.terms);
    expect(src).toMatch(/Payments are coming\. Nothing is charged today/);
    expect(src).toMatch(/monthly only/i);
    expect(src).toMatch(/first month free/i);
    expect(src).toMatch(/renews every month until you cancel/i);
    expect(src).toMatch(/Cancel any time, in one click/);
    expect(src).toMatch(/keep Pro until the end of the month you have paid for/);
    expect(src).toMatch(/\$\{GUILD_PRICE\}/);
    expect(GUILD_PRICE).toBe(25);
    expect(src).toMatch(/What you must not do/);
    expect(src).toMatch(/Scrape the service/);
    expect(src).toMatch(/\{RIGHTS_NOTICE\}/);
    expect(src).toMatch(/AGPL-3\.0-or-later/);
    expect(src).toMatch(/lock an account out/);
    expect(src).toMatch(/as is and as available/);
    expect(src).toMatch(/\{MIN_AGE\}/);
    expect(src).toMatch(/TERMS_VERSION/);
  });
  it('terms: the fan-site notice is the SAME text the landing footer shows', async () => {
    const mod = await import('../web/lib/raidmimicLanding.ts');
    expect(mod.RIGHTS_NOTICE).toMatch(/registered trademark of Daybreak Game Company LLC/);
    expect(code(PAGES.terms)).toMatch(/import \{[^}]*RIGHTS_NOTICE[^}]*\} from '@\/lib\/raidmimicLanding'/);
  });
  it('refunds: payments are not live at the top, monthly only, first month free, cancel any time, 7 days if unused, how to ask', () => {
    const src = code(PAGES.refunds);
    expect(src.indexOf('Payments are not live yet.')).toBeGreaterThan(-1);
    expect(src.indexOf('Payments are not live yet.')).toBeLessThan(src.indexOf('How billing works'));
    expect(src).toMatch(/Monthly only/);
    expect(src).toMatch(/first month is free/);
    expect(src).toMatch(/Cancel any time, in one click/);
    expect(src).toMatch(/keep Pro until the end of the month you have paid for/);
    expect(src).toMatch(/Ask within 7 days of a charge/);
    expect(src).toMatch(/did not use Pro that month/);
    expect(src).toMatch(/CONTACT_EMAIL/);
  });
  it('NO governing-law, venue or jurisdiction clause on any page (that is a lawyer’s call), and no placeholder text', () => {
    const t = legalText();
    expect(t).not.toMatch(/governing law|governed by|jurisdiction|venue|courts? of|laws? of\b|arbitrat/i);
    expect(t).not.toMatch(/\bTODO\b|\bTBD\b|lorem ipsum|\[insert|\bXXX+\b|your (company|name) here|example\.com/i);
  });
  it('plain words: no page leans on a defined-term maze (no "hereinafter", "notwithstanding", "whereas")', () => {
    expect(legalText()).not.toMatch(/hereinafter|notwithstanding|whereas|heretofore/i);
  });
  it('payments are never described as live, and no payment processor is named before one exists', () => {
    const t = legalText();
    expect(t).not.toMatch(/\bStripe\b|\bPayPal\b|\bPaddle\b|checkout\.|billing portal/i);
    expect(code('web/lib/legal.ts')).not.toMatch(/stripe/i);
  });
});

// ── 3. Served on the raidmimic hosts by the real middleware ─────────────────────────────────────────────────────
describe('raidmimic hosts serve /privacy /terms /refunds', () => {
  it('the target function maps them (case, trailing slash and query are ignored) and nothing else changes', () => {
    expect(raidmimicLandingTarget('/privacy')).toEqual({ pathname: '/raidmimic/privacy', search: '' });
    expect(raidmimicLandingTarget('/Terms/')).toEqual({ pathname: '/raidmimic/terms', search: '' });
    expect(raidmimicLandingTarget('/refunds')).toEqual({ pathname: '/raidmimic/refunds', search: '' });
    expect(raidmimicLandingTarget('/setup').pathname).toBe('/raidmimic/setup');
    expect(raidmimicLandingTarget('/register').pathname).toBe('/raidmimic/register');
    expect(raidmimicLandingTarget('/privacy-policy').pathname).toBe('/raidmimic');
    expect(raidmimicLandingTarget('/privacy/x').pathname).toBe('/raidmimic');
    expect(raidmimicLandingTarget('/').pathname).toBe('/raidmimic');
  });

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
  it.each(['raidmimic.com', 'www.raidmimic.net', 'raidmimic.quest', 'b.raidmimic.com'])('%s: the real middleware rewrites the three paths to their pages and drops the query', async (h) => {
    for (const [p, want] of [['/privacy?utm=x', '/raidmimic/privacy'], ['/terms', '/raidmimic/terms'], ['/refunds/', '/raidmimic/refunds']]) {
      const to = await run(`https://${h}${p}`);
      expect(to, `${h}${p}`).not.toBeNull();
      expect(to.pathname, `${h}${p}`).toBe(want);
      expect(to.search, `${h}${p}`).toBe('');
    }
  });

  it('the sitemap lists them at their canonical addresses', async () => {
    const { GET } = await import('../web/app/raidmimic/sitemap.xml/route.ts');
    const xml = await GET().text();
    for (const p of ['/', '/setup', '/register', '/privacy', '/terms', '/refunds']) expect(xml).toContain(`<loc>https://raidmimic.com${p}</loc>`);
  });
});

// ── 4. The terms-acceptance record ──────────────────────────────────────────────────────────────────────────────
describe('the migration', () => {
  const sql = stripSql(read('supabase/migrations/20261101130000_terms_acceptances.sql'));
  it('creates public.terms_acceptances with the five columns and a (user_id, terms_version) key', () => {
    expect(sql).toMatch(/create table if not exists public\.terms_acceptances/i);
    expect(sql).toMatch(/user_id\s+uuid\s+not null/i);
    expect(sql).toMatch(/discord_id\s+text/i);
    expect(sql).toMatch(/terms_version\s+text\s+not null/i);
    expect(sql).toMatch(/accepted_at\s+timestamptz\s+not null default now\(\)/i);
    expect(sql).toMatch(/host\s+text/i);
    expect(sql).toMatch(/primary key \(user_id, terms_version\)/i);
  });
  it('RLS is on, there are NO policies, and anon/authenticated hold nothing', () => {
    expect(sql).toMatch(/alter table public\.terms_acceptances enable row level security/i);
    expect(sql).not.toMatch(/create policy|alter policy/i);
    expect(sql).toMatch(/revoke all on public\.terms_acceptances from anon, authenticated/i);
    expect(sql).not.toMatch(/\bgrant\b/i);
  });
  it('is idempotent (re-running it changes nothing)', () => {
    expect(sql).not.toMatch(/drop table|drop column/i);
    expect(sql.match(/create table/gi)).toHaveLength(1);
    expect(sql).toMatch(/if not exists/i);
  });
  it('the file name sorts after the migrations it was written against', () => {
    const names = fs.readdirSync(path.join(ROOT, 'supabase/migrations')).filter(f => f.endsWith('.sql')).sort();
    const at = names.indexOf('20261101130000_terms_acceptances.sql');
    expect(at).toBeGreaterThan(names.indexOf('20261101070000_guild_interest.sql'));
  });
});

describe('recordTermsAcceptance (run)', () => {
  const fakeAdmin = (impl) => {
    const calls = [];
    return { calls, from: (t) => ({ upsert: (row, opts) => { calls.push({ t, row, opts }); return impl(row, opts); } }) };
  };
  it('writes one row for (user, current version): the Discord id and the host, ON CONFLICT DO NOTHING', async () => {
    const a = fakeAdmin(async () => ({ error: null }));
    await recordTermsAcceptance(a, 'u-1', 'd-100', 'https://RaidMimic.com');
    expect(a.calls).toEqual([{
      t: 'terms_acceptances',
      row: { user_id: 'u-1', discord_id: 'd-100', terms_version: L.TERMS_VERSION, host: 'raidmimic.com' },
      opts: { onConflict: 'user_id,terms_version', ignoreDuplicates: true },
    }]);
  });
  it('FAILS OPEN: a thrown error, a rejected promise and a returned database error all resolve quietly', async () => {
    await expect(recordTermsAcceptance(fakeAdmin(() => { throw new Error('relation does not exist'); }), 'u', 'd', 'https://raidmimic.com')).resolves.toBeUndefined();
    await expect(recordTermsAcceptance(fakeAdmin(() => Promise.reject(new Error('down'))), 'u', 'd', 'https://raidmimic.com')).resolves.toBeUndefined();
    await expect(recordTermsAcceptance(fakeAdmin(async () => ({ error: { message: 'permission denied' } })), 'u', 'd', 'https://raidmimic.com')).resolves.toBeUndefined();
    await expect(recordTermsAcceptance({ from: () => { throw new Error('no client'); } }, 'u', 'd', 'https://raidmimic.com')).resolves.toBeUndefined();
  });
  it('a malformed origin is swallowed too (sign-in must never hang on a log row)', async () => {
    await expect(recordTermsAcceptance(fakeAdmin(async () => ({ error: null })), 'u', 'd', 'not a url')).resolves.toBeUndefined();
  });
  it('the row has no personal data beyond what the account already holds', () => {
    expect(Object.keys(termsAcceptanceRow('u', 'd', 'h.com')).sort()).toEqual(['discord_id', 'host', 'terms_version', 'user_id']);
    expect(termsAcceptanceRow('u', undefined, undefined)).toMatchObject({ discord_id: null, host: null });
  });
});

describe('both sign-in callbacks record it, after the session is good, and never let it gate sign-in', () => {
  const wolf = code('web/app/auth/callback/route.ts');
  const open = code('web/lib/openSignIn.ts');

  it('Wolf Pack callback: after the member upsert succeeded, before the final redirect, result ignored', () => {
    const call = wolf.indexOf('await recordTermsAcceptance(admin, data.session.user.id, member.user.id, origin);');
    expect(call).toBeGreaterThan(-1);
    expect(call).toBeGreaterThan(wolf.indexOf("from('wolfpack_members').upsert"));
    expect(call).toBeGreaterThan(wolf.indexOf('if (upsertError)'));
    expect(call).toBeLessThan(wolf.indexOf('return NextResponse.redirect(`${origin}${next}`);'));
    expect(wolf).toMatch(/import \{ recordTermsAcceptance \} from '\.\.\/\.\.\/\.\.\/lib\/termsAcceptance'/);
  });
  it('raidmimic callback: after the locked-out check and the player upsert, before either redirect, result ignored', () => {
    const call = open.indexOf('await recordTermsAcceptance(admin, user.id, discordId, origin);');
    expect(call).toBeGreaterThan(-1);
    expect(call).toBeGreaterThan(open.indexOf('if (await isLockedOut('));
    expect(call).toBeGreaterThan(open.indexOf("fail(origin, 'player_upsert: '"));
    expect(call).toBeLessThan(open.indexOf('FLOW_GUILDS) {'));
    expect(open).toMatch(/import \{ recordTermsAcceptance \} from '\.\/termsAcceptance'/);
  });
  it('neither call sits in a condition, an assignment or a signOut branch: it is a bare statement', () => {
    for (const [name, src] of [['wolf', wolf], ['open', open]]) {
      const line = src.split('\n').find(l => l.includes('recordTermsAcceptance(admin'));
      expect(line.trim(), name).toMatch(/^await recordTermsAcceptance\(/);
    }
  });
  it('the helper wraps its whole body in try/catch and the table is written with ignoreDuplicates', () => {
    const h = code('web/lib/termsAcceptance.ts');
    expect(h).toMatch(/try \{[\s\S]*terms_acceptances[\s\S]*\} catch/);
    expect(h).toMatch(/ignoreDuplicates: true/);
    expect(h).toMatch(/onConflict: 'user_id,terms_version'/);
  });

  // Run the real raidmimic callback end to end against a tiny fake database.
  function fakeDb({ terms = 'ok' } = {}) {
    const writes = [];
    return {
      writes,
      from(name) {
        const q = {};
        const b = {
          select: () => b, eq: () => b, is: () => b, in: () => b, not: () => b, limit: () => b,
          upsert: (payload, opts) => {
            if (name === 'terms_acceptances') {
              if (terms === 'throw') throw new Error('relation "terms_acceptances" does not exist');
              if (terms === 'error') return Promise.resolve({ error: { message: 'permission denied' } });
            }
            writes.push({ table: name, payload, opts });
            q.upserted = true;
            return b;
          },
          single: () => Promise.resolve({ data: { player_id: 'p1' }, error: null }),
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
          then: (res, rej) => Promise.resolve({ data: name === 'wolfpack_roles' ? [{ role_id: 'r-pack', name: 'Pack Member' }] : [], error: null }).then(res, rej),
        };
        return b;
      },
    };
  }
  async function load(db) {
    vi.resetModules();
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-test-key');
    vi.stubEnv('ALLOWED_ROLE_NAMES', 'Pack Member');
    const calls = { signOut: 0 };
    vi.doMock('next/server', () => ({ NextResponse: { redirect: (u) => ({ location: String(u) }) } }));
    vi.doMock('@supabase/supabase-js', () => ({ createClient: () => db }));
    vi.doMock('@/lib/supabase-server', () => ({
      supabaseServer: () => ({
        auth: {
          exchangeCodeForSession: async () => ({ data: { session: {
            provider_token: 'TOK',
            user: { id: 'auth-u1', user_metadata: { provider_id: 'd-100', custom_claims: { global_name: 'Aldenmar' } } },
          } }, error: null }),
          signOut: async () => { calls.signOut++; },
        },
      }),
    }));
    vi.doMock('@/lib/discord', () => ({
      fetchGuildMember: async () => ({ nick: 'Aldenmar', user: { id: 'd-100', global_name: 'Ald' }, roles: ['r-pack'], joined_at: '2026-01-01T00:00:00Z' }),
      memberAvatarUrl: () => null, memberDisplayName: (m) => m.nick, fetchUserGuilds: async () => [],
    }));
    vi.doMock('@/lib/lockout', () => ({ isLockedOut: async () => false }));
    vi.doMock('@/lib/request-origin', async () => await import('../web/lib/request-origin.ts'));
    vi.doMock('@/lib/raidmimicHost', async () => await import('../web/lib/raidmimicHost.ts'));
    vi.doMock('@/lib/hubRegistry', async () => await import('../web/lib/hubRegistry.ts'));
    vi.doMock('@/lib/openSignIn', async () => await import('../web/lib/openSignIn.ts'));
    vi.doMock('@/lib/landing', async () => await import('../web/lib/landing.ts'));
    return { GET: (await import('../web/app/auth/callback/route.ts')).GET, calls };
  }
  const req = (host) => ({ url: `https://${host}/auth/callback?code=abc&next=%2F`, headers: new Headers({ host }) });

  it.each([['raidmimic.com', 'https://raidmimic.com/guilds'], ['wolfpack.quest', 'https://wolfpack.quest/']])('%s: signing in writes the acceptance row for this terms version', async (host, landed) => {
    const db = fakeDb();
    const { GET, calls } = await load(db);
    const res = await GET(req(host));
    expect(res.location).toBe(landed);
    expect(calls.signOut).toBe(0);
    const w = db.writes.filter(x => x.table === 'terms_acceptances');
    expect(w).toHaveLength(1);
    expect(w[0].payload).toEqual({ user_id: 'auth-u1', discord_id: 'd-100', terms_version: L.TERMS_VERSION, host });
    expect(w[0].opts).toEqual({ onConflict: 'user_id,terms_version', ignoreDuplicates: true });
  });
  it.each([['raidmimic.com', 'https://raidmimic.com/guilds'], ['wolfpack.quest', 'https://wolfpack.quest/']])('%s: if the insert throws or errors, sign-in still completes (fail-open)', async (host, landed) => {
    for (const terms of ['throw', 'error']) {
      const { GET, calls } = await load(fakeDb({ terms }));
      const res = await GET(req(host));
      expect(res.location, `${host} ${terms}`).toBe(landed);
      expect(calls.signOut, `${host} ${terms}`).toBe(0);
    }
  });
});

// ── 5. The words next to the buttons and on the landing page ────────────────────────────────────────────────────
describe('the agreement line', () => {
  const agree = code('web/components/AgreeLine.tsx');
  it('reads "By signing up you agree to the Terms and the Privacy policy", both linked from the legal paths', () => {
    expect(agree).toMatch(/By signing up you agree to the <a href=\{p\.terms\}[^>]*>Terms<\/a> and the\{' '\}\s*<a href=\{privacy \?\? p\.privacy\}[^>]*>Privacy policy<\/a>/);
    expect(agree).toMatch(/legalPaths\(onHost\)/);
  });
  it('sits right under the sign-up button on the story stage’s end card', () => {
    const s = code('web/app/raidmimic/_landing/StoryStage.tsx');
    expect(s).toMatch(/label=\{W\.signUp\}[^\n]*\/><\/div>\s*<AgreeLine onHost=\{onHost\} \/>/);
    expect(s).toMatch(/import AgreeLine from '@\/components\/AgreeLine'/);
  });
  it('sits right under the Pro Guild sign-up button in the pricing tiles', () => {
    const s = code('web/app/raidmimic/_landing/StoryParts.tsx');
    expect(s).toMatch(/<SignUp className=\{`\$\{PRIMARY_BTN\} w-full`\} \/>\s*<AgreeLine onHost=\{onHost\} \/>/);
  });
  it('sits under the "Continue with Discord" button on the sign-in page: raidmimic host and Wolf Pack (pointing at Wolf Pack’s own /privacy)', () => {
    const s = code('web/app/auth/signin/page.tsx');
    expect(s).toMatch(/<SignInButton next=\{next\} \/>\s*<AgreeLine onHost \/>/);
    expect(s).toMatch(/<SignInButton next=\{next\} \/>\s*<AgreeLine onHost=\{false\} privacy="\/privacy" \/>/);
  });
  it('every SignInButton on a raidmimic landing/sign-in surface that says Sign up / Continue with Discord has the line near it', () => {
    for (const f of ['web/app/raidmimic/_landing/StoryStage.tsx', 'web/app/raidmimic/_landing/StoryParts.tsx', 'web/app/auth/signin/page.tsx']) {
      const s = code(f);
      expect(s, f).toMatch(/AgreeLine/);
    }
    expect(STORY_WORDS.signUp).toBe('Sign up with Discord');
  });
});

describe('the landing page additions', () => {
  it('"Animated with AI tools" is a quiet label in the video’s bottom row, not a button', () => {
    expect(STORY_WORDS.aiLabel).toBe('Animated with AI tools');
    const v = code('web/app/raidmimic/_landing/StoryVideo.tsx');
    expect(v).toMatch(/<span data-story-ai [^>]*>\{W\.aiLabel\}<\/span>/);
    expect(v.indexOf('data-story-ai')).toBeGreaterThan(v.indexOf('data-story-controls'));
  });
  it('under the Pro Guild price: "Renews monthly until you cancel · cancel any time · refunds", refunds linked to the refunds page', () => {
    expect(`${STORY_WORDS.renews} ${STORY_WORDS.refunds}`).toBe('Renews monthly until you cancel · cancel any time · refunds');
    const s = code('web/app/raidmimic/_landing/StoryParts.tsx');
    expect(s).toMatch(/\{t\.id === 'guild' && \(\s*<p data-renewal [^>]*>\{W\.renews\} <a href=\{legal\.refunds\}>\{W\.refunds\}<\/a><\/p>/);
    expect(s.indexOf('data-renewal')).toBeGreaterThan(s.indexOf('{t.note}'));
    expect(s.indexOf('data-renewal')).toBeLessThan(s.indexOf('t.points.map'));
  });
  it('the footer carries Privacy · Terms · Refunds · Contact, from the shared component, and the page passes the host through', () => {
    const f = code('web/app/raidmimic/_landing/Parts.tsx');
    expect(f).toMatch(/<LegalLinks onHost=\{onHost\} \/>/);
    expect(f).toMatch(/export function Footer\(\{ onHost = false \}/);
    const page = code('web/app/raidmimic/page.tsx');
    expect(page).toMatch(/<Footer onHost=\{onHost\} \/>/);
    expect(page).toMatch(/<Pricing setup=\{ctx\.setup\} onHost=\{onHost\} \/>/);
    const links = code('web/components/LegalLinks.tsx');
    expect(links).toMatch(/\['Privacy', p\.privacy\], \['Terms', p\.terms\], \['Refunds', p\.refunds\], \['Contact', CONTACT_HREF\]/);
  });
  it('the mailto lives in lib/legal.ts alone (no page hard-codes the address)', () => {
    for (const f of ['web/app/raidmimic/_landing/Parts.tsx', 'web/app/raidmimic/_landing/StoryParts.tsx', 'web/components/LegalLinks.tsx', ...Object.values(PAGES)]) {
      expect(code(f), f).not.toMatch(/@raidmimic\.com|mailto:/);
    }
  });
});

describe('the Wolf Pack privacy page gains three short lines and keeps its shape', () => {
  const p = code('web/app/privacy/page.tsx');
  it('not for children under 13, nothing used to train AI models, and the contact email', () => {
    expect(p).toMatch(/not for children under \{MIN_AGE\}/);
    expect(p).toMatch(/Nothing you upload is used to train AI models/);
    expect(p).toMatch(/href=\{CONTACT_HREF\}[^>]*>\{CONTACT_EMAIL\}/);
    expect(p).toMatch(/import \{ CONTACT_EMAIL, CONTACT_HREF, MIN_AGE \} from '@\/lib\/legal'/);
  });
  it('still the same sections in the same order (nothing restructured)', () => {
    const titles = [...p.matchAll(/<Section title="([^"]+)"/g)].map(m => m[1]);
    expect(titles.slice(0, 3)).toEqual(['The spirit', "What we can't promise yet", 'Is it a keylogger? Is it a virus?']);
    expect(titles).toContain('If your guild runs this');
  });
});
