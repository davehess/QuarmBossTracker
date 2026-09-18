// test/guild-discord-json.test.js — guild/discord.json fills UNSET anchors only.
//
// The guild kit's slice 1a (docs/DESIGN-guild-kit.md §2). The bot reads every
// Discord anchor straight from process.env at ~54 sites, so the file layer
// runs in FRONT of env at boot rather than behind a resolver that does not
// exist. The properties that matter, each executed against the shipped
// function rather than asserted on source text:
//
//   • env wins — a key already set is never overwritten (ours are all set, so
//     our deployment must be byte-for-byte unaffected);
//   • an unset key is filled from the file;
//   • secret-shaped keys are REFUSED even when unset — a password in a
//     committed file must never silently work;
//   • no file, or a broken file, is a no-op, never a crash at boot.
//
// Run: npx vitest run test/guild-discord-json.test.js

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { readSource, BOT_INDEX, sliceBlock, evalBlock } from './_source-slice.js';

const src = readSource(BOT_INDEX);
// evalBlock runs the slice through `new Function`, which has no `require` in
// scope — and the shipped loader requires fs/path inline (it must run before
// index.js's own requires). Hand it the real modules through a global-backed
// shim rather than editing the function under test.
globalThis.__wpTestFs = fs; globalThis.__wpTestPath = path;
const { _loadGuildDiscordJson } = evalBlock(
  "const require = (m) => m === 'fs' ? globalThis.__wpTestFs : globalThis.__wpTestPath;\n"
    + sliceBlock(src, 'function _loadGuildDiscordJson(dir, env) {', '\n}'),
  ['_loadGuildDiscordJson'],
);
// The example file was generated from every env read in the bot, utils AND
// commands — so "is this a real anchor" has to look at all three.
const ROOT = path.dirname(BOT_INDEX);
const allBotSrc = [BOT_INDEX,
  ...fs.readdirSync(path.join(ROOT, 'utils')).map(f => path.join(ROOT, 'utils', f)),
  ...fs.readdirSync(path.join(ROOT, 'commands')).map(f => path.join(ROOT, 'commands', f)),
].filter(f => f.endsWith('.js')).map(f => fs.readFileSync(f, 'utf8')).join('\n');

function tmpGuild(json) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-guild-'));
  if (json !== undefined) fs.writeFileSync(path.join(dir, 'discord.json'), json);
  return dir;
}

describe('guild/discord.json at boot', () => {
  it('fills an anchor env does not set', () => {
    const dir = tmpGuild(JSON.stringify({ TIMER_CHANNEL_ID: '111' }));
    const env = {};
    const r = _loadGuildDiscordJson(dir, env);
    expect(env.TIMER_CHANNEL_ID).toBe('111');
    expect(r.filled).toEqual(['TIMER_CHANNEL_ID']);
  });

  it('never overwrites a key env already sets — env wins', () => {
    const dir = tmpGuild(JSON.stringify({ TIMER_CHANNEL_ID: '111' }));
    const env = { TIMER_CHANNEL_ID: '999' };
    const r = _loadGuildDiscordJson(dir, env);
    expect(env.TIMER_CHANNEL_ID).toBe('999');
    expect(r.skipped).toEqual(['TIMER_CHANNEL_ID']);
    expect(r.filled).toEqual([]);
  });

  it('treats an EMPTY env value as unset, so a blank line in .env does not block the file', () => {
    const dir = tmpGuild(JSON.stringify({ LOOT_CHANNEL_ID: '222' }));
    const env = { LOOT_CHANNEL_ID: '   ' };
    _loadGuildDiscordJson(dir, env);
    expect(env.LOOT_CHANNEL_ID).toBe('222');
  });

  it('refuses secret-shaped keys even when unset', () => {
    const dir = tmpGuild(JSON.stringify({
      TAG_CHANNEL_SPEC: 'name:pw', OFFICER_CHANNEL_SPEC: 'x:y',
      DISCORD_TOKEN: 't', SUPABASE_SERVICE_ROLE_KEY: 'k', WISHLIST_BID_KEY: 'b', SOME_PASSWORD: 'p',
      TIMER_CHANNEL_ID: '111',
    }));
    const env = {};
    const r = _loadGuildDiscordJson(dir, env);
    for (const k of ['TAG_CHANNEL_SPEC', 'OFFICER_CHANNEL_SPEC', 'DISCORD_TOKEN', 'SUPABASE_SERVICE_ROLE_KEY', 'WISHLIST_BID_KEY', 'SOME_PASSWORD']) {
      expect(env[k]).toBeUndefined();
      expect(r.refused).toContain(k);
    }
    expect(env.TIMER_CHANNEL_ID).toBe('111');   // the legitimate key still lands
  });

  it('ignores _comment keys and nulls (the example file is all nulls)', () => {
    const dir = tmpGuild(JSON.stringify({ _comment: 'x', TIMER_CHANNEL_ID: null, LOOT_CHANNEL_ID: '2' }));
    const env = {};
    const r = _loadGuildDiscordJson(dir, env);
    expect(env._comment).toBeUndefined();
    expect(env.TIMER_CHANNEL_ID).toBeUndefined();
    expect(r.filled).toEqual(['LOOT_CHANNEL_ID']);
  });

  it('coerces numbers and joins arrays, because env is always a string', () => {
    const dir = tmpGuild(JSON.stringify({ TIMER_CHANNEL_ID: 123, RAID_NIGHT_THREADS: ['a', 'b'] }));
    const env = {};
    _loadGuildDiscordJson(dir, env);
    expect(env.TIMER_CHANNEL_ID).toBe('123');
    expect(env.RAID_NIGHT_THREADS).toBe('a,b');
  });

  it('is a no-op with no file — every deployment today', () => {
    const dir = tmpGuild(undefined);
    const env = { X: '1' };
    const r = _loadGuildDiscordJson(dir, env);
    expect(env).toEqual({ X: '1' });
    expect(r).toEqual({ filled: [], skipped: [], refused: [] });
  });

  it('is a no-op on invalid JSON — never a crash at boot', () => {
    const dir = tmpGuild('{ not json');
    const env = {};
    expect(() => _loadGuildDiscordJson(dir, env)).not.toThrow();
    expect(env).toEqual({});
  });
});

describe('where it is wired', () => {
  it('runs at the top of index.js, right after dotenv and before the first env read', () => {
    const dotenv = src.indexOf("require('dotenv').config();");
    const call   = src.indexOf("_loadGuildDiscordJson(require('path').join(__dirname, 'guild'), process.env);");
    const firstRead = src.indexOf('process.env.AGENT_RELEASE_REF');
    expect(dotenv).toBeGreaterThan(-1);
    expect(call).toBeGreaterThan(dotenv);
    expect(firstRead).toBeGreaterThan(call);
  });

  it('ships an example whose every key is a real anchor the bot reads, and none is secret-shaped', () => {
    const ex = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'guild', 'discord.example.json'), 'utf8'));
    const keys = Object.keys(ex).filter(k => !k.startsWith('_'));
    expect(keys.length).toBeGreaterThan(30);
    for (const k of keys) {
      expect(k).not.toMatch(/SPEC|TOKEN|KEY|SECRET|PASSWORD/);
      // A key nothing reads is a key the provisioner would fill for nothing.
      expect(allBotSrc.includes('process.env.' + k), `${k} is read nowhere`).toBe(true);
    }
  });
});
