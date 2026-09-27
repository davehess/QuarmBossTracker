// The one-time Vex Thal celebration in #raid-chat on the Aten Ha Ra kill (the guild lead,
// 2026-09-27: "a one time celebration for all miMIC users after tomorrow's defeat of Aten Ha Ra in
// our last scheduled Vex Thal raid"). Runs the bot's REAL one-shot against fakes.
//
// Run: npx vitest run test/announce-vex-thal-cleared.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, ROOT, sliceBlock, stripJs } from './_source-slice.js';

const bot = readSource(path.join(ROOT, 'index.js'));
const block = sliceBlock(bot, "const _VT_CLEARED_KV_KEY = 'announce_vex_thal_cleared';", "  return 'posted';\n}");
const kvLatch = require('../utils/kvLatch');

function harness({ latch = [], tune = {}, encounters = [], channel = true } = {}) {
  const log = { posts: [], upserts: [], selects: [] };
  const fakes = {
    './utils/supabase': {
      select: async (table, q) => { log.selects.push([table, q]); if (table === 'bot_kv') return latch; if (table === 'encounters') return encounters; return []; },
      upsert: async (table, rows) => { log.upserts.push([table, rows]); },
    },
    'discord.js': {
      EmbedBuilder: class { constructor() { this.d = {}; }
        setColor(c) { this.d.color = c; return this; } setTitle(t) { this.d.title = t; return this; }
        setDescription(t) { this.d.description = t; return this; } setFooter(f) { this.d.footer = f; return this; } },
    },
  };
  const raidChat = { send: async (m) => { log.posts.push(m); return { id: 'm9' }; } };
  const client = { channels: { fetch: async () => (channel ? raidChat : null) } };
  // eslint-disable-next-line no-new-func
  const run = new Function('require', 'client', 'kvLatch', 'process', '_overlayTuningMap', 'WP_GUILD_NAME',
    block + '\nreturn _announceVexThalClearedOnce;')(
    (m) => fakes[m], client, kvLatch, { env: { RAID_CHAT_CHANNEL_ID: 'R' } }, async () => tune, 'Wolf Pack');
  return { run, log };
}
// Invented killer; the boss is the real one.
const KILL = { character: 'Brackwyn', guild: 'Wolf Pack', boss: 'Aten Ha Ra', zone: 'Vex Thal' };

describe('the Vex Thal celebration', () => {
  it('fires only for her, and only for our kill', async () => {
    for (const k of [{ ...KILL, boss: 'Kaas Thox Xi Aten Ha Ra (North)' }, { ...KILL, boss: 'Thall Xundraux Diabo' }]) {
      const { run, log } = harness();
      expect(await run(k)).toBe('not-her');
      expect(log.posts).toHaveLength(0);
    }
    const { run, log } = harness();
    expect(await run({ ...KILL, guild: 'Zek' })).toBe('not-us');
    expect(log.posts).toHaveLength(0);
  });

  it('posts once to #raid-chat, pinging no one, with the kill count and the film link, and latches', async () => {
    const { run, log } = harness({ tune: { celebration_video_url: 'https://youtu.be/abc123' }, encounters: Array.from({ length: 19 }, (_, i) => ({ id: i })) });
    expect(await run(KILL)).toBe('posted');
    expect(log.posts).toHaveLength(1);
    expect(log.posts[0].allowedMentions).toEqual({ parse: [] });
    const e = log.posts[0].embeds[0].d;
    expect(e.title).toMatch(/VEX THAL CLEARED/);
    expect(e.description).toMatch(/\*\*Brackwyn\*\* and the raid/);
    expect(e.description).toMatch(/kill number \*\*20\*\*/);
    expect(e.description).toMatch(/The film:\*\* https:\/\/youtu\.be\/abc123/);
    expect(log.upserts).toEqual([['bot_kv', [expect.objectContaining({ key: 'announce_vex_thal_cleared' })]]]);
    // The count excludes fights that started in the last two hours (tonight's own parse).
    expect(log.selects.find(s => s[0] === 'encounters')[1]).toMatch(/started_at=lt\./);
  });

  it('without a film link it says the film is coming; a bad link is not printed', async () => {
    for (const tune of [{}, { celebration_video_url: 'javascript:alert(1)' }, { celebration_video_url: 'http://x' }]) {
      const { run, log } = harness({ tune });
      expect(await run(KILL)).toBe('posted');
      expect(log.posts[0].embeds[0].d.description).toMatch(/in the works/);
      expect(log.posts[0].embeds[0].d.description).not.toMatch(/javascript|http:\/\/x/);
    }
  });

  it('never posts twice, never on an unreadable latch, and never without the channel', async () => {
    const done = harness({ latch: [{ value: { posted_at: 'x' } }] });
    expect(await done.run(KILL)).toBe('latched');
    const unknown = harness({ latch: null });
    expect(await unknown.run(KILL)).toBe('unknown');
    const noCh = harness({ channel: false });
    expect(await noCh.run(KILL)).toBe('no-channel');
    expect(done.log.posts.length + unknown.log.posts.length + noCh.log.posts.length).toBe(0);
  });

  it('is hooked to the kill relay, right after the next-spawn line', () => {
    const relay = stripJs(sliceBlock(bot, 'async function _handleAgentBossKill(req, res) {', '\n}\n'));
    expect(relay).toMatch(/next spawn \$\{discordRelativeTime\(nextSpawn\)\}[\s\S]{0,200}discordJobs\.push\(\(\) => _announceVexThalClearedOnce\(kill\)/);
  });
});
