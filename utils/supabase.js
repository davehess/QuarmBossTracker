// utils/supabase.js — Lightweight Supabase REST client using global fetch.
//
// No npm dependency — uses PostgREST endpoints directly with the service_role key.
// All writes are best-effort: if Supabase isn't configured (env vars missing) or
// the request fails, the call returns null and logs a warning. The existing
// state.json + Discord-thread storage continues to work unchanged.
//
// Required env vars:
//   SUPABASE_URL                — https://[PROJECT-REF].supabase.co
//   SUPABASE_SERVICE_ROLE_KEY   — from Project Settings → API → service_role
//   SUPABASE_GUILD_ID           — guild identifier written to every row (default: 'wolfpack')

function isEnabled() {
  return !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function _guildId() {
  return process.env.SUPABASE_GUILD_ID || 'wolfpack';
}

async function _request(path, opts = {}) {
  if (!isEnabled()) return null;

  const url = `${process.env.SUPABASE_URL}/rest/v1${path}`;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const headers = {
    'apikey':        key,
    'Authorization': `Bearer ${key}`,
    'Content-Type':  'application/json',
    'Prefer':        opts.prefer || 'return=representation',
    ...(opts.headers || {}),
  };

  try {
    const res = await fetch(url, {
      method:  opts.method || 'GET',
      headers,
      body:    opts.body ? JSON.stringify(opts.body) : undefined,
    });

    const text = await res.text();
    let parsed;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }

    if (!res.ok) {
      // Stringify the parsed body so Node's util.inspect doesn't truncate it
      // to "{" when an object spans multiple keys. PostgREST 4xx bodies carry
      // {code, details, hint, message} and you NEED the full hint to debug
      // (e.g. "there is no unique or exclusion constraint matching the
      // ON CONFLICT specification" — the partial-index bug we just shipped a
      // fix for). Truncating to 800 chars keeps a flood from blowing the log.
      const bodyStr = parsed && typeof parsed === 'object'
        ? JSON.stringify(parsed).slice(0, 800)
        : String(parsed || '').slice(0, 800);
      console.warn(`[supabase] ${opts.method || 'GET'} ${path} → ${res.status}: ${bodyStr}`);
      return null;
    }
    return parsed;
  } catch (err) {
    console.warn(`[supabase] request failed:`, err?.message);
    return null;
  }
}

// ── Generic helpers ──────────────────────────────────────────────────────────
async function select(table, queryString = '') {
  const path = queryString ? `/${table}?${queryString}` : `/${table}`;
  return _request(path);
}

async function insert(table, rows) {
  return _request(`/${table}`, { method: 'POST', body: rows });
}

async function update(table, queryString, body) {
  return _request(`/${table}?${queryString}`, { method: 'PATCH', body });
}

// Default behavior: returns the upserted rows so callers can count via
// Array.isArray(result).length. Pass { minimal: true } when you DON'T need
// the rows back — the PostgREST response array is capped at the server's
// max-rows setting (default 1000 on Supabase), so a 2000-row upsert silently
// returns 1000 even though all rows were written. Minimal-return drops the
// representation entirely (no cap, less egress); the caller's "written"
// count then has to come from the input length, not the response.
async function upsert(table, rows, onConflict, opts = {}) {
  const ret = opts.minimal ? 'return=minimal' : 'return=representation';
  const prefer = `${ret},resolution=merge-duplicates`;
  const path   = onConflict ? `/${table}?on_conflict=${onConflict}` : `/${table}`;
  return _request(path, { method: 'POST', body: rows, prefer });
}

// Insert with silent dedup against ANY unique index/constraint that fires —
// including PARTIAL unique indexes that PostgREST's `on_conflict=` can't
// reference (buff_casts has two partial uniques split on spell_id, and
// upsert(...) was 400-erroring on every call as a result). This sends
// `Prefer: resolution=ignore-duplicates` with no on_conflict target, which
// becomes an unqualified ON CONFLICT DO NOTHING server-side and works with
// any unique storage. Drops `return=representation` so the response body is
// empty (saves egress on what's typically a hot insert path).
async function insertIgnoreDuplicates(table, rows) {
  return _request(`/${table}`, {
    method: 'POST',
    body:   rows,
    prefer: 'return=minimal,resolution=ignore-duplicates',
  });
}

async function del(table, queryString) {
  return _request(`/${table}?${queryString}`, { method: 'DELETE', prefer: 'return=minimal' });
}

// Call a stored procedure (RPC). For find_or_create_encounter, merge_encounter_players.
async function rpc(fnName, params = {}) {
  return _request(`/rpc/${fnName}`, { method: 'POST', body: params });
}

// ── Domain helpers ───────────────────────────────────────────────────────────

// Look up the npc_id for one of our local boss internal_ids (e.g. 'lord_nagafen').
// Returns the int or null if not yet mapped in bosses_local.
async function getNpcIdForInternalId(internalId) {
  if (!isEnabled() || !internalId) return null;
  const rows = await select('bosses_local', `internal_id=eq.${encodeURIComponent(internalId)}&select=npc_id`);
  return Array.isArray(rows) && rows[0]?.npc_id ? rows[0].npc_id : null;
}

// Find or create an encounter matching npc_id within ±N min of timestamp.
// Returns the encounter id (uuid) or null on failure.
// zoneShort is optional — when present it's stored on insert. When absent the
// RPC falls back to bosses_local.zone_short for the npc.
async function findOrCreateEncounter({ npcId, startedAtMs, durationSec, windowMin = 30, zoneShort = null }) {
  if (!isEnabled() || !npcId) return null;
  const params = {
    p_guild_id:   _guildId(),
    p_npc_id:     npcId,
    p_started_at: new Date(startedAtMs).toISOString(),
    p_duration:   durationSec,
    p_window_min: windowMin,
  };
  if (zoneShort) params.p_zone_short = zoneShort;
  const result = await rpc('find_or_create_encounter', params);
  // RPC returns the scalar uuid
  return typeof result === 'string' ? result : null;
}

// Record a contribution (one player's perspective) for an encounter.
// rawParse is the { bossName, duration, totalDamage, totalDps, players: [...] } structure.
// Idempotent for named contributors via the contributions_dedup partial unique
// index (encounter_id, source, contributor_character) — re-runs upsert the row
// in place. Anonymous (NULL-character) contributions still insert fresh every
// time since the index excludes NULLs.
async function recordContribution({
  encounterId,
  contributorDiscordId,
  contributorCharacter,
  source,
  rawParse,
  agentVersion = null,
  hasAbilityDetail = false,
  // Discord ID of the mimic_session that submitted this upload — distinct
  // from contributorDiscordId, which is the /quarmy-linked owner of the
  // CHARACTER on the parse. uploadedByDiscordId is the agent identity that
  // actually pushed the bytes; it's the forensic trace.
  uploadedByDiscordId = null,
}) {
  if (!isEnabled() || !encounterId) return null;

  const row = {
    encounter_id:             encounterId,
    contributor_discord_id:   contributorDiscordId || null,
    contributor_character:    contributorCharacter || null,
    source,
    total_damage:             rawParse?.totalDamage || 0,
    player_count:             rawParse?.players?.length || 0,
    duration_sec:             rawParse?.duration || null,
    raw_parse:                rawParse,
    agent_version:            agentVersion,
    has_ability_detail:       !!hasAbilityDetail,
    uploaded_by_discord_id:   uploadedByDiscordId || null,
  };

  const written = contributorCharacter
    ? await upsert('contributions', [row], 'encounter_id,source,contributor_character')
    : await insert('contributions', [row]);
  const contributionId = Array.isArray(written) ? written[0]?.id : null;

  // Recompute the merged encounter_players view
  if (contributionId) {
    await rpc('merge_encounter_players', { p_encounter_id: encounterId });
  }
  return contributionId;
}

// One-shot helper: takes a parsed EQLogParser result, looks up the npc_id from
// bosses_local (via our internal_id), creates/finds the encounter, records the
// contribution, and recomputes the merged player view.
//
// Gracefully no-ops in any of these cases (no errors thrown):
//   - Supabase env vars unset
//   - bossInternalId not yet mapped in bosses_local (sync not done; or boss not opt-in)
//   - any RPC call fails
//
// Returns { encounterId, contributionId, npcId } or null.
async function recordParse({
  bossInternalId, parsed, timestampMs,
  contributorDiscordId, contributorCharacter,
  source = 'eqlogparser_send_to_eq',
  zoneShort = null,
  agentVersion = null,
  rollupByChar = null,
  // Boss self-heal accumulated by the agent (Lady Vox CH etc.). Persisted
  // on the encounters row via a follow-up PATCH after find_or_create
  // returns. Max-keep semantics: if multiple parsers report different
  // totals for the same fight, the highest wins (matches our
  // max-damage-per-player merge convention).
  npcHealedTotal = 0,
  // Discord ID of the mimic_session that submitted this upload — forensic
  // trace. Stamps both contributions.uploaded_by_discord_id and (on first
  // creation only) encounters.uploaded_by_discord_id.
  uploadedByDiscordId = null,
  // Per-fight timeline events for the callout replay (#98): raid-wide events
  // (enrage/DT/rampage/AoE), trigger fires, tank switches. [{at,kind,subtype,
  // actor,label,meta}]. Stored in encounter_events, deduped at read like deaths.
  timelineEvents = null,
}) {
  if (!isEnabled()) return null;

  // Guard: drop session-blob parses. When a parser uploads an entire raid
  // session as one "encounter" (a 30m–2h duration with everyone who did any
  // damage in the zone), merging it into a real ~3min boss kill drags in
  // parked alts and passers-by (Uilnayar 2026-06-23: a 3024s Cazic Thule blob
  // attributed 2.3k to Hitya, who wasn't in the fight). No single boss fight on
  // Quarm runs past 30 minutes; anything longer is a segmentation failure, not
  // a fight. Drop it before it can find/create or pollute an encounter. The
  // boss respawn timer is unaffected (it rides the separate /bosskill path).
  const MAX_FIGHT_SEC = 1800;
  if (parsed && Number(parsed.duration) > MAX_FIGHT_SEC) {
    console.warn(`[supabase] dropped session-blob parse: ${parsed.duration}s for ${bossInternalId} from ${contributorCharacter || '?'} (agent v${agentVersion || '?'}) — exceeds ${MAX_FIGHT_SEC}s single-fight cap`);
    return null;
  }

  // One query for npc_id + zone_short so encounter insert lands with a zone.
  const rows = await select(
    'bosses_local',
    `internal_id=eq.${encodeURIComponent(bossInternalId)}&select=npc_id,zone_short&limit=1`
  );
  const row   = Array.isArray(rows) ? rows[0] : null;
  const npcId = row?.npc_id || null;
  if (!npcId) {
    // Expected during rollout — bosses_local hasn't been populated yet, or this
    // boss isn't opt-in. Falling back to no-op is correct; the legacy parses.json
    // path still records everything locally.
    return null;
  }

  const encounterId = await findOrCreateEncounter({
    npcId,
    startedAtMs: timestampMs,
    durationSec: parsed.duration,
    zoneShort:   zoneShort || row.zone_short || null,
  });
  if (!encounterId) return null;

  const hasAbilityDetail = !!(rollupByChar && Object.keys(rollupByChar).length);
  const contributionId = await recordContribution({
    encounterId,
    contributorDiscordId,
    contributorCharacter,
    source,
    rawParse: parsed,
    agentVersion,
    hasAbilityDetail,
    uploadedByDiscordId,
  });

  // Stamp encounters.uploaded_by_discord_id only on FIRST creation — once a
  // legitimate contribution lands, subsequent uploads from anyone else can't
  // rewrite the original uploader. WHERE uploaded_by_discord_id IS NULL
  // enforces that.
  if (uploadedByDiscordId) {
    try {
      await update(
        'encounters',
        `id=eq.${encounterId}&uploaded_by_discord_id=is.null`,
        { uploaded_by_discord_id: uploadedByDiscordId },
      );
    } catch (err) {
      console.warn('[supabase] encounters uploaded_by stamp failed:', err?.message);
    }
  }

  // Persist the per-character verb rollup for this encounter. Idempotent via
  // (encounter_id, character_name) — a resubmit overwrites in place. Failures
  // are non-fatal: the contribution + merged player view still landed.
  if (hasAbilityDetail) {
    try { await upsertCombatRollup(encounterId, agentVersion, rollupByChar); }
    catch (err) { console.warn('[supabase] combat rollup upsert failed:', err?.message); }
  }

  // Stamp the boss self-heal total on the encounter row. Max-keep: read the
  // current value, only PATCH if the incoming total is strictly higher. This
  // matches the max-damage-per-player merge semantics used elsewhere — if a
  // backfill parser saw fewer heal events than the live one (or vice versa),
  // we keep the higher tally rather than letting the last-write win.
  if (npcHealedTotal > 0) {
    try {
      const existing = await select(
        'encounters',
        `id=eq.${encounterId}&select=npc_healed_total&limit=1`
      );
      const current = (Array.isArray(existing) && existing[0]?.npc_healed_total) || 0;
      if (npcHealedTotal > current) {
        await update('encounters', `id=eq.${encounterId}`, { npc_healed_total: npcHealedTotal });
      }
    } catch (err) {
      console.warn('[supabase] npc_healed_total patch failed:', err?.message);
    }
  }

  // Per-fight timeline events (#98) — raid-wide events, trigger fires, tank
  // switches for the callout replay. Non-fatal; the parse itself already landed.
  if (Array.isArray(timelineEvents) && timelineEvents.length) {
    try { await recordEncounterEvents(encounterId, timelineEvents, uploadedByDiscordId); }
    catch (err) { console.warn('[supabase] encounter_events insert failed:', err?.message); }
  }

  return { encounterId, contributionId, npcId };
}

// Persist per-fight timeline events for the callout replay (#98). Idempotent
// per uploader via the encounter_events_dedup unique index (backfill re-runs
// don't duplicate); cross-uploader duplicates collapse at read. Capped so a
// runaway agent can't flood the table.
async function recordEncounterEvents(encounterId, events, uploadedByDiscordId) {
  if (!isEnabled() || !encounterId || !Array.isArray(events) || events.length === 0) return;
  const rows = [];
  for (const e of events) {
    if (!e || !e.at || !e.kind) continue;
    const at = new Date(e.at);
    if (isNaN(at.getTime())) continue;
    rows.push({
      guild_id:               _guildId(),
      encounter_id:           encounterId,
      uploaded_by_discord_id: uploadedByDiscordId || null,
      at:                     at.toISOString(),
      kind:                   String(e.kind).slice(0, 24),
      subtype:                e.subtype ? String(e.subtype).slice(0, 48) : null,
      actor:                  e.actor  ? String(e.actor).slice(0, 64)  : null,
      label:                  e.label  ? String(e.label).slice(0, 160) : null,
      meta:                   (e.meta && typeof e.meta === 'object') ? e.meta : null,
    });
  }
  if (rows.length === 0) return;
  await insertIgnoreDuplicates('encounter_events', rows.slice(0, 500));
}

// Upsert per-character ability rollups for one encounter.
// rollupByChar: { [characterName]: { by_skill, total_hits, total_damage, self_attack_count } }
async function upsertCombatRollup(encounterId, agentVersion, rollupByChar) {
  if (!isEnabled() || !encounterId || !rollupByChar) return;
  const rows = Object.entries(rollupByChar).map(([characterName, b]) => ({
    guild_id:          _guildId(),
    encounter_id:      encounterId,
    character_name:    characterName,
    agent_version:     agentVersion || null,
    by_skill:          b?.by_skill || {},
    total_hits:        Number(b?.total_hits)        || 0,
    total_damage:      Number(b?.total_damage)      || 0,
    self_attack_count: Number(b?.self_attack_count) || 0,
  }));
  if (rows.length === 0) return;
  await upsert('encounter_combat_rollup', rows, 'encounter_id,character_name');
}

// Fetch the completeness summary for an encounter.
async function getEncounterCompleteness(encounterId) {
  if (!isEnabled() || !encounterId) return null;
  const rows = await select('encounter_completeness', `encounter_id=eq.${encounterId}`);
  return Array.isArray(rows) ? rows[0] : null;
}

// Fetch all contributions for an encounter (for display / debugging).
async function getEncounterContributions(encounterId) {
  if (!isEnabled() || !encounterId) return [];
  const rows = await select('contributions',
    `encounter_id=eq.${encounterId}&order=created_at.asc`);
  return Array.isArray(rows) ? rows : [];
}

// Fetch merged player aggregates for an encounter.
async function getEncounterPlayers(encounterId) {
  if (!isEnabled() || !encounterId) return [];
  const rows = await select('encounter_players',
    `encounter_id=eq.${encounterId}&order=rank.asc`);
  return Array.isArray(rows) ? rows : [];
}

// Fetch tonight's encounters with completeness scores.
async function getTonightEncounters(date = new Date()) {
  if (!isEnabled()) return [];
  const dayStart = new Date(date);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  const guildId = _guildId();
  const query = `guild_id=eq.${guildId}` +
    `&started_at=gte.${dayStart.toISOString()}` +
    `&started_at=lt.${dayEnd.toISOString()}` +
    `&order=started_at.desc`;
  const rows = await select('encounter_completeness', query);
  return Array.isArray(rows) ? rows : [];
}

// Mirror one PvP boss kill into Supabase. Called from utils/state.recordPvpKill
// so the kill lands in BOTH state.json (live timers) AND the public.pvp_boss_kills
// table (web /pvp board). Idempotent via the dedup_key column. Failure is non-
// fatal — state.json remains the source of truth for the bot itself.
async function mirrorPvpBossKill(row) {
  if (!isEnabled()) return null;
  if (!row || !row.boss_id || !row.killed_at) return null;
  // Per-minute dedup so two agents broadcasting the same kill don't double up.
  const minuteIso = new Date(row.killed_at).toISOString().slice(0, 16); // YYYY-MM-DDTHH:MM
  const guildId   = row.guild_id || _guildId();
  const dedupKey  = row.dedup_key || `${guildId}|${row.boss_id}|${minuteIso}`;
  const killedAt  = new Date(row.killed_at);
  const baseMs    = Number(row.timer_hours) * 3600000;
  const spawnEarly = new Date(killedAt.getTime() + baseMs * 0.8).toISOString();
  const spawnLate  = new Date(killedAt.getTime() + baseMs * 1.2).toISOString();
  return upsert('pvp_boss_kills', [{
    guild_id:        guildId,
    boss_id:         row.boss_id,
    boss_name:       row.boss_name,
    zone:            row.zone || null,
    timer_hours:     Number(row.timer_hours),
    killed_at:       killedAt.toISOString(),
    killed_by:       row.killed_by       || null,
    killed_by_guild: row.killed_by_guild || null,
    recorded_by:     row.recorded_by     || null,
    source:          row.source          || 'auto_broadcast',
    raw_text:        row.raw_text        ? String(row.raw_text).slice(0, 500) : null,
    spawn_earliest:  spawnEarly,
    spawn_latest:    spawnLate,
    // A fresh kill resets the window, so it clears any prior quake override
    // (null) unless the caller is explicitly setting one.
    spawn_earliest_override: row.spawn_earliest_override || null,
    dedup_key:       dedupKey,
  }], 'dedup_key').catch(err => {
    console.warn('[pvp_boss_kills] upsert failed:', err?.message);
    return null;
  });
}

// Quake → PvP board. Set spawn_earliest_override on every tracked boss so the
// web /pvp board reads the window open "now" while keeping killed_at +
// spawn_latest. Blanket update is correct: a quake repops ALL pvp mobs. Scoped
// to recent rows (the board only shows the latest kill per boss within 90d).
async function applyQuakeToPvpBoardMirror(quakeTimeMs) {
  if (!isEnabled()) return null;
  const overrideIso = new Date(quakeTimeMs).toISOString();
  const sinceIso    = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString();
  return update(
    'pvp_boss_kills',
    `guild_id=eq.${encodeURIComponent(_guildId())}&killed_at=gte.${encodeURIComponent(sinceIso)}`,
    { spawn_earliest_override: overrideIso },
  );
}

// ── /who overrides (officer-curated class + Zek, edited on the web /admin/who) ──
// Read by the bot at startup + on a periodic refresh so web-set class/Zek flow
// into state.whoData (→ /whois, PvP auto-zek). /markzek dual-writes here so the
// Discord and web sides converge on one source of truth.
async function getWhoOverrides() {
  if (!isEnabled()) return [];
  const rows = await select(
    'who_overrides',
    `guild_id=eq.${encodeURIComponent(_guildId())}&select=character,class,is_zek`,
  );
  return Array.isArray(rows) ? rows : [];
}
// Upsert one override. Only the fields you pass are written, so setting Zek
// from /markzek won't blank a class set on the web (merge-duplicates updates
// just the columns present in the payload).
async function upsertWhoOverride({ character, klass, isZek, setBy, setByName, note }) {
  if (!isEnabled() || !character) return null;
  const row = {
    guild_id:    _guildId(),
    character,
    set_by:      setBy || null,
    set_by_name: setByName || null,
    updated_at:  new Date().toISOString(),
  };
  if (klass !== undefined) row.class  = klass;
  if (isZek !== undefined) row.is_zek = isZek;
  if (note  !== undefined) row.note   = note;
  return upsert('who_overrides', [row], 'guild_id,character');
}

module.exports = {
  isEnabled,
  select, insert, insertIgnoreDuplicates, update, upsert, del, rpc,
  getWhoOverrides, upsertWhoOverride,
  applyQuakeToPvpBoardMirror,
  getNpcIdForInternalId,
  findOrCreateEncounter,
  recordContribution,
  recordParse,
  upsertCombatRollup,
  getEncounterCompleteness,
  getEncounterContributions,
  getEncounterPlayers,
  getTonightEncounters,
  mirrorPvpBossKill,
};
