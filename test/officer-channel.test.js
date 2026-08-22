// test/officer-channel.test.js — where officer posts go.
//
// Hitya 2026-08-21: "wire it to officer channel." OFFICER_CHAT_CHANNEL_ID is
// not set on Railway, so every officer post was silently skipping — and an env
// var needs a human in the Railway UI plus a redeploy. The resolver lets an
// officer point the bot at a channel from Discord instead, storing it in
// bot_kv (which survives deploys; state.json does not).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getOfficerChannelId, setOfficerChannelId } from '../utils/officerChannel.js';

function fakeSupabase(kvValue) {
  const saved = [];
  return {
    saved,
    isEnabled: () => true,
    select: async () => (kvValue ? [{ value: kvValue }] : []),
    upsert: async (table, rows) => { saved.push({ table, rows }); return rows; },
  };
}

const ENV = { ...process.env };
beforeEach(() => { delete process.env.OFFICER_CHAT_CHANNEL_ID; delete process.env.OFFICER_ALERT_CHANNEL_ID; });
afterEach(() => { process.env = { ...ENV }; });

describe('getOfficerChannelId', () => {
  it('prefers the channel an officer wired from Discord', async () => {
    process.env.OFFICER_CHAT_CHANNEL_ID = '111';
    const sb = fakeSupabase({ channel_id: '999' });
    expect(await getOfficerChannelId(sb)).toBe('999');
  });

  it('falls back to the env var, then the older alert var', async () => {
    const sb = fakeSupabase(null);
    process.env.OFFICER_CHAT_CHANNEL_ID = '111';
    expect(await getOfficerChannelId(sb)).toBe('111');
    delete process.env.OFFICER_CHAT_CHANNEL_ID;
    process.env.OFFICER_ALERT_CHANNEL_ID = '222';
    expect(await getOfficerChannelId(sb)).toBe('222');
  });

  it('returns null when nothing is configured — callers must SAY so, not guess a channel', async () => {
    expect(await getOfficerChannelId(fakeSupabase(null))).toBeNull();
  });

  it('a Supabase failure degrades to env rather than throwing', async () => {
    process.env.OFFICER_CHAT_CHANNEL_ID = '111';
    const broken = { isEnabled: () => true, select: async () => { throw new Error('down'); } };
    expect(await getOfficerChannelId(broken)).toBe('111');
  });
});

describe('setOfficerChannelId', () => {
  it('stores the id in bot_kv with who set it', async () => {
    const sb = fakeSupabase(null);
    const res = await setOfficerChannelId(sb, '123456789012', 'discord-1');
    expect(res.ok).toBe(true);
    expect(sb.saved[0].table).toBe('bot_kv');
    expect(sb.saved[0].rows[0].value).toMatchObject({ channel_id: '123456789012', set_by: 'discord-1' });
  });

  it('refuses a non-snowflake rather than storing junk', async () => {
    const sb = fakeSupabase(null);
    expect((await setOfficerChannelId(sb, 'general')).ok).toBe(false);
    expect((await setOfficerChannelId(sb, '')).ok).toBe(false);
    expect(sb.saved).toHaveLength(0);
  });
});
