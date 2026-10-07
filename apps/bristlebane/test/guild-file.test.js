// apps/bristlebane/test/guild-file.test.js — the guild-file layer in Bristlebane's config (lib.js).
//
// What can go wrong without anyone noticing: the file overriding an id the deployment set in its environment
// (Wolf Pack sets everything in env and must not change), a secret-shaped key in a committed file quietly
// working, a hand-edited file that is not valid JSON crashing the boot or filling junk, a file that fills the
// API address or screen URL that are meant to stay deployment values, and loadConfig writing into the process
// environment it was handed. The Discord and voice glue is in index.js and is not touched here.
//
// Every loadConfig call below names its file explicitly (second argument or BRISTLEBANE_GUILD_FILE), so the
// result never depends on whether the repo being tested has a guild/discord.json of its own.
//
// lib.js uses Node built-ins only, so this runs without apps/bristlebane/node_modules installed.
//
// Run: npx vitest run apps/bristlebane/test/guild-file.test.js   (from the repo root)

import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const lib = require('../lib.js');

const here = path.dirname(fileURLToPath(import.meta.url));
const tmpDirs = [];
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'bristlebane-guild-')); tmpDirs.push(d); return d; };
// A guild file with this content (an object is stringified, a string is written as it is).
const guildFile = (content) => {
  const f = path.join(tmp(), 'discord.json');
  fs.writeFileSync(f, typeof content === 'string' ? content : JSON.stringify(content));
  return f;
};
const MISSING = () => path.join(tmp(), 'no-such-file.json');

afterEach(() => {
  vi.restoreAllMocks();
  while (tmpDirs.length) fs.rmSync(tmpDirs.pop(), { recursive: true, force: true });
});

// Capture what the loader says, so a test can assert on it (and so the run stays quiet).
function spies() {
  return {
    warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
    log: vi.spyOn(console, 'log').mockImplementation(() => {}),
  };
}
const said = (spy) => spy.mock.calls.map((c) => c.join(' ')).join('\n');

// ── fillEnvFromGuildFile ─────────────────────────────────────────────────────

describe('fillEnvFromGuildFile', () => {
  it('fills keys the environment leaves unset or blank, and reports them', () => {
    spies();
    const f = guildFile({ DISCORD_GUILD_ID: '111111', RAID_VOICE_CHANNEL_ID: '222222', RAID_CHAT_CHANNEL_ID: '333333' });
    const env = { RAID_VOICE_CHANNEL_ID: '', RAID_CHAT_CHANNEL_ID: '   ' };
    const out = lib.fillEnvFromGuildFile(env, f);
    expect(env).toEqual({ DISCORD_GUILD_ID: '111111', RAID_VOICE_CHANNEL_ID: '222222', RAID_CHAT_CHANNEL_ID: '333333' });
    expect(out.filled).toEqual(['DISCORD_GUILD_ID', 'RAID_VOICE_CHANNEL_ID', 'RAID_CHAT_CHANNEL_ID']);
    expect(out.skipped).toEqual([]);
    expect(out.refused).toEqual([]);
  });

  it('never overrides an environment value, and says which keys it left alone', () => {
    spies();
    const f = guildFile({ DISCORD_GUILD_ID: 'from-file', RAID_VOICE_CHANNEL_ID: 'from-file' });
    const env = { DISCORD_GUILD_ID: 'from-env' };
    const out = lib.fillEnvFromGuildFile(env, f);
    expect(env.DISCORD_GUILD_ID).toBe('from-env');
    expect(env.RAID_VOICE_CHANNEL_ID).toBe('from-file');
    expect(out.skipped).toEqual(['DISCORD_GUILD_ID']);
    expect(out.filled).toEqual(['RAID_VOICE_CHANNEL_ID']);
  });

  it('stringifies values, joins arrays with commas, and skips _ keys and nulls', () => {
    spies();
    const f = guildFile({ _comment: 'ignored', A_NULL: null, A_LIST: ['1', '2', '3'], A_NUMBER: 42, A_FLAG: true, A_STRING: 'x' });
    const env = {};
    lib.fillEnvFromGuildFile(env, f);
    expect(env).toEqual({ A_LIST: '1,2,3', A_NUMBER: '42', A_FLAG: 'true', A_STRING: 'x' });
  });

  it('refuses secret-shaped keys with a warning that names the key and never prints its value', () => {
    const { warn, log } = spies();
    const secrets = ['BOT_API_KEY', 'BRISTLEBANE_TOKEN', 'SOME_SECRET_ID', 'CHANNEL_PASSWORD', 'TAG_SPEC_FOO'];
    const f = guildFile({ ...Object.fromEntries(secrets.map((k) => [k, 'hunter2-value'])), DISCORD_GUILD_ID: '111111' });
    const env = {};
    const out = lib.fillEnvFromGuildFile(env, f);
    expect(out.refused).toEqual(secrets);
    for (const k of secrets) expect(env[k]).toBeUndefined();
    expect(env.DISCORD_GUILD_ID).toBe('111111');
    expect(said(warn)).toMatch(/refused secret-shaped key\(s\) BOT_API_KEY, BRISTLEBANE_TOKEN/);
    expect(said(warn) + said(log)).not.toContain('hunter2-value');
  });

  it('a missing file is a no-op and says nothing', () => {
    const { warn, log } = spies();
    const env = { KEEP: 'me' };
    expect(lib.fillEnvFromGuildFile(env, MISSING())).toEqual({ filled: [], skipped: [], refused: [] });
    expect(env).toEqual({ KEEP: 'me' });
    expect(warn).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it('a file that is not valid JSON is a no-op with a warning', () => {
    const { warn } = spies();
    const env = { KEEP: 'me' };
    const out = lib.fillEnvFromGuildFile(env, guildFile('{ "DISCORD_GUILD_ID": "111111", '));
    expect(out).toEqual({ filled: [], skipped: [], refused: [] });
    expect(env).toEqual({ KEEP: 'me' });
    expect(said(warn)).toMatch(/not valid JSON — ignored/);
  });

  it('a malformed file\'s warning gives the position at most, never a snippet of the file', () => {
    const { warn } = spies();
    // Node quotes the start of the text in some parse errors (`Unexpected token 'o', "not json hu"... is not valid JSON`),
    // and the start of a file can be a value. Two shapes: a bare word, and a value followed by a missing comma.
    for (const text of ['not json hunter2-value', '{ "DISCORD_GUILD_ID": "hunter2-value" "X": 1 }']) {
      warn.mockClear();
      expect(lib.fillEnvFromGuildFile({}, guildFile(text))).toEqual({ filled: [], skipped: [], refused: [] });
      expect(said(warn)).toMatch(/not valid JSON — ignored \(SyntaxError( at position \d+)?\)/);
      expect(said(warn)).not.toContain('hunter2');
      expect(said(warn)).not.toContain('not json');
    }
  });

  it('a path that exists but cannot be read as a file warns with the error code, and fills nothing', () => {
    const { warn } = spies();
    const env = { KEEP: 'me' };
    const dir = tmp();                       // a directory where a file was meant: Docker makes one of a mistyped -v host path
    expect(lib.fillEnvFromGuildFile(env, dir)).toEqual({ filled: [], skipped: [], refused: [] });
    expect(env).toEqual({ KEEP: 'me' });
    expect(said(warn)).toContain(`${dir} could not be read (EISDIR) — ignored`);

    // A file the process may not open (root-owned 0600 under `USER node`). Simulated: the tests may run as root.
    const f = guildFile({ DISCORD_GUILD_ID: '111111' });
    const real = fs.readFileSync;
    vi.spyOn(fs, 'readFileSync').mockImplementation((p, ...rest) => {
      if (p === f) throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
      return real(p, ...rest);
    });
    warn.mockClear();
    expect(lib.fillEnvFromGuildFile(env, f).filled).toEqual([]);
    expect(said(warn)).toContain(`${f} could not be read (EACCES) — ignored`);
  });

  it('a number too large to be an exact id is refused with a warning, not rounded into a wrong id', () => {
    const { warn, log } = spies();
    // Written as text: JSON.stringify of the number would already have rounded it.
    // 9007199254740993 is 2^53 + 1, which JSON.parse reads as 9007199254740992.
    const f = guildFile('{ "DISCORD_GUILD_ID": 9007199254740993, "RAID_VOICE_CHANNEL_ID": "222222", "A_SMALL_NUMBER": 42 }');
    const env = {};
    const out = lib.fillEnvFromGuildFile(env, f);
    expect(env).toEqual({ RAID_VOICE_CHANNEL_ID: '222222', A_SMALL_NUMBER: '42' });
    expect(out.filled).toEqual(['RAID_VOICE_CHANNEL_ID', 'A_SMALL_NUMBER']);
    expect(said(warn)).toContain('DISCORD_GUILD_ID is a number too large to keep exactly — write ids as strings');
    expect(said(warn) + said(log)).not.toContain('9007199254740992');     // the rounded value is never printed either

    // The warning is about a key the file would have filled: when env already has it, there is nothing to say.
    warn.mockClear();
    const env2 = { DISCORD_GUILD_ID: 'from-env' };
    expect(lib.fillEnvFromGuildFile(env2, f).skipped).toEqual(['DISCORD_GUILD_ID']);
    expect(env2.DISCORD_GUILD_ID).toBe('from-env');
    expect(said(warn)).not.toContain('too large');
  });

  it('JSON that is not an object (a list, a string, a number) fills nothing', () => {
    const { warn } = spies();
    for (const text of ['["a","b"]', '"abc"', '7', 'null']) {
      const env = {};
      expect(lib.fillEnvFromGuildFile(env, guildFile(text))).toEqual({ filled: [], skipped: [], refused: [] });
      expect(env).toEqual({});
    }
    expect(warn).toHaveBeenCalled();
  });

  it('`only` limits what is filled, but secret-shaped keys outside it are still reported', () => {
    const { warn } = spies();
    const f = guildFile({ DISCORD_GUILD_ID: '111111', BOT_API_URL: 'https://elsewhere.example', BOT_API_KEY: 'k' });
    const env = {};
    const out = lib.fillEnvFromGuildFile(env, f, ['DISCORD_GUILD_ID']);
    expect(env).toEqual({ DISCORD_GUILD_ID: '111111' });
    expect(out.refused).toEqual(['BOT_API_KEY']);
    expect(said(warn)).toMatch(/BOT_API_KEY/);
  });

  it('with no file argument it reads guild/discord.json at the repo root', () => {
    expect(path.resolve(lib.DEFAULT_GUILD_FILE)).toBe(path.resolve(here, '..', '..', '..', 'guild', 'discord.json'));
  });
});

// ── loadConfig ───────────────────────────────────────────────────────────────

describe('loadConfig with a guild file', () => {
  // Everything but the four ids the file may supply. BOT_API_URL carries a trailing slash on purpose.
  const rest = { BRISTLEBANE_TOKEN: 't', BOT_API_URL: 'https://bot.example/api/agent/', BOT_API_KEY: 'key-123' };
  const ids = { DISCORD_GUILD_ID: '111111', RAID_VOICE_CHANNEL_ID: '222222', RAID_CHAT_CHANNEL_ID: '333333', OFFNIGHT_VOICE_CHANNEL_ID: '444444' };

  it('takes the four Discord ids from the file when the environment sets none of them', () => {
    spies();
    const c = lib.loadConfig({ ...rest }, guildFile(ids));
    expect(c).toMatchObject({ guildId: '111111', raidVoiceChannelId: '222222', raidChatChannelId: '333333', offnightVoiceChannelId: '444444' });
  });

  it('finds the file through BRISTLEBANE_GUILD_FILE, and an explicit argument beats that variable', () => {
    spies();
    const viaEnv = lib.loadConfig({ ...rest, BRISTLEBANE_GUILD_FILE: guildFile(ids) });
    expect(viaEnv.guildId).toBe('111111');
    const other = guildFile({ ...ids, DISCORD_GUILD_ID: '999999' });
    expect(lib.loadConfig({ ...rest, BRISTLEBANE_GUILD_FILE: guildFile(ids) }, other).guildId).toBe('999999');
  });

  it('environment wins, id by id: the file only fills what env leaves unset or blank', () => {
    spies();
    const c = lib.loadConfig({ ...rest, DISCORD_GUILD_ID: 'env-guild', RAID_CHAT_CHANNEL_ID: '  ' }, guildFile(ids));
    expect(c.guildId).toBe('env-guild');
    expect(c.raidChatChannelId).toBe('333333');
    expect(c.raidVoiceChannelId).toBe('222222');
  });

  it('a deployment that sets everything in env is unchanged by a file full of other values, and logs nothing', () => {
    const { warn, log } = spies();
    const env = { ...rest, DISCORD_GUILD_ID: 'g', RAID_VOICE_CHANNEL_ID: 'v', RAID_CHAT_CHANNEL_ID: 'c', OFFNIGHT_VOICE_CHANNEL_ID: 'o' };
    const without = lib.loadConfig(env, MISSING());
    warn.mockClear();                       // the line above names a file that is not there; this test is about the next call
    const other = {};
    for (const k of Object.keys(ids)) other[k] = 'other-' + k;
    const withFile = lib.loadConfig(env, guildFile(other));
    expect(withFile).toEqual(without);
    expect(withFile).toMatchObject({ guildId: 'g', raidVoiceChannelId: 'v', raidChatChannelId: 'c', offnightVoiceChannelId: 'o' });
    expect(warn).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it('optional ids stay null when neither env nor file has them', () => {
    spies();
    const c = lib.loadConfig({ ...rest }, guildFile({ DISCORD_GUILD_ID: '111111', RAID_VOICE_CHANNEL_ID: '222222', RAID_CHAT_CHANNEL_ID: null }));
    expect(c.raidChatChannelId).toBeNull();
    expect(c.offnightVoiceChannelId).toBeNull();
  });

  it('need() still throws, naming both required ids, when neither env nor file has them', () => {
    spies();
    for (const file of [MISSING(), guildFile({ DISCORD_GUILD_ID: null, RAID_VOICE_CHANNEL_ID: null }), guildFile('not json'), guildFile({})]) {
      expect(() => lib.loadConfig({ ...rest }, file)).toThrow(/DISCORD_GUILD_ID is not set; RAID_VOICE_CHANNEL_ID is not set/);
    }
    // One id from the file does not hide the other that is still missing.
    expect(() => lib.loadConfig({ ...rest }, guildFile({ DISCORD_GUILD_ID: '111111' }))).toThrow(/^(?!.*DISCORD_GUILD_ID).*RAID_VOICE_CHANNEL_ID is not set/s);
  });

  it('BOT_API_URL, BOT_API_KEY, SCREEN_URL and the token stay environment-only, whatever the file says', () => {
    const { warn } = spies();
    const f = guildFile({
      ...ids, BOT_API_URL: 'https://file.example/api/agent', BOT_API_KEY: 'file-key',
      BRISTLEBANE_TOKEN: 'file-token', SCREEN_URL: 'https://file.example/screen',
    });
    let err;
    try { lib.loadConfig({}, f); } catch (e) { err = e; }
    expect(err.message).toMatch(/BRISTLEBANE_TOKEN is not set/);
    expect(err.message).toMatch(/BOT_API_URL is not set/);
    expect(err.message).toMatch(/BOT_API_KEY is not set/);
    expect(said(warn)).toMatch(/refused secret-shaped key\(s\) BOT_API_KEY, BRISTLEBANE_TOKEN/);
    const c = lib.loadConfig({ ...rest }, f);
    expect(c.apiUrl).toBe('https://bot.example/api/agent');
    expect(c.apiKey).toBe('key-123');
    expect(c.screenUrl).toBeNull();
  });

  it('does not modify the environment object it was given', () => {
    spies();
    const env = { ...rest };
    const before = JSON.stringify(env);
    lib.loadConfig(env, guildFile(ids));
    expect(JSON.stringify(env)).toBe(before);
    expect(env.DISCORD_GUILD_ID).toBeUndefined();
  });

  it('warns when an explicitly named guild file does not exist, and stays quiet when none was named', () => {
    const { warn } = spies();
    const gone = MISSING();
    expect(() => lib.loadConfig({ ...rest, BRISTLEBANE_GUILD_FILE: gone })).toThrow(/DISCORD_GUILD_ID is not set/);
    expect(said(warn)).toContain(`${gone} does not exist`);
    expect(() => lib.loadConfig({ ...rest }, gone)).toThrow(/DISCORD_GUILD_ID is not set/);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('with no file named, an absent default path is read without a word', () => {
    const { warn, log } = spies();
    // The real guild/discord.json is never touched: reading the default path is made to fail as "absent",
    // so this holds in a checkout that has filled that file in, too.
    const real = fs.readFileSync;
    const read = vi.spyOn(fs, 'readFileSync').mockImplementation((p, ...a) => {
      if (p === lib.DEFAULT_GUILD_FILE) throw Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' });
      return real(p, ...a);
    });
    expect(() => lib.loadConfig({ ...rest })).toThrow(/DISCORD_GUILD_ID is not set/);
    expect(read).toHaveBeenCalledWith(lib.DEFAULT_GUILD_FILE, 'utf8');
    expect(warn).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it('a directory named as the guild file warns (EISDIR) and the boot still stops for the missing ids', () => {
    const { warn } = spies();
    const dir = tmp();
    expect(() => lib.loadConfig({ ...rest }, dir)).toThrow(/DISCORD_GUILD_ID is not set; RAID_VOICE_CHANNEL_ID is not set/);
    expect(() => lib.loadConfig({ ...rest, BRISTLEBANE_GUILD_FILE: dir })).toThrow(/DISCORD_GUILD_ID is not set/);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(said(warn)).toContain(`${dir} could not be read (EISDIR)`);
    expect(said(warn)).not.toContain('does not exist');     // it exists; it is just not a file
  });
});
