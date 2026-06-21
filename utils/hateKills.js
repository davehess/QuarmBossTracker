// utils/hateKills.js — Supabase-backed Plane of Hate kill log.
//
// Replaces the state.json `liveKills` / `pvpKills` hate keys + the hidden
// Discord JSON embed that used to be the recovery store. One row per kill —
// "current spot status" is computed at read time from the latest active row.
//
// Why per-kill rows instead of one-per-spot:
//   * Cross-redeploy persistence: the prior model lost updates whenever the
//     Railway volume rolled and the Discord embed got overwritten by a
//     partial post-redeploy state on the next /pvphatekill.
//   * PvP Hate spawn rerolls: spot identities reshuffle when nobody's in
//     zone, so the same spot can legitimately host two distinct kills
//     inside a single 72h lockout. The one-row-per-spot model collapsed
//     them into one and lost the earlier kill.
//
// The bot's commands/buttons go through here exclusively. state.json is no
// longer touched for hate; on first startup `importLegacyHateState` lifts
// any leftover entries out of state.json into Supabase so we don't lose
// anything during the cutover.
//
// Failure mode: if SUPABASE_URL/SERVICE_ROLE aren't set, every function
// returns an empty/null answer + the commands degrade to an error reply.
// That's acceptable — Supabase has been the source of truth for everything
// else (encounters, contributions, etc.) since the 1.0 cutover.

const supabase = require('./supabase');

const HATE_TIMER_HOURS = 72;
const LIVE_VARIANCE = 0;    // exact 72h on live server
const PVP_VARIANCE  = 0.2;  // ±20% on PvP server

// Lower bound on how far back to look when computing "current state". Older
// rows can't be active (max spawn window is 72h * 1.2 = 86.4h), so 96h is
// a safe ceiling that keeps the query cheap.
const ACTIVE_LOOKBACK_HOURS = 96;

function _windowFor(server, killedAtMs, timerUnknown) {
  if (timerUnknown) return { earliest: null, latest: null };
  const baseMs = HATE_TIMER_HOURS * 3600000;
  if (server === 'live') {
    const exact = new Date(killedAtMs + baseMs).toISOString();
    return { earliest: exact, latest: exact };
  }
  const variance = PVP_VARIANCE;
  return {
    earliest: new Date(killedAtMs + baseMs * (1 - variance)).toISOString(),
    latest:   new Date(killedAtMs + baseMs * (1 + variance)).toISOString(),
  };
}

// Insert one hate kill. Returns the inserted row (with id) or null on error.
// killedAtMs defaults to now(); pass an earlier ms to back-date a /…hatekill.
async function recordHateKill({
  server,                  // 'live' | 'pvp'
  spotNum = null,          // 1..12 or null (foreign-guild [PVP] echoes)
  killerName = null,
  killerGuild = null,
  killedAtMs = null,
  timerUnknown = false,
  source,                  // 'manual_slash' | 'manual_button' | 'pvp_broadcast' | 'druzzil_broadcast'
  rawText = null,
  notes = null,
  recordedByDiscordId = null,
}) {
  if (!supabase.isEnabled()) return null;
  if (server !== 'live' && server !== 'pvp') return null;

  const ts = killedAtMs || Date.now();
  const killedAt = new Date(ts).toISOString();
  const { earliest, latest } = _windowFor(server, ts, timerUnknown);

  const row = {
    server,
    spot_num:                spotNum,
    killer_name:             killerName,
    killer_guild:            killerGuild,
    killed_at:               killedAt,
    next_spawn_earliest:     earliest,
    next_spawn_latest:       latest,
    timer_unknown:           !!timerUnknown,
    source,
    raw_text:                rawText ? String(rawText).slice(0, 500) : null,
    notes,
    recorded_by_discord_id:  recordedByDiscordId,
  };

  // Broadcast rows use insertIgnoreDuplicates so a same-minute duplicate
  // from a second agent on the same machine doesn't 409 the call — the
  // partial-unique index handles dedup server-side.
  if (source === 'pvp_broadcast' || source === 'druzzil_broadcast') {
    const written = await supabase.insert('hate_kills', [row]);
    if (Array.isArray(written) && written[0]) return written[0];
    // The unique index will 409 a duplicate-minute broadcast. Return null
    // (treated as "no new row" by callers — they won't re-post to Discord).
    return null;
  }

  const written = await supabase.insert('hate_kills', [row]);
  return Array.isArray(written) ? written[0] : null;
}

// "What's the current state of each spot?" — returns a map keyed by
// spot_num, value = the latest active row (cleared_at NULL AND (timer
// unknown OR latest spawn in the future)). Spots without an active row are
// absent from the map — callers treat absent as "🟢 Available".
//
// One query: pull all rows for `server` within ACTIVE_LOOKBACK_HOURS,
// ordered by killed_at desc. The first row we see per spot_num wins.
async function getSpotStateForServer(server) {
  if (!supabase.isEnabled()) return {};
  if (server !== 'live' && server !== 'pvp') return {};

  const since = new Date(Date.now() - ACTIVE_LOOKBACK_HOURS * 3600000).toISOString();
  const rows = await supabase.select(
    'hate_kills',
    `server=eq.${server}` +
    `&killed_at=gte.${encodeURIComponent(since)}` +
    `&cleared_at=is.null` +
    `&spot_num=not.is.null` +
    `&order=killed_at.desc`
  );
  if (!Array.isArray(rows)) return {};

  const now = Date.now();
  const out = {};
  for (const r of rows) {
    if (out[r.spot_num]) continue; // we already have a newer row for this spot
    const active = r.timer_unknown ||
      (r.next_spawn_latest && Date.parse(r.next_spawn_latest) > now);
    if (!active) continue;
    out[r.spot_num] = r;
  }
  return out;
}

// Mark the latest active row for (server, spotNum) as cleared. Used by the
// "Mark Available" button — operator override when the mob has respawned
// before the latest window closed.
async function clearLatestSpot({ server, spotNum, clearedByDiscordId }) {
  if (!supabase.isEnabled()) return null;
  const since = new Date(Date.now() - ACTIVE_LOOKBACK_HOURS * 3600000).toISOString();
  const rows = await supabase.select(
    'hate_kills',
    `server=eq.${server}` +
    `&spot_num=eq.${spotNum}` +
    `&killed_at=gte.${encodeURIComponent(since)}` +
    `&cleared_at=is.null` +
    `&order=killed_at.desc&limit=1&select=id`
  );
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const id = rows[0].id;
  const patched = await supabase.update(
    'hate_kills',
    `id=eq.${id}`,
    {
      cleared_at: new Date().toISOString(),
      cleared_by_discord_id: clearedByDiscordId || null,
    },
  );
  return Array.isArray(patched) ? patched[0] : null;
}

// Flip the latest active row for (server, spotNum) into timer_unknown — used
// by the "Timer Unknown" button. Zeros out the spawn windows so display
// shifts to the "❓ check manually" branch.
async function setLatestSpotTimerUnknown({ server, spotNum, setByDiscordId }) {
  if (!supabase.isEnabled()) return null;
  const since = new Date(Date.now() - ACTIVE_LOOKBACK_HOURS * 3600000).toISOString();
  const rows = await supabase.select(
    'hate_kills',
    `server=eq.${server}` +
    `&spot_num=eq.${spotNum}` +
    `&killed_at=gte.${encodeURIComponent(since)}` +
    `&cleared_at=is.null` +
    `&order=killed_at.desc&limit=1&select=id`
  );
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const id = rows[0].id;
  const patched = await supabase.update(
    'hate_kills',
    `id=eq.${id}`,
    {
      timer_unknown: true,
      next_spawn_earliest: null,
      next_spawn_latest: null,
    },
  );
  return Array.isArray(patched) ? patched[0] : null;
}

// Assign a spot to a previously-NULL row (from an auto-broadcast). Used by
// the spot-picker buttons posted under "Wolf Pack killed Lord of Ire — set
// spot?" notifications. Re-derives next_spawn_earliest/latest from killed_at.
async function assignSpotToKill({ killId, spotNum, recordedByDiscordId }) {
  if (!supabase.isEnabled()) return null;
  const rows = await supabase.select(
    'hate_kills',
    `id=eq.${killId}&select=server,killed_at,timer_unknown`
  );
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const r = rows[0];
  const { earliest, latest } = _windowFor(r.server, Date.parse(r.killed_at), r.timer_unknown);
  const patched = await supabase.update(
    'hate_kills',
    `id=eq.${killId}`,
    {
      spot_num: spotNum,
      next_spawn_earliest: earliest,
      next_spawn_latest: latest,
      recorded_by_discord_id: recordedByDiscordId || null,
    },
  );
  return Array.isArray(patched) ? patched[0] : null;
}

// Update the thread_message_id on a kill row — called after we post the
// notification embed so future edits (spot assignment, mark-available)
// know which message to edit in place.
async function setThreadMessageId(killId, messageId) {
  if (!supabase.isEnabled() || !killId) return null;
  return supabase.update('hate_kills', `id=eq.${killId}`, { thread_message_id: messageId });
}

// Pull recent kills for the activity feed (latest N across all spots, for
// rendering "recent kills" trailer on the board / /pvp/hate web page).
async function getRecentKills(server, limit = 50) {
  if (!supabase.isEnabled()) return [];
  const rows = await supabase.select(
    'hate_kills',
    `server=eq.${server}&order=killed_at.desc&limit=${limit}`
  );
  return Array.isArray(rows) ? rows : [];
}

// Pull recent kills regardless of server (for the web page that shows both).
async function getRecentKillsBoth(limit = 100) {
  if (!supabase.isEnabled()) return [];
  const rows = await supabase.select(
    'hate_kills',
    `order=killed_at.desc&limit=${limit}`
  );
  return Array.isArray(rows) ? rows : [];
}

// Pull a single row by id (used by the spot-picker button to refresh state
// after the user clicks).
async function getKillById(killId) {
  if (!supabase.isEnabled() || !killId) return null;
  const rows = await supabase.select('hate_kills', `id=eq.${killId}&limit=1`);
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

// One-shot startup import: lift any leftover hate_/hate_pvp_ entries out of
// state.json into Supabase as backfill rows, then delete them from state so
// future code paths only read from Supabase.
//
// Safe to run on every boot — same-killed_at + same source rows for the
// same spot collide on the broadcast dedup index OR (for legacy manual
// rows) we just match-and-skip via a precheck. Returns the count migrated.
async function importLegacyHateState() {
  if (!supabase.isEnabled()) return 0;
  let state;
  try { state = require('./state'); }
  catch { return 0; }

  const liveKills = state.getAllLiveKills ? state.getAllLiveKills() : {};
  const pvpKills  = state.getAllPvpKills  ? state.getAllPvpKills()  : {};

  const writes = [];
  for (const [key, entry] of Object.entries(liveKills || {})) {
    const m = /^hate_(\d+)$/.exec(key);
    if (!m) continue;
    writes.push({ server: 'live', spot: parseInt(m[1], 10), entry, key });
  }
  for (const [key, entry] of Object.entries(pvpKills || {})) {
    const m = /^hate_pvp_(\d+)$/.exec(key);
    if (!m) continue;
    writes.push({ server: 'pvp', spot: parseInt(m[1], 10), entry, key });
  }
  if (writes.length === 0) return 0;

  let migrated = 0;
  for (const w of writes) {
    const killedAtIso = w.entry.killedAt
      ? new Date(w.entry.killedAt).toISOString()
      : new Date().toISOString();

    // Idempotency check — re-running on next boot must not double-insert.
    // The broadcast dedup index doesn't cover legacy rows (NULL killer),
    // so we test for existence by (server, spot, killed_at) explicitly.
    const exists = await supabase.select(
      'hate_kills',
      `server=eq.${w.server}` +
      `&spot_num=eq.${w.spot}` +
      `&killed_at=eq.${encodeURIComponent(killedAtIso)}` +
      `&select=id&limit=1`
    );
    if (Array.isArray(exists) && exists.length > 0) {
      // Already migrated on a previous boot — purge the legacy key so we
      // stop checking from the next startup forward.
      if (w.server === 'live') state.clearLiveKill && state.clearLiveKill(w.key);
      else                     state.clearPvpKill  && state.clearPvpKill(w.key);
      continue;
    }

    const wrote = await recordHateKill({
      server:              w.server,
      spotNum:             w.spot,
      killerName:          null,
      killerGuild:         null,
      killedAtMs:          w.entry.killedAt || Date.now(),
      timerUnknown:        !!w.entry.timerUnknown,
      source:              'legacy_state',
      recordedByDiscordId: w.entry.killedBy || null,
      notes:               'imported from state.json on startup',
    });
    if (wrote) {
      migrated += 1;
      if (w.server === 'live') state.clearLiveKill && state.clearLiveKill(w.key);
      else                     state.clearPvpKill  && state.clearPvpKill(w.key);
    }
  }

  if (migrated > 0) {
    console.log(`[hateKills] Imported ${migrated} legacy hate kill row(s) from state.json into Supabase`);
  }
  return migrated;
}

module.exports = {
  HATE_TIMER_HOURS,
  recordHateKill,
  getSpotStateForServer,
  clearLatestSpot,
  setLatestSpotTimerUnknown,
  assignSpotToKill,
  setThreadMessageId,
  getRecentKills,
  getRecentKillsBoth,
  getKillById,
  importLegacyHateState,
};
