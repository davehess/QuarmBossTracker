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
      console.warn(`[supabase] ${opts.method || 'GET'} ${path} → ${res.status}:`, parsed);
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
async function findOrCreateEncounter({ npcId, startedAtMs, durationSec, windowMin = 30 }) {
  if (!isEnabled() || !npcId) return null;
  const result = await rpc('find_or_create_encounter', {
    p_guild_id:   _guildId(),
    p_npc_id:     npcId,
    p_started_at: new Date(startedAtMs).toISOString(),
    p_duration:   durationSec,
    p_window_min: windowMin,
  });
  // RPC returns the scalar uuid
  return typeof result === 'string' ? result : null;
}

// Record a contribution (one player's perspective) for an encounter.
// rawParse is the { bossName, duration, totalDamage, totalDps, players: [...] } structure.
async function recordContribution({
  encounterId,
  contributorDiscordId,
  contributorCharacter,
  source,
  rawParse,
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
  };

  const inserted = await insert('contributions', [row]);
  const contributionId = Array.isArray(inserted) ? inserted[0]?.id : null;

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
}) {
  if (!isEnabled()) return null;

  const npcId = await getNpcIdForInternalId(bossInternalId);
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
  });
  if (!encounterId) return null;

  const contributionId = await recordContribution({
    encounterId,
    contributorDiscordId,
    contributorCharacter,
    source,
    rawParse: parsed,
  });

  return { encounterId, contributionId, npcId };
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

module.exports = {
  isEnabled,
  select, insert, update, upsert, rpc,
  getNpcIdForInternalId,
  findOrCreateEncounter,
  recordContribution,
  recordParse,
  getEncounterCompleteness,
  getEncounterContributions,
  getEncounterPlayers,
  getTonightEncounters,
};
