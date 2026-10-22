// utils/slowMode.js — Quarm's guild-instance "slow mode" (the guild lead, 2026-10-11 and 2026-10-14).
//
// While our instances are in slow mode, EVERY boss we kill respawns 18 hours after death, whatever its
// usual timer (the guild lead, 2026-10-14: "anything that died within our instances since 8pm should be
// 18 hour respawn", "18 hours is the rule once the zones get converted to slow mode"). It is guild-wide:
// "if one guild instance is slow mode they all are for us" (§250). It first shipped (2026-10-11) for the
// four second-floor Bastion of Thunder named only, because those were the kills inside that night's
// window; their `slowModeHours: 18` in data/bosses.json is now just the default spelled out. A boss row
// can still carry its own `slowModeHours` if one ever differs.
// Only kills judged OURS reach recordKill at all (utils/killContext.js: live and PvP-copy kills start no
// timer), so "our instances" is already enforced upstream.
// ponytail: an officer's manual /kill of an open-world boss inside the window also gets 18h; the window
// is a raid night's 8h at most, so the switch off (/slowmode off) is the fix if that ever matters.
//
// The switch is officer-driven (/slowmode on | off | status); the server's own "time has returned to its
// natural pace" message also turns it off, reported by an agent (POST /api/agent/slow-mode). It lives in
// bot_kv, NOT state.json, because state.json does not survive a Railway deploy. Kills are timed in SYNC
// code (utils/state.js recordKill), so the flag is read from a module-level copy that loadSlowMode()
// fills at boot and setSlowMode() keeps current.
//
// auto_off_at is a fixed 8 hours after the switch goes on, so a forgotten switch cannot leak into the
// next raid. A kill is judged by WHEN IT HAPPENED, not when it was recorded: a kill relayed late is
// still measured against the window that was open at its own timestamp.

const SLOW_MODE_KEY = 'slow_mode';
const AUTO_OFF_MS = 8 * 3600000;
const SLOW_MODE_HOURS = 18;

let _flag = null;   // { on, set_by, set_at, auto_off_at, off_at? } — ISO strings, as stored in bot_kv

function _ms(iso) {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

// The moment the window closed: the earlier of the auto-off and an officer's /slowmode off.
function _windowEnd(flag) {
  const ends = [_ms(flag.auto_off_at), flag.on ? null : _ms(flag.off_at)].filter((t) => t !== null);
  return ends.length ? Math.min(...ends) : null;
}

// Was slow mode in force at `atMs`? A flag that is off and has no recorded off time is never in force.
function slowModeOnAt(atMs, flag = _flag) {
  if (!flag) return false;
  const start = _ms(flag.set_at);
  const end = _windowEnd(flag);
  if (start === null || end === null) return false;
  return atMs >= start && atMs < end;
}

// THE rule. Called once, from recordKill's wrapper in utils/state.js, so the board button, /kill, the
// agent's kill relay, the encounter upload and the rest all get it without knowing about it.
// `boss` is a bosses.json row; inside the window every boss gets its `slowModeHours`, else 18.
function effectiveTimerHours(boss, baseHours, killedAtMs, flag = _flag) {
  if (!boss || !slowModeOnAt(killedAtMs, flag)) return baseHours;
  const hours = Number(boss.slowModeHours);
  return hours > 0 ? hours : SLOW_MODE_HOURS;
}

function _bossById(bossId) {
  try { return require('../data/bosses.json').find((b) => b.id === bossId) || null; }
  catch { return null; }
}

// recordKill's entry point: resolves the boss row by id, then applies the rule.
function timerHoursForKill(bossId, baseHours, killedAtMs) {
  return effectiveTimerHours(_bossById(bossId), baseHours, killedAtMs);
}

// A timer on the board for a kill inside the slow-mode window whose length is not the boss's own (18h
// where it is usually 3h, or 66h). Derived from the entry and the stored window, so nothing extra is
// stored in state.json.
function isSlowModeTimer(boss, entry, flag = _flag) {
  if (!boss || !entry || !Number.isFinite(entry.killedAt)) return false;
  return slowModeOnAt(entry.killedAt, flag)
    && Math.abs(entry.nextSpawn - entry.killedAt - Number(boss.timerHours) * 3600000) > 60000;
}

function getSlowMode() { return _flag; }

function _kvQuery(supabase) {
  return `guild_id=eq.${encodeURIComponent(supabase.guildId())}&key=eq.${SLOW_MODE_KEY}`;
}

// Boot: pull the stored flag into memory. Never throws; a failed read leaves the flag as it was.
async function loadSlowMode() {
  try {
    const supabase = require('./supabase');
    if (!supabase.isEnabled()) return _flag;
    const rows = await supabase.select('bot_kv', `${_kvQuery(supabase)}&select=value&limit=1`);
    if (Array.isArray(rows) && rows[0] && rows[0].value && typeof rows[0].value === 'object') _flag = rows[0].value;
  } catch (err) {
    console.warn('[slowmode] load failed:', err?.message);
  }
  return _flag;
}

// Turn slow mode on or off AS OF `atMs` (an officer's command passes "now"; the server's own message
// passes the time on its log line). Memory first (so the next kill sees it), then bot_kv.
// Returns { flag, persisted }; persisted=false means it will not survive a restart.
async function setSlowMode(on, by, atMs = Date.now(), line = null) {
  const atIso = new Date(atMs).toISOString();
  if (on) {
    _flag = { on: true, set_by: by || null, set_at: atIso, auto_off_at: new Date(atMs + AUTO_OFF_MS).toISOString() };
    if (line) _flag.set_line = line;
  } else {
    // Keep the window it ran, so a kill from before this moment is still judged against it.
    _flag = { ...(_flag || { set_at: atIso, auto_off_at: atIso }), on: false, off_by: by || null, off_at: atIso };
    if (line) _flag.off_line = line;
  }
  let persisted = false;
  try {
    const supabase = require('./supabase');
    if (supabase.isEnabled()) {
      const res = await supabase.upsert('bot_kv',
        [{ guild_id: supabase.guildId(), key: SLOW_MODE_KEY, value: _flag, updated_at: new Date().toISOString() }], 'guild_id,key');
      persisted = Array.isArray(res);
    }
  } catch (err) {
    console.warn('[slowmode] persist failed:', err?.message);
  }
  return { flag: _flag, persisted };
}

// One short line to #raid-chat, pinging the raider roles (the guild lead, 2026-10-15: "This should go in raid-chat
// channel 1193692008812920863", "it should also tag the raider roles" — it had landed in #raid-mobs).
// Channel: RAID_CHAT_CHANNEL_ID, then the known #raid-chat id, then TIMER_CHANNEL_ID as a last resort.
// Roles: SLOWMODE_PING_ROLES (comma-separated names), default the two raid ranks; a name the guild lacks is skipped,
// and only those role ids may ping. Best effort, never throws.
const RAID_CHAT_FALLBACK_ID = '1193692008812920863';
function pingRoleNames() {
  return String(process.env.SLOWMODE_PING_ROLES || 'Raid Pack,Raid Recruit').split(',').map(s => s.trim()).filter(Boolean);
}
async function announce(client, text) {
  if (!client) return false;
  const ids = [process.env.RAID_CHAT_CHANNEL_ID, RAID_CHAT_FALLBACK_ID, process.env.TIMER_CHANNEL_ID].filter(Boolean);
  for (const id of ids) {
    try {
      const ch = await client.channels.fetch(id);
      if (!ch || typeof ch.send !== 'function') continue;
      const roles = ch.guild && ch.guild.roles && ch.guild.roles.cache;
      const wanted = new Set(pingRoleNames().map(n => n.toLowerCase()));
      const roleIds = roles ? [...roles.values()].filter(r => wanted.has(String(r.name).toLowerCase())).map(r => r.id) : [];
      const mention = roleIds.map(r => `<@&${r}>`).join(' ');
      await ch.send({ content: (mention ? mention + ' ' : '') + text, allowedMentions: { parse: [], roles: roleIds } });
      return true;
    } catch (err) {
      console.warn('[slowmode] announce to', id, 'failed:', err?.message);
    }
  }
  return false;
}

// ── The server's own message (option B, the guild lead, 2026-10-11) ─────────────────────────────────────
// The server announces slow mode ENDING through a guild message from the god:
//   [<stamp>] Druzzil Ro tells the guild, 'A ripple passes through your guild's thread of time. <Name> has
//   asked the Timekeeper of Druzzil Ro to set its weave right. Beware! Time has returned to its natural
//   pace, and those walking it have been drawn back to Tranquility.'
// The STARTING line has not been captured, so none is matched here and none is invented: the officer
// switch (/slowmode on) is how it starts. A second line from the same night ("Druzzil Ro's voice fills
// your mind … Your guild's thread of time has shifted … I've pulled you out") is a private line to
// whoever was pulled out, not the announcement, and is deliberately NOT read as either state.
const SLOW_MODE_OFF_RX = /^\[(.+?)\]\s+Druzzil Ro tells the guild,\s*['"]A ripple passes through your guild's thread of time\.\s+(\w+) has asked the Timekeeper of Druzzil Ro to set its weave right\.\s+Beware!\s+Time has returned to its natural pace\b/;

// Raw log line -> { state: 'off', at, by } or null. Pure. `at` is the line's own stamp as an ISO string;
// the agent already knows its machine's clock and sends its own ISO, so this reads the stamp in the
// process's zone unless `parseStamp(text) -> ms` says otherwise.
function parseSlowModeLine(line, parseStamp = Date.parse) {
  const m = SLOW_MODE_OFF_RX.exec(String(line || ''));
  if (!m) return null;
  const ms = parseStamp(m[1]);
  if (!Number.isFinite(ms)) return null;
  return { state: 'off', at: new Date(ms).toISOString(), by: m[2] };
}

// The entry point for the agent's report. Idempotent, because every raider's agent hears the same line:
// an OFF only lands if a window was open at `at`, an ON only if none was. A stale replay (an old OFF line
// read from a backfill) falls outside the open window and changes nothing.
// The check-then-set below has no await between them, so two requests cannot interleave; the double
// "Slow mode ended" post (2026-10-21) was the CLOCKS instead: each agent reports the stamp on its own
// log line, and the same server message can read one second apart on two machines. The first report
// ends the window at :01; the second, stamped :00, lands INSIDE that window (atMs < off_at), looks like
// a fresh OFF, and was announced again. So a report that finds the flag already in the state it asks
// for is a duplicate, whatever its stamp.
const DUP_WINDOW_MS = 2 * 60000;
async function applyDetectedSlowMode(state, atMs, by, line = null) {
  if (state !== 'on' && state !== 'off') return { changed: false, reason: 'bad-state' };
  if (!Number.isFinite(atMs)) return { changed: false, reason: 'bad-time' };
  if (atMs > Date.now() + 10 * 60000) return { changed: false, reason: 'in-the-future' };
  const open = slowModeOnAt(atMs);
  if (state === 'off' && !open) return { changed: false, reason: 'no-open-window' };
  if (state === 'off' && _flag && !_flag.on) return { changed: false, reason: 'already-off' };
  if (state === 'on' && open) return { changed: false, reason: 'already-on' };
  if (state === 'on' && _flag && _flag.on && Math.abs(atMs - _ms(_flag.set_at)) < DUP_WINDOW_MS) return { changed: false, reason: 'already-on' };
  const res = await setSlowMode(state === 'on', by ? `auto:${by}` : 'auto', atMs, line);
  return { changed: true, ...res };
}

module.exports = {
  SLOW_MODE_KEY, AUTO_OFF_MS,
  slowModeOnAt, effectiveTimerHours, timerHoursForKill, isSlowModeTimer,
  getSlowMode, loadSlowMode, setSlowMode, announce, parseSlowModeLine, applyDetectedSlowMode,
};
