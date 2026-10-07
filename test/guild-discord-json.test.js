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
import { createRequire } from 'node:module';
import { readSource, BOT_INDEX, sliceBlock, evalBlock, stripJs } from './_source-slice.js';

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
// The provisioner and /setup NAME every anchor on purpose (they build the layout),
// so they cannot be evidence that the BOT reads one. Leave them out of "who reads".
const PROVISIONER_FILES = new Set([
  path.join(ROOT, 'utils', 'discordProvisioner.js'), path.join(ROOT, 'commands', 'setup.js'),
]);
const botFiles = [BOT_INDEX,
  ...fs.readdirSync(path.join(ROOT, 'utils')).map(f => path.join(ROOT, 'utils', f)),
  ...fs.readdirSync(path.join(ROOT, 'commands')).map(f => path.join(ROOT, 'commands', f)),
].filter(f => f.endsWith('.js') && !PROVISIONER_FILES.has(f));
const allBotSrc = botFiles.map(f => fs.readFileSync(f, 'utf8')).join('\n');
// Comments are stripped for the converse check: a comment that mentions an old
// env name is not a read of it.
const allBotCode = stripJs(allBotSrc);

// Anchors the bot reads through a COMPUTED name rather than a literal
// `process.env.NAME`: the per-expansion keys (utils/config.js EXPANSION_META,
// utils/state.js, utils/killops.js), the hate-board ids (utils/state.js) and the
// rules channels (commands/ingestrules.js reads process.env[chan.env]).
const requireCjs = createRequire(import.meta.url);
const { EXPANSION_META } = requireCjs(path.join(ROOT, 'utils', 'config.js'));
const { RULE_CHANNELS } = requireCjs(path.join(ROOT, 'utils', 'rulesParser.js'));
function dynamicReads() {
  const out = new Set();
  for (const meta of Object.values(EXPANSION_META)) out.add(meta.envKey);
  for (const era of Object.keys(EXPANSION_META)) {
    const E = era.toUpperCase();
    // utils/killops.js builds `${expansion.toUpperCase()}_BOARD_IDS`; utils/state.js
    // builds expansion.toUpperCase() + '_COOLDOWN_ID'. Both shapes are one read.
    if (/toUpperCase\(\)(?:\}|\s*\+\s*')_BOARD_IDS/.test(allBotCode)) out.add(`${E}_BOARD_IDS`);
    if (/toUpperCase\(\)(?:\}|\s*\+\s*')_COOLDOWN_ID/.test(allBotCode)) out.add(`${E}_COOLDOWN_ID`);
  }
  for (const k of ['LIVE_HATE_BOARD_ID', 'PVP_HATE_BOARD_ID']) if (allBotCode.includes(`'${k}'`)) out.add(k);
  for (const c of RULE_CHANNEL_LIST()) out.add(c.env);
  return out;
}
function RULE_CHANNEL_LIST() { return RULE_CHANNELS.filter(c => /process\.env\[chan\.env\]/.test(allBotCode)); }
const DYNAMIC = dynamicReads();
const isRead = (k) => allBotSrc.includes('process.env.' + k) || DYNAMIC.has(k);

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
      expect(isRead(k), `${k} is read nowhere`).toBe(true);
    }
  });

  it('accepts the dynamic reads, and still rejects a key nothing reads', () => {
    for (const k of ['CLASSIC_THREAD_ID', 'POP_THREAD_ID', 'KUNARK_COOLDOWN_ID', 'LUCLIN_BOARD_IDS',
      'LIVE_HATE_BOARD_ID', 'PVP_HATE_BOARD_ID', 'RULES_CHANNEL_ID', 'LOOT_RULES_CHANNEL_ID']) {
      expect(isRead(k), `${k} should count as read`).toBe(true);
    }
    // A vacuous isRead would pass everything; these must fail.
    expect(isRead('NOPE_THREAD_ID')).toBe(false);
    expect(isRead('RELEASE_ANNOUNCE_CHANNEL_ID')).toBe(false);   // dead: nothing reads it any more
  });

  it('the example lists every dynamic anchor, none of the flags, and not the dead announce channel', () => {
    const ex = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'guild', 'discord.example.json'), 'utf8'));
    for (const k of DYNAMIC) expect(k in ex, `${k} missing from discord.example.json`).toBe(true);
    for (const k of ['RAID_NIGHT_THREADS', 'RAID_NIGHT_THREAD_BOSS_ONLY', 'RELEASE_ANNOUNCE_CHANNEL_ID']) {
      expect(k in ex, `${k} is a flag or dead and must not be in the example`).toBe(false);
    }
  });

  // The converse: the first check proves nothing in the example is imaginary;
  // this proves nothing the bot reads is missing from it — the gap that left five
  // <ERA>_THREAD_ID, five cooldown ids and five board-id lists out of a file that
  // claimed to hold "every Discord anchor the bot reads".
  it('every anchor-shaped env read in the bot is in the example or an explicit allowlist', () => {
    const ex = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'guild', 'discord.example.json'), 'utf8'));
    // Names that look like an anchor but are not one. Empty today; an entry needs a reason.
    const ALLOW = new Set([]);
    const reads = new Set(DYNAMIC);
    const re = /process\.env\.([A-Z0-9_]*(?:_CHANNEL_ID|_THREAD_ID|_MESSAGE_ID|_MSG_ID|_BOARD_IDS?|_COOLDOWN_ID|THREAD_PARENT_ID)[A-Z0-9_]*)/g;
    for (const m of allBotCode.matchAll(re)) reads.add(m[1]);
    for (const k of ['RAIDHELPER_BOT_ID', 'RH_SERVER_ID', 'DISCORD_GUILD_ID', 'DISCORD_CLIENT_ID']) {
      if (allBotCode.includes('process.env.' + k)) reads.add(k);
    }
    expect(reads.size).toBeGreaterThan(45);   // a corpus smaller than the example proves nothing
    for (const k of reads) {
      expect(k in ex || ALLOW.has(k), `${k} is read by the bot but missing from guild/discord.example.json`).toBe(true);
    }
  });
});
