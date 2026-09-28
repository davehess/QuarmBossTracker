// The one-time #raid-chat card for the film's making-of (the guild lead, 2026-09-28: "send a link to the
// guild's raid-chat using this image as the 'come look at the stuff'"). It waits for the card's picture to
// be live on wolfpack.quest (same web deploy as the page), posts once with that picture, and latches.
//
// Runs the bot's REAL one-shot against fake Supabase / web / Discord.
// Run: npx vitest run test/announce-film-making.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, ROOT, sliceBlock } from './_source-slice.js';

const bot = readSource(path.join(ROOT, 'index.js'));
const block = sliceBlock(bot, "const _FILMMAKING_KV_KEY = 'announce_film_making_raid_chat';", '\n// First try a minute after boot');
const kvLatch = require('../utils/kvLatch');

function harness({ latch = [], status = 200, env = {} } = {}) {
  const log = { posts: [], upserts: [], channel: null, fetched: [] };
  const fakes = {
    './utils/supabase': {
      select: async () => (typeof latch === 'function' ? latch() : latch),
      upsert: async (table, rows) => { log.upserts.push([table, rows]); },
    },
    https: {
      get: (opts, cb) => {
        log.fetched.push(opts.hostname + opts.path);
        const res = { statusCode: status, on: (ev, f) => { if (ev === 'end') f(); return res; } };
        cb(res);
        const req = { on: () => req };
        return req;
      },
    },
    'discord.js': {
      EmbedBuilder: class { constructor() { this.d = {}; }
        setColor(c) { this.d.color = c; return this; } setTitle(t) { this.d.title = t; return this; }
        setURL(u) { this.d.url = u; return this; } setImage(u) { this.d.image = u; return this; }
        setDescription(t) { this.d.description = t; return this; } setFooter(f) { this.d.footer = f; return this; } },
    },
  };
  const raid = { name: 'raid-chat', send: async (m) => { log.posts.push(m); log.channel = 'by-name'; return { id: 'm1' }; } };
  const byId = { name: 'raid-chat-by-id', send: async (m) => { log.posts.push(m); log.channel = 'by-id'; return { id: 'm2' }; } };
  const client = {
    channels: { fetch: async (id) => (id === 'C1' ? byId : null) },
    guilds: { cache: { get: () => ({ channels: { cache: { find: (f) => [raid].find(f) } } }), first: () => null } },
  };
  // eslint-disable-next-line no-new-func
  const run = new Function('require', 'client', 'kvLatch', 'process', block + '\nreturn _announceFilmMakingOnce;')(
    (m) => fakes[m], client, kvLatch, { env: { DISCORD_GUILD_ID: 'g', ...env } });
  return { run, log };
}

describe('the making-of card in #raid-chat', () => {
  it('waits until the picture is live on wolfpack.quest', async () => {
    for (const status of [0, 404, 500, 307]) {
      const { run, log } = harness({ status });
      expect(await run()).toBe('waiting');
      expect(log.posts).toHaveLength(0);
      expect(log.fetched).toEqual(['wolfpack.quest/film/making-of.jpg']);
    }
  });

  it('posts once with the link and the picture, pinging no one, and latches', async () => {
    const { run, log } = harness({ env: { RAID_CHAT_CHANNEL_ID: 'C1' } });
    expect(await run()).toBe('posted');
    expect(log.channel).toBe('by-id');
    expect(log.posts).toHaveLength(1);
    expect(log.posts[0].allowedMentions).toEqual({ parse: [] });
    const e = log.posts[0].embeds[0].d;
    expect(e.url).toBe('https://wolfpack.quest/film/making');
    expect(e.image).toBe('https://wolfpack.quest/film/making-of.jpg');
    expect(e.description).toMatch(/type your name or pick your class at the top/);
    expect(log.upserts).toEqual([['bot_kv', [expect.objectContaining({ key: 'announce_film_making_raid_chat' })]]]);
  });

  it('falls back to a channel named raid-chat', async () => {
    const { run, log } = harness();
    expect(await run()).toBe('posted');
    expect(log.channel).toBe('by-name');
  });

  it('never posts twice, and never posts when the latch cannot be read', async () => {
    const done = harness({ latch: [{ value: { posted_at: '2026-09-28T07:00:00Z' } }] });
    expect(await done.run()).toBe('latched');
    expect(done.log.posts).toHaveLength(0);
    const down = harness({ latch: null });
    expect(await down.run()).toBe('unknown');
    expect(down.log.posts).toHaveLength(0);
  });
});
