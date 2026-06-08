// utils/voiceSettings.js — cached read helper for the voice_settings row.
//
// utils/voice.js consults this on every fire to decide:
//   • should we play at all (enabled === false → ripcord),
//   • what volume to play at (0..200%, applied via inlineVolume),
//   • should we skip this specific message (skip_patterns substring match),
//   • should we skip this whole trigger (skip_trigger_names exact match),
//   • what voice to use if the trigger didn't pin one.
//
// 30s TTL — short enough that toggling the ripcord on /admin/voice kills
// noise within a half-minute, long enough that a high-frequency callout
// burst (DI procs) isn't hitting Supabase per fire.

'use strict';

const CACHE_TTL_MS = 30 * 1000;

const DEFAULTS = {
  enabled:            true,
  default_voice:      'en-US-AriaNeural',
  volume_pct:         100,
  skip_patterns:      [],
  skip_trigger_names: [],
};

let _cache = null;       // { row, fetchedAt }

function _isStale() {
  return !_cache || (Date.now() - _cache.fetchedAt > CACHE_TTL_MS);
}

// Lazy require so this module loads in environments where utils/supabase
// isn't wired (tests, local dev without SUPABASE_URL). If the client isn't
// available we silently fall back to DEFAULTS — the bot still works,
// nothing is silenced, the ripcord just can't kill anything.
function _client() {
  try { return require('./supabase'); }
  catch { return null; }
}

async function _fetch(guildId) {
  const sb = _client();
  if (!sb || !sb.isEnabled()) return null;
  try {
    // PostgREST querystring — utils/supabase.select takes a raw query, not
    // a filter object. `guild_id=eq.<id>` is the PostgREST equality filter.
    const rows = await sb.select('voice_settings', `select=*&guild_id=eq.${encodeURIComponent(guildId)}`);
    return Array.isArray(rows) && rows[0] ? rows[0] : null;
  } catch (err) {
    console.warn('[voice-settings] fetch failed:', err?.message);
    return null;
  }
}

// Return the merged settings object. Always returns an object — callers
// never need to handle null. Cached across calls; one in-flight refresh.
async function get(guildId) {
  const g = guildId || process.env.SUPABASE_GUILD_ID || 'wolfpack';
  if (!_isStale()) return _cache.row;
  const row = await _fetch(g);
  const merged = { ...DEFAULTS, ...(row || {}) };
  _cache = { row: merged, fetchedAt: Date.now() };
  return merged;
}

// Force-invalidate after a write (the /admin/voice POST handler calls
// the bot's /api/admin/voice-settings/refresh after upsert so the ripcord
// is instant rather than waiting out the TTL). No-op when never cached.
function invalidate() { _cache = null; }

// Pure helper so the voice module + tests can ask "should this play?"
// without poking the cache directly. Returns { ok: boolean, reason }.
function shouldPlay(settings, { triggerName, message }) {
  if (!settings.enabled) return { ok: false, reason: 'ripcord (enabled=false)' };
  const lcMsg = String(message || '').toLowerCase();
  const skipPats = settings.skip_patterns || [];
  for (const p of skipPats) {
    if (p && lcMsg.includes(String(p).toLowerCase())) {
      return { ok: false, reason: `skip pattern matched: ${p}` };
    }
  }
  const skipNames = settings.skip_trigger_names || [];
  if (triggerName && skipNames.some(n => n && n.toLowerCase() === String(triggerName).toLowerCase())) {
    return { ok: false, reason: `skip trigger name: ${triggerName}` };
  }
  return { ok: true };
}

module.exports = { get, invalidate, shouldPlay, DEFAULTS, CACHE_TTL_MS };
