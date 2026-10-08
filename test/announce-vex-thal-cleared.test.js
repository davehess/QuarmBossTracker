// The one-time Vex Thal celebration in #raid-chat on the Aten Ha Ra kill (the guild lead,
// 2026-09-27: "a one time celebration for all miMIC users after tomorrow's defeat of Aten Ha Ra in
// our last scheduled Vex Thal raid" · "congrats Wolf Pack on the last Aten Ha Ra of Luclin!" · "The
// guild has done approximately N damage to Aten Ha Ra since <First kill>" · "post the video into
// discord"). Runs the bot's REAL one-shot and the film poller against fakes.
//
// Run: npx vitest run test/announce-vex-thal-cleared.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, ROOT, sliceBlock, stripJs } from './_source-slice.js';

const bot = readSource(path.join(ROOT, 'index.js'));
// Both functions plus the helpers; the interval block after them is left out on purpose.
const block = sliceBlock(bot, "const _VT_CLEARED_KV_KEY = 'announce_vex_thal_cleared';", "  console.log('[vt-film] posted to #raid-chat:', posted.id);\n  return 'posted';\n}");
const kvLatch = require('../utils/kvLatch');

function harness({ latch = [], tune = {}, encounters = [], channel = true } = {}) {
  const log = { posts: [], upserts: [], selects: [] };
  const fakes = {
    './utils/supabase': {
      select: async (table, q) => {
        log.selects.push([table, q]);
        if (table === 'bot_kv') return typeof latch === 'function' ? latch(q) : latch;
        if (table === 'encounters') return encounters;
        return [];
      },
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
  const fns = new Function('require', 'client', 'kvLatch', 'process', '_overlayTuningMap', 'WP_GUILD_NAME',
    block + '\nreturn { _announceVexThalClearedOnce, _announceVexThalFilmOnce, _vtBigNumber, _vtKillDate };')(
    (m) => fakes[m], client, kvLatch, { env: { RAID_CHAT_CHANNEL_ID: 'R' } }, async () => tune, 'Wolf Pack');
  return { ...fns, run: fns._announceVexThalClearedOnce, film: fns._announceVexThalFilmOnce, log };
}
// Invented killer; the boss is the real one.
const KILL = { character: 'Brackwyn', guild: 'Wolf Pack', boss: 'Aten Ha Ra', zone: 'Vex Thal' };
// Nineteen prior kills, oldest first as the bot orders them, 22,642,841 parsed damage between them.
const HISTORY = Array.from({ length: 19 }, (_, i) => ({ id: i, started_at: i === 0 ? '2026-02-27T02:41:04Z' : `2026-0${3 + Math.floor(i / 4)}-1${i % 4}T02:00:00Z`, total_damage: i === 0 ? 2642841 : 1111111 + (i === 18 ? 1 : 0) }));
const FILM = 'https://youtu.be/abc123';

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

  it('congratulates the pack, sums the damage since the first kill (in Eastern time), counts tonight, and latches', async () => {
    const { run, log } = harness({ encounters: HISTORY });
    expect(await run(KILL)).toBe('posted');
    expect(log.posts).toHaveLength(1);
    expect(log.posts[0].allowedMentions).toEqual({ parse: [] });
    const e = log.posts[0].embeds[0].d;
    expect(e.title).toBe('🐺 Congrats Wolf Pack on the last Aten Ha Ra of Luclin!');
    expect(e.description).toMatch(/\*\*Brackwyn\*\* and the raid/);
    // 2642841 + 17×1111111 + 1111112 = 22,642,840 → "22.6 million"; the first kill at 02:41 UTC was Feb 26 in New York.
    expect(e.description).toMatch(/approximately \*\*22\.6 million\*\* damage to Aten Ha Ra since the first kill on February 26, 2026/);
    expect(e.description).toMatch(/kill number \*\*20\*\*/);
    expect(e.description).toMatch(/in the works/);
    expect(log.posts[0].content).toBeUndefined();
    expect(log.upserts).toEqual([['bot_kv', [expect.objectContaining({ key: 'announce_vex_thal_cleared' })]]]);
    // The history excludes fights that started in the last two hours (tonight's own parse), oldest first.
    const q = log.selects.find(s => s[0] === 'encounters')[1];
    expect(q).toMatch(/started_at=lt\./);
    expect(q).toMatch(/order=started_at\.asc/);
  });

  it('with the link already set, the video rides the message content (so Discord unfurls it) and the film latch is set too', async () => {
    const { run, log } = harness({ tune: { celebration_video_url: FILM }, encounters: HISTORY });
    expect(await run(KILL)).toBe('posted');
    expect(log.posts[0].content).toBe(FILM);
    expect(log.posts[0].embeds[0].d.description).toMatch(/The film\*\* is below/);
    expect(log.upserts[0][1].map(r => r.key).sort()).toEqual(['announce_vex_thal_cleared', 'announce_vex_thal_film']);
  });

  it('a bad link is never printed; an unreadable history still posts, without the numbers', async () => {
    for (const tune of [{ celebration_video_url: 'javascript:alert(1)' }, { celebration_video_url: 'http://x' }]) {
      const { run, log } = harness({ tune, encounters: null });
      expect(await run(KILL)).toBe('posted');
      expect(log.posts[0].content).toBeUndefined();
      expect(JSON.stringify(log.posts[0])).not.toMatch(/javascript|http:\/\/x/);
      expect(log.posts[0].embeds[0].d.description).not.toMatch(/approximately|kill number/);
      expect(log.posts[0].embeds[0].d.description).toMatch(/in the works/);
    }
    // A readable but empty history is a first kill, not a missing number.
    const { run, log } = harness({ encounters: [] });
    expect(await run(KILL)).toBe('posted');
    expect(log.posts[0].embeds[0].d.description).toMatch(/kill number \*\*1\*\*/);
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

  it('rounds the damage the way a raider reads it', () => {
    const { _vtBigNumber } = harness();
    expect(_vtBigNumber(22642841)).toBe('22.6 million');
    expect(_vtBigNumber(2_000_000_000)).toBe('2 billion');
    expect(_vtBigNumber(45_000)).toBe('45 thousand');
    expect(_vtBigNumber(0)).toBeNull();
    expect(_vtBigNumber(null)).toBeNull();
  });

  it('is hooked to the kill relay, right after the next-spawn line', () => {
    const relay = stripJs(sliceBlock(bot, 'async function _handleAgentBossKill(req, res) {', '\n}\n'));
    expect(relay).toMatch(/next spawn \$\{discordRelativeTime\(nextSpawn\)\}[\s\S]{0,200}discordJobs\.push\(\(\) => _announceVexThalClearedOnce\(kill\)/);
  });
});

describe('the film poller', () => {
  const cleared = { key: 'announce_vex_thal_cleared', value: { posted_at: 'x' } };
  const filmed = { key: 'announce_vex_thal_film', value: { posted_at: 'y' } };

  it('does nothing without a link, and waits for the kill embed before posting', async () => {
    const none = harness({ latch: [] });
    expect(await none.film()).toBe('no-link');
    expect(none.log.selects).toHaveLength(0);
    const early = harness({ tune: { celebration_video_url: FILM }, latch: [] });
    expect(await early.film()).toBe('waiting');
    expect(early.log.posts).toHaveLength(0);
  });

  it('posts the link once the kill embed exists, in the content, and latches', async () => {
    const { film, log } = harness({ tune: { celebration_video_url: FILM }, latch: [cleared] });
    expect(await film()).toBe('posted');
    expect(log.posts).toHaveLength(1);
    expect(log.posts[0].content).toMatch(/The film\.\*\*[\s\S]*\nhttps:\/\/youtu\.be\/abc123$/);
    expect(log.posts[0].allowedMentions).toEqual({ parse: [] });
    expect(log.upserts).toEqual([['bot_kv', [expect.objectContaining({ key: 'announce_vex_thal_film', value: expect.objectContaining({ url: FILM }) })]]]);
    expect(log.selects[0][1]).toMatch(/key=in\.\(announce_vex_thal_cleared,announce_vex_thal_film\)/);
  });

  it('never posts twice, never on an unreadable latch, never on a bad link', async () => {
    const again = harness({ tune: { celebration_video_url: FILM }, latch: [cleared, filmed] });
    expect(await again.film()).toBe('latched');
    const unknown = harness({ tune: { celebration_video_url: FILM }, latch: null });
    expect(await unknown.film()).toBe('unknown');
    const bad = harness({ tune: { celebration_video_url: 'javascript:alert(1)' }, latch: [cleared] });
    expect(await bad.film()).toBe('no-link');
    expect(again.log.posts.length + unknown.log.posts.length + bad.log.posts.length).toBe(0);
  });
});
