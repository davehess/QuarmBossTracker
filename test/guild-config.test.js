// test/guild-config.test.js — guild/config.json and the single guild-config helper.
//
// The guild kit's slice 1b (docs/DESIGN-guild-kit.md §2-§3). Resolution order is
// env -> guild/config.json -> built-in fallback, and our own deployment (everything in env,
// no config.json) must behave exactly as before. So the properties pinned here are:
//
//   • env beats the file beats the default; a whitespace-only env value is "unset";
//   • a missing or broken file is a no-op, never a crash at boot;
//   • secret-shaped keys in the file are never read, at any depth;
//   • fillEnv fills ONLY unset names, joins arrays, unions the role lists, skips placeholders;
//   • every getter's built-in default is today's literal — pinned here AND compared to the code
//     that still holds the literal (utils/roles.js, the roster rank list, the web rank lists);
//   • every ENV_MAP target is an env name something actually reads;
//   • index.js runs fillEnv after the slice-1a loader and before the first env read.
//
// Behaviour over text wherever possible; the few text assertions strip comments first
// (CLAUDE.md "comments satisfy text assertions").
//
// Run: npx vitest run test/guild-config.test.js

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
import { readSource, BOT_INDEX, stripJs } from './_source-slice.js';

const require = createRequire(import.meta.url);
const gc = require('../utils/guildConfig.js');
const roles = require('../utils/roles.js');
const { getDefaultTz } = require('../utils/timezone.js');

const ROOT = path.dirname(BOT_INDEX);

function tmpDir(json) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-gcfg-'));
  if (json !== undefined) fs.writeFileSync(path.join(dir, 'config.json'), typeof json === 'string' ? json : JSON.stringify(json));
  return dir;
}
const EMPTY = tmpDir();              // a guild/ with no config.json — every deployment today
const ctx = (dir, env = {}) => ({ dir, env });

beforeEach(() => gc._resetCache());

describe('load / hasConfigFile', () => {
  it('reads and freezes a valid file', () => {
    const dir = tmpDir({ guild: { name: 'Pack X' } });
    expect(gc.hasConfigFile(dir)).toBe(true);
    const cfg = gc.load(dir);
    expect(cfg.guild.name).toBe('Pack X');
    expect(Object.isFrozen(cfg)).toBe(true);
    expect(Object.isFrozen(cfg.guild)).toBe(true);
  });

  it('a missing file is {} and silent', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(gc.load(EMPTY)).toEqual({});
    expect(gc.hasConfigFile(EMPTY)).toBe(false);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('invalid JSON is {} with exactly one warning, however often it is read', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const dir = tmpDir('{ not json');
    expect(() => gc.load(dir)).not.toThrow();
    gc.load(dir); gc.hasConfigFile(dir); gc.get('X', 'a.b', 'd', ctx(dir));
    expect(gc.load(dir)).toEqual({});
    expect(gc.hasConfigFile(dir)).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('a JSON array or scalar is not a config', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(gc.load(tmpDir('[1,2]'))).toEqual({});
    expect(gc.load(tmpDir('"x"'))).toEqual({});
    warn.mockRestore();
  });

  it('caches per directory', () => {
    const a = tmpDir({ guild: { name: 'A' } });
    const b = tmpDir({ guild: { name: 'B' } });
    expect(gc.load(a).guild.name).toBe('A');
    expect(gc.load(b).guild.name).toBe('B');
    expect(gc.load(a)).toBe(gc.load(a));
  });
});

describe('get(): env -> file -> default', () => {
  const dir = tmpDir({ guild: { name: 'From File', tags: ['a', 'b'], nested: { n: 1 } } });

  it('env wins over the file', () => {
    expect(gc.get('GUILD_NAME', 'guild.name', 'D', ctx(dir, { GUILD_NAME: 'From Env' }))).toBe('From Env');
  });
  it('the file wins over the default', () => {
    expect(gc.get('GUILD_NAME', 'guild.name', 'D', ctx(dir))).toBe('From File');
  });
  it('the default applies when neither has it', () => {
    expect(gc.get('GUILD_NAME', 'guild.nope', 'D', ctx(dir))).toBe('D');
    expect(gc.get('GUILD_NAME', 'guild.name', 'D', ctx(EMPTY))).toBe('D');
  });
  it('a whitespace-only or empty env value is unset, and a set value is trimmed', () => {
    expect(gc.get('GUILD_NAME', 'guild.name', 'D', ctx(dir, { GUILD_NAME: '   ' }))).toBe('From File');
    expect(gc.get('GUILD_NAME', 'guild.name', 'D', ctx(dir, { GUILD_NAME: '' }))).toBe('From File');
    expect(gc.get('GUILD_NAME', 'guild.name', 'D', ctx(dir, { GUILD_NAME: '  Padded ' }))).toBe('Padded');
  });
  it('arrays and objects come back as-is from a dot path', () => {
    expect(gc.get(null, 'guild.tags', [], ctx(dir))).toEqual(['a', 'b']);
    expect(gc.get(null, 'guild.nested', null, ctx(dir))).toEqual({ n: 1 });
  });
  it('an angle-bracket placeholder in the file counts as absent', () => {
    const d = tmpDir({ sites: { botApiBase: 'https://<your-bot-host>/api/agent' }, discord: { guildId: '<discord-guild-id>' } });
    expect(gc.get(null, 'sites.botApiBase', 'D', ctx(d))).toBe('D');
    expect(gc.get(null, 'discord.guildId', 'D', ctx(d))).toBe('D');
  });
  it('does not walk the prototype chain', () => {
    expect(gc.get(null, 'toString', 'D', ctx(dir))).toBe('D');
    expect(gc.get(null, '__proto__.polluted', 'D', ctx(dir))).toBe('D');
  });
});

describe('secrets never come from the file', () => {
  const dir = tmpDir({
    channels: { raidTag: 'Tag', tagPassword: 'hunter2', spec: 'name:pw' },
    discord: { botToken: 'abc', apiKey: 'k', clientSecret: 's', guildId: '123' },
    opendkp: { clientName: 'mine', password: 'p' },
  });

  it('strips secret-shaped keys at every depth when loading, and warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    gc._resetCache();
    const cfg = gc.load(dir);
    expect(cfg.channels).toEqual({ raidTag: 'Tag' });
    expect(cfg.discord).toEqual({ guildId: '123' });
    expect(cfg.opendkp).toEqual({ clientName: 'mine' });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/refused secret-shaped/);
    warn.mockRestore();
  });

  it('get() will not read a secret-shaped env name or path from the file', () => {
    expect(gc.get('TAG_CHANNEL_SPEC', 'channels.spec', 'D', ctx(dir))).toBe('D');
    expect(gc.get('DISCORD_TOKEN', 'discord.botToken', 'D', ctx(dir))).toBe('D');
    expect(gc.get(null, 'channels.tagPassword', 'D', ctx(dir))).toBe('D');
    // a secret-shaped ENV NAME is refused even when its config path is innocent
    expect(gc.get('SOME_API_KEY', 'discord.guildId', 'D', ctx(dir))).toBe('D');
    expect(gc.get('GUILD_NAME', 'discord.guildId', 'D', ctx(dir))).toBe('123');
    // ...but env may hold them
    expect(gc.get('TAG_CHANNEL_SPEC', 'channels.spec', 'D', ctx(dir, { TAG_CHANNEL_SPEC: 'n:p' }))).toBe('n:p');
  });

  it('fillEnv reports them as refused and writes nothing secret-shaped', () => {
    const env = {};
    const r = gc.fillEnv(env, JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8')));
    expect(r.refused.sort()).toEqual(['channels.spec', 'channels.tagPassword', 'discord.apiKey', 'discord.botToken', 'discord.clientSecret', 'opendkp.password']);
    for (const k of Object.keys(env)) expect(k).not.toMatch(/SPEC|TOKEN|KEY|SECRET|PASSWORD/);
    expect(env.TAG_CHANNEL_NAME).toBe('Tag');
  });

  it('no ENV_MAP target and no config path is secret-shaped, so the map cannot leak one', () => {
    for (const e of gc.ENV_MAP) {
      expect(e.env).not.toMatch(/SPEC|TOKEN|KEY|SECRET|PASSWORD/);
      for (const p of [].concat(e.path)) expect(p).not.toMatch(/spec|token|key|secret|password/i);
    }
  });
});

describe('fillEnv', () => {
  const full = {
    repo: 'someone/their-fork',
    guild: { tag: 'mypack', name: 'My Pack', short: 'MP', inGameGuild: 'My Pack IG', timezone: 'America/Chicago' },
    sites: { web: 'https://mypack.example' },
    discord: {
      guildId: '555',
      roles: { member: ['Pack Member', 'Raider'], officer: ['Officer', 'Raider'] },
      provision: { mode: 'adopt', optional: ['a', 'b'], skip: ['c'], createChannels: true, lock: 'strict', pin: false },
    },
    opendkp: { clientName: 'mypack' },
    channels: { raidTag: 'MyTag', officer: 'MyOfficer' },
  };

  it('fills every unset name, with arrays joined and booleans as 1/0', () => {
    const env = {};
    const r = gc.fillEnv(env, full);
    expect(env).toEqual({
      SUPABASE_GUILD_ID: 'mypack', DISCORD_GUILD_ID: '555',
      ALLOWED_ROLE_NAMES: 'Pack Member,Raider,Officer', OFFICER_ROLE_NAMES: 'Officer,Raider',
      OPENDKP_CLIENT_NAME: 'mypack', DEFAULT_TIMEZONE: 'America/Chicago',
      TAG_CHANNEL_NAME: 'MyTag', OFFICER_CHANNEL_NAME: 'MyOfficer',
      WEB_BASE_URL: 'https://mypack.example', PVP_GUILD_NAME: 'My Pack IG', GITHUB_REPO: 'someone/their-fork',
      GUILD_NAME: 'My Pack', GUILD_SHORT: 'MP',
      GUILD_PROVISION: 'adopt', GUILD_PROVISION_OPTIONAL: 'a,b', GUILD_PROVISION_SKIP: 'c',
      GUILD_PROVISION_CREATE_CHANNELS: '1', GUILD_PROVISION_LOCK: 'strict', GUILD_PROVISION_PIN: '0',
    });
    expect(r.filled.length).toBe(Object.keys(env).length);
    expect(r.skipped).toEqual([]);
    expect(r.refused).toEqual([]);
  });

  it('allow-list is the UNION of member and officer, de-duplicated, member first', () => {
    const env = {};
    gc.fillEnv(env, { discord: { roles: { member: ['M', 'X'], officer: ['O', 'X'] } } });
    expect(env.ALLOWED_ROLE_NAMES).toBe('M,X,O');
    expect(env.OFFICER_ROLE_NAMES).toBe('O,X');
  });

  it('never overwrites a set name — env wins — and reports it skipped', () => {
    const env = { GUILD_NAME: 'Ours', DEFAULT_TIMEZONE: 'UTC' };
    const r = gc.fillEnv(env, full);
    expect(env.GUILD_NAME).toBe('Ours');
    expect(env.DEFAULT_TIMEZONE).toBe('UTC');
    expect(r.skipped.sort()).toEqual(['DEFAULT_TIMEZONE', 'GUILD_NAME']);
    expect(r.filled).not.toContain('GUILD_NAME');
  });

  it('treats a blank env value as unset', () => {
    const env = { GUILD_NAME: '   ', GUILD_SHORT: '' };
    gc.fillEnv(env, full);
    expect(env.GUILD_NAME).toBe('My Pack');
    expect(env.GUILD_SHORT).toBe('MP');
  });

  it('skips angle-bracket placeholders, including inside arrays', () => {
    const env = {};
    const r = gc.fillEnv(env, {
      discord: { guildId: '<discord-guild-id>', roles: { member: ['<role name>'], officer: ['Officer', '<another>'] } },
      sites: { web: 'https://<your-domain>' },
    });
    expect(env.DISCORD_GUILD_ID).toBeUndefined();
    expect(env.WEB_BASE_URL).toBeUndefined();
    expect(env.ALLOWED_ROLE_NAMES).toBe('Officer');
    expect(r.filled).toEqual(['ALLOWED_ROLE_NAMES', 'OFFICER_ROLE_NAMES']);
  });

  it('writes strings only: objects, nulls and empties never become env, and never "undefined"', () => {
    const env = {};
    gc.fillEnv(env, { guild: { name: { x: 1 }, short: null, tag: '', timezone: [] }, discord: { guildId: 12345678901234567890 } });
    expect(env).toEqual({});
    expect(Object.values(env)).not.toContain('undefined');
  });

  it('accepts a numeric id only when it is a safe integer', () => {
    const env = {};
    gc.fillEnv(env, { discord: { guildId: 12345 } });
    expect(env.DISCORD_GUILD_ID).toBe('12345');
  });

  it('is a no-op for an empty config and for the real repo (no config.json committed)', () => {
    const env = { A: '1' };
    expect(gc.fillEnv(env, {})).toEqual({ filled: [], skipped: [], refused: [] });
    expect(env).toEqual({ A: '1' });
    expect(fs.existsSync(path.join(ROOT, 'guild', 'config.json'))).toBe(false);
    const env2 = { A: '1' };
    expect(gc.fillEnv(env2)).toEqual({ filled: [], skipped: [], refused: [] });
    expect(env2).toEqual({ A: '1' });
  });
});

describe('getters: built-in defaults are today\'s Wolf Pack literals', () => {
  const c = ctx(EMPTY);

  it('identity', () => {
    expect(gc.guildTag(c)).toBe('wolfpack');
    expect(gc.guildName(c)).toBe('Wolf Pack');
    expect(gc.guildShort(c)).toBe('WP');
    expect(gc.server(c)).toBe('Project Quarm');
    expect(gc.inGameGuild(c)).toBe('Wolf Pack');
    expect(gc.tz(c)).toBe('America/New_York');
  });

  it('sites, repo and OpenDKP', () => {
    expect(gc.webBase(c)).toBe('https://wolfpack.quest');
    expect(gc.webBeta(c)).toBe('https://b.wolfpack.quest');
    expect(gc.botApiBase(c)).toBeNull();
    expect(gc.repo(c)).toEqual({
      owner: 'davehess', name: 'QuarmBossTracker', slug: 'davehess/QuarmBossTracker',
      url: 'https://github.com/davehess/QuarmBossTracker',
      api: 'https://api.github.com/repos/davehess/QuarmBossTracker',
      rawBase: 'https://raw.githubusercontent.com/davehess/QuarmBossTracker',
    });
    expect(gc.opendkpClient(c)).toBe('wolfpack');
    expect(gc.opendkpBase(c)).toBe('https://wolfpack.opendkp.com');
  });

  it('roles, ranks, floors, channels, eras, flags, provision', () => {
    expect(gc.roles(c)).toEqual({ member: ['Pack Member'], officer: ['Officer', 'Guild Leader'] });
    expect(gc.ranks(c)).toEqual({
      priority: ['Officer', 'Pack Leader', 'Raid Pack', 'Recruit', 'Member', 'Inactive'],
      raider: ['Pack Leader', 'Officer', 'Raid Pack', 'Recruit'],
      raidAlt: ['Raid Alt'],
      nonRaid: ['Non-raid Alt', 'Trader'],
      newMain: 'Recruit',
    });
    expect(gc.raidFloors(c)).toEqual({ raidAlt: 46, pop: 60 });
    expect(gc.tagChannel(c)).toBe('Ztwolfpacktag');
    expect(gc.officerChannel(c)).toBe('Wolfpackofficer');
    expect(gc.eras(c)).toEqual({ PoP: '2026-10-01' });
    expect(gc.flag('pvp', true, c)).toBe(true);
    expect(gc.flag('pvp', false, c)).toBe(false);
    expect(gc.anchor('TIMER_CHANNEL_ID', c)).toBeNull();
    expect(gc.provision(c)).toEqual({ mode: 'auto', optional: [], skip: [], createChannels: false, lock: 'none', pin: false });
  });

  it('brand() is the identity at the defaults', () => {
    const blob = 'Wolf Pack raid at https://wolfpack.quest/raid, b.wolfpack.quest and wolfpack.quest/me';
    expect(gc.brand(blob, c)).toBe(blob);
    expect(gc.brand(42, c)).toBe(42);
  });

  it('agentManifest() at the defaults', () => {
    expect(gc.agentManifest(c)).toEqual({
      schema: 1,
      guild: { name: 'Wolf Pack', short: 'WP', server: 'Project Quarm', inGameGuild: 'Wolf Pack' },
      sites: { web: 'https://wolfpack.quest', webBeta: 'https://b.wolfpack.quest', opendkp: 'https://wolfpack.opendkp.com' },
      channels: { raidTag: 'Ztwolfpacktag', officer: 'Wolfpackofficer' },
      schedule: { tz: 'America/New_York' },
      eras: { PoP: '2026-10-01' },
      features: { pvp: true, opendkp: true },
    });
  });

  it('defaults match the code that still holds the literal', () => {
    // roles: compare against the real utils/roles.js under the same (empty) env
    const saved = { ...process.env };
    for (const k of ['ALLOWED_ROLE_NAMES', 'ALLOWED_ROLE_NAME', 'OFFICER_ROLE_NAMES', 'DEFAULT_TIMEZONE']) delete process.env[k];
    try {
      expect(gc.roles(c).member).toEqual(roles.getAllowedRoles());
      expect(gc.roles(c).officer).toEqual(roles.getOfficerRoles());
      expect(gc.tz(c)).toBe(getDefaultTz());
    } finally { Object.assign(process.env, saved); }
    // the roster rank order and the web rank lists, read from source (comments stripped)
    const roster = stripJs(readSource(path.join(ROOT, 'utils', 'roster.js')));
    const rp = roster.match(/const RANK_PRIORITY\s*=\s*(\[[^\]]*\])/);
    expect(JSON.parse(rp[1].replace(/'/g, '"'))).toEqual(gc.ranks(c).priority);
    expect(roster).toMatch(/const ALT_RANK\s*=\s*'Raid Alt'/);
    const pop = stripJs(readSource(path.join(ROOT, 'web', 'lib', 'popRoster.ts')));
    const arr = (name) => JSON.parse(pop.match(new RegExp(`${name}\\s*=\\s*(\\[[^\\]]*\\])`))[1].replace(/'/g, '"'));
    expect(arr('RAIDER_RANKS')).toEqual(gc.ranks(c).raider);
    expect(arr('RAID_ALT_RANKS')).toEqual(gc.ranks(c).raidAlt);
    expect(Number(pop.match(/POP_MIN_LEVEL\s*=\s*(\d+)/)[1])).toBe(gc.raidFloors(c).pop);
  });
});

describe('getters: env beats file beats default', () => {
  const dir = tmpDir({
    repo: 'filer/file-repo',
    guild: { tag: 'ft', name: 'File Guild', short: 'FG', server: 'File Server', inGameGuild: 'File IG', timezone: 'Europe/Paris' },
    sites: { web: 'https://file.example/', webBeta: 'https://b.file.example', botApiBase: 'https://bot.example/api/agent/', opendkp: 'https://file.opendkp.example/' },
    opendkp: { clientName: 'fileclient', ranks: { priority: ['A', 'B'], raider: ['A'], raidAlt: ['AltA'], nonRaid: ['N'], newMain: 'B' } },
    raid: { altMinLevel: 50, popMinLevel: 65 },
    channels: { raidTag: 'FileTag', officer: 'FileOff' },
    features: { pvp: false, opendkp: true },
    expansions: { planesOfPower: '2027-01-02' },
  });

  it('file values apply with no env', () => {
    const c = ctx(dir);
    expect(gc.guildTag(c)).toBe('ft');
    expect(gc.guildName(c)).toBe('File Guild');
    expect(gc.guildShort(c)).toBe('FG');
    expect(gc.server(c)).toBe('File Server');
    expect(gc.inGameGuild(c)).toBe('File IG');
    expect(gc.tz(c)).toBe('Europe/Paris');
    expect(gc.webBase(c)).toBe('https://file.example');            // trailing slash dropped
    expect(gc.webBeta(c)).toBe('https://b.file.example');
    expect(gc.botApiBase(c)).toBe('https://bot.example/api/agent');
    expect(gc.opendkpClient(c)).toBe('fileclient');
    expect(gc.opendkpBase(c)).toBe('https://file.opendkp.example');
    expect(gc.repo(c).slug).toBe('filer/file-repo');
    expect(gc.repo(c).rawBase).toBe('https://raw.githubusercontent.com/filer/file-repo');
    expect(gc.ranks(c)).toEqual({ priority: ['A', 'B'], raider: ['A'], raidAlt: ['AltA'], nonRaid: ['N'], newMain: 'B' });
    expect(gc.raidFloors(c)).toEqual({ raidAlt: 50, pop: 65 });
    expect(gc.tagChannel(c)).toBe('FileTag');
    expect(gc.officerChannel(c)).toBe('FileOff');
    expect(gc.flag('pvp', true, c)).toBe(false);
    expect(gc.eras(c)).toEqual({ PoP: '2027-01-02' });
  });

  it('env overrides each of them', () => {
    const c = ctx(dir, {
      SUPABASE_GUILD_ID: 'et', GUILD_NAME: 'Env Guild', GUILD_SHORT: 'EG', PVP_GUILD_NAME: 'Env IG',
      DEFAULT_TIMEZONE: 'UTC', WEB_BASE_URL: 'https://env.example///', OPENDKP_CLIENT_NAME: 'envclient',
      GITHUB_REPO: 'envo/env-repo', TAG_CHANNEL_NAME: 'EnvTag', OFFICER_CHANNEL_NAME: 'EnvOff',
    });
    expect(gc.guildTag(c)).toBe('et');
    expect(gc.guildName(c)).toBe('Env Guild');
    expect(gc.guildShort(c)).toBe('EG');
    expect(gc.inGameGuild(c)).toBe('Env IG');
    expect(gc.tz(c)).toBe('UTC');
    expect(gc.webBase(c)).toBe('https://env.example');
    expect(gc.opendkpClient(c)).toBe('envclient');
    expect(gc.repo(c).slug).toBe('envo/env-repo');
    expect(gc.tagChannel(c)).toBe('EnvTag');
    expect(gc.officerChannel(c)).toBe('EnvOff');
  });

  it('inGameGuild falls back to the guild name, which itself follows env', () => {
    const d = tmpDir({ guild: { name: 'Just A Name' } });
    expect(gc.inGameGuild(ctx(d))).toBe('Just A Name');
    expect(gc.inGameGuild(ctx(d, { GUILD_NAME: 'Env Name' }))).toBe('Env Name');
  });

  it('opendkpBase is derived from the client when sites.opendkp is absent or a placeholder', () => {
    const d = tmpDir({ opendkp: { clientName: 'abc' }, sites: { opendkp: 'https://<your-guild>.opendkp.com' } });
    expect(gc.opendkpBase(ctx(d))).toBe('https://abc.opendkp.com');
    expect(gc.opendkpBase(ctx(EMPTY, { OPENDKP_CLIENT_NAME: 'zed' }))).toBe('https://zed.opendkp.com');
  });

  it('a malformed repo falls back to the default slug', () => {
    expect(gc.repo(ctx(EMPTY, { GITHUB_REPO: 'not a repo' })).slug).toBe('davehess/QuarmBossTracker');
    expect(gc.repo(ctx(EMPTY, { GITHUB_REPO: 'a/b/c' })).slug).toBe('davehess/QuarmBossTracker');
  });

  it('bad list/number/date values fall back to the defaults instead of poisoning them', () => {
    const d = tmpDir({
      opendkp: { ranks: { priority: [], raider: [1, 2], raidAlt: 'Raid Alt', nonRaid: ['', 'x'], newMain: 7 } },
      raid: { altMinLevel: '50', popMinLevel: -1 },
      expansions: { planesOfPower: 'soon' },
    });
    const c = ctx(d);
    expect(gc.ranks(c)).toEqual(gc.ranks(ctx(EMPTY)));
    expect(gc.raidFloors(c)).toEqual({ raidAlt: 46, pop: 60 });
    expect(gc.eras(c)).toEqual({ PoP: '2026-10-01' });
  });

  it('returned rank lists are copies — mutating one cannot change the next call', () => {
    const c = ctx(EMPTY);
    gc.ranks(c).priority.push('Hacked');
    expect(gc.ranks(c).priority).not.toContain('Hacked');
  });

  it('brand() swaps the host and the name, scheme and path kept', () => {
    const c = ctx(EMPTY, { WEB_BASE_URL: 'https://mypack.example', GUILD_NAME: 'My Pack' });
    expect(gc.brand('Wolf Pack: https://wolfpack.quest/raid and wolfpack.quest/me', c))
      .toBe('My Pack: https://mypack.example/raid and mypack.example/me');
  });

  it('agentManifest carries no id, password or token, whatever the env holds', () => {
    const c = ctx(dir, {
      DISCORD_TOKEN: 'tok', TAG_CHANNEL_SPEC: 'Tag:pw', SUPABASE_SERVICE_ROLE_KEY: 'srk', DISCORD_GUILD_ID: '999888777',
      SUPABASE_GUILD_ID: 'tenant-id',
    });
    const s = JSON.stringify(gc.agentManifest(c));
    for (const bad of ['tok', 'Tag:pw', 'srk', '999888777', 'tenant-id', 'pw']) expect(s).not.toContain(bad);
    expect(Object.keys(gc.agentManifest(c)).sort()).toEqual(['channels', 'eras', 'features', 'guild', 'schedule', 'schema', 'sites']);
  });
});

describe('roles(): exactly utils/roles.js, with the file between env and the default', () => {
  const cases = [
    {},
    { ALLOWED_ROLE_NAMES: 'A, B ,,C' },
    { ALLOWED_ROLE_NAME: 'Solo' },
    { ALLOWED_ROLE_NAMES: 'A', ALLOWED_ROLE_NAME: 'Solo' },
    { OFFICER_ROLE_NAMES: 'Off1,Off2' },
    { ALLOWED_ROLE_NAMES: 'A,B', OFFICER_ROLE_NAMES: 'B' },
    { ALLOWED_ROLE_NAMES: '', OFFICER_ROLE_NAMES: '' },          // empty string falls through (`||`)
    { ALLOWED_ROLE_NAMES: '   ' },                               // whitespace is truthy: an EMPTY list
    { ALLOWED_ROLE_NAMES: ',', OFFICER_ROLE_NAMES: '  ' },
  ];
  it.each(cases)('matches roles.js for env %j (no config.json)', (env) => {
    const saved = { ...process.env };
    for (const k of ['ALLOWED_ROLE_NAMES', 'ALLOWED_ROLE_NAME', 'OFFICER_ROLE_NAMES']) delete process.env[k];
    Object.assign(process.env, env);
    try {
      const got = gc.roles(ctx(EMPTY, { ...env }));
      expect(got.member).toEqual(roles.getAllowedRoles());
      expect(got.officer).toEqual(roles.getOfficerRoles());
    } finally {
      for (const k of ['ALLOWED_ROLE_NAMES', 'ALLOWED_ROLE_NAME', 'OFFICER_ROLE_NAMES']) delete process.env[k];
      Object.assign(process.env, saved);
    }
  });

  it('whitespace-only ALLOWED_ROLE_NAMES really is an empty list (the documented quirk is real)', () => {
    expect(gc.roles(ctx(EMPTY, { ALLOWED_ROLE_NAMES: '   ' })).member).toEqual([]);
  });

  it('the file fills in when env is empty: allowed = member + officer, officer = officer', () => {
    const d = tmpDir({ discord: { roles: { member: ['M'], officer: ['O1', 'O2'] } } });
    expect(gc.roles(ctx(d))).toEqual({ member: ['M', 'O1', 'O2'], officer: ['O1', 'O2'] });
  });

  it('env still beats the file, and officer follows an env allow-list before the file', () => {
    const d = tmpDir({ discord: { roles: { member: ['M'], officer: ['O'] } } });
    expect(gc.roles(ctx(d, { ALLOWED_ROLE_NAMES: 'E' }))).toEqual({ member: ['E'], officer: ['E'] });
    expect(gc.roles(ctx(d, { OFFICER_ROLE_NAMES: 'EO' }))).toEqual({ member: ['M', 'O'], officer: ['EO'] });
  });

  it('a placeholder role in the file is ignored', () => {
    const d = tmpDir({ discord: { roles: { member: ['<your member role>'], officer: ['<your officer role>'] } } });
    expect(gc.roles(ctx(d))).toEqual({ member: ['Pack Member'], officer: ['Officer', 'Guild Leader'] });
  });
});

describe('flag(), anchor(), provision()', () => {
  it('flag: FEATURE_<NAME> env beats features.<name> beats the default', () => {
    const d = tmpDir({ features: { pvp: false, assistant: true } });
    expect(gc.flag('pvp', true, ctx(d))).toBe(false);
    expect(gc.flag('pvp', false, ctx(d, { FEATURE_PVP: '1' }))).toBe(true);
    expect(gc.flag('assistant', false, ctx(d, { FEATURE_ASSISTANT: 'off' }))).toBe(false);
    expect(gc.flag('assistant', false, ctx(d))).toBe(true);
    expect(gc.flag('web', true, ctx(d))).toBe(true);
    expect(gc.flag('pvp', true, ctx(d, { FEATURE_PVP: '  ' }))).toBe(false);          // blank = unset -> file
    expect(gc.flag('pvp', true, ctx(d, { FEATURE_PVP: 'maybe' }))).toBe(false);       // unparseable -> file
    expect(gc.flag('some-thing', true, ctx(EMPTY, { FEATURE_SOME_THING: '0' }))).toBe(false);
  });

  it('anchor: trimmed env or null', () => {
    expect(gc.anchor('X_ID', ctx(EMPTY, { X_ID: ' 123 ' }))).toBe('123');
    expect(gc.anchor('X_ID', ctx(EMPTY, { X_ID: '  ' }))).toBeNull();
    expect(gc.anchor('X_ID', ctx(EMPTY))).toBeNull();
  });

  it('provision: reads the GUILD_PROVISION* env names; bad mode falls back to auto', () => {
    const env = {
      GUILD_PROVISION: 'Adopt', GUILD_PROVISION_OPTIONAL: 'a, b,', GUILD_PROVISION_SKIP: 'c',
      GUILD_PROVISION_CREATE_CHANNELS: '1', GUILD_PROVISION_LOCK: 'strict', GUILD_PROVISION_PIN: 'true',
    };
    expect(gc.provision(ctx(EMPTY, env))).toEqual({ mode: 'adopt', optional: ['a', 'b'], skip: ['c'], createChannels: true, lock: 'strict', pin: true });
    expect(gc.provision(ctx(EMPTY, { GUILD_PROVISION: 'bogus' })).mode).toBe('auto');
    expect(gc.provision(ctx(EMPTY, { GUILD_PROVISION_CREATE_CHANNELS: '0' })).createChannels).toBe(false);
  });

  it('the config file reaches provision() through fillEnv', () => {
    const env = {};
    gc.fillEnv(env, { discord: { provision: { mode: 'report', optional: ['x'], createChannels: true } } });
    expect(gc.provision(ctx(EMPTY, env))).toMatchObject({ mode: 'report', optional: ['x'], createChannels: true, lock: 'none' });
  });
});

describe('guild/config.example.json', () => {
  const example = JSON.parse(fs.readFileSync(path.join(ROOT, 'guild', 'config.example.json'), 'utf8'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-gcfg-ex-'));
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(example));

  it('has no secret-shaped key anywhere', () => {
    const walk = (o, p = '') => Object.entries(o || {}).flatMap(([k, v]) =>
      [/spec|token|key|secret|password/i.test(k) ? p + k : null, ...(v && typeof v === 'object' && !Array.isArray(v) ? walk(v, p + k + '.') : [])]);
    expect(walk(example).filter(Boolean)).toEqual([]);
  });

  it('keeps every key slice 0 shipped', () => {
    for (const p of ['guild.name', 'guild.short', 'guild.tagline', 'guild.server', 'guild.timezone', 'guild.raidNights', 'guild.raidWindow',
      'guild.deployFreeze', 'sites.web', 'sites.webBeta', 'sites.botApiBase', 'sites.opendkp', 'sites.pqdi', 'discord.guildId',
      'discord.layout', 'discord.roles.member', 'discord.roles.raider', 'discord.roles.officer', 'channels.raidTag', 'channels.officer',
      'theme.bg', 'theme.displayFont', 'wording.assistantName', 'wording.mimicName', 'wording.parserName',
      'features.web', 'features.opendkp', 'features.pvp', 'features.assistant', 'expansions.planesOfPower']) {
      expect(gc.dig(example, p), p).not.toBeUndefined();
    }
  });

  it('carries the new keys', () => {
    for (const p of ['repo', 'guild.tag', 'guild.inGameGuild', 'discord.roles.active', 'discord.provision.mode', 'discord.provision.optional',
      'discord.provision.skip', 'discord.provision.createChannels', 'discord.provision.lock', 'discord.provision.pin',
      'opendkp.clientName', 'opendkp.ranks.priority', 'opendkp.ranks.raider', 'opendkp.ranks.raidAlt', 'opendkp.ranks.nonRaid',
      'opendkp.ranks.newMain', 'raid.altMinLevel', 'raid.popMinLevel', 'sites.loginEmailDomain']) {
      expect(gc.dig(example, p), p).not.toBeUndefined();
    }
    expect(example.discord.provision).toMatchObject({ mode: 'auto', optional: [], skip: [], createChannels: false, lock: 'none', pin: false });
  });

  it('every ENV_MAP path is present in the example, so the map and the schema agree', () => {
    for (const e of gc.ENV_MAP) for (const p of [].concat(e.path)) expect(gc.dig(example, p), `${e.env} <- ${p}`).not.toBeUndefined();
  });

  it('filling an empty env from the example yields Wolf Pack\'s own values and never a placeholder', () => {
    const env = {};
    const r = gc.fillEnv(env);   // default dir has no file; use the example explicitly
    expect(r.filled).toEqual([]);
    const r2 = gc.fillEnv(env, example);
    expect(r2.refused).toEqual([]);
    expect(env.DISCORD_GUILD_ID).toBeUndefined();                       // still "<discord-guild-id>"
    expect(env.SUPABASE_GUILD_ID).toBe('wolfpack');
    expect(env.GUILD_NAME).toBe('Wolf Pack');
    expect(env.GITHUB_REPO).toBe('davehess/QuarmBossTracker');
    expect(env.ALLOWED_ROLE_NAMES).toBe('Pack Member,Officer,Guild Leader');
    expect(env.OFFICER_ROLE_NAMES).toBe('Officer,Guild Leader');
    expect(env.GUILD_PROVISION).toBe('auto');
    expect(env.GUILD_PROVISION_CREATE_CHANNELS).toBe('0');
    for (const v of Object.values(env)) expect(v).not.toMatch(/<[^<>]+>|undefined/);
  });

  it('every getter reading the example resolves to the same values as with no file at all', () => {
    const withFile = ctx(dir);
    const none = ctx(EMPTY);
    for (const fn of ['guildTag', 'guildName', 'guildShort', 'server', 'inGameGuild', 'tz', 'webBase', 'webBeta', 'botApiBase', 'repo',
      'opendkpClient', 'opendkpBase', 'roles', 'ranks', 'raidFloors', 'tagChannel', 'officerChannel', 'eras']) {
      const a = gc[fn](withFile), b = gc[fn](none);
      // roles differ by design: the example's allow-list is member + officer, the built-in is just the member role
      if (fn === 'roles') { expect(a.officer).toEqual(b.officer); continue; }
      expect(a, fn).toEqual(b);
    }
  });
});

describe('ENV_MAP targets are env names the bot actually reads', () => {
  const read = (f) => fs.readFileSync(f, 'utf8');
  const listJs = (d) => fs.readdirSync(path.join(ROOT, d)).filter((f) => f.endsWith('.js')).map((f) => path.join(ROOT, d, f));
  const gcPath = path.join(ROOT, 'utils', 'guildConfig.js');
  const others = [BOT_INDEX, ...listJs('utils'), ...listJs('commands')].filter((f) => f !== gcPath);
  const botSrc = stripJs(others.map(read).join('\n'));
  // guildConfig's own getters count as readers (new code resolves these names through them) — but not
  // the ENV_MAP table itself, which would make every name read "by definition".
  // (slice on the raw text first — the anchor is a comment — then strip what was sliced)
  const gcRaw = read(gcPath);
  const anchorAt = gcRaw.indexOf('// ── typed getters');
  if (anchorAt < 0) throw new Error('typed-getters anchor comment not found in utils/guildConfig.js');
  const getterSrc = stripJs(gcRaw.slice(anchorAt));

  it('every target is read by the bot, or by a typed getter that new code resolves it through', () => {
    expect(gc.ENV_MAP.length).toBeGreaterThanOrEqual(18);
    const botReads = [];
    for (const { env } of gc.ENV_MAP) {
      const byBot = new RegExp(`process\\.env\\.${env}\\b|process\\.env\\[['"]${env}['"]\\]`).test(botSrc);
      const byGetter = new RegExp(`['"]${env}['"]`).test(getterSrc);
      expect(byBot || byGetter, `${env} is read nowhere`).toBe(true);
      if (byBot) botReads.push(env);
    }
    // the pre-existing reads we are feeding must really exist in the bot today
    for (const k of ['SUPABASE_GUILD_ID', 'DISCORD_GUILD_ID', 'ALLOWED_ROLE_NAMES', 'OFFICER_ROLE_NAMES', 'OPENDKP_CLIENT_NAME', 'DEFAULT_TIMEZONE', 'WEB_BASE_URL', 'PVP_GUILD_NAME']) {
      expect(botReads, k).toContain(k);
    }
  });

  it('targets are unique', () => {
    const names = gc.ENV_MAP.map((e) => e.env);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('where it is wired in index.js', () => {
  const raw = readSource(BOT_INDEX);
  const code = stripJs(raw);

  it('fillEnv runs after the slice-1a loader and before the first env read', () => {
    const dotenv = code.indexOf("require('dotenv').config();");
    const discord = code.indexOf("_loadGuildDiscordJson(require('path').join(__dirname, 'guild'), process.env);");
    const fill = code.indexOf("require('./utils/guildConfig').fillEnv(process.env)");
    const firstRead = code.indexOf('process.env.AGENT_RELEASE_REF');
    expect(dotenv).toBeGreaterThan(-1);
    expect(discord).toBeGreaterThan(dotenv);
    expect(fill).toBeGreaterThan(discord);
    expect(firstRead).toBeGreaterThan(fill);
  });

  it('is inside the file\'s opening region, before the first require of a module that reads env', () => {
    const fill = code.indexOf("require('./utils/guildConfig').fillEnv(process.env)");
    const firstUtilsRequire = code.search(/require\('\.\/utils\/(?!guildConfig)/);
    expect(fill).toBeGreaterThan(-1);
    expect(firstUtilsRequire).toBeGreaterThan(fill);
  });

  it('logs only when it filled something', () => {
    expect(code).toMatch(/if \(_GUILD_CONFIG_FILLED\.filled\.length\) console\.log\(/);
  });
});
