// test/guild-interest.test.js — the "Register your guild" interest form on raidmimic.com/register
// (the guild lead, 2026-11-01, option B: "a proper interest form, no sign-in").
//
// What this pins:
//   - the validator (lib/guildInterest.ts), RUN: required name, the raiders range, nights a subset of the seven days, the
//     closed fields, the honeypot, and that the anonymous-feedback cleaner is applied to every free-text field,
//   - the server action, RUN with the database and headers mocked: the honeypot and a bad form never touch the database,
//     the hourly limit refuses the next one, the stored row carries cleaned text and a hash, never the address,
//   - the wiring around it (comment-stripped source text): the action's order, the limit, the migration (RLS on, no
//     policies, no guild_id), the page's metadata and pageMeta entry, the middleware path, the admin page and nav,
//   - interestUrl: every Register-interest link lands on the form, whichever host the page is read on.
//
// Source-text assertions run over comment-stripped source (CLAUDE.md "comments satisfy text assertions").
// Run: npx vitest run test/guild-interest.test.js

import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ROOT, stripJs, stripSql } from './_source-slice.js';
import * as G from '../web/lib/guildInterest.ts';
import { raidmimicLandingTarget, RAIDMIMIC_REGISTER_PATH, raidmimicSeo } from '../web/lib/raidmimicHost.ts';
import { interestUrl, EQMIMIC_FEEDBACK_PATH } from '../web/lib/raidmimicLanding.ts';
import { metaForPath, ADMIN_TITLES } from '../web/lib/pageMeta.ts';
import { NAV_GROUPS, groupLinks } from '../web/lib/adminNav.ts';

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const code = (rel) => stripJs(read(rel));

const GOOD = { guildName: 'Brackwyn Vanguard', game: 'quarm', raiders: 24, nights: ['wed', 'sun'], dkp: 'opendkp', heard: 'A friend told us', discord: 'Corvale' };

describe('validateInterest', () => {
  it('accepts a full form and returns the row the table takes, nights in week order', () => {
    const r = G.validateInterest(GOOD);
    expect(r.ok).toBe(true);
    expect(r.row).toEqual({
      guild_name: 'Brackwyn Vanguard', game: 'quarm', server: null, raiders: 24, nights: ['sun', 'wed'],
      tz: null, raid_start: null, raid_end: null, bid_mode: null,
      dkp: 'opendkp', heard: 'A friend told us', discord_contact: 'corvale',
    });
  });
  it('timezone, raid window and bid mode store when on-list and fall to null when not', () => {
    const full = G.validateInterest({ ...GOOD, tz: 'et', raidStart: '20:00', raidEnd: '00:30', bidMode: 'dkp-sealed' });
    expect(full.ok).toBe(true);
    expect([full.row.tz, full.row.raid_start, full.row.raid_end, full.row.bid_mode])
      .toEqual(['et', '20:00', '00:30', 'dkp-sealed']);
    // Off-list values from a tampered request never error the lead away and never store raw text.
    const junk = G.validateInterest({ ...GOOD, tz: 'Mars', raidStart: '20:15', raidEnd: 'late', bidMode: 'DROP TABLE' });
    expect(junk.ok).toBe(true);
    expect([junk.row.tz, junk.row.raid_start, junk.row.raid_end, junk.row.bid_mode]).toEqual([null, null, null, null]);
  });
  it('the closed lists carry the vocabulary the migration checks', () => {
    expect(G.TIMEZONES).toEqual(['et', 'ct', 'mt', 'pt', 'gmt-uk', 'eu-central', 'oceania', 'other']);
    expect(G.BID_MODES).toContain('dkp-sealed');
    expect(G.RAID_TIMES).toHaveLength(48);
    expect(G.RAID_TIMES).toContain('00:00');
    expect(G.RAID_TIMES).toContain('23:30');
    const mig = stripSql(read('supabase/migrations/20261103150000_guild_interest_detail.sql'));
    for (const z of G.TIMEZONES) expect(mig).toContain(`'${z}'`);
    for (const m of G.BID_MODES) expect(mig).toContain(`'${m}'`);
  });
  it('the guild name is required, and trimmed to 60', () => {
    for (const n of [undefined, null, '', '   ', 42, {}]) expect(G.validateInterest({ ...GOOD, guildName: n }).ok, String(n)).toBe(false);
    const long = G.validateInterest({ ...GOOD, guildName: 'Nyssara '.repeat(20) });
    expect(long.ok).toBe(true);
    expect(long.row.guild_name.length).toBeLessThanOrEqual(60);
    expect(G.validateInterest({ ...GOOD, guildName: 'Ro' }).ok).toBe(true);   // a short real name is not "too little left"
  });
  it('a name that is only a link or a code-like string is refused, not stored as [removed]', () => {
    for (const n of ['https://evil.example/x', 'SELECT * FROM users', '<script>alert(1)</script>', 'a@b.example']) {
      expect(G.validateInterest({ ...GOOD, guildName: n }).ok, n).toBe(false);
    }
  });
  it('raiders must be a whole number from 6 to 72', () => {
    expect([G.RAIDERS_MIN, G.RAIDERS_MAX]).toEqual([6, 72]);
    for (const n of [6, 24, 72, '40']) expect(G.validateInterest({ ...GOOD, raiders: n }).ok, String(n)).toBe(true);
    for (const n of [5, 73, 0, -1, 1.5, NaN, '', 'many', null, undefined]) expect(G.validateInterest({ ...GOOD, raiders: n }).ok, String(n)).toBe(false);
  });
  it('nights are a subset of the seven days; anything else is refused; none is fine; repeats fold', () => {
    expect(G.NIGHTS).toEqual(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']);
    expect(G.validateInterest({ ...GOOD, nights: [] }).row.nights).toEqual([]);
    expect(G.validateInterest({ ...GOOD, nights: undefined }).row.nights).toEqual([]);
    expect(G.validateInterest({ ...GOOD, nights: ['sat', 'sat', 'mon'] }).row.nights).toEqual(['mon', 'sat']);
    for (const bad of [['funday'], ['sun', 'x'], [1], ['SUN']]) expect(G.validateInterest({ ...GOOD, nights: bad }).ok, JSON.stringify(bad)).toBe(false);
    expect(G.validateInterest({ ...GOOD, nights: 'sun' }).row.nights).toEqual([]);   // not an array: no nights, never a crash
  });
  it('game, DKP tool: only the listed values are kept; the server text rides only with "other"', () => {
    expect(G.validateInterest({ ...GOOD, game: 'eq-live' }).row.game).toBe('eq-live');
    expect(G.validateInterest({ ...GOOD, game: 'warcraft' }).row.game).toBeNull();
    expect(G.validateInterest({ ...GOOD, game: 'quarm', server: 'Zebuxoruk' }).row.server).toBeNull();
    expect(G.validateInterest({ ...GOOD, game: 'other', server: 'Aldenmar Reach' }).row).toMatchObject({ game: 'other', server: 'Aldenmar Reach' });
    for (const d of ['opendkp', 'eqdkp', 'other', 'none']) expect(G.validateInterest({ ...GOOD, dkp: d }).row.dkp).toBe(d);
    expect(G.validateInterest({ ...GOOD, dkp: 'spreadsheet' }).row.dkp).toBeNull();
  });
  it('the cleaner runs on every free-text field: links, emails and addresses come out, the Discord name is validated', () => {
    const r = G.validateInterest({
      ...GOOD, game: 'other',
      server: 'see http://evil.example now', heard: 'from https://evil.example/post or mail me at rethlan@evil.example, ip 203.0.113.9',
      guildName: 'Zarrin Guard www.evil.example', discord: 'not a valid name!!',
    });
    expect(r.ok).toBe(true);
    const all = JSON.stringify(r.row);
    expect(all).not.toMatch(/evil|https?:|203\.0\.113|@/);
    expect(r.row.discord_contact).toBeNull();
    expect(r.row.guild_name).toContain('Zarrin Guard');
  });
  it('a filled honeypot is a bot: thanked, nothing returned to store', () => {
    expect(G.validateInterest({ ...GOOD, website: 'http://spam.example' })).toEqual({ ok: true, bot: true });
    expect(G.validateInterest({ ...GOOD, website: '   ' }).row).toBeTruthy();
  });
  it('null and non-object input never throws', () => {
    for (const x of [null, undefined, {}]) expect(G.validateInterest(x).ok).toBe(false);
  });
});

describe('the server action, run', () => {
  const ACTION = path.join(ROOT, 'web/app/raidmimic/register/actions.ts');
  async function loadAction(admin, hdrs = new Headers()) {
    vi.resetModules();
    vi.doMock('@/lib/supabase', () => ({ supabaseAdmin: admin }));
    vi.doMock('@/lib/guildInterest', async () => await import('../web/lib/guildInterest.ts'));
    vi.doMock('next/headers', () => ({ headers: () => hdrs }));
    try { vi.doMock(createRequire(ACTION).resolve('next/headers'), () => ({ headers: () => hdrs })); } catch { /* CI: no web/node_modules */ }
    return await import('../web/app/raidmimic/register/actions.ts');
  }

  it('a filled honeypot and an invalid form never reach the database', async () => {
    const admin = vi.fn(() => { throw new Error('must not be reached'); });
    const { submitGuildInterest } = await loadAction(admin);
    expect(await submitGuildInterest({ ...GOOD, website: 'x' })).toEqual({ ok: true });
    expect((await submitGuildInterest({ ...GOOD, guildName: '' })).ok).toBe(false);
    expect((await submitGuildInterest({ ...GOOD, raiders: 500 })).ok).toBe(false);
    expect((await submitGuildInterest({ ...GOOD, nights: ['noday'] })).ok).toBe(false);
    expect(admin).not.toHaveBeenCalled();
  });

  it('the fourth submission in an hour is refused; a stored row is cleaned, hashed, and holds no address', async () => {
    process.env.ANON_FEEDBACK_SALT = 'test-salt';
    let inserted = null; let counted = 3; let pruned = null;
    const chain = (final) => {
      const c = {
        select: () => c, eq: () => c, gte: () => Promise.resolve(final),
        insert: (rows) => { inserted = rows[0]; return Promise.resolve({ error: null }); },
        update: (patch) => { pruned = patch; return c; }, lt: () => c, not: () => Promise.resolve({ error: null }),
      };
      return c;
    };
    const admin = () => ({ from: () => chain({ count: counted, error: null }) });
    const { submitGuildInterest } = await loadAction(admin, new Headers({ 'x-forwarded-for': '203.0.113.9, 10.0.0.1' }));
    const dirty = { ...GOOD, heard: 'saw it at https://evil.example/x' };
    expect((await submitGuildInterest(dirty)).ok).toBe(false);
    expect(inserted).toBeNull();

    counted = 2;
    expect(await submitGuildInterest(dirty)).toEqual({ ok: true });
    expect(inserted.heard).not.toMatch(/evil|https?:/);
    expect(inserted).toMatchObject({ guild_name: 'Brackwyn Vanguard', raiders: 24, nights: ['sun', 'wed'], dkp: 'opendkp' });
    expect(inserted.ip_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(pruned).toEqual({ ip_hash: null });
    expect(JSON.stringify(inserted)).not.toContain('203.0.113.9');
    delete process.env.ANON_FEEDBACK_SALT;
  });

  it('without a server secret nothing is stored', async () => {
    delete process.env.ANON_FEEDBACK_SALT; delete process.env.DEMO_OBFUSCATE_SALT;
    const admin = vi.fn(() => { throw new Error('must not be reached'); });
    const { submitGuildInterest } = await loadAction(admin);
    expect((await submitGuildInterest(GOOD)).ok).toBe(false);
    expect(admin).not.toHaveBeenCalled();
  });

  const act = code('web/app/raidmimic/register/actions.ts');
  it('order: validate (which holds the honeypot), then the hash, then the limit, then the insert; no console', () => {
    const at = (s) => act.indexOf(s);
    expect(at('validateInterest(input)')).toBeGreaterThan(0);
    expect(at('validateInterest(input)')).toBeLessThan(at('const hash = ipHash()'));
    expect(at('const hash = ipHash()')).toBeLessThan(at("select('id', { count: 'exact', head: true })"));
    expect(at("select('id', { count: 'exact', head: true })")).toBeLessThan(at('.insert('));
    expect(act).not.toMatch(/console\./);
  });
  it('rate limit wiring: per ip_hash, last hour, INTEREST_PER_HOUR, hash erased after a day', () => {
    expect(G.INTEREST_PER_HOUR).toBe(3);
    expect(act).toMatch(/\.eq\('ip_hash', hash\)/);
    expect(act).toMatch(/\.gte\('created_at', since\)/);
    expect(act).toMatch(/Date\.now\(\) - 60 \* 60 \* 1000/);
    expect(act).toMatch(/\(count \?\? 0\) >= INTEREST_PER_HOUR/);
    expect(act).toMatch(/update\(\{ ip_hash: null \}\)/);
    expect(act).toMatch(/createHash\('sha256'\)/);
    expect(act).toMatch(/process\.env\.ANON_FEEDBACK_SALT \|\| process\.env\.DEMO_OBFUSCATE_SALT/);
  });
  it('the sanitizer is the anonymous-feedback cleaner, imported rather than rewritten', () => {
    const lib = code('web/lib/guildInterest.ts');
    expect(lib).toMatch(/import \{ cleanAnonMessage, cleanDiscordContact \} from '\.\/anonFeedbackClean'/);
    expect(lib).toMatch(/cleanAnonMessage\(PREFIX \+ flat\)/);
    expect(lib).toMatch(/cleanDiscordContact\(input\?\.discord\)/);
  });
});

describe('the table', () => {
  const sql = stripSql(read('supabase/migrations/20261101070000_guild_interest.sql')).replace(/[ \t]+/g, ' ');
  it('has the columns the form stores', () => {
    for (const c of ['id uuid primary key default gen_random_uuid()', 'created_at timestamptz', 'guild_name text not null', 'game text', 'server text',
      'raiders integer check (raiders between 1 and 200)', 'nights text[]', 'dkp text', 'heard text', 'discord_contact text', 'ip_hash text', "status text not null default 'new'"]) {
      expect(sql, c).toContain(c);
    }
  });
  it('is service-role only: RLS on, grants revoked, and NO policy', () => {
    expect(sql).toMatch(/alter table public\.guild_interest enable row level security;/);
    expect(sql).toMatch(/revoke all on public\.guild_interest from anon, authenticated;/);
    expect(sql).not.toMatch(/create\s+policy/i);
    expect(sql).not.toMatch(/\bgrant\b/i);
  });
  it('is idempotent, and is a lead list, not guild data: no guild_id, not in the guild-scope table list', () => {
    expect(sql).toMatch(/create table if not exists public\.guild_interest/);
    expect(sql.match(/create index if not exists/gi).length).toBe(sql.match(/create index/gi).length);
    expect(sql).not.toMatch(/guild_id/);
    expect(JSON.parse(read('scripts/guild-tables.json')).tables).not.toContain('guild_interest');
  });
  it('the migration file name is the one the guild lead’s call named', () => {
    expect(fs.existsSync(path.join(ROOT, 'supabase/migrations/20261101070000_guild_interest.sql'))).toBe(true);
  });
});

describe('the page and its routing', () => {
  const page = code('web/app/raidmimic/register/page.tsx');
  it('/register on a raidmimic host is rewritten to the page, query dropped; other paths still reach the landing page', () => {
    expect(RAIDMIMIC_REGISTER_PATH).toBe('/raidmimic/register');
    for (const p of ['/register', '/register/', '/Register', '/REGISTER//']) {
      expect(raidmimicLandingTarget(p), p).toEqual({ pathname: '/raidmimic/register', search: '' });
    }
    for (const p of ['/registers', '/register/x', '/raidmimic/register', '/admin/interest']) expect(raidmimicLandingTarget(p).pathname, p).toBe('/raidmimic');
    expect(fs.existsSync(path.join(ROOT, 'web/app/raidmimic/register/page.tsx'))).toBe(true);
  });
  it('the tab and the Discord card carry the same words, and the page is [beta], public and server-rendered', () => {
    const title = /const TITLE = '([^']+)'/.exec(page)[1];
    const desc = /const DESCRIPTION =\s*'([^']+)'/.exec(page)[1];
    const m = metaForPath('/raidmimic/register');
    expect(m).toEqual({ title, description: desc });
    expect(title).toMatch(/^\[beta\] /);
    expect(page).toMatch(/export function generateMetadata/);
    expect(page).toMatch(/raidmimicSeo\(headers\(\)\.get\('host'\), '\/register'\)/);
    expect(page).toMatch(/<NewPageTag\b/);
    expect(page).not.toMatch(/['"]use client['"]|createServerClient|supabase|getUser/i);
  });
  it('is indexed on the apex raidmimic hosts with raidmimic.com/register as canonical; noindex elsewhere', () => {
    expect(raidmimicSeo('raidmimic.com', '/register')).toEqual({ robots: { index: true, follow: true }, alternates: { canonical: 'https://raidmimic.com/register' } });
    for (const h of ['wolfpack.quest', 'b.wolfpack.quest', 'b.raidmimic.com', null]) expect(raidmimicSeo(h, '/register'), String(h)).toEqual({ robots: { index: false, follow: false } });
  });
  it('the form: the seven days, the fields asked for, "Count us in", the honeypot, and a thank-you with the download and the setup guide', () => {
    const form = code('web/app/raidmimic/register/RegisterForm.tsx');
    expect(form).toMatch(/Count us in/);
    expect(form).toMatch(/type="range"/);
    expect(form).toMatch(/Download Mimic/);
    expect(form).toMatch(/setup guide/i);
    expect(form).toMatch(/tabIndex=\{-1\}/);
    expect(form).toMatch(/aria-hidden="true"/);
    expect(form).toMatch(/submitGuildInterest\(/);
    // the form imports the constants file, so the cleaner is not shipped to the browser
    expect(form).toMatch(/from '@\/lib\/guildInterestFields'/);
    expect(form).not.toMatch(/anonFeedbackClean/);
    expect(page).toMatch(/onHost \? '\/setup'/);
  });
});

describe('every Register-interest link lands on the form', () => {
  it('interestUrl keeps its signature and answers /register on a raidmimic host, /raidmimic/register on Wolf Pack hosts', () => {
    expect(interestUrl('https://eqmimic.quest/feedback')).toBe('/register');
    expect(interestUrl(EQMIMIC_FEEDBACK_PATH)).toBe('/raidmimic/register');
    expect(code('web/lib/raidmimicLanding.ts')).toMatch(/export function interestUrl\(base: string\): string/);
  });
  it('the guilds pages (a feedback link, not a registration) keep pointing at the feedback form', () => {
    for (const f of ['web/app/guilds/page.tsx', 'web/app/guilds/new/page.tsx', 'web/app/guilds/[slug]/page.tsx']) {
      expect(code(f), f).not.toMatch(/interestUrl/);
      expect(code(f), f).toMatch(/\$\{EQMIMIC_ORIGIN\}\/feedback/);
    }
  });
});

describe('officers’ view', () => {
  const page = code('web/app/admin/interest/page.tsx');
  it('is officer-gated, newest first, never selects ip_hash, and renders plain text only', () => {
    expect(page).toMatch(/await requireOfficer\(\)/);
    expect(page).toMatch(/\.from\('guild_interest'\)/);
    expect(page).toMatch(/\.order\('created_at', \{ ascending: false \}\)/);
    expect(page).not.toMatch(/ip_hash/);
    expect(page).not.toMatch(/dangerouslySetInnerHTML|<a\b|href=\{r\.|<Link href=\{r\./);
    expect(page).not.toMatch(/\.update\(|\.insert\(|\.delete\(|'use server'/);   // read-only: nothing acts on a row
  });
  it('is in the admin sidebar with a title and a blurb, and unfurls with its own name', () => {
    expect(groupLinks(NAV_GROUPS.find(g => g.id === 'between')).map(l => l.href)).toContain('/admin/interest');
    expect(ADMIN_TITLES['/admin/interest']).toBe('[beta] Guild interest');
    expect(metaForPath('/admin/interest').title).toBe('[beta] Guild interest · Admin');
    expect(code('web/app/admin/adminBlurbs.ts')).toContain("'/admin/interest':");
  });
});
