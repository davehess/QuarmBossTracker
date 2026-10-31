// utils/theme.js — the bot's copy of the guild theme (docs/DESIGN-theming.md section 4).
//
// Only one value reaches the bot: guild_theme.embed_color, the stripe on Discord cards that carry no meaning of
// their own (the "neutral" embeds that are blurple today). Kill, death, warning and error cards keep their
// semantic colours; do not route those through here.
//
// embedColor() is SYNCHRONOUS on purpose, because it sits inside `.setColor(embedColor())` at call sites that
// are already built. It returns the last value read; when that copy is older than a minute it starts a refresh
// in the background and still answers immediately, so a card never waits on Supabase. A failed read keeps the
// last known colour (null from the helper means timeout or an open breaker), and is retried a minute later.

const DEFAULT_COLOR = 0x5865F2;   // Discord blurple, what every neutral embed wears today
const TTL_MS = 60_000;

let _color = DEFAULT_COLOR;
let _at = 0;           // when the last refresh was attempted (0 = never)
let _inflight = null;

// '#5865f2' / '5865F2' / 0x5865f2 -> 0x5865f2; anything else -> null.
function parseColor(v) {
  if (typeof v === 'number') return Number.isInteger(v) && v >= 0 && v <= 0xFFFFFF ? v : null;
  if (typeof v !== 'string') return null;
  const m = v.trim().match(/^#?([0-9a-f]{6})$/i);
  return m ? parseInt(m[1], 16) : null;
}

async function refresh() {
  try {
    const supabase = require('./supabase');
    if (!supabase.isEnabled()) return false;
    const rows = await supabase.select(
      'guild_theme',
      `select=embed_color&guild_id=eq.${encodeURIComponent(supabase.guildId())}&limit=1`,
    );
    if (!Array.isArray(rows)) return false;   // timeout / breaker: keep what we had
    // No row, or no usable colour, is "the guild has not chosen": blurple.
    _color = parseColor(rows[0]?.embed_color) ?? DEFAULT_COLOR;
    return true;
  } catch (err) {
    console.warn('[theme] refresh failed:', err?.message);
    return false;
  }
}

function embedColor(now = Date.now()) {
  if (now - _at >= TTL_MS && !_inflight) {
    _at = now;
    _inflight = refresh().finally(() => { _inflight = null; });
  }
  return _color;
}

// Test hook: set the cached colour and mark it fresh (or pass null to forget everything).
function _setForTest(color, at = Date.now()) {
  _color = color == null ? DEFAULT_COLOR : color;
  _at = color == null ? 0 : at;
  _inflight = null;
}

module.exports = { embedColor, refresh, parseColor, DEFAULT_COLOR, TTL_MS, _setForTest };
