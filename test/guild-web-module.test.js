// test/guild-web-module.test.js — web/lib/guild.ts, the guild kit's one place for "which guild is this".
//
// Two promises are pinned here. (1) With NOTHING set, every export equals the literal the website used before
// the module existed, so Wolf Pack's production deployment is unchanged. (2) Resolution is env first, with
// whitespace counting as unset, and the frozen password-login domain never follows anything else.
//
// Run: npx vitest run test/guild-web-module.test.js

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs } from './_source-slice.js';

const NAMES = [
  'NEXT_PUBLIC_GUILD_TAG', 'SUPABASE_GUILD_ID', 'NEXT_PUBLIC_GUILD_NAME', 'NEXT_PUBLIC_GUILD_SHORT',
  'NEXT_PUBLIC_GUILD_INGAME_NAME', 'NEXT_PUBLIC_SITE_NAME', 'NEXT_PUBLIC_SITE_URL', 'NEXT_PUBLIC_BETA_SITE_URL',
  'NEXT_PUBLIC_IS_BETA', 'NEXT_PUBLIC_LOGIN_DOMAIN', 'NEXT_PUBLIC_GITHUB_REPO', 'NEXT_PUBLIC_OPENDKP_BASE',
  'NEXT_PUBLIC_OPENDKP_CLIENT', 'NEXT_PUBLIC_RAID_TZ', 'ALLOWED_ROLE_NAMES', 'OFFICER_ROLE_NAMES',
];
const saved = {};
beforeEach(() => {
  for (const n of NAMES) { saved[n] = process.env[n]; delete process.env[n]; }
  vi.resetModules();
});
afterEach(() => {
  for (const n of NAMES) { if (saved[n] === undefined) delete process.env[n]; else process.env[n] = saved[n]; }
});

// Fresh module under a given environment.
async function load(env = {}) {
  for (const n of NAMES) delete process.env[n]; // each call starts clean, so two loads in one case don't leak
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  vi.resetModules();
  return import('../web/lib/guild.ts');
}

describe('defaults are Wolf Pack today, to the character', () => {
  it('identity', async () => {
    const g = await load();
    expect(g.GUILD_TAG).toBe('wolfpack');
    expect(g.GUILD_NAME).toBe('Wolf Pack');
    expect(g.GUILD_SHORT).toBe('WP');
    expect(g.GUILD_INGAME_NAME).toBe('Wolf Pack');
    expect(g.SITE_NAME).toBe('WolfPack.quest');
  });

  it('site address matches app/layout.tsx on prod and on beta', async () => {
    expect((await load()).SITE_URL).toBe('https://wolfpack.quest');
    expect((await load({ NEXT_PUBLIC_IS_BETA: '1' })).SITE_URL).toBe('https://b.wolfpack.quest');
    expect((await load({ NEXT_PUBLIC_IS_BETA: '1' })).BETA_SITE_URL).toBe('https://b.wolfpack.quest');
  });

  it('login domain, repo, OpenDKP, time zone', async () => {
    const g = await load();
    expect(g.LOGIN_EMAIL_DOMAIN).toBe('login.wolfpack.quest');
    expect(g.REPO).toEqual({ owner: 'davehess', name: 'QuarmBossTracker' });
    expect(g.REPO_URL).toBe('https://github.com/davehess/QuarmBossTracker');
    expect(g.REPO_RELEASES_URL).toBe('https://github.com/davehess/QuarmBossTracker/releases');
    expect(g.REPO_RELEASES_API).toBe('https://api.github.com/repos/davehess/QuarmBossTracker/releases');
    expect(g.OPENDKP_BASE).toBe('https://wolfpack.opendkp.com');
    expect(g.RAID_TZ).toBe('America/New_York');
  });

  it('rank and role tables', async () => {
    const g = await load();
    expect(g.RANKS.priority).toEqual(['Officer', 'Pack Leader', 'Raid Pack', 'Raid Recruit', 'Recruit', 'Member', 'Inactive', 'Raid Alt']);
    expect(g.RANKS.raider).toEqual(['Pack Leader', 'Officer', 'Raid Pack', 'Recruit']);
    expect(g.RANKS.raidAlt).toEqual(['Raid Alt']);
    expect(g.RANKS.nonRaid).toEqual(['Non-raid Alt', 'Trader']);
    expect(g.RANKS.trader).toBe('Trader');
    expect(g.RANKS.newMain).toBe('Recruit');
    expect(g.ROLES.active).toEqual(['Raid Pack', 'Officer', 'Raid Recruit', 'Pack Member', 'Pack Leader']);
    expect(g.RAID_LEVEL_FLOOR).toEqual({ raidAlt: 46, pop: 60 });
  });

  it('RANKS.priority is the same list eras.ts ships (no drift between the copies)', async () => {
    const g = await load();
    const { RANK_PRIORITY } = await import('../web/lib/eras.ts');
    expect([...g.RANKS.priority]).toEqual([...RANK_PRIORITY]);
  });
});

describe('the environment wins', () => {
  it('NEXT_PUBLIC_GUILD_TAG beats SUPABASE_GUILD_ID beats the default', async () => {
    expect((await load({ SUPABASE_GUILD_ID: 'alias' })).GUILD_TAG).toBe('alias');
    expect((await load({ SUPABASE_GUILD_ID: 'alias', NEXT_PUBLIC_GUILD_TAG: 'pub' })).GUILD_TAG).toBe('pub');
  });

  it('identity, repo, OpenDKP, time zone overrides', async () => {
    const g = await load({
      NEXT_PUBLIC_GUILD_NAME: 'Night Owls', NEXT_PUBLIC_GUILD_SHORT: 'NO', NEXT_PUBLIC_SITE_NAME: 'Owls.example',
      NEXT_PUBLIC_GITHUB_REPO: 'someone/their-fork', NEXT_PUBLIC_RAID_TZ: 'Europe/Berlin',
      NEXT_PUBLIC_OPENDKP_BASE: 'https://owls.opendkp.com/',
    });
    expect(g.GUILD_NAME).toBe('Night Owls');
    expect(g.GUILD_SHORT).toBe('NO');
    expect(g.SITE_NAME).toBe('Owls.example');
    expect(g.REPO).toEqual({ owner: 'someone', name: 'their-fork' });
    expect(g.REPO_URL).toBe('https://github.com/someone/their-fork');
    expect(g.REPO_RELEASES_API).toBe('https://api.github.com/repos/someone/their-fork/releases');
    expect(g.RAID_TZ).toBe('Europe/Berlin');
    expect(g.OPENDKP_BASE).toBe('https://owls.opendkp.com');
  });

  it('OPENDKP_CLIENT builds <client>.opendkp.com, and BASE outranks it', async () => {
    expect((await load({ NEXT_PUBLIC_OPENDKP_CLIENT: 'owls' })).OPENDKP_BASE).toBe('https://owls.opendkp.com');
    expect((await load({ NEXT_PUBLIC_OPENDKP_CLIENT: 'owls', NEXT_PUBLIC_OPENDKP_BASE: 'https://x.example' })).OPENDKP_BASE)
      .toBe('https://x.example');
  });

  it('GUILD_INGAME_NAME follows GUILD_NAME until set on its own', async () => {
    expect((await load({ NEXT_PUBLIC_GUILD_NAME: 'Night Owls' })).GUILD_INGAME_NAME).toBe('Night Owls');
    const g = await load({ NEXT_PUBLIC_GUILD_NAME: 'Night Owls', NEXT_PUBLIC_GUILD_INGAME_NAME: 'The Owls' });
    expect(g.GUILD_NAME).toBe('Night Owls');
    expect(g.GUILD_INGAME_NAME).toBe('The Owls');
  });

  it('NEXT_PUBLIC_SITE_URL wins over the beta default; siteUrl() joins cleanly', async () => {
    const g = await load({ NEXT_PUBLIC_IS_BETA: '1', NEXT_PUBLIC_SITE_URL: 'https://owls.example/' });
    expect(g.SITE_URL).toBe('https://owls.example/');
    expect(g.siteUrl()).toBe('https://owls.example');
    expect(g.siteUrl('/me')).toBe('https://owls.example/me');
    expect(g.siteUrl('me')).toBe('https://owls.example/me');
    expect((await load()).siteUrl('/auth/callback')).toBe('https://wolfpack.quest/auth/callback');
  });

  it('a malformed repo falls back to the default instead of building a broken link', async () => {
    expect((await load({ NEXT_PUBLIC_GITHUB_REPO: 'not-a-repo' })).REPO_URL).toBe('https://github.com/davehess/QuarmBossTracker');
    expect((await load({ NEXT_PUBLIC_GITHUB_REPO: 'a/b/c' })).REPO.owner).toBe('davehess');
  });
});

describe('whitespace is unset', () => {
  it('a blank or spaces-only value falls through to the default', async () => {
    const g = await load({
      NEXT_PUBLIC_GUILD_TAG: '   ', SUPABASE_GUILD_ID: '\t', NEXT_PUBLIC_GUILD_NAME: ' ', NEXT_PUBLIC_SITE_URL: '  ',
      NEXT_PUBLIC_LOGIN_DOMAIN: ' ', NEXT_PUBLIC_RAID_TZ: '', NEXT_PUBLIC_OPENDKP_BASE: ' ',
    });
    expect(g.GUILD_TAG).toBe('wolfpack');
    expect(g.GUILD_NAME).toBe('Wolf Pack');
    expect(g.SITE_URL).toBe('https://wolfpack.quest');
    expect(g.LOGIN_EMAIL_DOMAIN).toBe('login.wolfpack.quest');
    expect(g.RAID_TZ).toBe('America/New_York');
    expect(g.OPENDKP_BASE).toBe('https://wolfpack.opendkp.com');
  });

  it('a set value is trimmed', async () => {
    expect((await load({ NEXT_PUBLIC_GUILD_TAG: '  owls  ' })).GUILD_TAG).toBe('owls');
  });
});

describe('role gates keep today\'s semantics, read per request', () => {
  it('memberRoles(): unset or empty means the gate is off', async () => {
    const g = await load();
    expect(g.memberRoles()).toEqual([]);
    process.env.ALLOWED_ROLE_NAMES = '';
    expect(g.memberRoles()).toEqual([]);
    process.env.ALLOWED_ROLE_NAMES = ' , ,';
    expect(g.memberRoles()).toEqual([]);
  });

  it('memberRoles(): splits on commas and trims, keeping inner spaces', async () => {
    const g = await load();
    process.env.ALLOWED_ROLE_NAMES = 'Pack Member, Officer ,Guild Leader';
    expect(g.memberRoles()).toEqual(['Pack Member', 'Officer', 'Guild Leader']);
  });

  it('officerRoles(): default is "Officer,Pack Leader", unchanged', async () => {
    const g = await load();
    expect(g.officerRoles()).toEqual(['Officer', 'Pack Leader']);
    process.env.OFFICER_ROLE_NAMES = '';
    expect(g.officerRoles()).toEqual(['Officer', 'Pack Leader']);
  });

  it('officerRoles(): env overrides and is trimmed', async () => {
    const g = await load();
    process.env.OFFICER_ROLE_NAMES = ' Captain , First Mate';
    expect(g.officerRoles()).toEqual(['Captain', 'First Mate']);
  });

  it('both are functions that re-read the environment on every call (not frozen at import)', async () => {
    const g = await load();
    expect(typeof g.memberRoles).toBe('function');
    expect(g.memberRoles()).toEqual([]);
    process.env.ALLOWED_ROLE_NAMES = 'A';
    expect(g.memberRoles()).toEqual(['A']);
    process.env.ALLOWED_ROLE_NAMES = 'B';
    expect(g.memberRoles()).toEqual(['B']);
  });
});

describe('LOGIN_EMAIL_DOMAIN is frozen, never derived', () => {
  it('does not move with the site URL, the beta flag, the tag or the name', async () => {
    const g = await load({
      NEXT_PUBLIC_SITE_URL: 'https://owls.example', NEXT_PUBLIC_IS_BETA: '1',
      NEXT_PUBLIC_GUILD_TAG: 'owls', NEXT_PUBLIC_GUILD_NAME: 'Night Owls', NEXT_PUBLIC_SITE_NAME: 'Owls.example',
    });
    expect(g.SITE_URL).toBe('https://owls.example');
    expect(g.LOGIN_EMAIL_DOMAIN).toBe('login.wolfpack.quest');
  });

  it('only its own variable changes it', async () => {
    expect((await load({ NEXT_PUBLIC_LOGIN_DOMAIN: 'login.owls.example' })).LOGIN_EMAIL_DOMAIN).toBe('login.owls.example');
  });
});

describe('client-bundle safety (source shape)', () => {
  const src = stripJs(fs.readFileSync(path.join(ROOT, 'web/lib/guild.ts'), 'utf8'));

  it('imports nothing at all (no next/*, no supabase, no server module)', () => {
    expect(src).not.toMatch(/^\s*import\s/m);
    expect(src).not.toMatch(/\brequire\(/);
  });

  it('reads NEXT_PUBLIC_ names statically: Next inlines only `process.env.NEXT_PUBLIC_X`, never `process.env[k]`', () => {
    expect(src).not.toMatch(/process\.env\s*\[/);
    expect(src).toMatch(/process\.env\.NEXT_PUBLIC_GUILD_TAG/);
  });

  it('never touches a service key or a secret-shaped name', () => {
    expect(src).not.toMatch(/SERVICE_ROLE|TOKEN|SECRET|PASSWORD|_KEY\b/);
  });
});
