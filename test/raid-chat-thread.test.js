// The guild lead, 2026-10-30: relayed raid chat filled #raid-chat line by line during a raid — "i'd rather it be in
// a thread". Raid chat now goes to the night's raid thread when there is one, and to the channel otherwise.
import { describe, it, expect, afterEach } from 'vitest';
import { readSource, BOT_INDEX, sliceBlock, evalBlock, stripJs } from './_source-slice.js';

const src = readSource(BOT_INDEX);
const block = sliceBlock(src, 'async function _raidChatDestination(', '// ── Era boundaries for chat thread routing');
const { _raidChatDestination } = evalBlock(block, ['_raidChatDestination']);

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

  it('falls back to the channel outside a raid or event window', async () => {
    const seen = [];
    const ch = await _raidChatDestination(channelClient(seen), 'raid-chat', rnWith(null));
    expect(ch.id).toBe('raid-chat');
    expect(seen).toEqual(['raid-chat']);
  });

  it('falls back to the channel when the thread lookup throws', async () => {
    const seen = [];
    const rn = { getRaidNightTarget: async () => { throw new Error('discord down'); } };
    const ch = await _raidChatDestination(channelClient(seen), 'raid-chat', rn);
    expect(ch.id).toBe('raid-chat');
  });

  it('RAID_CHAT_IN_THREAD=0 keeps it in the channel', async () => {
    process.env.RAID_CHAT_IN_THREAD = '0';
    const seen = [];
    const ch = await _raidChatDestination(channelClient(seen), 'raid-chat', rnWith({ id: 'thread-1' }));
    expect(ch.id).toBe('raid-chat');
  });

  it('only raid chat is rerouted; guild chat still fetches its channel', () => {
    const code = stripJs(src);
    expect(code).toMatch(/channel === 'raid'\s*\?\s*await _raidChatDestination\(client, channelId\)\s*:\s*await client\.channels\.fetch\(channelId\)/);
  });
});
