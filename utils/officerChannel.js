// Where do officer-facing posts go?
//
// Hitya 2026-08-21: "wire it to officer channel." The reason this needs a
// resolver rather than an env var: OFFICER_CHAT_CHANNEL_ID is NOT set on
// Railway (checked, 2026-08-21), so every officer post was silently skipping —
// the same "shipped but never fires" failure as the inventory uploader. And an
// env var can only be set by a human in the Railway UI followed by a redeploy,
// which is a bad dependency for something an officer should be able to point
// at a channel themselves.
//
// Resolution order, first hit wins:
//   1. bot_kv `officer_channel_id` — set by running /preraid here:true in the
//      channel you want. Survives deploys (state.json does NOT).
//   2. OFFICER_CHAT_CHANNEL_ID env
//   3. OFFICER_ALERT_CHANNEL_ID env (the older name, still in .env.example)
//
// Returns null when nothing is configured, and callers must SAY so rather than
// posting somewhere arbitrary — an officer briefing in the wrong channel is
// worse than no briefing.

const KEY = 'officer_channel_id';

function _guildId() { return process.env.SUPABASE_GUILD_ID || 'wolfpack'; }

async function getOfficerChannelId(supabase) {
  try {
    if (supabase && supabase.isEnabled && supabase.isEnabled()) {
      const rows = await supabase.select('bot_kv',
        `guild_id=eq.${encodeURIComponent(_guildId())}&key=eq.${KEY}&select=value&limit=1`)
        .catch(() => null);
      const v = Array.isArray(rows) && rows[0] && rows[0].value;
      if (v && typeof v.channel_id === 'string' && v.channel_id) return v.channel_id;
    }
  } catch (e) { void e; }
  return process.env.OFFICER_CHAT_CHANNEL_ID || process.env.OFFICER_ALERT_CHANNEL_ID || null;
}

async function setOfficerChannelId(supabase, channelId, byDiscordId) {
  if (!supabase || !supabase.isEnabled || !supabase.isEnabled()) {
    return { ok: false, error: 'Supabase not configured' };
  }
  if (!/^\d{5,25}$/.test(String(channelId || ''))) return { ok: false, error: 'bad channel id' };
  const err = await supabase.upsert('bot_kv', [{
    guild_id: _guildId(), key: KEY,
    value: { channel_id: String(channelId), set_by: byDiscordId || null, set_at: new Date().toISOString() },
    updated_at: new Date().toISOString(),
  }], 'guild_id,key').then(() => null).catch(e => e);
  return err ? { ok: false, error: err.message || 'save failed' } : { ok: true };
}

module.exports = { getOfficerChannelId, setOfficerChannelId, OFFICER_CHANNEL_KEY: KEY };
