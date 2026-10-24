// test/raidmimic-landing.test.js — the raidmimic.com front door (the guild lead, 2026-10-18, option C "two doors"; made
// player-first, with "Pick your path" as the one layout, on 2026-10-23). Modelled on test/eqmimic-landing.test.js.
//
// What this pins:
//   - the host list (six hosts, exact match, lookalikes refused) and the routing function: every path on those
//     hosts goes to /raidmimic with EVERY query parameter dropped (robots.txt and sitemap.xml to their own files, the
//     page's own captures, clips and drawing served as themselves),
//   - the middleware, RUN against a stand-in for next/server, agrees, and the eqmimic host still behaves as before;
//     the branch sits before any session work and the link-preview rewrite,
//   - the root layout gives the raidmimic hosts the same bare shell as eqmimic's,
//   - the page: ONE layout ("Pick your path", the guild lead's pick, 2026-10-23; no `?v=` switch, the Ladder and the
//     Scene-first layouts are deleted), the player-first title, indexing ON for the raidmimic hosts only with
//     https://raidmimic.com/ as the canonical address (noindex on the Wolf Pack hosts), robots.txt and the sitemap,
//     the [beta] tag, and the Register-interest address (the existing anonymous form, text in the FRAGMENT),
//   - the scene player: two audiences (raiders; raid leaders and guild leaders), every scene with its beat's caption
//     and its files on disk, no empty tab,
//   - "How it works": the four-step drawing, a static file in a lazy frame, no external request, no name of a person
//     and nothing marked live that the page marks Coming,
//   - the layout carries every required section and draws its words from the content modules,
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
  RAIDMIMIC_HOSTS, RAIDMIMIC_LANDING_PATH, RAIDMIMIC_ORIGIN, isRaidmimicAsset, isRaidmimicHost, raidmimicLandingTarget, raidmimicSeo,
} from '../web/lib/raidmimicHost.ts';
import { isEqmimicHost } from '../web/lib/eqmimicHost.ts';
import * as C from '../web/lib/raidmimicLanding.ts';
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
  it('is the six hosts the guild lead bought, with and without www', () => {
    expect(RAIDMIMIC_HOSTS).toEqual([
      'raidmimic.com', 'www.raidmimic.com', 'raidmimic.net', 'www.raidmimic.net', 'raidmimic.quest', 'www.raidmimic.quest',
    ]);
  });
  it('matches any case and an optional port, exactly', () => {
    for (const h of [...RAIDMIMIC_HOSTS, 'RaidMimic.COM', 'raidmimic.com:443', 'www.raidmimic.net:3000']) expect(isRaidmimicHost(h), h).toBe(true);
  });
  it('refuses lookalikes, the other front doors and empties', () => {
    for (const h of ['raidmimic.com.evil.com', 'evil-raidmimic.com', 'sub.raidmimic.com', 'raidmimic.org', 'eqmimic.quest',
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
    for (const h of [...RAIDMIMIC_HOSTS, 'RaidMimic.COM:443']) {
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
  it('robots.txt allows everything and names the sitemap on the canonical host; the sitemap lists the two pages', async () => {
    const robots = await (await (await import('../web/app/raidmimic/robots.txt/route.ts')).GET()).text();
    expect(robots).toBe('User-agent: *\nAllow: /\n\nSitemap: https://raidmimic.com/sitemap.xml\n');
    expect(robots).not.toMatch(/Disallow/);
    const res = await (await import('../web/app/raidmimic/sitemap.xml/route.ts')).GET();
    expect(res.headers.get('content-type')).toMatch(/^application\/xml/);
    const xml = await res.text();
    expect([...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1])).toEqual(['https://raidmimic.com/', 'https://raidmimic.com/setup']);
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
  it('renders ONE layout, “Pick your path”, with one preview flag: `?v=motion` and nothing else; no Ladder, no Scene-first layout, no variant bar', () => {
    expect(page).toMatch(/return <PathsLayout ctx=\{ctx\} motion=\{IS_BETA && searchParams\?\.v === 'motion'\} \/>;/);
    expect(page.match(/<[A-Z]\w+Layout /g)).toHaveLength(1);
    expect(page.match(/searchParams/g)).toHaveLength(3);                       // the destructured parameter, its type and the one read
    expect(page.match(/\bv === /g)).toHaveLength(1);
    expect(page).not.toMatch(/variantOf|LadderLayout|SceneLayout|PreviewBar/);
    expect(page).not.toMatch(/hero=|raidmimicVariant|PitchLayout|TourLayout|OutputLayout|WatchLayout|StoryLayout|ScreenLayout/);
    for (const gone of ['LadderLayout', 'SceneLayout', 'VariantParts', 'TourLayout', 'OutputLayout', 'WatchLayout', 'StoryLayout', 'ScreenLayout', 'PitchLayout', 'Figures']) {
      expect(fs.existsSync(path.join(ROOT, `${L}${gone}.tsx`)), gone).toBe(false);
    }
    expect(C).not.toHaveProperty('raidmimicVariant');
    expect(C).not.toHaveProperty('BLOCKS');
    for (const gone of ['STORY', 'SCREEN_NOTES', 'SETUP_LINK', 'ILLUSTRATIVE_NOTE', 'HERO', 'MOMENTS']) expect(C, gone).not.toHaveProperty(gone);
    for (const gone of ['VARIANTS', 'VARIANT_LABEL', 'variantOf', 'PREVIEW_NOTE', 'PLAYER', 'JUMP', 'GUILD', 'RUN', 'LINUX_URL']) expect(PL, gone).not.toHaveProperty(gone);
    // the layered mascot hero (the guild lead, 2026-10-21) is kept: it opens “See it run”
    expect(page).not.toMatch(/Mascot|MotionStage/);
    expect(code(L + 'PathsLayout.tsx')).toMatch(/\{!motion && <MascotHero \/>\}/);   // the default page still opens “See it run” with it
  });
  it('the Register-interest address is the anonymous form: absolute on a raidmimic host, its real path on Wolf Pack hosts', () => {
    expect(page).toMatch(/interest: interestUrl\(`\$\{EQMIMIC_ORIGIN\}\/feedback`\)/);
    expect(page).toMatch(/interest: interestUrl\(EQMIMIC_FEEDBACK_PATH\)/);
    expect(C.EQMIMIC_ORIGIN + '/feedback').toBe('https://eqmimic.quest/feedback');
    expect(C.EQMIMIC_FEEDBACK_PATH).toBe('/eqmimic/feedback');
    // the form really is at that path, and really reads a fragment
    expect(fs.existsSync(path.join(ROOT, 'web/app/eqmimic/feedback/page.tsx'))).toBe(true);
    expect(code('web/app/eqmimic/feedback/AnonFeedbackForm.tsx')).toMatch(/window\.location\.hash/);
  });
  it('interestUrl puts an Idea and the template in the FRAGMENT, never the query string, and it round-trips', () => {
    const u = C.interestUrl('https://eqmimic.quest/feedback');
    expect(u.startsWith('https://eqmimic.quest/feedback#')).toBe(true);
    expect(u).not.toMatch(/\?/);
    const p = new URLSearchParams(u.split('#')[1]);
    expect(p.get('cat')).toBe('idea');
    expect(p.get('text')).toBe(C.INTEREST_TEXT);
    expect(C.INTEREST_TEXT.length).toBeLessThan(400);   // the form keeps 4000; this is a template, not an essay
  });
  it('no mailto, no new form, no new endpoint', () => {
    for (const f of ['page.tsx', 'Parts.tsx', 'PathsLayout.tsx', 'HowItWorks.tsx', 'ClipTabs.tsx', 'SceneClip.tsx', 'MascotHero.tsx', 'MascotVideo.tsx', 'MotionStage.tsx']) {
      const src = f === 'page.tsx' ? page : code(L + f);
      expect(src, f).not.toMatch(/mailto:|<form\b|fetch\(|action=/);
    }
    expect(allText()).not.toMatch(/mailto:|@[a-z0-9-]+\.[a-z]{2,}/i);
  });
});

describe('the layout', () => {
  const scene = code(L + 'PathsLayout.tsx');
  const parts = code(L + 'Parts.tsx');

  it('the [beta] tag is the site’s NewPageTag, at the top, and its link works on a raidmimic host', () => {
    expect(parts).toMatch(/import NewPageTag from '@\/components\/NewPageTag'/);
    expect(parts).toMatch(/<NewPageTag [^>]*href=\{ctx\.onHost \? ctx\.interest : '\/feedback'\}/);
    expect(scene.indexOf('<BetaTag')).toBeGreaterThan(-1);
    expect(scene.indexOf('<BetaTag')).toBeLessThan(scene.indexOf('<header'));
    expect(code('web/components/NewPageTag.tsx')).toMatch(/href = '\/feedback'/);   // every other page keeps its link
  });

  // The required sections, by the id the layout gives them.
  const REQUIRED = ['works-with', 'data', 'cost', 'worlds'];
  it('carries the hero, the three doors, “See it run” (the mascot and captures, the scene player, the gallery), “How it works”, the four facts folded away, the coming list and the ask, in that order', () => {
    const order = ['<header', 'DOORS.map', 'id="see"', '<MascotHero', '<ClipTabs', '<MoreShots', 'id={HOW.id}', '<HowItWorks', ...REQUIRED.map(r => `id="${r}"`), '<ComingList', '<CtaBand', '<Footer'].map(s => scene.indexOf(s));
    expect(order.every(i => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(parts).toMatch(/<details\b/);
    expect(scene).toMatch(/lg:grid-cols-3/);   // the doors side by side from lg, stacked on a phone
  });
  it('takes the section bodies from Parts, so a fact is corrected in one place', () => {
    for (const body of ['WorksWithBody', 'DataBody', 'CostBody', 'WorldsBody']) expect(scene, body).toMatch(new RegExp(`<${body} />`));
  });
  it('the Register-interest address is on the Guild door and the Self-host door’s second link, and again at the end', () => {
    expect(parts).toMatch(/export function CtaBand[\s\S]*?<InterestButton ctx=\{ctx\} \/>/);
    expect(parts).toMatch(/href=\{ctx\.interest\}/);
    expect(scene.match(/ctx\.interest/g)?.length).toBeGreaterThanOrEqual(1);
    expect(scene).toMatch(/<CtaBand ctx=\{ctx\} \/>/);
  });
  it('the layout switch is gone: no VariantSwitch, no PreviewBar, no ?v= link, no landing path on the context', () => {
    expect(parts).not.toMatch(/VariantSwitch|\?v=|Layout preview|landing:|PreviewBar/);
    expect(scene).not.toMatch(/VariantSwitch|PreviewBar|\?v=/);
    expect(code('web/app/raidmimic/page.tsx')).not.toMatch(/landing:/);
  });
  it('the old text hero is gone from Parts (the doors page has its own header); the player’s `only` mode went with the Ladder', () => {
    expect(parts).not.toMatch(/export function Hero\b/);
    expect(code(L + 'ClipTabs.tsx')).not.toMatch(/\bonly\b/);
  });
  it('the footer carries the rights notice and the fan-project line, verbatim from the eqmimic module', () => {
    expect(C.RIGHTS_NOTICE).toBe(EQ.RIGHTS_NOTICE);
    expect(C.FAN_PROJECT_LINE).toBe(EQ.FAN_PROJECT_LINE);
    const footer = parts.slice(parts.indexOf('export function Footer'));
    expect(footer).toMatch(/\{RIGHTS_NOTICE\}/);
    expect(footer).toMatch(/\{FAN_PROJECT_LINE\}/);
    expect(footer).not.toMatch(/text-\[(?:9|10|11)px\]/);
    expect(scene.indexOf('<Footer')).toBeGreaterThan(scene.lastIndexOf('</section>'));
  });
  it('server components except the five that play: only SceneClip, ClipTabs, MascotVideo, MotionStage and the drawing’s frame are client files', () => {
    for (const f of ['Parts.tsx', 'MascotHero.tsx', 'PathsLayout.tsx']) expect(read(L + f), f).not.toMatch(/['"]use client['"]/);
    expect(read('web/app/raidmimic/page.tsx')).not.toMatch(/['"]use client['"]/);
    for (const f of ['SceneClip.tsx', 'ClipTabs.tsx', 'MascotVideo.tsx', 'MotionStage.tsx', 'HowItWorks.tsx']) expect(read(L + f), f).toMatch(/^'use client';/);
    expect(fs.readdirSync(path.join(ROOT, L)).sort()).toEqual([
      'ClipTabs.tsx', 'FeatureIcons.tsx', 'HowItWorks.tsx', 'MascotHero.tsx', 'MascotVideo.tsx', 'MotionStage.tsx', 'Parts.tsx', 'PathsLayout.tsx', 'SceneClip.tsx',
    ]);
  });
  it('fetches and embeds nothing external; every outbound link is one we name', () => {
    const urls = new Set();
    for (const f of ['page.tsx', 'Parts.tsx', 'ClipTabs.tsx', 'SceneClip.tsx', 'MascotHero.tsx', 'MascotVideo.tsx', 'MotionStage.tsx', 'PathsLayout.tsx', 'HowItWorks.tsx']) {
      for (const m of (f === 'page.tsx' ? code('web/app/raidmimic/page.tsx') : code(L + f)).matchAll(/https?:\/\/[^\s'"`)<>]+/g)) urls.add(m[0]);
    }
    expect([...urls]).toEqual([]);   // every address is a constant in the content module
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
  return ['PathsLayout', 'HowItWorks', 'ClipTabs', 'SceneClip', 'MascotHero', 'MascotVideo'].map(f => code(`${L}${f}.tsx`)).join('\n');
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

// ─── Scene-first, the guild lead's pick (Decision Desk 2026-10-22, card raidmimic-layout-clips) ────────────────
// "Individual raiders or players get quite a bit out of the overlays, Raid Leaders and guild leaders get more out of
// the coordination and orchestration bits. It should really be a combination." The recordings are made by another
// process (scripts/raidmimic-shots/scenes.mjs), so this checks the files that ship, not how they were made.
describe('the scene player (Scene-first)', () => {
  const CLIP_DIR = path.join(ROOT, 'web/public/raidmimic/clips');
  const tabs = code(L + 'ClipTabs.tsx');
  const scene = code(L + 'SceneClip.tsx');
  const layout = code(L + 'PathsLayout.tsx');

  it('is organised by two audiences, raiders first and then raid leaders and guild leaders, and the layout uses the player', () => {
    expect(C.AUDIENCES.map(a => [a.id, a.label])).toEqual([
      ['raiders', 'For raiders'], ['leaders', 'For raid leaders and guild leaders'],
    ]);
    for (const a of C.AUDIENCES) expect(C.CLIPS.some(c => c.audience === a.id), a.id).toBe(true);   // no audience tab without a scene
    for (const c of C.CLIPS) expect(C.AUDIENCES.map(a => a.id), c.id).toContain(c.audience);
    expect(layout).toMatch(/<ClipTabs \/>/);
    expect(layout).not.toMatch(/\.mp4|-poster|\/raidmimic\/clips/);
  });

  it('keeps the guild lead’s mix: the overlays for raiders, the coordination (the hail board) for leaders', () => {
    const by = (a) => C.CLIPS.filter(c => c.audience === a).map(c => c.id);
    expect(by('raiders')).toEqual(['target-debuffs', 'xtarget-split']);
    expect(by('leaders')).toEqual(['grummus-hail']);
    expect(C.CLIPS.map(c => c.id)).toEqual(['target-debuffs', 'xtarget-split', 'grummus-hail']);   // the raid night, in order
  });

  it('every scene carries its beat: a step, a head and the sentence that is its caption', () => {
    expect(C.CLIPS.map(c => c.step)).toEqual(['The debuffs', 'The split', 'The kill and the hail']);
    for (const c of C.CLIPS) {
      expect(c.id, c.id).toMatch(/^[a-z-]+$/);
      expect(c.title.length, c.id).toBeGreaterThan(3);
      expect(c.head.length, c.id).toBeGreaterThan(8);
      expect(c.line.length, c.id).toBeGreaterThan(40);
      expect(c.alt.length, c.id).toBeGreaterThan(40);
      expect(c.w, c.id).toBeGreaterThan(100);
      expect(c.h, c.id).toBeGreaterThan(100);
    }
    expect(C.CLIPS_NOTE).toMatch(/invented/);
    expect(tabs).toMatch(/\{clip\.step\}/);
    expect(tabs).toMatch(/\{clip\.head\}/);
    expect(tabs).toMatch(/\{clip\.line\}/);
  });

  it('there is never an empty tab: every scene has its mp4 and poster on disk, and an audience tab shows only with a scene', () => {
    for (const c of C.CLIPS) {
      expect(C.clipSrc(c.id, 'video')).toBe(`/raidmimic/clips/${c.id}.mp4`);
      expect(C.clipSrc(c.id, 'poster')).toBe(`/raidmimic/clips/${c.id}-poster.webp`);
      expect(fs.existsSync(path.join(CLIP_DIR, `${c.id}.mp4`)), `${c.id}.mp4`).toBe(true);
      expect(fs.existsSync(path.join(CLIP_DIR, `${c.id}-poster.webp`)), `${c.id}-poster.webp`).toBe(true);
    }
    expect(fs.readdirSync(CLIP_DIR).sort()).toEqual(C.CLIPS.flatMap(c => [`${c.id}-poster.webp`, `${c.id}.mp4`]).sort());
    expect(tabs).toMatch(/AUDIENCES\.filter\(a => CLIPS\.some\(c => c\.audience === a\.id\)\)/);
    expect(tabs).toMatch(/scenes\.length > 1/);
    expect(JSON.stringify(C.CLIPS)).not.toMatch(/DKP|loot rolls/i);   // next to record, but not shown until it exists
    const mod = code('web/lib/raidmimicLanding.ts');
    expect(mod.match(/-poster\.webp/g)).toHaveLength(1);
    expect(mod.match(/\.mp4/g)).toHaveLength(1);
    expect(C.CLIPS_DIR).toBe('/raidmimic/clips');
  });

  it('each mp4 is at most 1.5 MB and each poster at most 200 KB', () => {
    for (const c of C.CLIPS) {
      expect(fs.statSync(path.join(CLIP_DIR, `${c.id}.mp4`)).size, `${c.id}.mp4`).toBeLessThanOrEqual(1.5 * 1024 * 1024);
      expect(fs.statSync(path.join(CLIP_DIR, `${c.id}-poster.webp`)).size, `${c.id}-poster.webp`).toBeLessThanOrEqual(200 * 1024);
    }
  });

  it('the tablists are real: tab roles, the selected one in the tab order, arrow keys, one clip mounted at a time', () => {
    expect((tabs.match(/role="tablist"/g) || []).length).toBe(2);
    expect(tabs).toMatch(/role="tab"/);
    expect(tabs).toMatch(/aria-selected=/);
    expect(tabs).toMatch(/role="tabpanel"/);
    expect(tabs).toMatch(/tabIndex=\{/);
    expect(tabs).toMatch(/ArrowRight/);
    expect((tabs.match(/<SceneClip /g) || []).length).toBe(1);   // only the open scene is mounted, so the others are not fetched
    expect(tabs).toMatch(/<SceneClip key=\{clip\.id\} id=\{clip\.id\} \/>/);
    expect(tabs).toMatch(/min-h-11/);   // a tap target, on a phone
  });

  it('SceneClip: muted looping inline video with a poster, sized from the clip, swapped for the poster under reduced motion, paused off screen', () => {
    expect(scene).toMatch(/autoPlay muted loop playsInline preload="metadata"/);
    expect(scene).toMatch(/poster=\{clipSrc\(clip\.id, 'poster'\)\}/);
    expect(scene).toMatch(/width=\{clip\.w\} height=\{clip\.h\}/);
    expect(scene).toMatch(/className=\{`block h-auto w-full motion-reduce:hidden/);
    expect(scene).toMatch(/hidden h-auto w-full motion-reduce:block/);
    expect(scene).toMatch(/prefers-reduced-motion: reduce/);
    expect(scene).toMatch(/IntersectionObserver/);
    expect(scene).not.toMatch(/https?:\/\/|\.mp4|-poster\.webp/);
  });

  it('sizes by aspect ratio: no fixed pixel widths', () => {
    for (const f of ['PathsLayout.tsx', 'SceneClip.tsx', 'ClipTabs.tsx', 'HowItWorks.tsx']) {
      expect(code(L + f), f).not.toMatch(/\bw-\[\d+px\]|\bmin-w-\[\d+px|\bh-\[\d+px\]|width: \d+px/);
    }
    expect(tabs).toMatch(/calc\(75vh \* \$\{clip\.w\} \/ \$\{clip\.h\}\)/);
  });

  it('the copy names no person and breaks none of the page rules', () => {
    const t = JSON.stringify([C.CLIPS, C.AUDIENCES, C.CLIPS_NOTE, C.CLIPS_HEAD]);
    expect(t).not.toMatch(/\$\s?\d|per (?:month|year|seat|user|raider)|free trial|testimonial|trusted by|“|”|\bsaid\b/i);
    expect(t).not.toMatch(/\b\d[\d,]*\+? (?:guilds|customers|raiders|users|teams)\b/i);
    expect(t).not.toMatch(/https?:\/\/|mailto:/);
  });
});

// ─── The hero: the layered mascot with the overlay captures around it (the guild lead, 2026-10-21: "i like B for the hero") ──
describe('the mascot hero', () => {
  const hero = code(L + 'MascotHero.tsx');
  const video = read(L + 'MascotVideo.tsx');
  const MASCOT = path.join(ROOT, 'web/public/raidmimic/mascot');
  const SHOTS_DIR = path.join(ROOT, 'web/public/raidmimic/shots');

  // Pixel size of a WebP file, from its header (lossy "VP8 ", lossless "VP8L", or extended "VP8X").
  function webpSize(file) {
    const b = fs.readFileSync(file);
    expect(b.toString('ascii', 0, 4)).toBe('RIFF');
    expect(b.toString('ascii', 8, 12)).toBe('WEBP');
    const kind = b.toString('ascii', 12, 16);
    if (kind === 'VP8 ') return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
    if (kind === 'VP8X') return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
    const bits = b.readUInt32LE(21);   // VP8L
    return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 };
  }

  it('opens “See it run”: after the doors, then the mascot, then the scene player', () => {
    const scene = code(L + 'PathsLayout.tsx');
    expect(scene.indexOf('DOORS.map')).toBeLessThan(scene.indexOf('<MascotHero'));
    expect(scene.indexOf('<MascotHero')).toBeLessThan(scene.indexOf('<ClipTabs'));
    expect(scene).toMatch(/\{SHOTS_HEAD\.note\} \{MAP_CREDIT\}/);   // "made-up data" and the Map's walls credit sit under it
  });

  it('the mascot clip and poster are small mp4/jpg files only (no webm), each under 600 KB, and the howl clip is gone', () => {
    for (const f of ['hop.mp4', 'hop-poster.jpg']) {
      const size = fs.statSync(path.join(MASCOT, f)).size;
      expect(size, f).toBeGreaterThan(1000);
      expect(size, f).toBeLessThan(600 * 1024);
    }
    expect(fs.readFileSync(path.join(MASCOT, 'hop-poster.jpg'))[0]).toBe(0xff);
    expect(fs.readdirSync(MASCOT).sort()).toEqual(['hop-poster.jpg', 'hop.mp4']);
    expect(hero).not.toMatch(/howl/i);
    expect(video).not.toMatch(/howl/i);
  });

  it('the hop loops, muted inline autoplay with a poster', () => {
    expect(hero).toMatch(/<MascotVideo src=\{`\$\{DIR\}\/hop\.mp4`\}[^>]*\bloop\b/);
    expect(video).toMatch(/autoPlay muted loop=\{loop\} playsInline/);
    expect(video).toMatch(/poster=\{poster\}/);
  });

  it('honours prefers-reduced-motion: CSS swaps the clip for its poster and the script frees the clip', () => {
    expect(video).toMatch(/motion-reduce:hidden/);
    expect(video).toMatch(/hidden motion-reduce:block/);
    expect(video).toMatch(/prefers-reduced-motion: reduce/);
    const css = read('web/app/globals.css');
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.rm-card \{ animation: none; \}/);
  });

  it('the fan-in animates transform and opacity only', () => {
    const css = read('web/app/globals.css');
    const kf = css.slice(css.indexOf('@keyframes rm-fan'), css.indexOf('@media (min-width: 1024px)', css.indexOf('@keyframes rm-fan')));
    const props = [...kf.matchAll(/([a-z-]+)\s*:/g)].map(m => m[1]);
    for (const p of props) expect(['opacity', 'transform'], p).toContain(p);
    expect(props.length).toBeGreaterThan(0);
  });

  it('uses every capture once, from the one shots folder, and only the content module: the hero fans the first seven, the gallery shows the rest', () => {
    expect(C.SHOTS.map(s => s.id)).toEqual(['map', 'cc', 'target-stats', 'target-quest', 'dps', 'rolls', 'timeline',
      'map-raid', 'map-target', 'target-debuffs', 'hud-box', 'ch-chain', 'dps-raid']);
    const ids = [...hero.matchAll(/\{ id: '([a-z-]+)',\s+l:/g)].map(m => m[1]);
    expect(ids.sort()).toEqual(C.SHOTS.filter(s => !s.more).map(s => s.id).sort());
    expect(C.SHOTS.filter(s => s.more).map(s => s.id)).toEqual(['map-raid', 'map-target', 'target-debuffs', 'hud-box', 'ch-chain', 'dps-raid']);
    expect(hero).toMatch(/SHOTS_DIR/);
    expect(C.SHOTS_DIR).toBe('/raidmimic/shots');
    expect(hero).not.toMatch(/https?:\/\/|mailto:|<form\b|fetch\(/);
    for (const s of C.SHOTS) {
      expect(s.alt.length, s.id).toBeGreaterThan(40);
      expect(s.line.length, s.id).toBeGreaterThan(30);
    }
  });

  it('the capture files exist, are WebP, are under 200 KB and are the size the module says', () => {
    for (const s of C.SHOTS) {
      const f = path.join(SHOTS_DIR, s.file);
      expect(fs.existsSync(f), s.file).toBe(true);
      expect(s.file).toMatch(/^[a-z-]+\.webp$/);
      expect(fs.statSync(f).size, s.file).toBeLessThan(200 * 1024);
      expect(webpSize(f), s.file).toEqual({ w: s.w, h: s.h });
      expect(fs.readFileSync(f).includes(Buffer.from('Exif')), `${s.file} carries no metadata`).toBe(false);
    }
    expect(fs.readdirSync(SHOTS_DIR).sort()).toEqual(C.SHOTS.map(s => s.file).sort());
  });

  it('the Map capture credits its walls to EQEmu (never Brewall), and the credit is on the page', () => {
    const m = C.SHOTS.find(s => s.id === 'map');
    expect(m).toMatchObject({ file: 'map.webp', w: 2000, h: 1180, title: 'Map', credit: C.MAP_CREDIT });
    expect(C.MAP_CREDIT).toBe('Generated walls: EQEmu maps (GPLv2+, © EQEmulator.NET, AX-Classic and ProjectEQ).');
    expect(JSON.stringify([C.SHOTS, C.SHOTS_HEAD])).not.toMatch(/Brewall/i);
  });

  it('is responsive: the cards are a swipe row under lg and fan out from lg, with no fixed pixel page width', () => {
    expect(hero).toMatch(/lg:contents/);
    expect(hero).toMatch(/overflow-x-auto/);
    expect(hero).not.toMatch(/\bmin-w-\[/);
  });
});

// ─── More captures under the player (the guild lead, 2026-10-23: "update raidmimic.com with more assets") ───────────
describe('the gallery of more captures', () => {
  const parts = code(L + 'Parts.tsx');
  const layout = code(L + 'PathsLayout.tsx');
  const more = C.SHOTS.filter(s => s.more);

  it('is on the one page both hosts render: the layout places it after the scene player and before “How it works”', () => {
    expect(layout).toMatch(/<MoreShots \/>/);
    expect(layout.indexOf('<ClipTabs')).toBeLessThan(layout.indexOf('<MoreShots'));
    expect(layout.indexOf('<MoreShots')).toBeLessThan(layout.indexOf('<HowItWorks'));
    expect(code('web/app/raidmimic/page.tsx')).toMatch(/return <PathsLayout ctx=\{ctx\} motion=\{IS_BETA && searchParams\?\.v === 'motion'\} \/>;/);
  });
  it('draws only the shots flagged `more`, from the content module, as full-size links with their size and alt text', () => {
    expect(more).toHaveLength(6);
    expect(parts).toMatch(/SHOTS\.filter\(s => s\.more\)/);
    expect(parts).toMatch(/<img src=\{src\} width=\{s\.w\} height=\{s\.h\} alt=\{s\.alt\}/);
    expect(parts).toMatch(/href=\{src\} target="_blank" rel="noreferrer"/);
    expect(C.MORE_HEAD.title).toBe('More of what the raid sees');
    expect(C.MORE_HEAD.note).toMatch(/invented/);
  });
  it('the Map captures name their walls’ source, and every capture’s words name no person', () => {
    for (const s of more.filter(s => /^map/.test(s.id))) expect(s.credit, s.id).toBe(C.MAP_CREDIT);
    expect(JSON.stringify([more, C.MORE_HEAD])).not.toMatch(/Brewall/i);
  });
});

// The recordings are made from fixtures with invented raider names (scripts/raidmimic-shots). The fixtures also drive
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
// "less about me setting it up as a service for them and more about here's what you get as a player, here's what you could
// have as a guild ... use this yourself, but I can help you with a self-hosted version". The page reads
// web/lib/raidmimicPlayer.ts for the doors and web/lib/raidmimicLanding.ts for the facts it has always stated.
describe('Pick your path: three doors by who is reading', () => {
  const P = PL;
  const paths = code(L + 'PathsLayout.tsx');
  const mod = code('web/lib/raidmimicPlayer.ts');

  it('has the doors Player, Guild and Self-host, each with a story, three points and its own next step', () => {
    expect(P.DOORS.map(d => [d.id, d.name])).toEqual([['player', 'Player'], ['guild', 'Guild'], ['selfhost', 'Self-host']]);
    for (const d of P.DOORS) {
      expect(d.story.length, d.id).toBeGreaterThan(40);
      expect(d.points, d.id).toHaveLength(3);
      expect(d.next.length, d.id).toBeGreaterThan(5);
      expect(d.more.length, d.id).toBeGreaterThan(5);
      expect(['free', 'hub', 'choice'], d.id).toContain(d.tone);
    }
    expect(paths).toMatch(/DOORS\.map\(d => <DoorCard key=\{d\.id\} door=\{d\} ctx=\{ctx\} \/>\)/);
    expect(paths).toMatch(/lg:grid-cols-3/);   // side by side from lg, stacked on a phone
  });
  it('each door ends in a real address: the download, the ask, the self-hosting guide (which exists)', () => {
    expect(paths).toMatch(/href=\{DOWNLOAD_URL\} className=\{PRIMARY_BTN\}/);
    expect(paths).toMatch(/href=\{SELFHOST_GUIDE_URL\} \{\.\.\.EXT\}/);
    expect(paths.match(/ctx\.interest/g)?.length).toBeGreaterThanOrEqual(1);
    expect(P.SELFHOST_GUIDE_URL).toBe('https://github.com/davehess/QuarmBossTracker/blob/main/docs/SELFHOSTING.md');
    expect(fs.existsSync(path.join(ROOT, 'docs/SELFHOSTING.md'))).toBe(true);
  });
  it('the page: beta tag, short hero, the doors, “See it run”, “How it works”, the small print, the coming list and the ask', () => {
    const at = (s) => { const i = paths.indexOf(s); expect(i, s).toBeGreaterThan(-1); return i; };
    const list = ['<BetaTag', '<header', 'DOORS.map', 'id="see"', '<MascotHero', '<ClipTabs />', '<MoreShots />', 'id={HOW.id}', '<HowItWorks />', 'id="works-with"', 'id="worlds"', '<ComingList', '<CtaBand', '<Footer'];
    const idx = list.map(at);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
  });
  it('the download is the same direct link eqmimic.quest uses, served by the /mimic route', () => {
    expect(P.DOWNLOAD_URL).toBe('https://wolfpack.quest/mimic?direct=1');
    expect(P.DOWNLOAD_URL).toBe(`${EQ.WOLFPACK_ORIGIN}${EQ.DOWNLOAD_PATH}`);
    expect(code('web/app/mimic/route.ts')).toMatch(/searchParams\.get\('direct'\) === '1'/);
  });
  it('says only what runs today as fact: free, Windows, no account, local mode; what is not built is Coming', () => {
    expect(P.HERO.fine).toMatch(/No guild, account or password/);
    expect(P.HERO.fine).toMatch(/free and open source/);
    expect(P.DOORS.find(d => d.id === 'player').story).toMatch(/choose Just me on the first screen/);
    expect(read('apps/mimic/welcome.html')).toMatch(/Just me — stays on this PC/);
    expect(P.DOORS.find(d => d.id === 'guild').story).toMatch(/When enough of them run it, a guild hub adds them up/);
    expect(P.TAG.hub).toBe('Needs your guild’s server');
    expect(P.TAG.free).toBe('Free · works today');
    expect(C.COMING.join(' ')).toMatch(/multi-guild hosting/);
  });
  it('invents no price, count, testimonial or guarantee', () => {
    const t = JSON.stringify(P.ALL_TEXT);
    expect(t).not.toMatch(/\$|£|€|\bper (?:month|year|seat|user|raider)\b|\/\s?(?:mo|month|yr|year)\b|% off|money-back/i);
    expect(t).not.toMatch(/\b\d[\d,]*\+? (?:guilds|customers|raiders|users|teams)\b/i);
    expect(t).not.toMatch(/testimonial|trusted by|loved by|“[^”]*” said|\bsaid\b|uptime of|SLA\b|guaranteed/i);
    expect(mod).not.toMatch(/\$\d/);
  });
  it('is about the player first, not a service: no “as a service”, no “sign up”, no “contact sales”', () => {
    const t = JSON.stringify(P.ALL_TEXT);
    expect(t).not.toMatch(/as a service|sign up|contact sales|book a demo|pricing page|enterprise|orchestration/i);
    expect(P.HERO.kicker).toMatch(/free for every player/);
  });
  it('names no member, character or address, and the layout holds no sentence of its own beyond labels', () => {
    const t = JSON.stringify(P.ALL_TEXT) + mod + paths;
    expect(t).not.toMatch(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/);
    expect(t).not.toMatch(/zhtoekwakucbckvatfky|1168893924329402420|service_role|SUPABASE_|WOLFPACK_AGENT_TOKEN|Bearer /);
    expect(t).not.toMatch(/\b[a-z0-9]{32,}\b/i);
    expect(t).not.toMatch(/mailto:|<form\b|fetch\(/);
  });
  it('is phone-first: no fixed pixel widths, 44px tap targets', () => {
    expect(paths).not.toMatch(/\bw-\[\d+px\]|\bmin-w-\[\d+px|\bh-\[\d+px\]|width: \d+px|overflow-x-scroll/);
    expect(paths).toMatch(/min-h-11/);
  });
  it('the colours are the platform’s tokens and mean something: green free, blue needs a hub, gold your call', () => {
    expect(paths).toMatch(/free: 'border-green\/60 text-green'/);
    expect(paths).toMatch(/hub: 'border-blue\/60 text-blue'/);
    expect(paths).toMatch(/choice: 'border-gold\/70 text-gold'/);
    expect(paths).not.toMatch(/bg-\[#|border-\[#|text-\[#(?!f2ede1)/);   // only the page’s own cream for headings
  });
});

// ─── How it works: the four-step drawing (the guild lead, 2026-10-23: "add the about-page scene as a section") ────────
// One static file in a lazy frame (web/public/raidmimic/how/scene.html, ISO-GLOW, MIT). The hero, "who gets what", "two ways
// to run it", "what stays free" and the fan notice of the draft are NOT in it: the doors page already says them.
describe('How it works: the four-step drawing', () => {
  const SCENE = 'web/public/raidmimic/how/scene.html';
  const html = read(SCENE);
  const frame = code(L + 'HowItWorks.tsx');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');

  it('is a section of the page, after the captures, with the words from the story module', () => {
    expect(PL.HOW.id).toBe('how');
    expect(PL.HOW.title).toBe('How it works');
    expect(PL.HOW.steps).toEqual(['Overlays', 'The raid', 'Raid leader', 'Hosting']);
    expect(PL.HOW.src).toBe('/raidmimic/how/scene.html');
    expect(PL.HOW.note).toMatch(/A drawing, not a recording/);
    expect(PL.HOW.note).toMatch(/invented/);
    const layout = code(L + 'PathsLayout.tsx');
    expect(layout).toMatch(/<section id=\{HOW\.id\} aria-label=\{HOW\.title\}/);
    expect(layout).toMatch(/\{HOW\.lead\}/);
    expect(layout.indexOf('<MoreShots')).toBeLessThan(layout.indexOf('<HowItWorks'));
    expect(layout.indexOf('<HowItWorks')).toBeLessThan(layout.indexOf('id="works-with"'));
  });
  it('the frame is lazy, titled, has no scroll of its own, and takes its height from the drawing’s own same-origin message', () => {
    expect(read(L + 'HowItWorks.tsx')).toMatch(/^'use client';/);
    expect(frame).toMatch(/src=\{HOW\.src\}/);
    expect(frame).toMatch(/title=\{HOW\.frameTitle\}/);
    expect(frame).toMatch(/loading="lazy"/);
    expect(frame).toMatch(/scrolling="no"/);
    expect(frame).toMatch(/e\.origin !== window\.location\.origin \|\| e\.source !== frame\.current\?\.contentWindow/);
    expect(frame).toMatch(/d\.h > 100 && d\.h < 4000/);
    expect(frame).toMatch(/aspect-\[4\/5\] sm:aspect-\[4\/3\]/);   // the box it holds until the first message
    expect(frame).toMatch(/\{HOW\.openLink\} →/);                  // and a link to the drawing on its own page
    expect(frame).not.toMatch(/sandbox|allow=/);                   // same origin, our own file
    expect(PL.HOW.frameTitle.length).toBeGreaterThan(40);
    expect(scripts).toMatch(/window\.parent\.postMessage\(\{ rmScene: 'height', h \}, location\.origin\)/);
  });
  it('is one self-contained file: no external script, style, font or request, and a small one', () => {
    expect(html).not.toMatch(/<script[^>]*\ssrc=|<link\b|@import|googleapis|<img\b|<iframe/i);
    expect(scripts).not.toMatch(/fetch\(|XMLHttpRequest|WebSocket|localStorage|sessionStorage|document\.cookie|eval\(|new Function/);
    const urls = [...html.matchAll(/https?:\/\/[^\s'"`)<>]+/g)].map(m => m[0]);
    expect([...new Set(urls)].sort()).toEqual(['http://www.w3.org/2000/svg', 'https://iso-glow.vercel.app']);
    expect(fs.statSync(path.join(ROOT, SCENE)).size).toBeLessThan(80 * 1024);
    expect(html).toMatch(/^<!doctype html>/i);
    expect(html).toMatch(/<html lang="en" data-theme="dark">/);
    expect(html).toMatch(/<meta name="robots" content="noindex">/);
  });
  it('keeps the kit’s credit link and the reduced-motion handling', () => {
    expect(html).toMatch(/<a href="https:\/\/iso-glow\.vercel\.app" target="_blank" rel="noopener">Made with ISO-GLOW ↗<\/a>/);
    expect(html).toMatch(/prefers-reduced-motion: reduce/);
    expect(html).toMatch(/matchMedia\('\(prefers-reduced-motion: reduce\)'\)/);
  });
  it('has the four steps and nothing else of the draft: no hero, no sign-up button, no sections the doors already cover', () => {
    const names = [...html.matchAll(/\['mm-\d', '([^']+)'/g)].map(m => m[1]);
    expect(names).toEqual(PL.HOW.steps);
    expect(html).not.toMatch(/class="hero"|class="about"|class="notice"|class="btn"|class="cta"|Register interest|Who gets what|Two ways to run it|What stays free|Fan site notice/);
    expect(html).not.toMatch(/swatches|Glow colour|id="prev"|id="next"/);
  });
  it('its words match today’s facts: hosting is Coming, the guild lookup is Coming, the hub is needed, nothing is promised', () => {
    const text = html.replace(/<style>[\s\S]*?<\/style>/g, '');
    expect(text).toMatch(/HOSTED · COMING/);
    expect(text).toMatch(/hosted · coming · not built yet/);
    expect(text).toMatch(/Hosting for other guilds is not built yet/);
    expect(text).toMatch(/guild lookup and hosting we run for you are <b>coming<\/b>/);
    expect(text).toMatch(/text-anchor="middle">coming<\/text>/);   // the lookup box
    expect(text).toMatch(/Needs a guild hub/);
    expect(text).toMatch(/it is not turnkey yet/);
    // claims the draft made that this page does not stand behind
    expect(text).not.toMatch(/WE RUN IT|\/g\/your-guild|EQMIMIC\.QUEST|under a second|14-day|nightly backups|free trial|never to a player|as soon as it ends|the moment it ends/i);
    expect(text).not.toMatch(/\$\s?\d|per month|guarantee/i);
  });
  it('the people in it are invented: eight names, checked on 2026-10-23 against the guild’s characters, the who history and the NPC catalog', () => {
    // SELECT-only check on the production database, case-insensitive: 0 hits in characters.name, who_observations.character and
    // eqemu_npc_types.name for every name below and for the boss, "The Arbiter". A test cannot reach the database, so this list
    // is the record; adding a name means checking it the same way first.
    const names = [...html.matchAll(/const NAMES = \[([^\]]+)\]/g)][0][1].split(',').map(s => s.trim().replace(/'/g, ''));
    expect(names).toEqual(['Aldenmar', 'Brackwyn', 'Corvale', 'Rethlan', 'Nyssara', 'Theodric', 'Velmira', 'Zarrin']);
    expect(html).toMatch(/const BOSS = 'The Arbiter'/);
    expect(JSON.stringify(PL.ALL_TEXT)).not.toMatch(new RegExp(names.join('|')));
  });
  it('is served as itself on a raidmimic host, and is a part of the page, not a page of its own in search', () => {
    expect(isRaidmimicAsset(PL.HOW.src)).toBe(true);
    expect(fs.existsSync(path.join(ROOT, SCENE))).toBe(true);
    expect(html).toMatch(/<meta name="robots" content="noindex">/);
  });
});

// ─── `?v=motion` (the guild lead, 2026-10-24, picked "B — Strip"): the 3D mimic's story, then its loop; the captures in a strip.
//     Vertical, 9:16, the same day ("vertical is great for both mobile and desktop"): headline beside it on a desktop ─
describe('the motion preview (?v=motion)', () => {
  const stage = read(L + 'MotionStage.tsx');
  const stageCode = stripJs(stage);
  const css = stripCss(read('web/app/globals.css'));
  const M = 'web/public/raidmimic/motion/';

  // A file's own size, from its mp4 header (the first `tkhd` is the only video track): width and height are 16.16 numbers.
  const mp4Size = (rel) => {
    const b = fs.readFileSync(path.join(ROOT, rel));
    const i = b.indexOf('tkhd');
    return { w: b.readUInt32BE(i + 4 + 76) >>> 16, h: b.readUInt32BE(i + 4 + 80) >>> 16 };
  };
  // The one query that makes the video (and its box) square, read from the component.
  const SQUARE_QUERY = stageCode.match(/const SQUARE_QUERY = '([^']+)';/)[1];
  // The table the component picks the story's files from: src, w, h, media (a quoted string, or the SQUARE_QUERY constant).
  const files = [...stageCode.matchAll(/\{ src: `\$\{DIR\}\/([\w.-]+)`,\s*w: (\d+),\s*h: (\d+),\s*media: (?:'([^']*)'|(SQUARE_QUERY)) \}/g)]
    .map(m => ({ name: m[1], w: +m[2], h: +m[3], media: m[5] ? SQUARE_QUERY : m[4] }));
  const loops = [...stageCode.matchAll(/`\$\{DIR\}\/(loop-[\w-]+\.mp4)`/g)].map(m => m[1]);

  it('only a query of exactly `motion` changes the page, and it is a preview: the default tree has no stage and keeps the mascot hero', () => {
    const layout = code(L + 'PathsLayout.tsx');
    expect(layout).toMatch(/motion = false/);
    expect(layout).toMatch(/const Frame = motion \? MotionStage : Fragment;/);           // the headline is the stage's left column
    expect(layout).toMatch(/<Frame>\s*<header /);
    expect(layout).toMatch(/\{!motion && <MascotHero \/>\}/);
    expect(code('web/app/raidmimic/page.tsx')).toMatch(/motion=\{IS_BETA && searchParams\?\.v === 'motion'\}/);
    // a raidmimic host never sees it: the middleware drops every query (tested above), so only the Wolf Pack hosts can
    expect(raidmimicLandingTarget('/')).toEqual({ pathname: '/raidmimic', search: '' });
  });

  // The page went live before its video (the guild lead, 2026-10-24: "B now then A"): only a beta build honours the query,
  // so production, which does not carry the story files yet, can never point at them.
  it('only a beta build honours the preview: the flag is the build-time IS_BETA from web/lib/guild.ts', () => {
    const page = code('web/app/raidmimic/page.tsx');
    expect(page).toMatch(/import \{ IS_BETA \} from '@\/lib\/guild';/);
    expect(page.match(/IS_BETA/g)).toHaveLength(2);                              // the import and the one gate
  });

  // The story files ship on beta only until the video graduates; where they are absent, the two file checks below have
  // nothing to check (and the gate above is what keeps production from asking for them).
  const itFiles = fs.existsSync(path.join(ROOT, M)) ? it : it.skip;

  // A JPEG's own size, from its SOF marker.
  const jpegSize = (rel) => {
    const b = fs.readFileSync(path.join(ROOT, rel));
    for (let i = 2; i < b.length;) { if (b[i] === 0xff && (b[i + 1] & 0xf0) === 0xc0 && b[i + 1] !== 0xc4 && b[i + 1] !== 0xc8 && b[i + 1] !== 0xcc) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) }; i += 2 + b.readUInt16BE(i + 2); }
  };

  itFiles('the motion directory holds exactly the story, the loop (each in three sizes), two posters and the captions; no 16:9 files are left', () => {
    expect(fs.readdirSync(path.join(ROOT, M)).sort()).toEqual(['loop-1080.mp4', 'loop-720.mp4', 'loop-sq-1080.mp4', 'story-1080.mp4', 'story-720.mp4', 'story-poster.jpg', 'story-sq-1080.mp4', 'story-sq-poster.jpg', 'story.vtt']);
    expect(files.map(f => f.name)).toEqual(['story-sq-1080.mp4', 'story-1080.mp4', 'story-720.mp4']);
    expect(loops.sort()).toEqual(['loop-1080.mp4', 'loop-720.mp4', 'loop-sq-1080.mp4']);
    expect(stageCode).not.toMatch(/-1920|-1280|mimic-16x9/);
  });
  itFiles('ships the files at the sizes the component says (9:16, or 1080 square), and each poster under 100 KB', () => {
    for (const f of files) {
      const rel = M + f.name;
      if (f.name.includes('-sq-')) expect(f.w, f.name).toBe(f.h); else expect(f.w * 16, f.name).toBe(f.h * 9);
      expect(mp4Size(rel), f.name).toEqual({ w: f.w, h: f.h });
      expect(fs.statSync(path.join(ROOT, rel)).size, f.name).toBeLessThan(16_000_000);
    }
    // each loop has the size of the story it replaces at that width
    expect(mp4Size(M + 'loop-1080.mp4')).toEqual({ w: 1080, h: 1920 });
    expect(mp4Size(M + 'loop-720.mp4')).toEqual({ w: 720, h: 1280 });
    expect(mp4Size(M + 'loop-sq-1080.mp4')).toEqual({ w: 1080, h: 1080 });
    for (const n of ['loop-1080.mp4', 'loop-720.mp4', 'loop-sq-1080.mp4']) expect(fs.statSync(path.join(ROOT, M + n)).size, n).toBeLessThan(16_000_000);
    for (const n of ['story-poster.jpg', 'story-sq-poster.jpg']) expect(fs.statSync(path.join(ROOT, M + n)).size, n).toBeLessThan(100_000);
    expect(jpegSize(M + 'story-poster.jpg')).toEqual({ w: 720, h: 1280 });
    expect(jpegSize(M + 'story-sq-poster.jpg')).toEqual({ w: 720, h: 720 });
    expect(stageCode).toMatch(/POSTER = \{ src: `\$\{DIR\}\/story-poster\.jpg`, w: 720, h: 1280 \}/);
    expect(stageCode).toMatch(/SQ_POSTER = \{ src: `\$\{DIR\}\/story-sq-poster\.jpg`, w: 720, h: 720 \}/);
  });
  it('the box is vertical 9:16 by default and 1:1 under exactly the query that picks the square files; the poster follows the same query; no 16:9 anywhere', () => {
    expect(css).toMatch(/\.rm-stage-box \{ aspect-ratio: 9 \/ 16; width: 100%; \}/);
    // exactly one landscape rule, and it makes the box square
    const rules = [...css.matchAll(/@media ([^{]*orientation[^{]*)\{\s*\.rm-stage-box \{([^}]*)\}\s*\}/g)];
    expect(css.match(/orientation/g)).toHaveLength(1);
    expect(rules).toHaveLength(1);
    expect(rules[0][2].trim()).toBe('aspect-ratio: 1 / 1;');
    // the box and the files can never disagree: the CSS query text IS the component's SQUARE_QUERY
    expect(rules[0][1].trim()).toBe(SQUARE_QUERY);
    expect(files[0]).toMatchObject({ name: 'story-sq-1080.mp4', w: 1080, h: 1080, media: SQUARE_QUERY });   // first, so <source media> picks it first
    expect(css).not.toMatch(/rm-stage-box[^}]*16 \/ 9/);
    expect(stageCode).not.toMatch(/16 ?\/ ?9|16x9/);
    // the poster: a <picture> whose square source uses the same query; the <img> inside stays the vertical poster
    expect(stageCode).toMatch(/<picture>\s*<source media=\{SQUARE_QUERY\} srcSet=\{SQ_POSTER\.src\} width=\{SQ_POSTER\.w\} height=\{SQ_POSTER\.h\} \/>\s*<img src=\{POSTER\.src\}/);
    // the column is square-wide on wide landscape screens (lg = 1024 px, the query's width)
    expect(stageCode).toMatch(/\blg:landscape:\[--rm-w:min\(70svh,720px\)\]/);
    expect(css).not.toMatch(/rm-drift/);
    expect(stageCode).not.toMatch(/rm-drift/);
    expect(stageCode).toMatch(/object-cover/);
    expect(stageCode).not.toMatch(/object-(fill|none)/);
  });

  it('the <video> is decoration that plays muted and inline, once: the story has no `loop` attribute, and the 1080 file is only for sharp screens or a box wider than 560 px', () => {
    const v = stageCode.match(/<video [\s\S]*?>/)[0];
    for (const a of ['autoPlay', 'muted', 'playsInline', 'preload="metadata"', 'aria-hidden="true"', 'tabIndex={-1}', 'motion-reduce:hidden']) expect(v, a).toContain(a);
    expect(v).not.toMatch(/\bloop\b/);
    expect(files[1].media).toBe('(min-width: 600px) and (min-resolution: 1.5dppx), (min-width: 561px) and (max-width: 639px)');
    expect(files[2].media).toBe('');                                        // the unconditional fallback is last
    expect(stageCode).toMatch(/<source key=\{f\.src\} src=\{f\.src\} type="video\/mp4"/);
  });
  it('lays out vertically: the headline (children) is the left column on a desktop and sits above the video on a phone; the video column is capped so it never towers', () => {
    // two columns from lg up, one below it; the headline is the first child, so it is first on a phone and left on a desktop
    expect(stageCode).toMatch(/<div className="lg:grid lg:grid-cols-\[minmax\(0,1fr\)_auto\] lg:items-center lg:gap-10">\s*\{children\}/);
    // the video's column: full width on a phone, and from 640 px up exactly as wide as a 9:16 box of height min(78svh, 820px)
    expect(stageCode).toMatch(/\[--rm-w:calc\(min\(78svh,820px\)\*9\/16\)\]/);
    expect(stageCode).toMatch(/\bw-full\b[^"]*\bsm:max-w-\[var\(--rm-w\)\][^"]*\blg:w-\[var\(--rm-w\)\]/);
    // the strip sits after the whole two-column block, so it is underneath both columns
    expect(stageCode.indexOf('</video>')).toBeLessThan(stageCode.indexOf('<ul '));
    expect(stageCode.indexOf('lg:grid-cols-[minmax')).toBeLessThan(stageCode.indexOf('<ul '));
    // the page's own headline is what goes in: one h1, with a download button on a desktop only (a phone cannot run it)
    const layout = code(L + 'PathsLayout.tsx');
    expect(layout.match(/<h1\b/g)).toHaveLength(1);
    expect(layout).toMatch(/\{motion && \(\s*<div className="mt-5 hidden [^"]*lg:flex">\s*<a href=\{DOWNLOAD_URL\} className=\{PRIMARY_BTN\}>\{HERO\.download\}<\/a>/);
    expect(layout).toMatch(/className=\{motion \? 'mb-6 lg:mb-0' : 'mb-6'\}/);   // the default page keeps its exact spacing
  });
  it('is a stage on the clip’s own #0f1219 so the edges vanish', () => {
    expect(stageCode).toMatch(/const STAGE_BG = '#0f1219'/);
    expect(stageCode.match(/backgroundColor: STAGE_BG/g)).toHaveLength(2);       // the video's frame and the strip's
  });
  it('when the story ends the file is swapped for the loop of the same shape (square, else the same width, chosen with the same media queries), looped and played', () => {
    expect(stageCode).toMatch(/const wide = window\.matchMedia\(WIDE_QUERY\)/);
    expect(stageCode).toMatch(/const square = window\.matchMedia\(SQUARE_QUERY\)/);
    expect(stageCode).toMatch(/const WIDE_QUERY = MOTION_FILES\[1\]\.media/);       // the 1080-vertical entry, NOT the square one
    expect(files[1].name).toBe('story-1080.mp4');
    const onEnded = stageCode.match(/const onEnded = \(\) => \{([\s\S]*?)\n      \};/)[1];
    expect(onEnded).toMatch(/v\.loop = true;/);
    expect(onEnded).toMatch(/v\.src = square\.matches \? LOOP_FILES\.square : wide\.matches \? LOOP_FILES\.wide : LOOP_FILES\.plain;/);
    expect(onEnded).toMatch(/setEnded\(true\);/);
    expect(onEnded).toMatch(/sync\(\);/);                                    // sync() is what calls play()
    expect(stageCode).toMatch(/v\.addEventListener\('ended', onEnded\)/);
    expect(stageCode).toMatch(/LOOP_FILES = \{ square: `\$\{DIR\}\/loop-sq-1080\.mp4`, wide: `\$\{DIR\}\/loop-1080\.mp4`, plain: `\$\{DIR\}\/loop-720\.mp4` \}/);
    expect(stageCode).toMatch(/STORY_FILES = \{ square: MOTION_FILES\[0\]\.src, wide: MOTION_FILES\[1\]\.src, plain: MOTION_FILES\[2\]\.src \}/);
  });
  it('“Watch again” is a real <button> that shows only once the story has ended, sits in a corner of the stage and replays the story from the start', () => {
    const btn = stageCode.match(/\{ended && \(\s*(<button [\s\S]*?<\/button>)\s*\)\}/)[1];
    expect(btn).toMatch(/^<button type="button" onClick=\{\(\) => replay\.current\(\)\}/);
    expect(btn).toMatch(/Watch again/);
    expect(btn).toMatch(/absolute bottom-2 right-2/);                       // inside the box, out of the way
    expect(btn).toMatch(/sm:bottom-3 sm:right-3/);                          // a little more room above a phone
    expect(btn).toMatch(/min-h-\[44px\]/);                                  // a touch target
    expect(btn).toMatch(/text-\[#f2ede1\]/);                                // readable on the dark stage
    expect(btn).toMatch(/focus-visible:outline/);
    const replay = stageCode.match(/replay\.current = \(\) => \{([\s\S]*?)\n      \};/)[1];
    expect(replay).toMatch(/v\.loop = false;/);
    expect(replay).toMatch(/v\.src = square\.matches \? STORY_FILES\.square : wide\.matches \? STORY_FILES\.wide : STORY_FILES\.plain;/);
    expect(replay).toMatch(/setEnded\(false\);/);
    expect(replay).toMatch(/sync\(\);/);
  });
  it('the story has sound: it autoplays muted, and a real "Sound on" button (always there, the other corner) unmutes it', () => {
    expect(stageCode).toMatch(/v\.muted = true;/);
    const btn = stageCode.match(/(<button type="button" onClick=\{toggleSound\}[\s\S]*?<\/button>)/)[1];
    expect(btn).toMatch(/aria-pressed=\{sound\}/);
    expect(btn).toMatch(/absolute bottom-2 left-2/);
    expect(btn).toMatch(/min-h-\[44px\]/);
    expect(btn).toMatch(/\{sound \? 'Sound off' : 'Sound on'\}/);
    const toggle = stageCode.match(/const toggleSound = \(\) => \{([\s\S]*?)\n  \};/)[1];
    expect(toggle).toMatch(/v\.muted = sound;/);                           // pressing it flips the element, not just the label
    expect(toggle).toMatch(/setSound\(!sound\);/);
  });
  itFiles('every story and loop file carries an audio track', () => {
    for (const f of ['story-1080.mp4', 'story-720.mp4', 'story-sq-1080.mp4', 'loop-1080.mp4', 'loop-720.mp4', 'loop-sq-1080.mp4']) {
      expect(fs.readFileSync(path.join(ROOT, M + f)).includes(Buffer.from('mp4a')), f + ' has an audio track').toBe(true);
    }
  });

  // Closed captions (the guild lead, 2026-10-24: "if it's muted have closed captions").
  it('the <video> carries the English captions as a default <track kind="captions"> from story.vtt', () => {
    expect(stageCode).toMatch(/const CAPTIONS = `\$\{DIR\}\/story\.vtt`;/);
    const video = stageCode.match(/<video [\s\S]*?<\/video>/)[0];
    const track = video.match(/<track [^>]*\/>/)[0];
    expect(track).toMatch(/kind="captions"/);
    expect(track).toMatch(/srcLang="en"/);
    expect(track).toMatch(/label="English"/);
    expect(track).toMatch(/src=\{CAPTIONS\}/);
    expect(track).toMatch(/\bdefault\b/);
  });
  it('the captions show while the story plays muted, hide once Sound is on, are disabled for the loop, and come back right on replay', () => {
    // a missing text track must not throw
    const set = stageCode.match(/const setCaptions = \(v: HTMLVideoElement, mode: TextTrackMode\) => \{([\s\S]*?)\n\};/)[1];
    expect(set).toMatch(/const t = v\.textTracks\[0\];\s*if \(t\) t\.mode = mode;/);
    // the effect sets the initial mode right after muting
    expect(stageCode).toMatch(/v\.muted = true;\s*setCaptions\(v, 'showing'\);/);
    // the effect's callbacks read the sound state through a ref, which toggleSound keeps in sync
    expect(stageCode).toMatch(/const soundRef = useRef\(false\);/);
    const toggle = stageCode.match(/const toggleSound = \(\) => \{([\s\S]*?)\n  \};/)[1];
    expect(toggle).toMatch(/soundRef\.current = !sound;/);
    expect(toggle).toMatch(/if \(!v\.loop\) setCaptions\(v, sound \? 'showing' : 'hidden'\);/);   // turning sound OFF shows them again; ON hides them; never in the loop
    const onEnded = stageCode.match(/const onEnded = \(\) => \{([\s\S]*?)\n      \};/)[1];
    expect(onEnded).toMatch(/setCaptions\(v, 'disabled'\);/);
    const replay = stageCode.match(/replay\.current = \(\) => \{([\s\S]*?)\n      \};/)[1];
    expect(replay).toMatch(/setCaptions\(v, soundRef\.current \? 'hidden' : 'showing'\);/);  });
  it('the cues are styled inside the stage only', () => {
    expect(css).toMatch(/\.rm-stage video::cue \{[^}]*background: rgb\(0 0 0 \/ 0\.72\);[^}]*color: #f2ede1;[^}]*\}/);
    expect(css.match(/::cue/g)).toHaveLength(1);
  });
  it('story.vtt is a valid caption file: WEBVTT, ordered cues that each end after they start, all inside the 90 s story, every line spoken by a named voice or a [sound]', () => {
    const vtt = read(M + 'story.vtt');
    expect(vtt.startsWith('WEBVTT')).toBe(true);
    const ts = (s) => { const [h, m, sec] = s.split(':'); return +h * 3600 + +m * 60 + +sec; };
    const cues = vtt.split(/\r?\n\r?\n/).map(b => b.trim().split(/\r?\n/)).filter(l => l.some(x => x.includes('-->')))
      .map(l => {
        const i = l.findIndex(x => x.includes('-->'));
        const m = l[i].match(/^(\d\d:\d\d:\d\d\.\d{3}) --> (\d\d:\d\d:\d\d\.\d{3})/);
        return { start: ts(m[1]), end: ts(m[2]), text: l.slice(i + 1).join(' ') };
      });
    expect(cues.length).toBeGreaterThan(10);
    for (const c of cues) {
      expect(c.start, c.text).toBeLessThan(c.end);
      expect(c.text, 'a spoken cue names its voice').toMatch(/^(?:MIMIC: |RAID LEADER: |YOU: |\[[^\]]+\]$)/);
    }
    for (let i = 1; i < cues.length; i++) expect(cues[i].start, cues[i].text).toBeGreaterThanOrEqual(cues[i - 1].start);
    expect(cues[cues.length - 1].end).toBeLessThan(90);
  });
  it('pauses off-screen and in a hidden tab, and under reduced motion plays nothing and fetches nothing (the poster stays, and so does the strip)', () => {
    expect(stageCode).toMatch(/new IntersectionObserver\(/);
    expect(stageCode).toMatch(/visibilitychange/);
    expect(stageCode).toMatch(/matchMedia\('\(prefers-reduced-motion: reduce\)'\)/);
    expect(stageCode).toMatch(/if \(reduce\.matches\) \{[\s\S]*?v\.pause\(\);[\s\S]*?querySelectorAll\('source'\)\.forEach\(s => s\.remove\(\)\);[\s\S]*?v\.load\(\);\s*return;/);
    // the reduced-motion branch returns before the ended handler is attached, so no loop file is ever set
    expect(stageCode.indexOf('querySelectorAll(\'source\')')).toBeLessThan(stageCode.indexOf('addEventListener(\'ended\''));
    expect(stageCode).toMatch(/motion-reduce:hidden/);
    // the shape is chosen when a file starts (matchMedia(...).matches); a 'change' listener never re-swaps mid-play
    expect(stageCode).toMatch(/window\.matchMedia\(SQUARE_QUERY\)/);
    expect([...stageCode.matchAll(/(\w+)\.addEventListener\('change'/g)].map(m => m[1])).toEqual(['reduce']);
    expect(stageCode).not.toMatch(/matchMedia\('\(orientation/);
    // the poster layer is a decorative last frame, not a second copy of the words
    expect(stageCode).toMatch(/alt="" aria-hidden="true"/);
  });

  it('the strip is the four real captures under the video: images with alt text that link to the full-size file, each with a name and a one-line description', () => {
    const ids = [...stageCode.match(/const STRIP: Card\[\] = \[([\s\S]*?)\n\];/)[1].matchAll(/id: '([\w-]+)'/g)].map(m => m[1]);
    expect(ids).toEqual(['hud-box', 'dps-raid', 'target-debuffs', 'ch-chain']);
    const lines = [...stageCode.match(/const STRIP: Card\[\] = \[([\s\S]*?)\n\];/)[1].matchAll(/line: '([^']+)'/g)].map(m => m[1]);
    expect(lines).toHaveLength(4);
    for (const l of lines) { expect(l.length).toBeGreaterThan(20); expect(l.length).toBeLessThan(70); }
    for (const id of ids) {
      const s = C.SHOTS.find(x => x.id === id);
      expect(s, id).toBeTruthy();
      expect(fs.existsSync(path.join(ROOT, 'web/public/raidmimic/shots', s.file)), id).toBe(true);
      expect(s.alt.length, id).toBeGreaterThan(40);
      expect(s.title.length, id).toBeGreaterThan(2);
    }
    expect(stageCode).toMatch(/<a href=\{src\} target="_blank" rel="noreferrer" aria-label=\{`\$\{s\.title\}: open the full-size capture`\}/);
    expect(stageCode).toMatch(/const src = `\$\{SHOTS_DIR\}\/\$\{s\.file\}`/);
    expect(stageCode).toMatch(/alt=\{s\.alt\}/);
    expect(stageCode).toMatch(/\{s\.title\}<\/p>/);                          // the name under each capture
    expect(stageCode).toMatch(/\{c\.line\}<\/p>/);                           // and its line
    // the strip comes after the video box in the section, and the captures are never laid over the video
    expect(stageCode.indexOf('</video>')).toBeLessThan(stageCode.indexOf('STRIP.map'));
    expect(stageCode).not.toMatch(/absolute"\s+style=\{\{ left/);
  });
  it('the strip is four across on a wide screen and two by two on a phone, on 16px gutters, with nothing that can scroll sideways', () => {
    const ul = stageCode.match(/<ul className="([^"]+)"/)[1];
    expect(ul).toMatch(/\bgrid-cols-2\b/);
    expect(ul).toMatch(/\blg:grid-cols-4\b/);
    expect(ul).toMatch(/\bgap-4\b/);                                        // 16px between cards
    expect(ul).toMatch(/\bp-4\b/);                                          // and 16px at the stage's edge
    expect(stageCode).toMatch(/<li key=\{c\.id\} className="min-w-0">/);    // a grid child may shrink below its content
    expect(stageCode).toMatch(/className="block h-full w-full object-contain"/);   // the image never exceeds its cell
    expect(stageCode).toMatch(/aspect-\[4\/3\] w-full/);
    expect(stageCode).toMatch(/loading="lazy"/);
  });
});
