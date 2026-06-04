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

async function upsert(table, rows, onConflict) {
  const prefer = `return=representation,resolution=merge-duplicates`;
  const path   = onConflict ? `/${table}?on_conflict=${onConflict}` : `/${table}`;
  return _request(path, { method: 'POST', body: rows, prefer });
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
}) {
  if (!isEnabled()) return null;

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

  return { encounterId, contributionId, npcId };
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
    dedup_key:       dedupKey,
  }], 'dedup_key').catch(err => {
    console.warn('[pvp_boss_kills] upsert failed:', err?.message);
    return null;
  });
}

module.exports = {
  isEnabled,
  select, insert, update, upsert, del, rpc,
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
