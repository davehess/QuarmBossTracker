// The Mimic 2.7.8 raid-chat announcement (the guild lead, 2026-10-03: "post the release to raid
// chat"). Same one-shot as the 2.7.1 card (test/announce-mimic-271.test.js).
//
// Runs the bot's REAL one-shot against fake Supabase / GitHub / Discord.
// Run: npx vitest run test/announce-mimic-278.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, ROOT, sliceBlock } from './_source-slice.js';

const bot = readSource(path.join(ROOT, 'index.js'));
const block = sliceBlock(bot, "const _MIMIC278_KV_KEY = 'announce_mimic_2_7_8_raid_chat';", '\n// First look a minute');
const kvLatch = require('../utils/kvLatch');

function harness({ latch = [], release = null } = {}) {
  const log = { posts: [], upserts: [], fetched: 0 };
  const fakes = {
    './utils/supabase': {
      select: async () => (typeof latch === 'function' ? latch() : latch),
      upsert: async (table, rows) => { log.upserts.push([table, rows]); },
    },
    https: {
      get: (_opts, cb) => {
        log.fetched++;
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
  const raidChat = { name: 'raid-chat', send: async (m) => { log.posts.push(m); return { id: 'm1' }; } };
  const client = { channels: { fetch: async () => null }, guilds: { cache: { get: () => ({ channels: { cache: { find: (f) => [raidChat].find(f) } } }), first: () => null } } };
  // eslint-disable-next-line no-new-func
  const run = new Function('require', 'client', 'kvLatch', 'process', block + '\nreturn _announceMimic278Once;')(
    (m) => fakes[m], client, kvLatch, { env: { DISCORD_GUILD_ID: 'g' } });
  return { run, log };
}
const READY = { tag_name: 'v2.7.8', draft: false, prerelease: false, assets: [{ name: 'Wolf-Pack-Mimic-Setup-2.7.8.exe' }, { name: 'latest.yml' }] };

describe('the Mimic 2.7.8 announcement in #raid-chat', () => {
  it('waits for the stable release to carry its installer', async () => {
    for (const release of [null, { message: 'Not Found' }, { ...READY, draft: true }, { ...READY, prerelease: true },
      { ...READY, assets: [{ name: 'latest.yml' }] }, { ...READY, tag_name: 'v2.7.7' }]) {
      const { run, log } = harness({ release });
      expect(await run()).toBe('waiting');
      expect(log.posts).toHaveLength(0);
    }
  });

  it('posts once when it is there, to #raid-chat, pinging no one — and latches', async () => {
    const { run, log } = harness({ release: READY });
    expect(await run()).toBe('posted');
    expect(log.posts).toHaveLength(1);
    expect(log.posts[0].allowedMentions).toEqual({ parse: [] });
    expect(log.upserts[0][0]).toBe('bot_kv');
    expect(log.upserts[0][1][0].key).toBe('announce_mimic_2_7_8_raid_chat');
  });

  it('names what is in it: PoP quests, raids, who looted what, crash review, tidier lists, and the website bits', async () => {
    const { run, log } = harness({ release: READY });
    await run();
    const e = log.posts[0].embeds[0].d;
    expect(e.title).toMatch(/Mimic 2\.7\.8/);
    for (const bit of [/PoP quests/, /Raids at a glance/, /Who looted what/, /Crash review/, /Tidier character lists/,
      /wolfpack\.quest\/pop\/guide/, /Hide from lists/, /update/i]) expect(e.description).toMatch(bit);
  });

  it('never twice: an existing latch stops it before GitHub is even asked', async () => {
    const { run, log } = harness({ latch: [{ value: { posted_at: 'x' } }], release: READY });
    expect(await run()).toBe('latched');
    expect([log.posts.length, log.fetched]).toEqual([0, 0]);
  });

  it('an unreadable latch (Supabase down) is not "never posted" — it holds, and says to retry', async () => {
    const { run, log } = harness({ latch: null, release: READY });
    expect(await run()).toBe('unknown');
    expect(log.posts).toHaveLength(0);
  });
});
