// test/guild-host.test.js — a guild's own address, <slug>.raidmimic.com (the guild lead, 2026-11-12, DECISIONS §569).
// The home guild's slug serves the whole site; any other slug serves the hub's pages for that guild and nothing else.
//
// Run: npx vitest run test/guild-host.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs } from './_source-slice.js';
import {
  guildHostSlug, isHomeGuildHost, otherGuildHostSlug, otherGuildHostRedirect, isGuildHostOpenPath, guildHostUrl,
  GUILD_HOST_SLUG_RX, RESERVED_SUBDOMAINS, PLATFORM_ORIGIN,
} from '../web/lib/guildHost.ts';
import { GUILD_SLUG_RX } from '../web/lib/hubRegistry.ts';
import { GUILD_TAG } from '../web/lib/guild.ts';
import { isRaidmimicHost, isRaidmimicIndexedHost, isRaidmimicOrigin, raidmimicSeo, RAIDMIMIC_HOSTS } from '../web/lib/raidmimicHost.ts';

const code = (rel) => stripJs(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const HOME = `${GUILD_TAG}.raidmimic.com`;

describe('which guild a host means', () => {
  it('reads the slug from <slug>.raidmimic.com, any case or port', () => {
    expect(guildHostSlug('breakfast-club.raidmimic.com')).toBe('breakfast-club');
    expect(guildHostSlug('Breakfast-Club.RaidMimic.COM:443')).toBe('breakfast-club');
    expect(guildHostSlug(HOME)).toBe(GUILD_TAG);
  });
  it('is null for the platform hosts, reserved names, deeper names, lookalikes and other domains', () => {
    for (const h of ['raidmimic.com', 'www.raidmimic.com', 'b.raidmimic.com', 'api.raidmimic.com', 'new.raidmimic.com',
      'a.b.raidmimic.com', 'ab.raidmimic.com', '-bad.raidmimic.com', 'bad-.raidmimic.com', 'guild.raidmimic.com.evil.com',
      'guild.raidmimic.net', 'guildraidmimic.com', 'wolfpack.quest', 'b.wolfpack.quest', '', null, undefined]) {
      expect(guildHostSlug(h), String(h)).toBeNull();
    }
  });
  it('uses the registry\'s slug shape, and every live subdomain is reserved', () => {
    expect(GUILD_HOST_SLUG_RX.source).toBe(GUILD_SLUG_RX.source);
    for (const h of RAIDMIMIC_HOSTS) {
      const sub = h.replace(/\.?raidmimic\.(com|net|quest)$/, '');
      if (sub && h.endsWith('.raidmimic.com')) expect(RESERVED_SUBDOMAINS, h).toContain(sub);
    }
  });
  it('splits the home guild from every other guild', () => {
    expect(isHomeGuildHost(HOME)).toBe(true);
    expect(otherGuildHostSlug(HOME)).toBeNull();
    expect(isHomeGuildHost('breakfast-club.raidmimic.com')).toBe(false);
    expect(otherGuildHostSlug('breakfast-club.raidmimic.com')).toBe('breakfast-club');
    expect(otherGuildHostSlug('raidmimic.com')).toBeNull();
    expect(guildHostUrl('breakfast-club')).toBe('https://breakfast-club.raidmimic.com');
  });
});

describe('the home guild\'s address is the whole site', () => {
  it('is NOT a raidmimic host: the guild\'s own member gate and layout apply, as on its own domain', () => {
    expect(isRaidmimicHost(HOME)).toBe(false);
    expect(isRaidmimicOrigin(`https://${HOME}`)).toBe(false);
  });
});

describe('another guild\'s address serves that guild\'s hub pages only', () => {
  const slug = 'breakfast-club';
  it('counts as a raidmimic host (open sign-in, bare shell), and is never indexed', () => {
    expect(isRaidmimicHost(`${slug}.raidmimic.com`)).toBe(true);
    expect(isRaidmimicOrigin(`https://${slug}.raidmimic.com`)).toBe(true);
    expect(isRaidmimicIndexedHost(`${slug}.raidmimic.com`)).toBe(false);
    expect(raidmimicSeo(`${slug}.raidmimic.com`, '/')).toEqual({ robots: { index: false, follow: false } });
    expect(raidmimicSeo('raidmimic.com', '/').robots).toEqual({ index: true, follow: true });
    expect(raidmimicSeo('b.raidmimic.com', '/').robots).toEqual({ index: false, follow: false });
  });
  it('serves sign-in, the guild pages, My characters and the framework files as themselves', () => {
    for (const p of ['/auth/signin', '/auth/callback', '/api/auth/signout', '/guilds', `/guilds/${slug}`, `/guilds/${slug}/settings`,
      '/guilds/new', '/characters', '/_next/static/chunk.js']) {
      expect(isGuildHostOpenPath(p), p).toBe(true);
      expect(otherGuildHostRedirect(slug, p), p).toBeNull();
    }
  });
  it('sends the root and every member page of this deployment to the guild\'s page', () => {
    for (const p of ['/', '/me', '/parses', '/raid/session', '/admin', '/admin/theme', '/api/agent/poll', '/pop/raid', '/guildsx', '/charactersx']) {
      expect(otherGuildHostRedirect(slug, p), p).toBe(`/guilds/${slug}`);
    }
  });
  it('sends the platform\'s own pages to raidmimic.com', () => {
    expect(otherGuildHostRedirect(slug, '/privacy')).toBe(`${PLATFORM_ORIGIN}/privacy`);
    expect(otherGuildHostRedirect(slug, '/terms/')).toBe(`${PLATFORM_ORIGIN}/terms`);
    expect(otherGuildHostRedirect(slug, '/Demo/parses')).toBe(`${PLATFORM_ORIGIN}/demo/parses`);
    expect(otherGuildHostRedirect(slug, '/setup')).toBe(`${PLATFORM_ORIGIN}/setup`);
    expect(otherGuildHostRedirect(slug, '/register')).toBe(`${PLATFORM_ORIGIN}/register`);
    // not a platform page: a lookalike stays on the guild's address
    expect(otherGuildHostRedirect(slug, '/privacy-policy')).toBe(`/guilds/${slug}`);
  });
});

describe('the middleware decides a guild host before the raidmimic branch', () => {
  const mw = code('web/middleware.ts');
  it('calls otherGuildHostSlug, then otherGuildHostRedirect, ahead of the landing-page rewrite', () => {
    const guild = mw.indexOf('otherGuildHostSlug(request.headers.get(\'host\'))');
    const landing = mw.indexOf('isRaidmimicHost(request.headers.get(\'host\')) && !isRaidmimicOpenPath');
    expect(guild).toBeGreaterThan(-1);
    expect(landing).toBeGreaterThan(guild);
    expect(mw.slice(guild, landing)).toMatch(/otherGuildHostRedirect\(guildSlug, request\.nextUrl\.pathname\)/);
    expect(mw.slice(guild, landing)).toMatch(/url\.search = ''/);
  });
});

describe('a guild\'s address is never indexed (the home guild\'s is a copy of its own domain)', () => {
  it('next.config.js sends X-Robots-Tag noindex for every raidmimic.com subdomain, and not for the apex', async () => {
    const config = (await import('../web/next.config.js')).default;
    const rules = await config.headers();
    const rule = rules.find(r => (r.has || []).some(h => h.type === 'host' && /raidmimic/.test(h.value)));
    expect(rule, 'the host rule').toBeTruthy();
    expect(rule.source).toBe('/(.*)');
    expect(rule.headers.find(h => h.key === 'X-Robots-Tag').value).toMatch(/noindex/);
    const rx = new RegExp('^' + rule.has[0].value + '$');   // Next matches a `has` value against the whole host
    for (const h of [HOME, 'breakfast-club.raidmimic.com', 'b.raidmimic.com']) expect(rx.test(h), h).toBe(true);
    for (const h of ['raidmimic.com', 'wolfpack.quest', 'b.wolfpack.quest', 'x.raidmimic.com.evil.com', 'raidmimic.net']) expect(rx.test(h), h).toBe(false);
  });
});
