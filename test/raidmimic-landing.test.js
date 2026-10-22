// test/raidmimic-landing.test.js — the raidmimic.com front door (the guild lead, 2026-10-18, option C "two doors").
// A FIRST-DRAFT page for guild leaders, modelled on test/eqmimic-landing.test.js.
//
// What this pins:
//   - the host list (six hosts, exact match, lookalikes refused) and the routing function: every path on those
//     hosts goes to /raidmimic with EVERY query parameter dropped,
//   - the middleware, RUN against a stand-in for next/server, agrees, and the eqmimic host still behaves as before;
//     the branch sits before any session work and the link-preview rewrite,
//   - the root layout gives the raidmimic hosts the same bare shell as eqmimic's,
//   - the page: [beta] title, not indexable, public, ONE layout ("Scene-first", the guild lead's pick, 2026-10-22; no
//     `?v=` switch, the other previews and the earlier tour are deleted), the [beta] tag, and the Register-interest
//     address (the existing anonymous form, text in the FRAGMENT),
//   - the scene player: two audiences (raiders; raid leaders and guild leaders), every scene with its beat's caption
//     and its files on disk, no empty tab,
//   - the layout carries every required section and draws its words from the one content module,
//   - honesty: every "coming" claim is in the COMING inventory, nothing invents a price, a customer count or a
//     testimonial, and the one dollar figure is the measured Wolf Pack number eqmimic already publishes,
//   - the metadata is in lib/pageMeta.ts as well as the page (test/page-metadata.test.js walks the rest),
//   - the content is public-safe, and the recordings' fixtures name only invented raiders.
//
// Source-text assertions run over comment-stripped source (CLAUDE.md "comments satisfy text assertions").
// Run: npx vitest run test/raidmimic-landing.test.js

import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs } from './_source-slice.js';
import {
  RAIDMIMIC_HOSTS, RAIDMIMIC_LANDING_PATH, isRaidmimicHost, raidmimicLandingTarget,
} from '../web/lib/raidmimicHost.ts';
import { isEqmimicHost } from '../web/lib/eqmimicHost.ts';
import * as C from '../web/lib/raidmimicLanding.ts';
import * as EQ from '../web/lib/eqmimicLanding.ts';
import { metaForPath, DEFAULT_DESCRIPTION } from '../web/lib/pageMeta.ts';

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const code = (rel) => stripJs(read(rel));
const L = 'web/app/raidmimic/_landing/';

// Every sentence the content module can put on the page, as one string (for the "no invented X" sweeps).
const allText = () => JSON.stringify([
  C.HERO, C.WORKS_WITH, C.DATA, C.COST, C.WORLDS, C.CTA, C.MOMENTS, C.COMING, C.CLIPS, C.AUDIENCES, C.CLIPS_HEAD, C.CLIPS_NOTE, C.SHOTS, C.SHOTS_HEAD,
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
  it('is [beta] in its title, not indexable, and public (no session code)', () => {
    expect(page).toMatch(/const TITLE = '\[beta\] raidmimic · raid orchestration as a service'/);
    expect(page).toMatch(/robots: \{ index: false, follow: false \}/);
    expect(page).not.toMatch(/getSessionUser|supabase/i);
  });
  it('renders the one layout, Scene-first, with no `?v=` switch: every earlier preview and the tour are deleted', () => {
    expect(page).toMatch(/return <SceneLayout ctx=\{ctx\} \/>;/);
    expect(page.match(/<[A-Z]\w+Layout /g)).toHaveLength(1);
    expect(page).not.toMatch(/searchParams|v === '|hero=/);
    expect(page).not.toMatch(/raidmimicVariant|PitchLayout|TourLayout|OutputLayout|WatchLayout|StoryLayout|ScreenLayout/);
    for (const gone of ['TourLayout', 'OutputLayout', 'WatchLayout', 'StoryLayout', 'ScreenLayout', 'PitchLayout', 'Figures']) {
      expect(fs.existsSync(path.join(ROOT, `${L}${gone}.tsx`)), gone).toBe(false);
    }
    expect(C).not.toHaveProperty('raidmimicVariant');
    expect(C).not.toHaveProperty('BLOCKS');
    for (const gone of ['STORY', 'SCREEN_NOTES', 'SETUP_LINK', 'ILLUSTRATIVE_NOTE']) expect(C, gone).not.toHaveProperty(gone);
    // the layered mascot hero (the guild lead, 2026-10-21) is kept: it is the page's hero, above the player
    expect(code('web/app/raidmimic/page.tsx')).not.toMatch(/Mascot/);
    expect(code(L + 'SceneLayout.tsx')).toMatch(/<MascotHero \/>/);
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
    for (const f of ['page.tsx', 'Parts.tsx', 'SceneLayout.tsx', 'ClipTabs.tsx', 'SceneClip.tsx', 'MascotHero.tsx', 'MascotVideo.tsx']) {
      const src = f === 'page.tsx' ? page : code(L + f);
      expect(src, f).not.toMatch(/mailto:|<form\b|fetch\(|action=/);
    }
    expect(allText()).not.toMatch(/mailto:|@[a-z0-9-]+\.[a-z]{2,}/i);
  });
});

describe('the layout', () => {
  const scene = code(L + 'SceneLayout.tsx');
  const parts = code(L + 'Parts.tsx');

  it('the [beta] tag is the site’s NewPageTag, at the top, and its link works on a raidmimic host', () => {
    expect(parts).toMatch(/import NewPageTag from '@\/components\/NewPageTag'/);
    expect(parts).toMatch(/<NewPageTag [^>]*href=\{ctx\.onHost \? ctx\.interest : '\/feedback'\}/);
    expect(scene.indexOf('<BetaTag')).toBeGreaterThan(-1);
    expect(scene.indexOf('<BetaTag')).toBeLessThan(scene.indexOf('<Hero'));
    expect(code('web/components/NewPageTag.tsx')).toMatch(/href = '\/feedback'/);   // every other page keeps its link
  });

  // The required sections, by the id the layout gives them.
  const REQUIRED = ['works-with', 'data', 'cost', 'worlds'];
  it('carries the hero, the scene player, the four moments, the four facts folded away, the coming list and the ask, in that order', () => {
    const order = ['<Hero', '<MascotHero', '<ClipTabs', 'MOMENTS.map', ...REQUIRED.map(r => `id="${r}"`), '<ComingList', '<CtaBand', '<Footer'].map(s => scene.indexOf(s));
    expect(order.every(i => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(C.MOMENTS).toHaveLength(4);
    expect(parts).toMatch(/<details\b/);
    expect(scene).toMatch(/<Hero ctx=\{ctx\} compact \/>/);
  });
  it('takes the section bodies from Parts, so a fact is corrected in one place', () => {
    for (const body of ['WorksWithBody', 'DataBody', 'CostBody', 'WorldsBody']) expect(scene, body).toMatch(new RegExp(`<${body} />`));
  });
  it('the Register-interest button is in the hero and again at the end', () => {
    expect(parts).toMatch(/export function Hero[\s\S]*?<InterestButton ctx=\{ctx\} \/>/);
    expect(parts).toMatch(/export function CtaBand[\s\S]*?<InterestButton ctx=\{ctx\} \/>/);
    expect(parts).toMatch(/href=\{ctx\.interest\}/);
  });
  it('the layout switch is gone: no VariantSwitch, no ?v=b link, no landing path on the context', () => {
    expect(parts).not.toMatch(/VariantSwitch|\?v=b|Layout preview|landing:/);
    expect(scene).not.toMatch(/VariantSwitch/);
    expect(code('web/app/raidmimic/page.tsx')).not.toMatch(/landing:/);
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
  it('server components except the three that play: only SceneClip, ClipTabs and MascotVideo are client files', () => {
    for (const f of ['Parts.tsx', 'SceneLayout.tsx', 'MascotHero.tsx']) expect(read(L + f), f).not.toMatch(/['"]use client['"]/);
    expect(read('web/app/raidmimic/page.tsx')).not.toMatch(/['"]use client['"]/);
    for (const f of ['SceneClip.tsx', 'ClipTabs.tsx', 'MascotVideo.tsx']) expect(read(L + f), f).toMatch(/^'use client';/);
    expect(fs.readdirSync(path.join(ROOT, L)).sort()).toEqual(['ClipTabs.tsx', 'MascotHero.tsx', 'MascotVideo.tsx', 'Parts.tsx', 'SceneClip.tsx', 'SceneLayout.tsx']);
  });
  it('fetches and embeds nothing external; every outbound link is one we name', () => {
    const urls = new Set();
    for (const f of ['page.tsx', 'Parts.tsx', 'SceneLayout.tsx', 'ClipTabs.tsx', 'SceneClip.tsx', 'MascotHero.tsx', 'MascotVideo.tsx']) {
      for (const m of (f === 'page.tsx' ? code('web/app/raidmimic/page.tsx') : code(L + f)).matchAll(/https?:\/\/[^\s'"`)<>]+/g)) urls.add(m[0]);
    }
    expect([...urls]).toEqual([]);   // every address is a constant in the content module
    const mod = code('web/lib/raidmimicLanding.ts');
    const inModule = [...mod.matchAll(/https?:\/\/[^\s'"`)<>]+/g)].map(m => m[0]).filter(u => !/\$\{/.test(u));
    expect(new Set(inModule)).toEqual(new Set(['https://eqmimic.quest', 'https://wolfpack.quest/privacy']));
  });
});

describe('honesty: "coming" means coming', () => {
  it('every moment and world carries a known status', () => {
    for (const x of [...C.MOMENTS, ...C.WORLDS.list]) expect(['live', 'alpha', 'coming'], x.title || x.name).toContain(x.status);
    expect(Object.keys(C.STATUS_LABEL).sort()).toEqual(['alpha', 'coming', 'live']);
    expect(C.STATUS_LABEL.coming).toBe('Coming');
  });
  it('the cross-guild board, the shared trial and the other games are NOT marked live', () => {
    expect(C.MOMENTS.find(m => m.id === 'two-guilds').status).toBe('coming');
    expect(C.COST.trialStatus).toBe('coming');
    for (const w of C.WORLDS.list.filter(w => /Monsters|Warcraft/.test(w.name))) expect(w.status, w.name).toBe('coming');
    expect(C.WORLDS.list.find(w => w.name === 'EverQuest').status).toBe('live');
    expect(C.MOMENTS.find(m => m.id === 'builder').status).toBe('alpha');
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
  it('the two doors point at each other: the hero sends players to eqmimic.quest', () => {
    expect(C.HERO.playerLine).toMatch(/free player tool/);
    expect(code(L + 'Parts.tsx')).toMatch(/<a href=\{EQMIMIC_ORIGIN\}[^>]*>eqmimic\.quest<\/a>/);
  });
});

function sceneSrc() {
  return ['SceneLayout', 'ClipTabs', 'SceneClip', 'MascotHero', 'MascotVideo'].map(f => code(`${L}${f}.tsx`)).join('\n');
}

describe('metadata: the tab AND the Discord card (CLAUDE.md, every page unfurls with its own name)', () => {
  it('lib/pageMeta.ts knows /raidmimic, with the same words as the page', () => {
    const m = metaForPath('/raidmimic');
    expect(m.title).toBe('[beta] raidmimic · raid orchestration as a service');
    expect(m.description).not.toBe(DEFAULT_DESCRIPTION);
    expect(m.description.length).toBeGreaterThan(20);
    expect(m.description.length).toBeLessThanOrEqual(300);
    const page = code('web/app/raidmimic/page.tsx');
    expect(page).toContain(`const TITLE = '${m.title}'`);
    const desc = page.match(/const DESCRIPTION =\s*'([^']+)'/)[1];
    expect(desc).toBe(m.description);
    expect(page).toMatch(/title: \{ absolute: TITLE \}/);   // not "· WolfPack.quest": this page is also raidmimic.com
  });
  it('the card carries nothing from the database: a static entry, no lookup', () => {
    expect(code('web/lib/pageMeta.ts')).toMatch(/'\/raidmimic':\s+\{ title: '\[beta\] raidmimic/);
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
  const layout = code(L + 'SceneLayout.tsx');

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
    for (const f of ['SceneLayout.tsx', 'SceneClip.tsx', 'ClipTabs.tsx']) {
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

  it('is the page’s hero: the text hero, then the mascot, then the scene player', () => {
    const scene = code(L + 'SceneLayout.tsx');
    expect(scene.indexOf('<Hero')).toBeLessThan(scene.indexOf('<MascotHero'));
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

  it('uses every capture once, from the one shots folder, and only the content module', () => {
    expect(C.SHOTS.map(s => s.id)).toEqual(['map', 'cc', 'target-stats', 'target-quest', 'dps', 'rolls', 'timeline']);
    const ids = [...hero.matchAll(/\{ id: '([a-z-]+)',\s+l:/g)].map(m => m[1]);
    expect(ids.sort()).toEqual(C.SHOTS.map(s => s.id).sort());
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
    expect(names.length).toBeGreaterThan(60);
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
});
