// test/officer-home-guild.test.js — officer rights hold in the home Discord server only.
// utils/roles.js hasOfficerRole matches role NAMES, which are not unique across servers. Every officer slash command, the
// audit Undo buttons and the raid-end button funnel through it, so the home-server check lives there, once.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import { BOT_INDEX, readSource, stripJs } from './_source-slice.js';

const nodeRequire = createRequire(BOT_INDEX);
const roles = nodeRequire('./utils/roles');

const member = (guildId, ...names) => ({
  guild: guildId === undefined ? undefined : { id: guildId },
  roles: { cache: { some: (fn) => names.map((name) => ({ name })).some(fn) } },
});

let saved;
beforeEach(() => { saved = { g: process.env.DISCORD_GUILD_ID, o: process.env.OFFICER_ROLE_NAMES }; delete process.env.OFFICER_ROLE_NAMES; });
afterEach(() => {
  if (saved.g === undefined) delete process.env.DISCORD_GUILD_ID; else process.env.DISCORD_GUILD_ID = saved.g;
  if (saved.o === undefined) delete process.env.OFFICER_ROLE_NAMES; else process.env.OFFICER_ROLE_NAMES = saved.o;
});

describe('hasOfficerRole is bound to the home server', () => {
  it('an Officer in the home server passes', () => {
    process.env.DISCORD_GUILD_ID = 'home';
    expect(roles.hasOfficerRole(member('home', 'Officer'))).toBe(true);
  });
  it('an "Officer" role in another server is refused', () => {
    process.env.DISCORD_GUILD_ID = 'home';
    expect(roles.hasOfficerRole(member('other', 'Officer'))).toBe(false);
    expect(roles.hasOfficerRole(member('other', 'Officer', 'Guild Leader'))).toBe(false);
  });
  it('a home-server member without an officer role is still refused', () => {
    process.env.DISCORD_GUILD_ID = 'home';
    expect(roles.hasOfficerRole(member('home', 'Pack Member'))).toBe(false);
  });
  it('plain member checks are unchanged in any server', () => {
    process.env.DISCORD_GUILD_ID = 'home';
    expect(roles.hasAllowedRole(member('other', 'Pack Member'))).toBe(true);
  });
  it('with DISCORD_GUILD_ID unset (local dev) nothing is enforced', () => {
    delete process.env.DISCORD_GUILD_ID;
    expect(roles.hasOfficerRole(member('other', 'Officer'))).toBe(true);
  });
});

describe('every officer path goes through hasOfficerRole', () => {
  const idx = stripJs(readSource(BOT_INDEX));
  it('the audit Undo handler checks it', () => {
    const at = idx.indexOf('async function handleAuditUndo');
    expect(at).toBeGreaterThan(-1);
    expect(idx.slice(at, at + 1500)).toMatch(/hasOfficerRole\(interaction\.member\)/);
  });
});
