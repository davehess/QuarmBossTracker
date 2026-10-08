// utils/zoneTimers.js — a long zone-wide timer follows you into the zone.
//
// The guild lead, 2026-10-08, on the Plane of Tactics stampede: "if one person had the stampede window
// it should go to anyone currently in the zone when it opens" — and picked "the timer follows you in".
// `You hear the pounding of hooves.` starts two guild-trigger countdowns on every Mimic that SAW the line:
// "window opens" (2400 s — the EARLIEST the next stampede can come) and "stampede by" (7200 s — the
// LATEST). A raider who zones in afterwards never saw the line, and the relay only carries a fire for
// 60 s, so they had no timer at all. This ledger remembers the window per zone, and a listener whose live
// zone is the window's zone is handed every countdown of it that is still running, once, with the
// ORIGINAL fire time, so their own countdowns end when everyone else's do and speak their own end text.
//
// THE TAG CONTRACT. A guild_triggers row opts in with the tag `zone-timer` (ZONE_TIMER_TAG). The bot reads
// the tag itself (index.js, a cached select by tag), so it works whatever agent the observer runs. Tagged
// rows that share a `source_pack` are ONE window: its shortest timer is the earliest bound (min_at), its
// longest the latest (max_at). A tagged row with no pack is a window of its own (min_at = max_at).
//
// A WINDOW, and how it ends (the guild lead, 2026-10-08):
//   waiting  — before min_at;   open — min_at … max_at;   then it is CLEARED, for everyone:
//   • max_at passes with no fresh sighting → 'expired_unobserved': the stampede happened and nobody with
//     Mimic saw it, so the old countdown is wrong and is never handed out again;
//   • a fresh sighting of the same pack in the same zone (anyone camping the zone) → 'replaced_by_sighting':
//     the new window restarts the clock for everyone.
//   One `cleared` record per pack+zone survives, so a page can say "no timer — the last one went
//   unobserved" instead of showing nothing. It names nobody: trigger name, zone, when, why.
//
// What a late joiner is sent, per still-running timer, is a relayed fire with three differences:
//   • actions: [] — nothing is replayed (no overlay, no speech: the stampede already happened);
//   • late_join: true + window_id;
//   • timer_duration_sec is that timer's FULL length and fired_at_* the original stamps, so the agent arms
//     ends_at = original fire + full length on its own clock (remaining_sec rides along for the journal).
//     An agent that does not know `late_join` drops it as a stale relay (older than its 15 s ghost TTL) —
//     or, inside those 15 s, arms the same correct countdown without the end text.
//
// PLACING THE ZONE. The bot knows the sender's live zones, not which character saw the line. A sender with
// one live zone places it. A sender with several (a boxed trader in the Bazaar) places it only where a
// window or cleared record for that pack already exists; otherwise the sighting is skipped and the next
// observer places it. Wrong-zone windows would hand a stampede timer to the Bazaar, which is worse.
//
// STORAGE. bot_kv key `zone_timer_windows` (KV_KEY), never state.json — a 2-hour window outlives a Railway
// deploy and state.json does not (CLAUDE.md). Plain JSON the website can read with the service role:
//   { windows: [{ window_id, trigger_name, zone, observed_at_ms, min_at_ms, max_at_ms,
//                 pack, fired_at_ms,
//                 timers: [{ trigger_id, name, duration_sec, ends_at_ms, end_text, cooldown_seconds }] }],
//     cleared: [{ trigger_name, zone, at_ms, reason, pack }] }  reason: 'expired_unobserved' | 'replaced_by_sighting'
// Times are epoch ms on the bot's clock (observed_at_ms is the skew-resolved fire time; fired_at_ms the
// first observer's raw stamp, kept for agents that have no clock offset yet).
// `trigger_name` is the longest timer's name (the one that sets max_at). No discord ids or character names
// are stored. Write-through on every record / replace / expiry. A failed read or write is logged and the
// ledger keeps working from memory: nothing here ever throws into the relay POST.
// Who saw a window and who was handed it stay IN MEMORY on purpose. After a restart both are empty, so a
// listener still in the zone (an observer included) is handed the window once more — harmless, because
// the agent skips a late join when it already runs a countdown for that trigger from the same window.
//
// Pure apart from the injected `supabase` (utils/supabase or a stand-in) and clock.
'use strict';

const ZONE_TIMER_TAG     = 'zone-timer';
const ZONE_TIMER_MAX_SEC = 4 * 3600;      // the relay's own clamp is 3600; the stampede-by row is 7200
const SAME_WINDOW_MS     = 120_000;       // two observers of one emote, across clocks and log latency
const MIN_REMAINING_MS   = 10_000;        // a countdown about to end is not worth arming
const MAX_WINDOWS        = 20;            // a handful in practice: one per tagged pack per zone
const MAX_CLEARED        = 20;
const KV_KEY             = 'zone_timer_windows';
const LOAD_RETRY_MS      = 60_000;
const REASON_EXPIRED     = 'expired_unobserved';
const REASON_REPLACED    = 'replaced_by_sighting';

// Tags as guild_triggers stores them (text[]); a CSV string is tolerated.
function hasZoneTimerTag(tags) {
  const list = Array.isArray(tags) ? tags : (typeof tags === 'string' ? tags.split(',') : []);
  return list.some(t => String(t || '').trim().toLowerCase() === ZONE_TIMER_TAG);
}

const cleanZones = (z) => [...new Set((Array.isArray(z) ? z : (z instanceof Set ? [...z] : (z ? [z] : [])))
  .map(s => (s == null ? '' : String(s).trim())).filter(Boolean))];

// 'waiting' | 'open' | 'over' for a window at time t.
function statusOf(w, t) {
  if (!w) return 'over';
  if (t < w.min_at_ms) return 'waiting';
  if (t < w.max_at_ms) return 'open';
  return 'over';
}

// A window as stored. Anything malformed (a hand-edited row, an older shape) is dropped, not repaired.
function validWindow(w) {
  return !!(w && typeof w.window_id === 'string' && typeof w.zone === 'string' && w.zone
    && Number.isFinite(w.observed_at_ms) && Number.isFinite(w.max_at_ms) && Array.isArray(w.timers) && w.timers.length);
}

function create({ supabase = null, guildId = null, now = Date.now, log = console } = {}) {
  const gid = () => (typeof guildId === 'function' ? guildId() : guildId)
    || (supabase && typeof supabase.guildId === 'function' ? supabase.guildId() : '');
  const enabled = () => !!(supabase && supabase.isEnabled && supabase.isEnabled());
  let windows = [];
  let cleared = [];
  const observers = new Map();          // window_id → Set(discord_id)            — memory only
  const delivered = new Map();          // window_id|trigger_id → Set(discord_id)  — memory only
  let loaded = false, loadedAt = 0, dirty = false;

  const packKey = (w) => w.pack || (w.timers[0] && w.timers[0].trigger_id) || w.window_id;
  function forget(w) {
    observers.delete(w.window_id);
    for (const k of [...delivered.keys()]) if (k.startsWith(w.window_id + '|')) delivered.delete(k);
  }
  function noteCleared(w, atMs, reason) {
    cleared = cleared.filter(c => !(c.zone === w.zone && c._pack === packKey(w)));
    cleared.push({ trigger_name: w.trigger_name, zone: w.zone, at_ms: Math.round(atMs), reason, _pack: packKey(w) });
    if (cleared.length > MAX_CLEARED) cleared = cleared.slice(-MAX_CLEARED);
  }
  // Windows past max_at become 'expired_unobserved'. Returns whether anything changed.
  function expire() {
    const t = now();
    const gone = windows.filter(w => !(w.max_at_ms > t));
    if (!gone.length) return false;
    for (const w of gone) { noteCleared(w, w.max_at_ms, REASON_EXPIRED); forget(w); }
    windows = windows.filter(w => w.max_at_ms > t);
    return true;
  }
  function snapshot() {
    return {
      windows: windows.map(w => ({ window_id: w.window_id, trigger_name: w.trigger_name, zone: w.zone,
        observed_at_ms: w.observed_at_ms, min_at_ms: w.min_at_ms, max_at_ms: w.max_at_ms, pack: w.pack || null,
        fired_at_ms: w.fired_at_ms,
        timers: w.timers.map(x => ({ trigger_id: x.trigger_id, name: x.name, duration_sec: x.duration_sec,
          ends_at_ms: x.ends_at_ms, end_text: x.end_text || null, cooldown_seconds: x.cooldown_seconds || 0 })) })),
      // `_pack` is the internal pack key for the one-per-pack+zone rule; trigger names can collide.
      cleared: cleared.map(c => ({ trigger_name: c.trigger_name, zone: c.zone, at_ms: c.at_ms, reason: c.reason, pack: c._pack })),
    };
  }

  // Never throws. A failed read is not an empty store: it is retried a minute later, and nothing is
  // written until a read has succeeded, so a flaky boot cannot erase a window an earlier deploy saved.
  async function load() {
    if (loaded) return true;
    if (!enabled()) return false;
    if (loadedAt && now() - loadedAt < LOAD_RETRY_MS) return false;
    loadedAt = now();
    let rows = null;
    try {
      rows = await supabase.select('bot_kv',
        `guild_id=eq.${encodeURIComponent(gid())}&key=eq.${KV_KEY}&select=value&limit=1`);
    } catch (err) { log.warn('[zone-timers] load failed:', err && err.message); return false; }
    if (!Array.isArray(rows)) return false;
    const value = (rows[0] && rows[0].value) || {};
    const have = new Set(windows.map(w => w.window_id));
    const back = (Array.isArray(value.windows) ? value.windows : []).filter(w => validWindow(w) && !have.has(w.window_id))
      .map(w => ({ ...w, timers: w.timers.filter(x => x && x.trigger_id && Number.isFinite(x.ends_at_ms)) }));
    const keepCleared = cleared;
    cleared = (Array.isArray(value.cleared) ? value.cleared : [])
      .filter(c => c && c.zone && c.reason)
      .map(c => ({ trigger_name: c.trigger_name || null, zone: c.zone, at_ms: c.at_ms, reason: c.reason, _pack: c.pack || c.trigger_name }));
    for (const c of keepCleared) {
      cleared = cleared.filter(o => !(o.zone === c.zone && o._pack === c._pack));
      cleared.push(c);
    }
    windows = [...back, ...windows].sort((a, b) => a.observed_at_ms - b.observed_at_ms).slice(-MAX_WINDOWS);
    loaded = true;
    // A window that ran out while the bot was down is cleared as unobserved, like any other.
    if (expire()) dirty = true;
    if (dirty) await save();
    return true;
  }

  async function save() {
    if (!enabled() || !loaded) { dirty = true; return; }
    dirty = false;
    try {
      await supabase.upsert('bot_kv', [{ guild_id: gid(), key: KV_KEY, value: snapshot(),
        updated_at: new Date(now()).toISOString() }], 'guild_id,key');
    } catch (err) { log.warn('[zone-timers] save failed:', err && err.message); }
  }

  // One relayed fire of a tagged trigger. `timers` is every tagged trigger of its pack
  // ([{ trigger_id, name, duration_sec, end_text, cooldown_seconds }]); `pack` its source_pack (or null).
  // Every observer's POST lands here, the duplicates the relay ring drops included, so each observer is
  // known. Returns the window (or null when nothing was recorded). Writes are not awaited by callers.
  function record(f) {
    if (!f) return null;
    const timers = (Array.isArray(f.timers) ? f.timers : [])
      .map(x => ({ trigger_id: x && x.trigger_id ? String(x.trigger_id) : '',
        name: String((x && x.name) || '').slice(0, 120),
        duration_sec: Math.min(ZONE_TIMER_MAX_SEC, Math.max(0, Math.floor(Number(x && x.duration_sec)) || 0)),
        end_text: x && x.end_text ? String(x.end_text).slice(0, 300) : null,
        cooldown_seconds: Math.max(0, parseInt(x && x.cooldown_seconds, 10) || 0) }))
      .filter(x => x.trigger_id && x.duration_sec > 0);
    const observed = Number(f.fired_at_true_ms);
    if (!timers.length || !Number.isFinite(observed)) return null;
    const pack = f.pack ? String(f.pack).slice(0, 80) : null;
    const pk = pack || timers[0].trigger_id;
    if (expire()) save();
    const t = now();

    let zones = cleanZones(f.origin_zones);
    if (zones.length > 1) {
      const known = new Set([...windows.filter(w => packKey(w) === pk).map(w => w.zone),
        ...cleared.filter(c => c._pack === pk).map(c => c.zone)]);
      zones = zones.filter(z => known.has(z));
    }
    if (zones.length !== 1) return null;                                   // can't place it in one zone
    const zone = zones[0];

    const maxSec = Math.max(...timers.map(x => x.duration_sec));
    const minSec = Math.min(...timers.map(x => x.duration_sec));
    if (observed + maxSec * 1000 <= t) return null;                       // a backlog replay of an old window
    const by = f.uploaded_by ? String(f.uploaded_by) : null;
    const held = windows.find(w => w.zone === zone && packKey(w) === pk);
    if (held && Math.abs(observed - held.observed_at_ms) <= SAME_WINDOW_MS) {
      if (by) { let s = observers.get(held.window_id); if (!s) observers.set(held.window_id, s = new Set()); s.add(by); }
      return held;                                                         // another observer of the same emote
    }
    if (held && observed < held.observed_at_ms) return null;              // older than the window we hold
    if (held) {                                                            // a fresh sighting restarts it
      noteCleared(held, observed, REASON_REPLACED);
      forget(held);
      windows = windows.filter(w => w !== held);
    }
    const longest = timers.reduce((a, b) => (b.duration_sec > a.duration_sec ? b : a));
    const w = {
      window_id:      pk + '|' + zone + '@' + Math.round(observed),
      trigger_name:   longest.name,
      zone,
      observed_at_ms: Math.round(observed),
      min_at_ms:      Math.round(observed + minSec * 1000),
      max_at_ms:      Math.round(observed + maxSec * 1000),
      pack,
      fired_at_ms:    Number.isFinite(Number(f.fired_at_ms)) ? Number(f.fired_at_ms) : Math.round(observed),
      timers:         timers.map(x => ({ ...x, ends_at_ms: Math.round(observed + x.duration_sec * 1000) })),
    };
    windows.push(w);
    if (by) observers.set(w.window_id, new Set([by]));
    if (windows.length > MAX_WINDOWS) {
      windows.sort((a, b) => a.observed_at_ms - b.observed_at_ms);
      for (const old of windows.slice(0, windows.length - MAX_WINDOWS)) forget(old);
      windows = windows.slice(-MAX_WINDOWS);
    }
    save();
    return w;
  }

  function hasActive() { if (expire()) save(); return windows.length > 0; }

  // The late-join fires for one listener on one poll. `zones` is the Set of zones their live characters
  // stand in. Each still-running timer of a window is handed to a listener once while they stay in its
  // zone; leaving the zone forgets it, so coming back hands it again (the agent ignores it if that
  // countdown is still running). A cleared window is gone from the ledger, so it is never handed out.
  function lateJoinFires(discordId, zones) {
    if (expire()) save();
    const id = discordId ? String(discordId) : '';
    if (!id || windows.length === 0) return [];
    const t = now();
    const out = [];
    for (const w of windows) {
      const here = !!zones && typeof zones.has === 'function' && zones.has(w.zone);
      for (const x of w.timers) {
        const dk = w.window_id + '|' + x.trigger_id;
        let got = delivered.get(dk);
        if (!here) { if (got) got.delete(id); continue; }
        const saw = observers.get(w.window_id);
        if (saw && saw.has(id)) continue;                  // they saw it themselves
        if (got && got.has(id)) continue;
        if (x.ends_at_ms - t < MIN_REMAINING_MS) continue; // that bound has passed (or nearly)
        if (!got) delivered.set(dk, got = new Set());
        got.add(id);
        out.push({
          id:                 dk,
          name:               x.name,
          key:                x.name + ':{}',              // the agent's own fire key for a capture-less trigger
          captures:           {},
          actions:            [],
          timer_duration_sec: x.duration_sec,
          trigger_id:         x.trigger_id,
          cooldown_seconds:   x.cooldown_seconds,
          fired_at_ms:        Number.isFinite(w.fired_at_ms) ? w.fired_at_ms : w.observed_at_ms,
          fired_at_true_ms:   w.observed_at_ms,
          late_join:          true,
          window_id:          w.window_id,
          window_status:      statusOf(w, t),
          remaining_sec:      Math.round((x.ends_at_ms - t) / 1000),
          end_text:           x.end_text,
        });
      }
    }
    return out;
  }

  return { load, save, record, hasActive, lateJoinFires, snapshot, _loaded: () => loaded };
}

module.exports = {
  ZONE_TIMER_TAG, ZONE_TIMER_MAX_SEC, SAME_WINDOW_MS, MIN_REMAINING_MS, MAX_WINDOWS, KV_KEY,
  REASON_EXPIRED, REASON_REPLACED, hasZoneTimerTag, statusOf, create,
};
