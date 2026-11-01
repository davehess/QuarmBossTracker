// test/raidmimic-landing.test.js — the raidmimic.com front door (the guild lead, 2026-10-18, option C "two doors"; made
// player-first 2026-10-23; the story stage became the one page on 2026-11-01, see test/raidmimic-landing-variants.test.js).
// Modelled on test/eqmimic-landing.test.js.
//
// What this pins:
//   - the host list (six hosts, exact match, lookalikes refused) and the routing function: every path on those
//     hosts goes to /raidmimic with EVERY query parameter dropped (robots.txt and sitemap.xml to their own files, the
//     page's own files served as themselves),
//   - the middleware, RUN against a stand-in for next/server, agrees, and the eqmimic host still behaves as before;
//     the branch sits before any session work and the link-preview rewrite,
//   - the root layout gives the raidmimic hosts the same bare shell as eqmimic's,
//   - the page: ONE page (the story stage; no `?v=` switch, no old layouts), the player-first title, indexing ON for
//     the raidmimic hosts only with https://raidmimic.com/ as the canonical address (noindex on the Wolf Pack hosts),
//     robots.txt and the sitemap, and the Register-interest address (the existing anonymous form, text in the FRAGMENT),
//   - the shared pieces (Parts.tsx) and the directory's file list,
//   - honesty: every "coming" claim is in the COMING inventory, nothing invents a price, a customer count or a
//     testimonial, and the one dollar figure is the measured Wolf Pack number eqmimic already publishes,
//   - the metadata is in lib/pageMeta.ts as well as the page (test/page-metadata.test.js walks the rest),
//   - the content is public-safe, and the recordings' fixtures name only invented raiders.
//
// Source-text assertions run over comment-stripped source (CLAUDE.md "comments satisfy text assertions").
// Run: npx vitest run test/raidmimic-landing.test.js

import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs, stripCss } from './_source-slice.js';
import {
  RAIDMIMIC_HOSTS, RAIDMIMIC_INDEXED_HOSTS, RAIDMIMIC_LANDING_PATH, RAIDMIMIC_ORIGIN, isRaidmimicAsset, isRaidmimicHost, raidmimicLandingTarget, raidmimicSeo,
  RAIDMIMIC_SETUP_PATH,
} from '../web/lib/raidmimicHost.ts';
import { isEqmimicHost } from '../web/lib/eqmimicHost.ts';
import * as C from '../web/lib/raidmimicLanding.ts';
import { FEATURES as STORY_FEATURES } from '../web/lib/raidmimicStory.ts';
import * as EQ from '../web/lib/eqmimicLanding.ts';
import * as PL from '../web/lib/raidmimicPlayer.ts';
import { metaForPath, DEFAULT_DESCRIPTION } from '../web/lib/pageMeta.ts';

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const code = (rel) => stripJs(read(rel));
const L = 'web/app/raidmimic/_landing/';

// Every sentence the content module can put on the page, as one string (for the "no invented X" sweeps).
const allText = () => JSON.stringify([
  C.WORKS_WITH, C.DATA, C.COST, C.WORLDS, C.CTA, C.COMING, C.CLIPS, C.AUDIENCES, C.CLIPS_HEAD, C.CLIPS_NOTE, C.SHOTS, C.SHOTS_HEAD, C.MORE_HEAD,
  PL.ALL_TEXT,   // the story's own words (the doors, the drawing's section, the search card): same sweeps, same rules
]);

describe('the host list', () => {
  it('is the six hosts the guild lead bought, with and without www, plus the beta mirror b.raidmimic.com', () => {
    expect(RAIDMIMIC_INDEXED_HOSTS).toEqual([
      'raidmimic.com', 'www.raidmimic.com', 'raidmimic.net', 'www.raidmimic.net', 'raidmimic.quest', 'www.raidmimic.quest',
    ]);
    expect(RAIDMIMIC_HOSTS).toEqual([...RAIDMIMIC_INDEXED_HOSTS, 'b.raidmimic.com']);
  });
  it('matches any case and an optional port, exactly', () => {
    for (const h of [...RAIDMIMIC_HOSTS, 'RaidMimic.COM', 'raidmimic.com:443', 'www.raidmimic.net:3000']) expect(isRaidmimicHost(h), h).toBe(true);
  });
  it('refuses lookalikes, the other front doors and empties', () => {
    for (const h of ['raidmimic.com.evil.com', 'evil-raidmimic.com', 'sub.raidmimic.com', 'c.raidmimic.com', 'b.raidmimic.com.evil.com', 'b.raidmimic.net', 'raidmimic.org', 'eqmimic.quest',
      'wolfpack.quest', 'b.wolfpack.quest', 'localhost:3000', '', null, undefined]) expect(isRaidmimicHost(h), String(h)).toBe(false);
  });
  it('is disjoint from the eqmimic hosts', () => {
    for (const h of RAIDMIMIC_HOSTS) expect(isEqmimicHost(h), h).toBe(false);
    expect(isRaidmimicHost('eqmimic.quest')).toBe(false);
  });
});

describe('raidmimicLandingTarget', () => {
  it('is the landing page with no query, always', () => {
    expect(RAIDMIMIC_LANDING_PATH).toBe('/raidmimic');
    expect(raidmimicLandingTarget()).toEqual({ pathname: '/raidmimic', search: '' });
  });
  it('the host module holds no query handling at all', () => {
    expect(code('web/lib/raidmimicHost.ts')).not.toMatch(/URLSearchParams|[?&]v=|searchParams/);
  });
  it('robots.txt and sitemap.xml go to their own files, in any case and with a trailing slash; lookalikes go to the page', () => {
    for (const p of ['/robots.txt', '/Robots.TXT', '/robots.txt/']) expect(raidmimicLandingTarget(p), p).toEqual({ pathname: '/raidmimic/robots.txt', search: '' });
    for (const p of ['/sitemap.xml', '/SITEMAP.xml', '/sitemap.xml/']) expect(raidmimicLandingTarget(p), p).toEqual({ pathname: '/raidmimic/sitemap.xml', search: '' });
    for (const p of ['/robots', '/robots.txt.bak', '/sitemap', '/sitemap.xml/x', '/raidmimic/robots.txt/x']) expect(raidmimicLandingTarget(p), p).toEqual({ pathname: '/raidmimic', search: '' });
  });
  it('the page’s own files (captures, clips, mascot, the drawing) are assets; nothing else is', () => {
    for (const p of ['/raidmimic/how/scene.html', '/raidmimic/clips/grummus-hail.mp4', '/raidmimic/mascot/hop.mp4', '/raidmimic/shots/cc.webp', '/raidmimic/motion/story-720.mp4']) expect(isRaidmimicAsset(p), p).toBe(true);
    for (const p of ['/', '/setup', '/raidmimic', '/raidmimic/setup', '/raidmimic/how/', '/raidmimic/a/b/c.mp4', '/other/how/scene.html', '/raidmimic/../x/y.html', '/api/agent/chat', '/raidmimic/how/%2e%2e.html']) expect(isRaidmimicAsset(p), p).toBe(false);
  });
});

// ─── Search engines (the guild lead, 2026-10-23): on, for the raidmimic hosts only ───────────────────────────────────
describe('search engines: indexed on the raidmimic hosts, noindex everywhere else', () => {
  const noindex = { robots: { index: false, follow: false } };
  afterEach(() => { delete process.env.NEXT_PUBLIC_IS_BETA; });

  it('every raidmimic host is indexed and names https://raidmimic.com as the canonical address, so the sister hosts fold into it', () => {
    expect(RAIDMIMIC_ORIGIN).toBe('https://raidmimic.com');
    for (const h of [...RAIDMIMIC_INDEXED_HOSTS, 'RaidMimic.COM:443']) {
      expect(raidmimicSeo(h, '/'), h).toEqual({ robots: { index: true, follow: true }, alternates: { canonical: 'https://raidmimic.com/' } });
      expect(raidmimicSeo(h, '/setup'), h).toEqual({ robots: { index: true, follow: true }, alternates: { canonical: 'https://raidmimic.com/setup' } });
    }
  });
  it('wolfpack.quest/raidmimic, b.wolfpack.quest/raidmimic, eqmimic.quest and an unknown host stay noindex (and name no canonical)', () => {
    for (const h of ['wolfpack.quest', 'b.wolfpack.quest', 'eqmimic.quest', 'localhost:3000', 'raidmimic.com.evil.com', '', null, undefined]) {
      expect(raidmimicSeo(h, '/'), String(h)).toEqual(noindex);
      expect(raidmimicSeo(h, '/setup'), String(h)).toEqual(noindex);
    }
  });
  it('a build of the beta branch is noindex whatever host it is reached by', () => {
    process.env.NEXT_PUBLIC_IS_BETA = '1';
    expect(raidmimicSeo('raidmimic.com', '/')).toEqual(noindex);
  });
  it('robots.txt allows everything and names the sitemap on the canonical host; the sitemap lists the pages (the legal pages joined 2026-11-01)', async () => {
    const robots = await (await (await import('../web/app/raidmimic/robots.txt/route.ts')).GET(new Request('https://raidmimic.com/robots.txt', { headers: { host: 'raidmimic.com' } }))).text();
    expect(robots).toBe('User-agent: *\nAllow: /\n\nSitemap: https://raidmimic.com/sitemap.xml\n');
    expect(robots).not.toMatch(/Disallow/);
    const res = await (await import('../web/app/raidmimic/sitemap.xml/route.ts')).GET();
    expect(res.headers.get('content-type')).toMatch(/^application\/xml/);
    const xml = await res.text();
    expect([...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1])).toEqual([
      'https://raidmimic.com/', 'https://raidmimic.com/setup', 'https://raidmimic.com/register',
      'https://raidmimic.com/privacy', 'https://raidmimic.com/terms', 'https://raidmimic.com/refunds',
    ]);
  });
  it('wolfpack.quest keeps its own robots.txt (the share links and the API stay out of search), untouched', () => {
    expect(code('web/app/robots.ts')).toMatch(/disallow: \['\/share\/', '\/api\/'\]/);
    expect(code('web/app/robots.ts')).not.toMatch(/raidmimic/i);
  });
  it('the root layout still marks the beta mirror noindex', () => {
    expect(code('web/app/layout.tsx')).toMatch(/\.\.\.\(IS_BETA \? \{ robots: \{ index: false, follow: false \} \} : \{\}\)/);
  });
});

describe('the middleware, run', () => {
  // Same stand-in as test/eqmimic-landing.test.js: the host branches touch only NextResponse.next/rewrite and
  // request.nextUrl/headers, so no session client may be built.
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

  it.each(RAIDMIMIC_HOSTS)('%s / -> the landing page, no query', async (h) => {
    const { to } = await run(`https://${h}/`);
    expect(to.pathname).toBe('/raidmimic');
    expect(to.search).toBe('');
  });
  it('every path and every query parameter is dropped, ?v=b included (a stale preview link must not change the page)', async () => {
    for (const u of ['https://raidmimic.com/?v=b', 'https://www.raidmimic.net/anything?x=1', 'https://raidmimic.quest/feedback?v=b&utm=1&token=secret',
      'https://raidmimic.com/admin/feedback', 'https://raidmimic.com/api/agent/chat', 'https://raidmimic.com/me?v=B']) {
      const { to } = await run(u);
      expect(to.pathname, u).toBe('/raidmimic');
      expect(to.search, u).toBe('');
    }
  });
  it('/_next/ assets are let through, not rewritten (or the page would have no scripts)', async () => {
    const { to, next } = await run('https://raidmimic.com/_next/data/x.json');
    expect(to).toBeNull();
    expect(next).toBe('1');
  });
  it('the page’s own files are served as themselves (a clip or the drawing rewritten to the landing page would be HTML)', async () => {
    for (const u of ['https://raidmimic.com/raidmimic/how/scene.html', 'https://raidmimic.net/raidmimic/clips/grummus-hail.mp4?x=1',
      'https://www.raidmimic.quest/raidmimic/mascot/hop.mp4']) {
      const { to, next } = await run(u);
      expect(to, u).toBeNull();
      expect(next, u).toBe('1');
    }
  });
  it('/robots.txt and /sitemap.xml are rewritten to their own files, query dropped', async () => {
    expect((await run('https://raidmimic.com/robots.txt')).to.pathname).toBe('/raidmimic/robots.txt');
    const sm = (await run('https://www.raidmimic.net/sitemap.xml?x=1')).to;
    expect(sm.pathname).toBe('/raidmimic/sitemap.xml');
    expect(sm.search).toBe('');
  });
  it('the eqmimic host is unchanged: / is its landing page, /feedback its form', async () => {
    expect((await run('https://eqmimic.quest/?v=b')).to.pathname).toBe('/eqmimic');
    expect((await run('https://eqmimic.quest/feedback')).to.pathname).toBe('/eqmimic/feedback');
  });

  const mw = code('web/middleware.ts');
  it('the raidmimic branch returns before the link-preview rewrite and before any session client', () => {
    const at = mw.indexOf('isRaidmimicHost(request.headers.get(\'host\'))');
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(mw.indexOf('PREVIEW_BOT_RX.test'));
    expect(at).toBeLessThan(mw.indexOf('createServerClient('));
    expect(mw).toMatch(/raidmimicLandingTarget\(request\.nextUrl\.pathname\)/);
  });
});

describe('the root layout', () => {
  const layout = code('web/app/layout.tsx');
  it('gives a raidmimic host the bare shell, before any session lookup', () => {
    const at = layout.indexOf('isRaidmimicHost(headers().get(\'host\'))');
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(layout.indexOf('await getSessionUser()'));
    // …and it is the SAME branch as the eqmimic one, so the two shells cannot drift
    const branch = layout.slice(layout.indexOf('if (isEqmimicHost('), layout.indexOf('await getSessionUser()'));
    expect(branch).toMatch(/isEqmimicHost\(headers\(\)\.get\('host'\)\) \|\| isRaidmimicHost\(headers\(\)\.get\('host'\)\)/);
    expect(branch).not.toMatch(/max-w-/);
  });
});

describe('the page', () => {
  const page = code('web/app/raidmimic/page.tsx');
  it('is player-first in its title (no “as a service”, no [beta]), public (no session code), and its search metadata comes from the host', () => {
    expect(page).toMatch(/const TITLE = 'Raid Mimic · free EverQuest raid overlays'/);
    expect(PL.META.title).toBe('Raid Mimic · free EverQuest raid overlays');
    expect(page).not.toMatch(/\[beta\]|as a service|orchestration/i);
    expect(page).not.toMatch(/robots:/);                                          // no pinned noindex any more …
    expect(page).toMatch(/\.\.\.raidmimicSeo\(headers\(\)\.get\('host'\), '\/'\)/);   // … the Host header decides (tests above)
    expect(page).toMatch(/export function generateMetadata\(\): Metadata/);
    expect(page).not.toMatch(/getSessionUser|supabase/i);
  });
  it('renders ONE page, the story stage (the guild lead’s pick C, 2026-11-01), and reads no query: no `?v=` branches, no beta tag, no old layouts', () => {
    expect(page).toMatch(/<StoryStage downloadUrl=\{DOWNLOAD_URL\} onHost=\{onHost\} \/>/);
    expect(page).not.toMatch(/searchParams|\bv === |\?v=[a-z]/);
    expect(page).not.toMatch(/PathsLayout|ChaptersStage|BetaTag|MotionStage|SignInTop|variantOf|PreviewBar/);
    for (const gone of ['PathsLayout', 'ChaptersStage', 'MotionStage', 'SignInTop', 'ClipTabs', 'SceneClip', 'MascotHero', 'MascotVideo', 'HowItWorks',
      'LadderLayout', 'SceneLayout', 'VariantParts', 'Figures']) {
      expect(fs.existsSync(path.join(ROOT, `${L}${gone}.tsx`)), gone).toBe(false);
    }
    expect(C).not.toHaveProperty('raidmimicVariant');
    expect(C).not.toHaveProperty('BLOCKS');
    for (const gone of ['STORY', 'SCREEN_NOTES', 'SETUP_LINK', 'ILLUSTRATIVE_NOTE', 'HERO', 'MOMENTS']) expect(C, gone).not.toHaveProperty(gone);
    for (const gone of ['VARIANTS', 'VARIANT_LABEL', 'variantOf', 'PREVIEW_NOTE', 'PLAYER', 'JUMP', 'GUILD', 'RUN', 'LINUX_URL']) expect(PL, gone).not.toHaveProperty(gone);
  });
  it('the stage is outside the width cap, and the reading column under it carries the features, raid management, pricing, the ask and the footer in that order', () => {
    const at = [...page.matchAll(/<(StoryStage|FeatureBlocks|RaidManagement|Pricing|CtaBand|Footer)\b/g)].map(m => m[1]);
    expect(at).toEqual(['StoryStage', 'FeatureBlocks', 'RaidManagement', 'Pricing', 'CtaBand', 'Footer']);
    expect(page.indexOf('<StoryStage')).toBeLessThan(page.indexOf('max-w-5xl'));
  });
  it('the Register-interest address is the anonymous form: absolute on a raidmimic host, its real path on Wolf Pack hosts', () => {
    expect(page).toMatch(/interest: interestUrl\(`\$\{EQMIMIC_ORIGIN\}\/feedback`\)/);
    expect(page).toMatch(/interest: interestUrl\(EQMIMIC_FEEDBACK_PATH\)/);
    expect(C.EQMIMIC_ORIGIN + '/feedback').toBe('https://eqmimic.quest/feedback');
    expect(C.EQMIMIC_FEEDBACK_PATH).toBe('/eqmimic/feedback');
    // 2026-11-01: those arguments still say "which host", but the address they yield is the interest form (below)
    expect(fs.existsSync(path.join(ROOT, 'web/app/eqmimic/feedback/page.tsx'))).toBe(true);
  });
  it('interestUrl yields the interest form: /register on a raidmimic host (an absolute base), /raidmimic/register on Wolf Pack hosts, nothing in the query or fragment', () => {
    expect(C.interestUrl('https://eqmimic.quest/feedback')).toBe('/register');
    expect(C.interestUrl(C.EQMIMIC_FEEDBACK_PATH)).toBe('/raidmimic/register');
    expect(C.INTEREST_TEXT.length).toBeLessThan(400);
    for (const u of [C.interestUrl('https://eqmimic.quest/feedback'), C.interestUrl(C.EQMIMIC_FEEDBACK_PATH)]) expect(u).not.toMatch(/[?#]/);
  });
  it('no mailto, no new form, no new endpoint', () => {
    for (const f of ['page.tsx', 'Parts.tsx', 'StoryParts.tsx', 'StoryBits.tsx']) {
      const src = f === 'page.tsx' ? page : code(L + f);
      expect(src, f).not.toMatch(/mailto:|<form\b|fetch\(|action=/);
    }
    expect(allText()).not.toMatch(/mailto:|@[a-z0-9-]+\.[a-z]{2,}/i);
  });
});

describe('the shared pieces (Parts.tsx)', () => {
  const parts = code(L + 'Parts.tsx');
  it('the Register-interest band opens the form address from the context, and again nothing else is in Parts but the button, the band and the footer', () => {
    expect(parts).toMatch(/export function CtaBand[\s\S]*?<InterestButton ctx=\{ctx\} \/>/);
    expect(parts).toMatch(/href=\{ctx\.interest\}/);
    expect([...parts.matchAll(/^export (?:function|const|interface) (\w+)/gm)].map(m => m[1]).sort())
      .toEqual(['CtaBand', 'Ctx', 'EXT', 'Footer', 'InterestButton', 'PRIMARY_BTN']);
  });
  it('the footer carries the rights notice and the fan-project line, verbatim from the eqmimic module', () => {
    expect(C.RIGHTS_NOTICE).toBe(EQ.RIGHTS_NOTICE);
    expect(C.FAN_PROJECT_LINE).toBe(EQ.FAN_PROJECT_LINE);
    const footer = parts.slice(parts.indexOf('export function Footer'));
    expect(footer).toMatch(/\{RIGHTS_NOTICE\}/);
    expect(footer).toMatch(/\{FAN_PROJECT_LINE\}/);
    expect(footer).not.toMatch(/text-\[(?:9|10|11)px\]/);
  });
  it('server components except the two that play: only StoryStage and StoryVideo are client files, and the directory holds exactly the graduated page’s files', () => {
    for (const f of ['Parts.tsx', 'StoryParts.tsx', 'StoryBits.tsx', 'FeatureIcons.tsx']) expect(read(L + f), f).not.toMatch(/['"]use client['"]/);
    expect(read('web/app/raidmimic/page.tsx')).not.toMatch(/['"]use client['"]/);
    for (const f of ['StoryStage.tsx', 'StoryVideo.tsx']) expect(read(L + f), f).toMatch(/^(?:\/\/[^\n]*\n)*'use client';|^'use client';/);
    expect(fs.readdirSync(path.join(ROOT, L)).sort()).toEqual([
      'FeatureIcons.tsx', 'Parts.tsx', 'StoryBits.tsx', 'StoryParts.tsx', 'StoryStage.tsx', 'StoryVideo.tsx',
    ]);
  });
  it('fetches and embeds nothing external; every outbound link is one we name', () => {
    const urls = new Set();
    for (const f of ['page.tsx', 'Parts.tsx', 'StoryParts.tsx', 'StoryStage.tsx', 'StoryVideo.tsx']) {
      for (const m of (f === 'page.tsx' ? code('web/app/raidmimic/page.tsx') : code(L + f)).matchAll(/https?:\/\/[^\s'"`)<>]+/g)) urls.add(m[0]);
    }
    expect([...urls]).toEqual([]);   // every address is a constant in a content module
    const mod = code('web/lib/raidmimicLanding.ts');
    const inModule = [...mod.matchAll(/https?:\/\/[^\s'"`)<>]+/g)].map(m => m[0]).filter(u => !/\$\{/.test(u));
    expect(new Set(inModule)).toEqual(new Set(['https://eqmimic.quest', 'https://wolfpack.quest/privacy']));
  });
});

describe('honesty: "coming" means coming', () => {
  it('every world carries a known status', () => {
    for (const x of C.WORLDS.list) expect(['live', 'alpha', 'coming'], x.name).toContain(x.status);
    expect(Object.keys(C.STATUS_LABEL).sort()).toEqual(['alpha', 'coming', 'live']);
    expect(C.STATUS_LABEL.coming).toBe('Coming');
  });
  it('the shared trial and the other games are NOT marked live', () => {
    expect(C.COST.trialStatus).toBe('coming');
    for (const w of C.WORLDS.list.filter(w => /Monsters|Warcraft/.test(w.name))) expect(w.status, w.name).toBe('coming');
    expect(C.WORLDS.list.find(w => w.name === 'EverQuest').status).toBe('live');
  });
  it('the doors say hosting for you is coming and the guild door needs a hub; nothing in them claims hosting or a lookup is live', () => {
    const selfhost = PL.DOORS.find(d => d.id === 'selfhost');
    expect(selfhost.points.join(' ')).toMatch(/Hosting it for you is coming/);
    expect(selfhost.story).toMatch(/not turnkey yet/);
    expect(PL.DOORS.find(d => d.id === 'guild').tone).toBe('hub');
    expect(C.COMING.join(' ')).toMatch(/multi-guild hosting/);
  });
  it('the inventory of promises names each of them', () => {
    const inv = C.COMING.join(' ');
    for (const re of [/other than Wolf Pack|multi-guild/i, /shared between guilds/i, /shared trial/i, /setup wizard/i, /Monsters & Memories/, /Warcraft/]) expect(inv).toMatch(re);
    expect(C.DATA.aside).toMatch(/is coming/);
    expect(C.COMING_TITLE).toBe('What is not built yet');
  });
  it('the live claims are things this platform has: each names the real surface that backs it', () => {
    // A cheap tripwire against a "live" moment with nothing behind it: the surfaces exist in the repo.
    for (const rel of ['web/app/pop/page.tsx', 'web/app/admin/lockouts/page.tsx', 'web/app/parses/page.tsx']) expect(fs.existsSync(path.join(ROOT, rel)), rel).toBe(true);
  });
  it('invents no price, customer count or testimonial', () => {
    const t = allText();
    const dollars = t.match(/\$\s?\d[\d,.]*/g) || [];
    expect(dollars).toEqual(['$30']);                       // the one measured Wolf Pack number, below
    expect(t).not.toMatch(/\bper (?:month|year|seat|user|raider)\b|\/\s?(?:mo|month|yr|year)\b|% off|free trial|money-back/i);
    expect(t).not.toMatch(/\b\d[\d,]*\+? (?:guilds|customers|raiders|users|teams)\b/i);
    expect(t).not.toMatch(/testimonial|trusted by|loved by|“|”|\bsaid\b|\bcalls it\b/);
    expect(C.COST.scale).toMatch(/No price list yet/);
    expect(C.COST.scale).toMatch(/not a quote/);
    expect(code('web/app/raidmimic/_landing/Parts.tsx') + sceneSrc()).not.toMatch(/\$\d/);
  });
  it('the one dollar figure is the measured Wolf Pack hosting number eqmimic.quest already publishes', () => {
    expect(EQ.COSTS.total).toMatch(/\$30\b/);
    expect(C.COST.scale).toMatch(/about \$30 a month in September 2026/);
    expect(EQ.COSTS.measured).toMatch(/September 2026/);
  });
  it('says what is true of the cost model: pass-through hosting by size, a small development share, a trial', () => {
    const t = JSON.stringify(C.COST);
    expect(t).toMatch(/own cloud account/);
    expect(t).toMatch(/by the size of your guild/);
    expect(t).toMatch(/small amount on top|small development share/i);
    expect(t).toMatch(/shared trial/);
    expect(C.COST.notTurnkey).toMatch(/not turnkey/);
  });
  it('the consent model is the one the platform runs: opt in, revoke, private chat on the PC, shown where it lives', () => {
    const heads = C.DATA.points.map(p => p.head);
    expect(heads).toEqual(['Each member opts in', 'Revoke any time', 'Private chat stays on the PC', 'Shown where it lives']);
    // the first three are claims about TODAY: they must match eqmimic's published privacy bullets
    expect(EQ.PRIVACY_BULLETS.join(' ')).toMatch(/signing out stops every upload/);
    expect(EQ.PRIVACY_BULLETS.join(' ')).toMatch(/Officer, group, custom-channel/);
  });
  it('works-with names the three tools and does not claim to replace or beat them', () => {
    expect(C.WORKS_WITH.tools).toEqual(['PQ Companion', 'GINA', 'EQLogParser']);
    expect(C.WORKS_WITH.lead).toMatch(/keep running/);
    expect(C.WORKS_WITH.lead).toMatch(/log file/);
    expect(JSON.stringify(C.WORKS_WITH)).not.toMatch(/better than|replace|instead of|switch from|unlike/i);
    expect(C.WORKS_WITH.rights).toMatch(/not affiliated/);
  });
  it('any solved world: EverQuest first, then the EQ family and Warcraft; Monsters & Memories waits on its rules', () => {
    expect(C.WORLDS.list.map(w => w.name)).toEqual(['EverQuest', 'Other EverQuest servers', 'Classic-era Warcraft', 'Monsters & Memories']);
    // The game's own policy forbids parsers (2026-10-19 research), so the page must not call it next.
    expect(C.WORLDS.list.find(w => w.name === 'Monsters & Memories').note).toMatch(/rules forbid/);
    expect(C.WORLDS.lead).toMatch(/meant to serve/);
    expect(C.WORLDS.rights).toMatch(/not affiliated/);
  });
  it('the two sites point at each other: the footer sends players to eqmimic.quest, and the interest form lives there', () => {
    expect(code(L + 'Parts.tsx')).toMatch(/<a href=\{EQMIMIC_ORIGIN\} \{\.\.\.EXT\}>The free player tool<\/a>/);
    expect(C.EQMIMIC_ORIGIN).toBe('https://eqmimic.quest');
  });
});

function sceneSrc() {
  return ['StoryStage', 'StoryVideo', 'StoryParts', 'StoryBits', 'Parts'].map(f => code(`${L}${f}.tsx`)).join('\n');
}

describe('metadata: the tab AND the Discord card (CLAUDE.md, every page unfurls with its own name)', () => {
  it('lib/pageMeta.ts knows /raidmimic, with the same words as the page', () => {
    const m = metaForPath('/raidmimic');
    expect(m.title).toBe('Raid Mimic · free EverQuest raid overlays');
    expect(m.description).not.toBe(DEFAULT_DESCRIPTION);
    expect(m.description.length).toBeGreaterThan(20);
    expect(m.description.length).toBeLessThanOrEqual(300);
    const page = code('web/app/raidmimic/page.tsx');
    expect(page).toContain(`const TITLE = '${m.title}'`);
    const desc = page.match(/const DESCRIPTION =\s*'([^']+)'/)[1];
    expect(desc).toBe(m.description);
    expect(page).toMatch(/title: \{ absolute: TITLE \}/);   // not "· WolfPack.quest": this page is also raidmimic.com
    // the story module's copy of the search card is the same words, so the three places cannot drift
    expect(PL.META).toEqual({ title: m.title, description: m.description });
  });
  it('the title and description are player-first and one sentence of facts: free, open source, what a guild can add', () => {
    const m = metaForPath('/raidmimic');
    expect(m.title).not.toMatch(/\[beta\]|service|orchestration/i);
    expect(m.description).not.toMatch(/\[beta\]|as a service|orchestration/i);
    expect(m.description).toMatch(/Free, open-source/);
    expect(m.description).toMatch(/run it on your own, or add a guild hub/);
    expect(m.description).not.toMatch(/\$\s?\d|coming|guarantee|best|fastest|#1/i);
    expect(m.description.split(/(?<=[.!?])\s+(?=[A-Z])/).length).toBe(1);   // one sentence
  });
  it('the card carries nothing from the database: a static entry, no lookup', () => {
    expect(code('web/lib/pageMeta.ts')).toMatch(/'\/raidmimic':\s+\{ title: 'Raid Mimic · free EverQuest raid overlays'/);
  });
});

describe('the content is public-safe', () => {
  it('no ids, tokens, addresses, project refs, member names or invented people', () => {
    const t = allText() + code('web/lib/raidmimicLanding.ts') + sceneSrc();
    expect(t).not.toMatch(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/);                 // an IP
    expect(t).not.toMatch(/zhtoekwakucbckvatfky|1168893924329402420|service_role|SUPABASE_|WOLFPACK_AGENT_TOKEN|Bearer /);
    expect(t).not.toMatch(/\b\d{17,20}\b/);                                           // a Discord id
    expect(t).not.toMatch(/\b[a-z0-9]{32,}\b/i);                                       // a long token
  });
});
// the stills generator, so this is where a real name slipping in would be caught.
describe('the recordings’ fixtures name invented raiders only', () => {
  it('every player-shaped field of every fixture is on the invented list, and the page’s words name none of them', async () => {
    const F = await import('../scripts/raidmimic-shots/fixtures.mjs');
    expect(new Set(F.PLAYERS).size).toBe(F.PLAYERS.length);
    // Every field of every fixture that names a PLAYER, gathered the way the overlays read them.
    const cc = F.commandCenter(), rl = F.rollsState(), ts = F.targetStats(), tq = F.targetQuest(), th = F.threat(), dp = F.dps();
    const names = [
      cc.character, cc.rampage.target, ...cc.hail.flatMap(w => [...w.still, ...w.hailed].map(x => x.name).concat(w.already_flagged)),
      ...cc.da_broadcasts.map(x => x.name), ...cc.healer_mana.map(x => x.name), ...cc.cures.map(x => x.name), ...cc.death_recaps.map(x => x.name),
      rl.character, ...rl.rolls.flatMap(r => [...r.winners.map(w => w.name), ...r.rolls.map(x => x.name)]),
      ts.activeCharacter, ...ts.mobInfo.target_buffs.map(b => b.owner).filter(Boolean), tq.activeCharacter,
      th.activeCharacter, th.currentEncounterThreat.uploader, ...Object.keys(th.currentEncounterThreat.perPlayer),
      dp.activeCharacter, ...Object.keys(dp.currentEncounterThreat.perPlayer), ...Object.keys(dp.currentEncounterThreat.spans),
      ...Object.values(dp.currentEncounterThreat.perPlayer).map(p => p.pet_owner).filter(Boolean),
    ];
    // the Map's stand-in payload: every raider, the target's target and every "by" on a timer or seen row
    const MF = await import('../scripts/raidmimic-shots/map-fixture.mjs');
    const mp = MF.mapState();
    names.push(mp.me.name, mp.self.name, ...mp.raid.map(r => r.name), ...mp.group.map(r => r.name), mp.target.tot.name,
      ...mp.timers.map(t => t.by), ...mp.seen.map(t => t.by));
    expect(mp.raid.length).toBeGreaterThanOrEqual(4);
    // the second set (the raid pull in Plane of Disease): the Map, Target Info, the HUD, CH Chain and the DPS meters
    const rm = MF.raidMapState(), td = F.targetDebuffs(), me = F.me(), ch = F.chChain().chChain, tr = F.threatRaid(), dr = F.dpsRaid();
    names.push(rm.me.name, rm.self.name, ...rm.raid.map(r => r.name), ...rm.group.map(r => r.name), rm.target.tot.name,
      ...rm.timers.map(t => t.by), ...rm.seen.map(t => t.by),
      td.activeCharacter, ...td.mobInfo.target_buffs.map(b => b.owner).filter(Boolean),
      me.character, ...me.group.map(g => g.name),
      ch.target, ...Object.values(ch.slots).map(s => s.name),
      tr.activeCharacter, tr.currentEncounterThreat.uploader, ...Object.keys(tr.currentEncounterThreat.perPlayer),
      dr.activeCharacter, ...Object.keys(dr.currentEncounterThreat.perPlayer), ...Object.keys(dr.currentEncounterThreat.spans),
      ...Object.values(dr.currentEncounterThreat.perPlayer).map(p => p.pet_owner).filter(Boolean));
    expect(rm.raid.length + rm.group.length).toBeGreaterThanOrEqual(8);
    expect(names.length).toBeGreaterThan(120);
    const allowed = new Set([...F.PLAYERS, ...F.PETS]);
    for (const n of names) expect(allowed.has(n), n).toBe(true);
    // …and the page's own words name no person at all
    const words = allText() + sceneSrc();
    for (const n of F.PLAYERS) expect(words, n).not.toContain(n);
  });

  it('the Map stand-in’s walls are EQEmu-generated (GPL, credited in the file), never a members-only map', () => {
    const walls = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/raidmimic-shots/map-walls-ponightmare.json'), 'utf8'));
    expect(walls._about).toMatch(/EQEmu\/maps/);
    expect(walls._about).toMatch(/GPLv2-or-later/);
    expect(walls.segs.length).toBeGreaterThan(300);
    for (const g of walls.segs) expect(g[4]).toBeLessThan(walls.bands.length);
  });

  it('so are the Plane of Disease walls: sliced from the EQEmu mesh, credited in the file, no Brewall lines', () => {
    const walls = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/raidmimic-shots/map-walls-podisease.json'), 'utf8'));
    expect(walls._about).toMatch(/EQEmu\/maps/);
    expect(walls._about).toMatch(/GPLv2-or-later/);
    expect(walls._about).toMatch(/Not Brewall/);
    expect(walls.segs.length).toBeGreaterThan(300);
    for (const g of walls.segs) expect(g[4]).toBeLessThan(walls.bands.length);
  });
});


// ─── Pick your path (the guild lead's pick, 2026-10-23): the one layout ─────────────────────────────────────────────
