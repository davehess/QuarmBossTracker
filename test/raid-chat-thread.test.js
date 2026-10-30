// The guild lead, 2026-10-30: relayed raid chat filled #raid-chat line by line during a raid — "i'd rather it be in
// a thread". Raid chat now goes to the night's raid thread when there is one, and to the channel otherwise.
import { describe, it, expect, afterEach } from 'vitest';
import { readSource, BOT_INDEX, sliceBlock, evalBlock, stripJs } from './_source-slice.js';

const src = readSource(BOT_INDEX);
const block = sliceBlock(src, 'async function _raidChatDestination(', '// ── Era boundaries for chat thread routing');
const { _raidChatDestination, _killAnnounceOnce } = evalBlock(block, ['_raidChatDestination', '_killAnnounceOnce']);

const channelClient = (seen) => ({ channels: { fetch: async (id) => { seen.push(id); return { id, kind: 'channel' }; } } });
const rnWith = (thread) => ({ getRaidNightTarget: async () => ({ thread, kind: thread ? 'raid' : null, event: null }) });

afterEach(() => { delete process.env.RAID_CHAT_IN_THREAD; });

describe('where relayed raid chat posts', () => {
  it('goes to the night thread when one is open', async () => {
    const seen = [];
    const thread = { id: 'thread-1', kind: 'thread' };
    const ch = await _raidChatDestination(channelClient(seen), 'raid-chat', rnWith(thread));
    expect(ch).toBe(thread);
    expect(seen).toEqual([]);
  });

  // 2026-10-30, the guild lead, after a two-person raid's chat and six copies of one kill landed in #raid-chat in the
  // morning: "just restrict those to main raid times and events in threads".
  it('posts nowhere outside a raid or event window', async () => {
    const seen = [];
    const ch = await _raidChatDestination(channelClient(seen), 'raid-chat', rnWith(null));
    expect(ch).toBeNull();
    expect(seen).toEqual([]);
  });

  it('posts nowhere when the thread lookup throws', async () => {
    const seen = [];
    const rn = { getRaidNightTarget: async () => { throw new Error('discord down'); } };
    const ch = await _raidChatDestination(channelClient(seen), 'raid-chat', rn);
    expect(ch).toBeNull();
    expect(seen).toEqual([]);
  });

  it('RAID_CHAT_IN_THREAD=0 keeps it in the channel', async () => {
    process.env.RAID_CHAT_IN_THREAD = '0';
    const seen = [];
    const ch = await _raidChatDestination(channelClient(seen), 'raid-chat', rnWith({ id: 'thread-1' }));
    expect(ch.id).toBe('raid-chat');
  });

  it('one kill announcement per boss in ten minutes, however many clients relay it', () => {
    const t0 = Date.UTC(2026, 9, 30, 15, 0, 0);
    expect(_killAnnounceOnce('Lord of Ire', t0)).toBe(true);
    for (let i = 1; i <= 5; i++) expect(_killAnnounceOnce('lord of ire', t0 + i * 1000)).toBe(false);
    expect(_killAnnounceOnce('Lord of Ire', t0 + 11 * 60 * 1000), 'the next kill').toBe(true);
    expect(_killAnnounceOnce('Lord of Wrath', t0 + 2000), 'another boss').toBe(true);
  });

  it('both kill announcements go through the gate and the thread, never the bare channel', () => {
    const code = stripJs(src);
    const start = code.indexOf('const raidChId   = process.env.RAID_CHAT_CHANNEL_ID;');
    const handler = code.slice(start, code.indexOf("res.end(JSON.stringify({ ok: true, set }));", start));
    expect(handler.match(/if \(raidChId && _killAnnounceOnce\((boss\.name|bossName)\)\)/g)).toHaveLength(2);
    expect(handler.match(/await _raidChatDestination\(client, raidChId\)/g)).toHaveLength(2);
    expect(handler).not.toMatch(/client\.channels\.fetch\(raidChId\)/);
  });

  it('only raid chat is rerouted; guild chat still fetches its channel', () => {
    const code = stripJs(src);
    expect(code).toMatch(/channel === 'raid'\s*\?\s*await _raidChatDestination\(client, channelId\)\s*:\s*await client\.channels\.fetch\(channelId\)/);
  });
});
