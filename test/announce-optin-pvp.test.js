// The one-time #pvp note (the guild lead, 2026-09-27: "make a note in the PVP channel for people to
// run their opt in logs to get historical credit on pvp kills and assists"). It waits for the stable
// v2.7.2 release to carry its installer, posts once, and latches.
//
// Runs the bot's REAL one-shot against fake Supabase / GitHub / Discord.
// Run: npx vitest run test/announce-optin-pvp.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, ROOT, sliceBlock } from './_source-slice.js';

const bot = readSource(path.join(ROOT, 'index.js'));
const block = sliceBlock(bot, "const _OPTINPVP_KV_KEY = 'announce_optin_pvp_credit';", '\n// Every 5 minutes');
const kvLatch = require('../utils/kvLatch');

function harness({ latch = [], release = null, env = {} } = {}) {
  const log = { posts: [], upserts: [], channel: null };
  const fakes = {
    './utils/supabase': {
      select: async () => (typeof latch === 'function' ? latch() : latch),
      upsert: async (table, rows) => { log.upserts.push([table, rows]); },
    },
    https: {
      get: (_opts, cb) => {
        const res = { on: (ev, f) => { if (ev === 'data') f(JSON.stringify(release)); if (ev === 'end') f(); return res; } };
        cb(res);
        const req = { on: () => req };
        return req;
      },
    },
    'discord.js': {
      EmbedBuilder: class { constructor() { this.d = {}; }
        setColor(c) { this.d.color = c; return this; } setTitle(t) { this.d.title = t; return this; }
        setDescription(t) { this.d.description = t; return this; } setFooter(f) { this.d.footer = f; return this; } },
    },
  };
  const pvp = { name: 'pvp', send: async (m) => { log.posts.push(m); log.channel = 'pvp-by-name'; return { id: 'm1' }; } };
  const byId = { name: 'pvp-thread', send: async (m) => { log.posts.push(m); log.channel = 'by-id'; return { id: 'm2' }; } };
  const client = {
    channels: { fetch: async (id) => (id === 'T1' ? byId : null) },
    guilds: { cache: { get: () => ({ channels: { cache: { find: (f) => [pvp].find(f) } } }), first: () => null } },
  };
  // eslint-disable-next-line no-new-func
  const run = new Function('require', 'client', 'kvLatch', 'process', block + '\nreturn _announceOptinPvpOnce;')(
    (m) => fakes[m], client, kvLatch, { env: { DISCORD_GUILD_ID: 'g', ...env } });
  return { run, log };
}
const READY = { tag_name: 'v2.7.2', draft: false, prerelease: false, assets: [{ name: 'Wolf-Pack-Mimic-Setup-2.7.2.exe' }, { name: 'latest.yml' }] };

describe('the opt-in-logs note in #pvp', () => {
  it('waits for the stable 2.7.2 release to carry its installer', async () => {
    for (const release of [null, { message: 'Not Found' }, { ...READY, tag_name: 'v2.7.2-beta.21', prerelease: true },
      { ...READY, draft: true }, { ...READY, assets: [{ name: 'latest.yml' }] }]) {
      const { run, log } = harness({ release });
      expect(await run()).toBe('waiting');
      expect(log.posts).toHaveLength(0);
    }
  });

  it('posts once to the PvP thread when set, pinging no one, and latches', async () => {
    const { run, log } = harness({ release: READY, env: { PVP_THREAD_ID: 'T1' } });
    expect(await run()).toBe('posted');
    expect(log.channel).toBe('by-id');
    expect(log.posts).toHaveLength(1);
    expect(log.posts[0].allowedMentions).toEqual({ parse: [] });
    const e = log.posts[0].embeds[0].d;
    expect(e.title).toMatch(/Opt-in Logs/);
    expect(e.description).toMatch(/Backfill/);
    expect(e.description).toMatch(/Re-run/);
    expect(e.description).toMatch(/one note/);
    expect(log.upserts).toEqual([['bot_kv', [expect.objectContaining({ key: 'announce_optin_pvp_credit' })]]]);
  });

  it('falls back to a channel named pvp', async () => {
    const { run, log } = harness({ release: READY });
    expect(await run()).toBe('posted');
    expect(log.channel).toBe('pvp-by-name');
  });

  it('never posts twice, and never posts when the latch cannot be read', async () => {
    const done = harness({ release: READY, latch: [{ value: { posted_at: 'x' } }] });
    expect(await done.run()).toBe('latched');
    expect(done.log.posts).toHaveLength(0);
    const unknown = harness({ release: READY, latch: null });
    expect(await unknown.run()).toBe('unknown');
    expect(unknown.log.posts).toHaveLength(0);
  });
});
