// test/raidmimic-setup.test.js — raidmimic.com/setup, the set-up guide for someone who is not in a guild
// (the guild lead, 2026-10-21). Sibling of test/raidmimic-landing.test.js.
//
// What this pins:
//   - host routing: /setup on a raidmimic host goes to the guide, everything else still goes to the landing page,
//     and the whole query string is dropped either way (pure function AND the middleware, run),
//   - the page: [beta] tag, not indexable, public, server-only, every step the guild lead asked for is present,
//   - metadata: the tab (page.tsx) and the Discord card (lib/pageMeta.ts) carry the same words,
//   - the words: "Wolf Pack" appears once as a credit and nowhere else, no member names or addresses, and the
//     privacy and releases links are the ones named.
//
// Source-text assertions run over comment-stripped source (CLAUDE.md "comments satisfy text assertions").
// Run: npx vitest run test/raidmimic-setup.test.js

import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs } from './_source-slice.js';
import {
  RAIDMIMIC_HOSTS, RAIDMIMIC_LANDING_PATH, RAIDMIMIC_SETUP_PATH, raidmimicLandingTarget, raidmimicSeo,
} from '../web/lib/raidmimicHost.ts';
import * as S from '../web/lib/raidmimicSetup.ts';
import { metaForPath, DEFAULT_DESCRIPTION } from '../web/lib/pageMeta.ts';

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const code = (rel) => stripJs(read(rel));
const PAGE = 'web/app/raidmimic/setup/page.tsx';

const allText = () => JSON.stringify([S.HERO, S.CREDIT, S.REQUIREMENTS, S.STEPS, S.TROUBLESHOOTING, S.STILL_STUCK, S.BETA_NOTE]);

describe('raidmimicLandingTarget', () => {
  it('/setup is the guide, with a trailing slash or capitals too', () => {
    expect(RAIDMIMIC_SETUP_PATH).toBe('/raidmimic/setup');
    for (const p of ['/setup', '/setup/', '/Setup', '/SETUP//']) {
      expect(raidmimicLandingTarget(p), p).toEqual({ pathname: '/raidmimic/setup', search: '' });
    }
  });
  it('everything else is still the landing page, and no argument means the landing page', () => {
    for (const p of ['/', '', '/index', '/setup/extra', '/set', '/feedback', '/admin/feedback', '/raidmimic/setup', '/me', '/robots.txt.bak', '/sitemap']) {
      expect(raidmimicLandingTarget(p), p).toEqual({ pathname: RAIDMIMIC_LANDING_PATH, search: '' });
    }
    expect(raidmimicLandingTarget()).toEqual({ pathname: '/raidmimic', search: '' });
  });
});

describe('the middleware, run', () => {
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
    return { to: to ? new URL(to) : null, next: res.headers.get('x-middleware-next') };
  }

  it.each(RAIDMIMIC_HOSTS)('%s /setup -> the guide, query dropped', async (h) => {
    const { to } = await run(`https://${h}/setup?v=b&utm=1&token=secret`);
    expect(to.pathname).toBe('/raidmimic/setup');
    expect(to.search).toBe('');
  });
  it('other paths still reach the landing page, query dropped', async () => {
    for (const u of ['https://raidmimic.com/', 'https://raidmimic.com/?v=b', 'https://raidmimic.com/setups',
      'https://raidmimic.com/setup/extra?x=1', 'https://raidmimic.com/feedback', 'https://raidmimic.com/api/agent/chat']) {
      const { to } = await run(u);
      expect(to.pathname, u).toBe('/raidmimic');
      expect(to.search, u).toBe('');
    }
  });
  it('/_next/ assets are still let through', async () => {
    const { to, next } = await run('https://raidmimic.com/_next/static/x.js');
    expect(to).toBeNull();
    expect(next).toBe('1');
  });
  it('a non-raidmimic host is not rewritten by the raidmimic branch: eqmimic /setup is its own landing page', async () => {
    expect((await run('https://eqmimic.quest/setup')).to.pathname).toBe('/eqmimic');
  });
});

describe('the page', () => {
  const page = code(PAGE);
  it('is [beta], indexed on the raidmimic hosts only (canonical https://raidmimic.com/setup), public, and a server component', () => {
    expect(page).toMatch(/const TITLE = '\[beta\] Set up Raid Mimic'/);
    // 2026-10-23: the robots and canonical come from raidmimicSeo(), decided per request from the Host header
    expect(page).toMatch(/\.\.\.raidmimicSeo\(headers\(\)\.get\('host'\), '\/setup'\)/);
    expect(page).not.toMatch(/robots:/);
    expect(raidmimicSeo('raidmimic.com', '/setup')).toEqual({
      robots: { index: true, follow: true }, alternates: { canonical: 'https://raidmimic.com/setup' },
    });
    expect(raidmimicSeo('wolfpack.quest', '/setup')).toEqual({ robots: { index: false, follow: false } });
    expect(raidmimicSeo('b.wolfpack.quest', '/setup')).toEqual({ robots: { index: false, follow: false } });
    expect(page).toMatch(/<NewPageTag\b/);
    expect(page.indexOf('<NewPageTag')).toBeLessThan(page.indexOf('<h1'));
    expect(page).not.toMatch(/['"]use client['"]|createServerClient|supabase/i);
  });
  it('shows the six steps the guild lead asked for, in order, plus the fixes', () => {
    expect(S.STEPS.map(s => s.id)).toEqual(['download', 'first-run', 'on-your-own', 'join-a-raid', 'for-a-guild', 'privacy']);
    expect(S.TROUBLESHOOTING.list.map(f => f.id)).toEqual(expect.arrayContaining(['zeal-not-found', 'compat-mode']));
    expect(page).toMatch(/STEPS\.map/);
    expect(page).toMatch(/TROUBLESHOOTING\.list\.map/);
  });
  it('step 1: the releases page, the SmartScreen way through, and the requirements', () => {
    expect(S.RELEASES_URL).toBe('https://github.com/davehess/QuarmBossTracker/releases');
    const dl = S.STEPS.find(s => s.id === 'download');
    expect(dl.link.href).toBe(S.RELEASES_URL);
    expect(JSON.stringify(dl)).toMatch(/More info/);
    expect(JSON.stringify(dl)).toMatch(/Run anyway/);
    expect(JSON.stringify(dl)).toMatch(/not code-signed/);
    expect(JSON.stringify(dl)).toMatch(/newest release/);
    const need = S.REQUIREMENTS.items.join(' ');
    expect(need).toMatch(/Windows/);
    expect(need).toMatch(/\/log on/);
    expect(need).toMatch(/Zeal is optional/);
  });
  it('steps 2 to 4: local mode, what works alone, and joining with a code', () => {
    const t = (id) => JSON.stringify(S.STEPS.find(s => s.id === id));
    expect(t('first-run')).toMatch(/Run local-only/);
    expect(t('first-run')).not.toMatch(/guild password/);
    expect(t('first-run')).toMatch(/local mode/);
    expect(t('first-run')).toMatch(/stays on your PC/);
    for (const re of [/DPS meter/, /triggers/, /timers/, /Canvas/, /On this PC/, /Inventory/, /\/outputfile inventory/, /My replay/, /Zeal/, /My parses/, /Rebuild from my logs/]) {
      expect(t('on-your-own'), String(re)).toMatch(re);
    }
    for (const re of [/Join a raid with a code/, /6 hours/, /raid file/, /merge/]) expect(t('join-a-raid'), String(re)).toMatch(re);
  });
  it('step 5 points at the landing page and says whose data is whose; step 6 links the privacy page', () => {
    const guild = S.STEPS.find(s => s.id === 'for-a-guild');
    expect(JSON.stringify(guild)).toMatch(/The guild’s data is the guild’s\. A player’s data is the player’s\./);
    expect(guild.link.href).toBe('');                      // the page fills it: the address differs by host
    expect(page).toMatch(/guildHref=\{landing\}/);
    expect(page).toMatch(/LANDING_PATH_ON_HOST/);
    expect(S.STEPS.find(s => s.id === 'privacy').link.href).toBe('https://wolfpack.quest/privacy');
  });
  it('troubleshooting: Zeal not found (install outside the EverQuest folder) and the compatibility-mode tick', () => {
    const fixes = Object.fromEntries(S.TROUBLESHOOTING.list.map(f => [f.id, f.fix]));
    expect(fixes['zeal-not-found']).toMatch(/outside your EverQuest folder/);
    expect(fixes['compat-mode']).toMatch(/eqgame\.exe/);
    expect(fixes['compat-mode']).toMatch(/untick/i);
    expect(fixes['compat-mode']).toMatch(/compatibility mode/);
  });
  it('the landing page links to it, on both kinds of host', () => {
    const layout = code('web/app/raidmimic/_landing/PathsLayout.tsx');
    expect(layout).toMatch(/href=\{ctx\.setup\}/);
    expect(layout).toMatch(/\{door\.more\} →/);
    expect(read('web/lib/raidmimicPlayer.ts')).toMatch(/setup: 'Set it up yourself'/);
    const landing = code('web/app/raidmimic/page.tsx');
    expect(landing).toMatch(/setup: '\/setup'/);
    expect(landing).toMatch(/setup: RAIDMIMIC_SETUP_PATH/);
  });
});

describe('metadata: the tab AND the Discord card (CLAUDE.md, every page unfurls with its own name)', () => {
  it('lib/pageMeta.ts knows /raidmimic/setup, with the same words as the page', () => {
    const m = metaForPath('/raidmimic/setup');
    expect(m.title).toBe('[beta] Set up Raid Mimic');
    expect(m.description).not.toBe(DEFAULT_DESCRIPTION);
    expect(m.description.length).toBeGreaterThan(20);
    expect(m.description.length).toBeLessThanOrEqual(300);
    expect(m.description).toBe(S.DESCRIPTION);
    expect(S.TITLE).toBe(m.title);
    const page = code(PAGE);
    expect(page).toContain(`const TITLE = '${m.title}'`);
    expect(page.match(/const DESCRIPTION =\s*'([^']+)'/)[1]).toBe(m.description);
    expect(page).toMatch(/title: \{ absolute: TITLE \}/);
  });
  it('the card is public-safe: one sentence, no name of a person', () => {
    const m = metaForPath('/raidmimic/setup');
    expect(m.description.split(/(?<=[.!?])\s/).length).toBe(1);
    expect(JSON.stringify(m)).not.toMatch(/Wolf Pack/);
  });
});

describe('the words', () => {
  it('"Wolf Pack" appears once, as the credit line, and nowhere else on the page', () => {
    const t = allText();
    expect(S.CREDIT).toBe('Made by the Wolf Pack guild on Project Quarm.');
    expect((t.match(/Wolf Pack/gi) || []).length).toBe(1);   // the privacy link’s address is not a name
    expect(code(PAGE)).not.toMatch(/Wolf Pack/i);        // the page file names no product, only the content module's credit
  });
  it('the only outbound addresses are the releases page, the privacy page and the source repo', () => {
    const urls = new Set([...code('web/lib/raidmimicSetup.ts').matchAll(/https?:\/\/[^\s'"`)<>]+/g)].map(m => m[0]));
    expect([...urls].filter(u => !/\$\{/.test(u))).toEqual(['https://wolfpack.quest/privacy']);
    expect(code(PAGE)).not.toMatch(/https?:\/\//);
  });
  it('is public-safe: no ids, tokens, addresses or invented people; no price', () => {
    const t = allText();
    expect(t).not.toMatch(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/);
    expect(t).not.toMatch(/zhtoekwakucbckvatfky|1168893924329402420|service_role|SUPABASE_|WOLFPACK_AGENT_TOKEN|Bearer /);
    expect(t).not.toMatch(/\b\d{17,20}\b/);
    expect(t).not.toMatch(/\$\s?\d/);
  });
  it('reads in plain words: no code identifiers in the steps', () => {
    expect(allText()).not.toMatch(/openExternal|localStorage|IPC|electron|\bnpm\b|\bAPI\b|bearer|\bJSON\b/i);
  });
});
