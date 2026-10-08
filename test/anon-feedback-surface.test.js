// test/anon-feedback-surface.test.js — the eqmimic.quest anonymous-feedback surface around the cleaner
// (the guild lead, 2026-10-08). The cleaner has its own behaviour tests; this file pins the rules that
// live in the page, the server action, the middleware and the migration:
//   - the prefill comes ONLY from the URL fragment (a query string reaches server logs before cleaning),
//   - the honeypot, the 5-an-hour rate limit, and "the raw text is never logged",
//   - eqmimic.quest serves the form and no Wolf Pack page, other hosts are untouched,
//   - the table is service-role only.
//
// Source-text assertions run over comment-stripped source (CLAUDE.md "comments satisfy text assertions").
// The middleware and the action's early exits are RUN, not just read.
//
// Run: npx vitest run test/anon-feedback-surface.test.js

import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ROOT, stripJs, stripSql } from './_source-slice.js';
import { isEqmimicHost, EQMIMIC_FEEDBACK_PATH } from '../web/lib/eqmimicHost.ts';

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const code = (rel) => stripJs(read(rel));

describe('prefill is fragment-only', () => {
  const form = code('web/app/eqmimic/feedback/AnonFeedbackForm.tsx');
  const page = code('web/app/eqmimic/feedback/page.tsx');

  it('reads window.location.hash and nothing from the query string', () => {
    expect(form).toMatch(/window\.location\.hash/);
    for (const src of [form, page]) {
      expect(src).not.toMatch(/searchParams/);
      expect(src).not.toMatch(/useSearchParams/);
      expect(src).not.toMatch(/location\.search/);
    }
  });
  it('the page takes no props, so nothing from the request can reach it', () => {
    expect(page).toMatch(/export default function EqmimicFeedbackPage\(\)/);
  });
  it('clears the fragment after reading it', () => {
    expect(form).toMatch(/history\.replaceState\(null, '', window\.location\.pathname\)/);
  });
  it('is neutral: no Wolf Pack name or link on the page or the form', () => {
    for (const rel of ['web/app/eqmimic/feedback/page.tsx', 'web/app/eqmimic/feedback/AnonFeedbackForm.tsx']) {
      expect(code(rel)).not.toMatch(/wolf\s*pack|wolfpack/i);
    }
  });
});

describe('server action', () => {
  const act = code('web/app/eqmimic/feedback/actions.ts');

  it('never logs: no console.* anywhere in the file', () => {
    expect(act).not.toMatch(/console\./);
  });
  it('cleans before the rate-limit read and before the insert', () => {
    const clean = act.indexOf('cleanAnonMessage(');
    const count = act.indexOf('.select(\'id\', { count');
    const insert = act.indexOf('.insert(');
    expect(clean).toBeGreaterThan(0);
    expect(count).toBeGreaterThan(clean);
    expect(insert).toBeGreaterThan(count);
  });
  it('stores the cleaned text, never the raw input', () => {
    expect(act).toMatch(/message: msg\.text/);
    expect(act).not.toMatch(/message: input\.message/);
  });
  it('rate limit: 5 an hour per ip_hash, counted over the last hour', () => {
    expect(act).toMatch(/const PER_HOUR = 5;/);
    expect(act).toMatch(/\.eq\('ip_hash', hash\)/);
    expect(act).toMatch(/\.gte\('submitted_at', since\)/);
    expect(act).toMatch(/Date\.now\(\) - 60 \* 60 \* 1000/);
    expect(act).toMatch(/\(count \?\? 0\) >= PER_HOUR/);
  });
  it('ip hash: sha256 of the first x-forwarded-for address plus a server secret, falling back to the demo salt', () => {
    expect(act).toMatch(/createHash\('sha256'\)/);
    expect(act).toMatch(/h\.get\('x-forwarded-for'\) \|\| ''\)\.split\(','\)\[0\]/);
    expect(act).toMatch(/process\.env\.ANON_FEEDBACK_SALT \|\| process\.env\.DEMO_OBFUSCATE_SALT/);
  });
  it('honeypot is the first thing checked', () => {
    const honey = act.indexOf('input?.website');
    expect(honey).toBeGreaterThan(0);
    expect(honey).toBeLessThan(act.indexOf('cleanAnonMessage('));
    expect(honey).toBeLessThan(act.indexOf('supabaseAdmin()'));
  });
  it('the form posts the honeypot and the page hides it from people', () => {
    const form = code('web/app/eqmimic/feedback/AnonFeedbackForm.tsx');
    expect(form).toMatch(/website,/);
    expect(form).toMatch(/tabIndex=\{-1\}/);
    expect(form).toMatch(/aria-hidden="true"/);
  });

  // Behaviour: the action runs for real, with the database and request headers mocked out. The
  // next/headers mock is keyed by the path the action's own import resolves to (web/node_modules).
  const ACTION = path.join(ROOT, 'web/app/eqmimic/feedback/actions.ts');
  async function loadAction(admin, hdrs = new Headers()) {
    vi.resetModules();
    const headersId = createRequire(ACTION).resolve('next/headers');
    vi.doMock('@/lib/supabase', () => ({ supabaseAdmin: admin }));
    vi.doMock('@/lib/anonFeedbackClean', async () => await import('../web/lib/anonFeedbackClean.ts'));
    vi.doMock(headersId, () => ({ headers: () => hdrs }));
    return await import('../web/app/eqmimic/feedback/actions.ts');
  }
  it('a filled honeypot is thanked and dropped without touching the database', async () => {
    const admin = vi.fn(() => { throw new Error('must not be reached'); });
    const { submitAnonFeedback } = await loadAction(admin);
    const r = await submitAnonFeedback({ category: 'bug', message: 'a perfectly fine long message here', website: 'http://spam.example' });
    expect(r).toEqual({ ok: true });
    expect(admin).not.toHaveBeenCalled();
  });
  it('a rejected message never reaches the database', async () => {
    const admin = vi.fn(() => { throw new Error('must not be reached'); });
    const { submitAnonFeedback } = await loadAction(admin);
    const r = await submitAnonFeedback({ category: 'bug', message: 'SELECT * FROM users' });
    expect(r.ok).toBe(false);
    expect(admin).not.toHaveBeenCalled();
    expect((await submitAnonFeedback({ category: 'praise', message: 'a perfectly fine long message here' })).ok).toBe(false);
  });
  it('the sixth report in an hour is refused, and a stored row carries only cleaned text', async () => {
    process.env.ANON_FEEDBACK_SALT = 'test-salt';
    let inserted = null;
    let counted = 5;
    let pruned = null;
    const chain = (final) => {
      const c = { select: () => c, eq: () => c, gte: () => Promise.resolve(final), insert: (rows) => { inserted = rows[0]; return c; }, single: () => Promise.resolve({ data: { ref: 12 }, error: null }),
        // The one-day prune of ip_hash runs on every save.
        update: (patch) => { pruned = patch; return c; }, lt: () => c, not: () => Promise.resolve({ error: null }) };
      return c;
    };
    const admin = () => ({ from: () => chain({ count: counted, error: null }) });
    const { submitAnonFeedback } = await loadAction(admin, new Headers({ 'x-forwarded-for': '203.0.113.9, 10.0.0.1' }));
    const msg = 'The overlay froze during the raid, see https://evil.example/x for the log, thanks a lot.';
    expect((await submitAnonFeedback({ category: 'bug', message: msg })).ok).toBe(false);
    expect(inserted).toBeNull();

    counted = 4;
    const ok = await submitAnonFeedback({ category: 'bug', message: msg, contact: 'Wolfie', client: 'mimic', appVersion: '2.7.10', platform: 'win32' });
    expect(ok).toEqual({ ok: true, ref: 12 });
    expect(inserted.message).not.toMatch(/evil|https?:/);
    expect(inserted).toMatchObject({ discord_contact: 'wolfie', client: 'mimic', app_version: '2.7.10', platform: 'win32' });
    expect(inserted.flags).toContain('url');
    expect(inserted.ip_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(pruned).toEqual({ ip_hash: null });
    expect(JSON.stringify(inserted)).not.toContain('203.0.113.9');
    // Off-shape self-reported strings are dropped, not stored.
    await submitAnonFeedback({ category: 'idea', message: msg, client: 'bot', appVersion: '1.0; drop', platform: 'WIN 32!' });
    expect(inserted).toMatchObject({ client: 'web', app_version: null, platform: null });
    delete process.env.ANON_FEEDBACK_SALT;
  });
});

describe('host routing', () => {
  it('knows the two hosts, with any case or port', () => {
    for (const h of ['eqmimic.quest', 'www.eqmimic.quest', 'EQMimic.Quest', 'eqmimic.quest:443']) expect(isEqmimicHost(h)).toBe(true);
    for (const h of ['wolfpack.quest', 'b.wolfpack.quest', 'eqmimic.quest.evil.com', 'evil-eqmimic.quest', 'localhost:3000', '', null, undefined]) expect(isEqmimicHost(h)).toBe(false);
  });

  const mw = code('web/middleware.ts');
  const host = mw.slice(mw.indexOf('isEqmimicHost(request'), mw.indexOf('PREVIEW_BOT_RX.test'));

  it('the eqmimic branch comes first and returns before any session work', () => {
    const at = mw.indexOf('isEqmimicHost(request.headers.get(\'host\'))');
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(mw.indexOf('PREVIEW_BOT_RX.test'));
    expect(at).toBeLessThan(mw.indexOf('createServerClient('));
    expect(host).toMatch(/NextResponse\.rewrite\(url\)/);
    expect(host).toMatch(/url\.pathname = EQMIMIC_FEEDBACK_PATH/);
    expect(host).toMatch(/url\.search = ''/);
  });
  it('the matcher still lets the eqmimic paths through', () => {
    const matcher = mw.slice(mw.indexOf('matcher:'));
    expect(matcher).toMatch(/_next\/static\|_next\/image\|favicon\.ico/);
    expect(matcher).not.toMatch(/eqmimic/);
    expect(matcher).not.toMatch(/\|api\b|\(\?!api/);
  });
  it('the layout drops the Wolf Pack chrome for the host, before the session lookup', () => {
    const layout = code('web/app/layout.tsx');
    const bare = layout.indexOf('isEqmimicHost(headers().get(\'host\'))');
    expect(bare).toBeGreaterThan(0);
    expect(bare).toBeLessThan(layout.indexOf('await getSessionUser()'));
    const branch = layout.slice(bare, layout.indexOf('await getSessionUser()'));
    expect(branch).not.toMatch(/SiteHeader|GlobalSearch|GuidedTour|AuthBadge|BetaBanner/);
  });

  // Behaviour: run the real middleware against real NextRequests.
  async function run(url, init = {}) {
    vi.resetModules();
    // The non-eqmimic path builds a Supabase client; with no auth cookie it never makes a call.
    process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://example.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= 'anon-test-key';
    const { NextRequest } = await import('../web/node_modules/next/server.js');
    const { middleware } = await import('../web/middleware.ts');
    const req = new NextRequest(url, init);
    return middleware(req, { waitUntil() {} });
  }
  const rewrittenTo = (res) => {
    const to = res.headers.get('x-middleware-rewrite');
    return to ? new URL(to) : null;
  };

  it('eqmimic.quest: / and /feedback rewrite to the form', async () => {
    for (const p of ['/', '/feedback']) {
      const res = await run('https://eqmimic.quest' + p, { headers: { host: 'eqmimic.quest' } });
      expect(rewrittenTo(res).pathname).toBe(EQMIMIC_FEEDBACK_PATH);
    }
  });
  it('eqmimic.quest: a Wolf Pack path, an admin path and an api path all land on the form, query dropped', async () => {
    for (const p of ['/admin/feedback', '/me', '/api/agent/chat', '/parses/123', '/auth/callback', '/eqmimic/other', '/boss/x']) {
      const res = await run('https://www.eqmimic.quest' + p + '?token=secret', { headers: { host: 'www.eqmimic.quest' } });
      const to = rewrittenTo(res);
      expect(to.pathname).toBe(EQMIMIC_FEEDBACK_PATH);
      expect(to.search).toBe('');
    }
  });
  it('eqmimic.quest: link-preview bots get the form, not the Wolf Pack embed card', async () => {
    const res = await run('https://eqmimic.quest/me', { headers: { host: 'eqmimic.quest', 'user-agent': 'Discordbot/2.0' } });
    expect(rewrittenTo(res).pathname).toBe(EQMIMIC_FEEDBACK_PATH);
  });
  it('eqmimic.quest: /_next assets pass through un-rewritten', async () => {
    const res = await run('https://eqmimic.quest/_next/static/chunks/app.js', { headers: { host: 'eqmimic.quest' } });
    expect(rewrittenTo(res)).toBeNull();
    expect(res.headers.get('x-middleware-next')).toBe('1');
  });
  it('wolfpack.quest keeps its behaviour: no rewrite to the form, and /eqmimic/feedback is reachable there', async () => {
    for (const p of ['/', '/feedback', '/eqmimic/feedback']) {
      const res = await run('https://wolfpack.quest' + p, { headers: { host: 'wolfpack.quest' } });
      expect(rewrittenTo(res)).toBeNull();
      expect(res.headers.get('x-middleware-next')).toBe('1');
    }
    // Link-preview bots on the main site still get the embed rewrite.
    const bot = await run('https://wolfpack.quest/me', { headers: { host: 'wolfpack.quest', 'user-agent': 'Discordbot/2.0' } });
    expect(rewrittenTo(bot).pathname).toBe('/api/embed-meta');
  });
});

describe('migration', () => {
  const sql = stripSql(read('supabase/migrations/20261008010000_anon_feedback.sql'));
  it('is idempotent and has its own sequence, separate from feedback', () => {
    expect(sql).toMatch(/create sequence if not exists public\.anon_feedback_ref_seq/);
    expect(sql).toMatch(/create table if not exists public\.anon_feedback/);
    expect(sql).toMatch(/create unique index if not exists anon_feedback_ref_key/);
    expect(sql).not.toMatch(/public\.feedback\b/);
    expect(sql).not.toMatch(/public\.feedback_ref_seq/);
  });
  it('is service-role only: RLS on, no policies, grants revoked', () => {
    expect(sql).toMatch(/enable row level security/);
    expect(sql).not.toMatch(/create policy/i);
    expect(sql).toMatch(/revoke all on public\.anon_feedback from anon, authenticated/);
  });
});

describe('officer view', () => {
  const page = code('web/app/admin/feedback/anonymous/page.tsx');
  it('is officer-gated in the page and in its action, and carries the beta marker', () => {
    expect(page).toMatch(/await requireOfficer\(\)/);
    expect(page).toMatch(/isOfficer\(user\.id\)/);
    expect(page).toMatch(/NewPageTag/);
    expect(page).toMatch(/\[beta\]/);
  });
  it('never reads the ip hash', () => {
    expect(page).not.toMatch(/ip_hash/);
  });
  it('is linked from /admin/feedback', () => {
    expect(code('web/app/admin/feedback/page.tsx')).toMatch(/href="\/admin\/feedback\/anonymous"/);
  });
});
