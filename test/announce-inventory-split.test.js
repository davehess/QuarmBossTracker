// The inventory-sharing split, announced once in #wlfpck-general (the guild
// lead, 2026-09-25: "post the inventory change to Wlfpck-general channel").
//
// Runs the bot's REAL one-shot against fake Supabase / Discord.
// Run: npx vitest run test/announce-inventory-split.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, ROOT, sliceBlock } from './_source-slice.js';

const bot = readSource(path.join(ROOT, 'index.js'));
const block = sliceBlock(bot, "const _INVSPLIT_KV_KEY = 'announce_inventory_split_general';", '\n// 90 s after boot');
const kvLatch = require('../utils/kvLatch');

function harness({ latch = [], named = true, byId = true } = {}) {
  const log = { posts: [], upserts: [], fetchedIds: [] };
  const fakes = {
    './utils/supabase': {
      select: async () => latch,
      upsert: async (table, rows) => { log.upserts.push([table, rows]); },
    },
    'discord.js': {
      EmbedBuilder: class { constructor() { this.d = {}; }
        setColor(c) { this.d.color = c; return this; } setTitle(t) { this.d.title = t; return this; }
        setDescription(t) { this.d.description = t; return this; } setFooter(f) { this.d.footer = f; return this; } },
    },
  };
  const general = { name: 'wlfpck-general', send: async (m) => { log.posts.push(m); return { id: 'm1' }; } };
  const channels = named ? [{ name: 'raid-chat', send: async () => ({ id: 'x' }) }, general] : [];
  const client = {
    channels: { fetch: async (id) => { log.fetchedIds.push(id); return byId ? general : null; } },
    guilds: { cache: { get: () => ({ channels: { cache: { find: (f) => channels.find(f) } } }), first: () => null } },
  };
  // eslint-disable-next-line no-new-func
  const run = new Function('require', 'client', 'kvLatch', 'process', block + '\nreturn _announceInventorySplitOnce;')(
    (m) => fakes[m], client, kvLatch, { env: { DISCORD_GUILD_ID: 'g' } });
  return { run, log };
}

describe('the inventory-split announcement in #wlfpck-general', () => {
  it('posts once, pinging no one, and latches', async () => {
    const { run, log } = harness();
    expect(await run()).toBe('posted');
    expect(log.posts).toHaveLength(1);
    expect(log.posts[0].allowedMentions).toEqual({ parse: [] });
    expect(log.upserts[0][0]).toBe('bot_kv');
    expect(log.upserts[0][1][0].key).toBe('announce_inventory_split_general');
  });

  it('says what changed and what to do, in member words', async () => {
    const { run, log } = harness();
    await run();
    const d = log.posts[0].embeds[0].d.description;
    expect(d).toContain('**Quest page**');
    expect(d).toContain('**Inventory page**');
    expect(d).toContain('Turn **Inventory page** back on at wolfpack.quest/me');
    expect(d).toContain('wolfpack.quest/privacy');
    expect(d).not.toMatch(/show_inventory_publicly|show_quests_publicly|@everyone|@here/);
  });

  it('finds the channel by name, and by its id when the name lookup misses', async () => {
    const byName = harness();
    await byName.run();
    expect(byName.log.fetchedIds).toEqual([]);
    const byIdOnly = harness({ named: false });
    expect(await byIdOnly.run()).toBe('posted');
    expect(byIdOnly.log.fetchedIds).toEqual(['1210572328589721660']);
    const neither = harness({ named: false, byId: false });
    expect(await neither.run()).toBe('no-channel');
  });

  it('never posts twice, and never posts when the latch cannot be read', async () => {
    const done = harness({ latch: [{ value: { posted_at: '2026-09-25T12:00:00Z' } }] });
    expect(await done.run()).toBe('latched');
    expect(done.log.posts).toHaveLength(0);
    const unreadable = harness({ latch: null });
    expect(await unreadable.run()).toBe('unknown');
    expect(unreadable.log.posts).toHaveLength(0);
  });
});
