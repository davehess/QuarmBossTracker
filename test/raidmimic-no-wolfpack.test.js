// test/raidmimic-no-wolfpack.test.js — nothing on raidmimic.com references wolfpack.quest, and a guild's own site is
// configuration (the guild lead, 2026-11-02: "nothing on raidmimic.com should reference wolfpack.quest, but we should be able
// to redirect users to their guild's website at their configuration" and "redirect by default, for wolfpack they could
// redirect to wolfpack.quest").
//
// Three halves:
//   1. A ratchet over comment-stripped SOURCE: no raidmimic page, shared component or lib spells the Wolf Pack address or uses
//      the constants that hold it (PROD_SITE_URL, WOLFPACK_ORIGIN, BETA_SITE_URL, PRIVACY_URL). The one module allowed to read
//      PROD_SITE_URL is web/lib/guildSites.ts, which turns it into the built-in guild's configured site. The auth pages render on
//      BOTH hosts, so for them the address may only sit on the Wolf Pack side of the host check.
//   2. The redirect choice, RUN: web/lib/guildSites.ts redirectTarget / wantsToStay / checkSiteUrl / builtinGuildSite.
//   3. The wiring: /guilds redirects only on a raidmimic host, every "back to Your guilds" link carries stay=1, and the settings
//      action re-checks the role. Plus the migration.
//
// ⚠ Comments are stripped before every text match (CLAUDE.md, "comments satisfy text assertions"): the files' own headers
// name the address on purpose. stripJs strips whole-line comments only, so a trailing `// ...wolfpack.quest` would fail here
// and must be reworded, not allow-listed.
//
// Run: npx vitest run test/raidmimic-no-wolfpack.test.js

import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs, stripSql } from './_source-slice.js';
import {
  GUILDS_STAY_PATH, STAY_PARAM, SITE_URL_MAX, builtinGuildSite, checkSiteUrl, cleanSiteUrl, redirectTarget, siteLabel, sitePage, wantsToStay,
} from '../web/lib/guildSites.ts';

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const code = (rel) => stripJs(read(rel));

// Every .ts/.tsx file under a directory (the demo's captures and clips are not source).
function walk(rel) {
  const out = [];
  for (const e of fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true })) {
    const p = `${rel}/${e.name}`;
    if (e.isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

// What is served on a raidmimic host and renders ONLY there or on both hosts with the same words.
const SURFACES = [
  ...walk('web/app/raidmimic'),
  ...walk('web/app/guilds'),
  'web/components/RaidmimicFrame.tsx',
  'web/components/LegalLinks.tsx',
  'web/components/AgreeLine.tsx',
  'web/app/me/data/YourData.tsx',
  ...['raidmimicLanding', 'raidmimicStory', 'raidmimicSetup', 'raidmimicPlayer', 'raidmimicHost', 'legal', 'mimicLinkHub', 'hubGuilds', 'hubRegistry', 'openSignIn']
    .map(n => `web/lib/${n}.ts`),
];

// Pages that render on BOTH hosts. The address may appear in them only on the Wolf Pack side (see the slices below).
const BOTH_HOSTS = ['web/app/auth/mimic-link/page.tsx', 'web/app/auth/claim/page.tsx', 'web/app/auth/signin/page.tsx'];

const ADDRESS = /wolfpack\.quest/i;
const ADDRESS_CONSTANTS = /\b(?:PROD_SITE_URL|BETA_SITE_URL|WOLFPACK_ORIGIN|PRIVACY_URL)\b/;

describe('no raidmimic page, component or lib spells the Wolf Pack address', () => {
  it('the walk found the surfaces it is meant to guard (a moved directory must not turn this into a green test over nothing)', () => {
    expect(SURFACES.length).toBeGreaterThan(30);
    for (const must of ['web/app/guilds/page.tsx', 'web/app/raidmimic/privacy/page.tsx', 'web/app/raidmimic/setup/page.tsx', 'web/app/raidmimic/page.tsx', 'web/lib/raidmimicLanding.ts']) {
      expect(SURFACES, must).toContain(must);
    }
  });

  it.each(SURFACES)('%s has no wolfpack.quest and no constant that holds it', (rel) => {
    const src = code(rel);
    expect(src, `${rel} spells the Wolf Pack address`).not.toMatch(ADDRESS);
    expect(src, `${rel} reads a constant that holds the Wolf Pack address`).not.toMatch(ADDRESS_CONSTANTS);
  });

  it('only web/lib/guildSites.ts reads PROD_SITE_URL, and only to make the built-in guild\'s default site', () => {
    const src = code('web/lib/guildSites.ts');
    expect((src.match(/PROD_SITE_URL/g) || []).length).toBe(2);   // the import and the one fallback
    expect(src).toMatch(/cleanSiteUrl\(process\.env\.GUILD_SITE_URL\) \?\? cleanSiteUrl\(PROD_SITE_URL\)/);
    expect(src).not.toMatch(ADDRESS);
  });

  it('Raid Mimic\'s own privacy page is self-contained: it links nothing outside the repo and the contact address', () => {
    const src = code('web/app/raidmimic/privacy/page.tsx');
    expect(src).not.toMatch(/https?:\/\//);
    expect(src).not.toMatch(/Wolf Pack (?:privacy )?page/i);
    expect([...src.matchAll(/href=\{([^}]+)\}/g)].map(m => m[1].trim()).sort()).toEqual(
      ['CONTACT_HREF', 'CONTACT_HREF', 'CONTACT_HREF', 'REPO_URL', 'REPO_URL', 'YOUR_DATA_PATH', 'p.refunds', 'p.terms'].sort());
    // what the four links to the Wolf Pack page used to carry is now written out on this page
    for (const heading of ['What other raiders’ Mimic records about you', 'What your switches actually do', 'How long we keep it', 'Who else handles it']) {
      expect(src, heading).toContain(heading);
    }
    for (const who of ['OpenDKP', 'Raid-Helper', 'Microsoft']) expect(src, who).toContain(who);
  });

  it('the download button and the set-up guide go to the release page on GitHub, not to the Wolf Pack site', async () => {
    const player = await import('../web/lib/raidmimicPlayer.ts');
    const setup = await import('../web/lib/raidmimicSetup.ts');
    expect(player.DOWNLOAD_URL).toBe(setup.RELEASES_URL);
    expect(player.DOWNLOAD_URL).toMatch(/^https:\/\/github\.com\/[^/]+\/[^/]+\/releases\/latest$/);
  });
});

describe('the pages that render on both hosts keep the address on the Wolf Pack side only', () => {
  it('the files this guards exist', () => {
    for (const rel of BOTH_HOSTS) expect(fs.existsSync(path.join(ROOT, rel)), rel).toBe(true);
  });

  it('/auth/mimic-link: the raidmimic half (everything from its marker down) has no address; the Wolf Pack half is reached only past the host check', () => {
    const raw = read('web/app/auth/mimic-link/page.tsx');
    const marker = raw.indexOf('// ── raidmimic hosts: finish a link');
    expect(marker).toBeGreaterThan(0);
    const hubHalf = stripJs(raw.slice(marker));
    expect(hubHalf).not.toMatch(ADDRESS);
    expect(hubHalf).not.toMatch(ADDRESS_CONSTANTS);
    // The Wolf Pack half still names its address (that behaviour is unchanged) ...
    const wolfHalf = stripJs(raw.slice(0, marker));
    expect(wolfHalf).toMatch(ADDRESS);
    // ... but only the Wolf Pack page body reads those labels, and it sits after the host check that returns the hub page.
    const src = code('web/app/auth/mimic-link/page.tsx');
    const hostCheck = src.indexOf('if (isRaidmimicHost(headers().get(\'host\'))) return <HubLinkPage');
    expect(hostCheck).toBeGreaterThan(0);
    expect(src.indexOf('ERROR_LABELS[searchParams.error]')).toBeGreaterThan(hostCheck);
    // the "wrong form" and "that code is Wolf Pack's" answers on a raidmimic host send the player to the configured site
    expect(hubHalf).toMatch(/wrong_site:\s+'That form belongs to your guild’s own site\./);
    expect(hubHalf).toMatch(/sitePage\(builtinGuildSite\(\)\.url, `\/auth\/mimic-link\?code=\$\{prefilled\}`\)/);
    expect(hubHalf).toMatch(/<a href=\{builtinLink\}/);
  });

  it('/auth/claim: Wolf Pack\'s own officer invite; a raidmimic host gets a 404 before the invite is even read', () => {
    const src = code('web/app/auth/claim/page.tsx');
    const guard = src.indexOf('if (isRaidmimicHost(headers().get(\'host\'))) notFound();');
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(src.indexOf('const { invite, reason } = await loadInvite(token);'));
    expect(src).toMatch(/Welcome to wolfpack\.quest/);   // unchanged on the Wolf Pack host
  });

  it('/auth/signin: the raidmimic branch has no address; what is left is the tab\'s description (a known gap, listed so it can only shrink)', () => {
    const src = code('web/app/auth/signin/page.tsx');
    const hostBranch = src.slice(src.indexOf('if (isRaidmimicHost(headers().get(\'host\')))'), src.indexOf('  return (\n    <div className="max-w-md mx-auto mt-12 space-y-6">\n      <section className="bg-panel border border-border rounded-lg p-6 text-center">\n        <h2 className="text-xl text-gold mb-2">Sign in</h2>'));
    expect(hostBranch.length).toBeGreaterThan(200);
    expect(hostBranch).not.toMatch(ADDRESS);
    // KNOWN GAP (open question for the guild lead): the page's <meta description> and the Discord card in web/lib/pageMeta.ts are
    // host-blind and say "WolfPack.quest", as does the root layout's title template. Making them host-aware is the next change.
    const gaps = [...src.matchAll(/.*wolfpack\.quest.*/gi)].map(m => m[0].trim());
    expect(gaps).toEqual(["description: 'Sign in to WolfPack.quest with your Discord account.',"]);
  });
});

describe('redirect by default: the choice, run', () => {
  const wp = { guildId: 'wolfpack', url: 'https://wolfpack.example', redirect: true };
  const hub = { guildId: 'brackwyn-raiders', url: 'https://brackwyn.example', redirect: true };

  it('one guild with a site and the redirect on -> redirect to that site', () => {
    expect(redirectTarget([wp], false)).toBe('https://wolfpack.example');
    expect(redirectTarget([hub], false)).toBe('https://brackwyn.example');
  });
  it('the redirect switched off -> no redirect', () => {
    expect(redirectTarget([{ ...wp, redirect: false }], false)).toBeNull();
    expect(redirectTarget([{ ...hub, redirect: false }], false)).toBeNull();
  });
  it('a guild with no site -> no redirect, whatever the switch says', () => {
    expect(redirectTarget([{ ...hub, url: null }], false)).toBeNull();
    expect(redirectTarget([{ ...hub, url: '' }], false)).toBeNull();
  });
  it('two guilds -> no redirect, even when both want one, or only one does (the player has not seen the other yet)', () => {
    expect(redirectTarget([wp, hub], false)).toBeNull();
    expect(redirectTarget([wp, { ...hub, redirect: false }], false)).toBeNull();
    expect(redirectTarget([wp, { ...hub, url: null }], false)).toBeNull();
  });
  it('no guild -> no redirect', () => {
    expect(redirectTarget([], false)).toBeNull();
  });
  it('stay=1 -> no redirect', () => {
    expect(redirectTarget([wp], true)).toBeNull();
    expect(wantsToStay({ stay: '1' })).toBe(true);
    expect(GUILDS_STAY_PATH).toBe(`/guilds?${STAY_PARAM}=1`);
  });
  it('the Find-my-guilds answer (find / found / closed) also stays, so the player sees the result; an empty or 0 value does not', () => {
    for (const q of [{ find: 'ok', found: '1' }, { find: 'refused' }, { closed: 'abc' }, { found: '2' }]) expect(wantsToStay(q), JSON.stringify(q)).toBe(true);
    for (const q of [{}, { stay: '' }, { stay: '0' }, { find: undefined }, { other: '1' }, null, undefined]) expect(wantsToStay(q), JSON.stringify(q)).toBe(false);
  });
});

describe('a guild\'s website address (checkSiteUrl)', () => {
  it('no address is fine (null); a good https address is kept, trimmed to origin + path', () => {
    expect(checkSiteUrl('')).toEqual({ ok: true, url: null });
    expect(checkSiteUrl('   ')).toEqual({ ok: true, url: null });
    expect(checkSiteUrl(undefined)).toEqual({ ok: true, url: null });
    expect(checkSiteUrl('https://brackwyn.example')).toEqual({ ok: true, url: 'https://brackwyn.example' });
    expect(checkSiteUrl('  https://Brackwyn.example/  ')).toEqual({ ok: true, url: 'https://brackwyn.example' });
    expect(checkSiteUrl('https://brackwyn.example/raid/?utm=x#top')).toEqual({ ok: true, url: 'https://brackwyn.example/raid' });
  });
  it('refuses anything that is not https, has sign-in details, has spaces, has no dot, or is too long', () => {
    for (const bad of ['http://brackwyn.example', 'ftp://brackwyn.example', 'javascript:alert(1)', 'brackwyn.example', '//brackwyn.example',
      'https://user:pw@brackwyn.example', 'https://brackwyn .example', 'https://localhost', `https://brackwyn.example/${'a'.repeat(SITE_URL_MAX)}`]) {
      expect(checkSiteUrl(bad).ok, bad).toBe(false);
    }
  });
  it('refuses a Raid Mimic host, which would redirect its members round in a circle', () => {
    for (const loop of ['https://raidmimic.com', 'https://raidmimic.com/guilds', 'https://www.raidmimic.net/', 'https://b.raidmimic.com', 'https://RAIDMIMIC.QUEST:443/x']) {
      const r = checkSiteUrl(loop);
      expect(r.ok, loop).toBe(false);
      expect(r.message).toMatch(/circle/);
    }
    expect(cleanSiteUrl('https://raidmimic.com/guilds')).toBeNull();
  });
  it('sitePage and siteLabel build the card\'s link and the address as a person reads it', () => {
    expect(sitePage('https://brackwyn.example/raid', '/auth/mimic-link?code=ABC123')).toBe('https://brackwyn.example/raid/auth/mimic-link?code=ABC123');
    expect(sitePage('https://brackwyn.example')).toBe('https://brackwyn.example');
    expect(sitePage(null, '/me')).toBeNull();
    expect(siteLabel('https://brackwyn.example/')).toBe('brackwyn.example');
  });
});

describe('the built-in guild\'s site comes from configuration, with today\'s production site as the default', () => {
  afterEach(() => { vi.unstubAllEnvs(); });
  it('nothing set: the production site, redirect OFF (2026-11-09, §556: raidmimic.com/guilds must not send Wolf Pack members away)', () => {
    vi.stubEnv('GUILD_SITE_URL', ''); vi.stubEnv('GUILD_SITE_REDIRECT', '');
    expect(builtinGuildSite()).toEqual({ url: 'https://wolfpack.quest', redirect: false });
  });
  it('GUILD_SITE_URL overrides it; an unusable value falls back to the default rather than redirecting somewhere wrong', () => {
    vi.stubEnv('GUILD_SITE_URL', 'https://pack.example/');
    expect(builtinGuildSite().url).toBe('https://pack.example');
    for (const bad of ['http://pack.example', 'not a url', 'https://raidmimic.com/guilds']) {
      vi.stubEnv('GUILD_SITE_URL', bad);
      expect(builtinGuildSite().url, bad).toBe('https://wolfpack.quest');
    }
  });
  it('GUILD_SITE_REDIRECT=1 (or true / on / yes) switches the built-in guild\'s redirect on; anything else leaves it off', () => {
    for (const on of ['1', 'true', 'ON', 'yes']) {
      vi.stubEnv('GUILD_SITE_REDIRECT', on);
      expect(builtinGuildSite().redirect, on).toBe(true);
    }
    for (const off of ['0', 'false', 'off', 'garbage']) {
      vi.stubEnv('GUILD_SITE_REDIRECT', off);
      expect(builtinGuildSite().redirect, off).toBe(false);
    }
  });
});

describe('the wiring, as source', () => {
  const page = code('web/app/guilds/page.tsx') + code('web/lib/hubGuildsLoad.ts');   // the page's reads moved to the shared loader (2026-11-09)

  it('/guilds redirects only on a raidmimic host, only through redirectTarget, and honours ?stay=1', () => {
    expect(page).toMatch(/if \(onHost\) \{[\s\S]*?redirectTarget\(mine, wantsToStay\(searchParams\)\)[\s\S]*?if \(to\) redirect\(to\);\s*\}/);
    expect((page.match(/redirectTarget\(/g) || []).length).toBe(1);
    expect(page).toMatch(/searchParams: \{[^}]*\bstay\?: string/);
    // every guild the player is in is counted, the built-in one from configuration and the hosted ones from their rows
    expect(page).toMatch(/\.\.\.\(wolf \? \[\{ guildId: GUILD_TAG, url: wolfSite\.url, redirect: wolfSite\.redirect \}\] : \[\]\)/);
    expect(page).toMatch(/\.\.\.hub\.map\(g => \(\{ guildId: g\.guild_id, url: g\.site, redirect: g\.redirect \}\)\)/);
    expect(page).toMatch(/select\('guild_id, display_name, website_url, redirect_members'\)/);
  });
  it('the Wolf Pack card is ONE "Open the guild\'s site" link, built from the configured site', () => {
    const card = page.slice(page.indexOf('{wolf && ('), page.indexOf('{hub.map('));
    expect((card.match(/<a href=/g) || []).length).toBe(1);
    expect(card).toMatch(/Open the guild&rsquo;s site &rarr;/);
    expect(card).not.toMatch(/flag-events|mimic-link/);
    expect(page).toMatch(/const wolfSite = builtinGuildSite\(\);/);
  });
  it('each hosted card offers "Open <guild>\'s site" when it has one', () => {
    expect(page).toMatch(/\{g\.site && <a href=\{g\.site\} className=\{LINK\}>Open \{g\.name\}&rsquo;s site &rarr;<\/a>\}/);
  });
  it('every link that means "manage my Raid Mimic account" carries stay=1', () => {
    for (const rel of SURFACES.filter(f => f.endsWith('.tsx'))) {
      expect(code(rel), `${rel} links /guilds without stay=1`).not.toMatch(/href="\/guilds"|href=\{'\/guilds'\}|href: '\/guilds'/);
    }
    expect(code('web/lib/raidmimicNav.ts')).toMatch(/\{ label: 'Your guilds', href: GUILDS_STAY_PATH \}/);
    for (const rel of ['web/app/guilds/[slug]/page.tsx', 'web/app/guilds/new/page.tsx']) expect(code(rel), rel).toMatch(/href=\{GUILDS_STAY_PATH\}[^>]*>&larr; Your guilds/);
    expect(code('web/app/guilds/JoinForm.tsx')).toMatch(/router\.replace\(GUILDS_STAY_PATH\)/);
    expect(code('web/app/auth/mimic-link/page.tsx')).toMatch(/<Link href=\{GUILDS_STAY_PATH\}/);
  });

  it('saving the site: the owner/officer check runs first, the address is validated, and only this guild\'s row is written', () => {
    const src = code('web/app/guilds/[slug]/actions.ts');
    const fn = src.slice(src.indexOf('export async function saveGuildSite'));
    expect(fn.indexOf('await officerOf(String(slug))')).toBeGreaterThan(0);
    expect(fn.indexOf('await officerOf(String(slug))')).toBeLessThan(fn.indexOf('checkSiteUrl(rawUrl)'));
    expect(fn.indexOf('checkSiteUrl(rawUrl)')).toBeLessThan(fn.indexOf('.update('));
    expect(fn).toMatch(/\.update\(\{ website_url: check\.url, redirect_members: redirectMembers === true \}\)\s*\.eq\('guild_id', slug\)/);
    expect(read('web/app/guilds/[slug]/actions.ts')).toMatch(/^'use server';/m);
  });
  it('the guild page shows the form only to an owner or officer, and the link to everyone in the guild', () => {
    const slugPage = code('web/app/guilds/[slug]/page.tsx');
    const site = slugPage.slice(slugPage.indexOf('aria-label="Website"'), slugPage.indexOf('aria-label="Invites"'));
    expect(site).toMatch(/\{site && <p[^>]*><a href=\{site\}/);
    expect(site).toMatch(/\{manage \? \([\s\S]*<SiteSettings slug=\{slug\}/);
    expect(site.slice(site.indexOf('SiteSettings'))).not.toMatch(/<SiteSettings/);   // one form, inside the manage branch
  });
});

describe('the migration (supabase/migrations/20261102230000_hub_guild_site.sql)', () => {
  const sql = stripSql(read('supabase/migrations/20261102230000_hub_guild_site.sql'));
  it('adds the two columns idempotently, with the https/200 check and the redirect on by default', () => {
    expect(sql).toMatch(/alter table hub_guilds add column if not exists website_url text;/);
    expect(sql).toMatch(/alter table hub_guilds add column if not exists redirect_members boolean not null default true;/);
    expect(sql).toMatch(/website_url ~ '\^https:\/\/\[\^\[:space:\]\]\+\$'/);
    expect(sql).toMatch(/char_length\(website_url\) <= 200/);
    expect(sql).toMatch(/exception when duplicate_object then null; end \$\$;/);
    expect(SITE_URL_MAX).toBe(200);
  });
  it('touches nothing else: no new table, no policy, no wolfpack row', () => {
    expect(sql).not.toMatch(/create table|create policy|insert into|drop /i);
    expect(sql).not.toMatch(/wolfpack/i);
  });
});
