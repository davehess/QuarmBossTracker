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

// ── The whole theme, for Mimic (docs/DESIGN-theming.md section 4, "served to the overlays") ─────────────────────────
// guildThemeFor(guildId) answers { slots, font, logo_url, embed_color, updated_at } for the mimic-link `linked` reply and
// the agent poll's `theme` stream, or null when the guild has no row (Mimic then keeps its own defaults). Only the
// THEMABLE slots survive, as lowercase six-digit hex; the meaning colours (green, red, gold, orange) are never served.
// Same 60 s copy as embedColor(): a poll never adds a Supabase read of its own, and a failed read keeps the last copy.
// Keep THEME_SLOTS and FONT_KEYS equal to web/lib/guildThemeCore.ts (test/guild-theme-mimic.test.js holds them).
const THEME_SLOTS = ['bg', 'panel', 'border', 'text', 'dim', 'accent', 'blue', 'purple'];
const FONT_KEYS = ['default', 'system-mono', 'sans', 'serif'];
const LOGO_RE = /^https:\/\/[^\s"'()<>\\]+$/i;
const THEMES_MAX = 200;
const _themes = new Map();   // guildId -> { at, value }
const _themeInflight = new Map();

function hex6(v) {
  const m = typeof v === 'string' ? v.trim().match(/^#?([0-9a-f]{6})$/i) : null;
  return m ? `#${m[1].toLowerCase()}` : null;
}

// A guild_theme row -> the served shape, or null for no row.
function shapeTheme(row) {
  if (!row || typeof row !== 'object') return null;
  const inSlots = row.slots && typeof row.slots === 'object' ? row.slots : {};
  const slots = {};
  for (const s of THEME_SLOTS) { const h = hex6(inSlots[s]); if (h) slots[s] = h; }
  const logo = typeof row.logo_url === 'string' ? row.logo_url.trim() : '';
  return {
    slots,
    font: FONT_KEYS.includes(row.font) ? row.font : 'default',
    logo_url: logo && logo.length <= 500 && LOGO_RE.test(logo) ? logo : null,
    embed_color: hex6(row.embed_color),
    updated_at: typeof row.updated_at === 'string' ? row.updated_at : null,
  };
}

async function _readTheme(guildId) {
  try {
    const supabase = require('./supabase');
    if (!supabase.isEnabled()) return { ok: false };
    const rows = await supabase.select(
      'guild_theme',
      `select=slots,font,logo_url,embed_color,updated_at&guild_id=eq.${encodeURIComponent(guildId)}&limit=1`,
    );
    if (!Array.isArray(rows)) return { ok: false };   // timeout / breaker: keep what we had
    return { ok: true, value: shapeTheme(rows[0]) };
  } catch (err) {
    console.warn('[theme] guild theme read failed:', err?.message);
    return { ok: false };
  }
}

async function guildThemeFor(guildId, now = Date.now()) {
  const id = String(guildId || '');
  if (!id) return null;
  const hit = _themes.get(id);
  if (hit && now - hit.at < TTL_MS) return hit.value;
  let p = _themeInflight.get(id);
  if (!p) {
    p = _readTheme(id).then((r) => {
      if (r.ok) {
        if (!_themes.has(id) && _themes.size >= THEMES_MAX) _themes.delete(_themes.keys().next().value);
        _themes.set(id, { at: Date.now(), value: r.value });
      } else if (hit) {
        hit.at = Date.now();   // retry a minute from now, not on every poll
      }
      return (_themes.get(id) || {}).value || null;
    }).finally(() => { _themeInflight.delete(id); });
    _themeInflight.set(id, p);
  }
  return p;
}

function _resetThemesForTest() { _themes.clear(); _themeInflight.clear(); }

module.exports = {
  embedColor, refresh, parseColor, DEFAULT_COLOR, TTL_MS, _setForTest,
  guildThemeFor, shapeTheme, THEME_SLOTS, FONT_KEYS, _resetThemesForTest,
};
