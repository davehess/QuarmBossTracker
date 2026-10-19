// Non-EverQuest ingest: the bot side of packages/wowlogsync/ (the guild lead, 2026-10-19: "start supporting other games").
//
// A reader for another game posts the SAME envelope the EverQuest agent posts to POST /api/agent/encounter,
// plus `game: 'wow'`. `_handleAgentUpload` hands that body here BEFORE it touches anything EverQuest-shaped:
// findBossFromName, _resolveBossForPersist, bosses_local, the who_data merge, parse cards, pet-owner maps, board
// timers and kill lockouts all stay on the EQ side of the branch. An upload with no `game` (or game 'eq') never
// reaches this file.
//
// What a WoW upload does instead:
//   1. validate and clamp the body (it is an authenticated member's data, but still untrusted input);
//   2. find_or_create_encounter_by_key(guild, 'wow', boss_key, boss_name, started_at, duration) -- the key RPC in
//      supabase/migrations/20261019130000_encounters_game_and_boss_key.sql, same +/- window dedupe as the EQ RPC;
//   3. recordContribution -> contributions row + merge_encounter_players (the same merge EQ uses);
//   4. on a confirmed kill, stamp encounters.ended_at once.
//
// v1 skips, on purpose: Discord parse cards (buildParseEmbed leans on EQ boss data), the session leaderboard,
// board timers, kill lockouts and charm sessions (all EQ concepts), and agent_upload_stats (that table counts the
// EQ fleet in players; a WoW character would inflate it).

const WOW_BOSS_KEY_RE = /^wow:(?:encounter|npc):\d{1,9}$/;
const NAME_RE         = /^[\p{L}'-]{1,24}$/u;
const MAX_PLAYERS     = 200;
const MAX_DEATHS      = 200;
const MAX_FIGHT_SEC   = 3 * 3600;
const MAX_STAT        = 1e11;

// Strict on purpose: only the literal string 'wow' leaves the EverQuest path.
function isWowUpload(payload) {
  return !!payload && payload.game === 'wow';
}

function _count(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.round(n), MAX_STAT) : 0;
}

function _cleanName(v) {
  const s = typeof v === 'string' ? v.trim() : '';
  return NAME_RE.test(s) ? s : null;
}

// Returns { ok: true, rec } or { ok: false, error }.
function normalizeWowUpload(payload, nowMs = Date.now()) {
  const enc = payload && payload.encounter;
  if (!enc || typeof enc !== 'object') return { ok: false, error: 'missing encounter' };
  const bossKey = typeof enc.boss_key === 'string' ? enc.boss_key : '';
  if (!WOW_BOSS_KEY_RE.test(bossKey)) return { ok: false, error: 'bad boss_key' };
  const bossName = String(enc.boss_name || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 80);
  if (!bossName) return { ok: false, error: 'missing boss_name' };

  // A named contributor is what makes a re-upload an upsert (contributions_dedup); without one it would insert anew.
  const character = _cleanName(payload.character);
  if (!character) return { ok: false, error: 'missing character' };

  const startedMs = Date.parse(enc.started_at);
  if (!Number.isFinite(startedMs) || startedMs < nowMs - 45 * 86400e3 || startedMs > nowMs + 3600e3) {
    return { ok: false, error: 'bad started_at' };
  }
  const endedMs = Date.parse(enc.ended_at);
  const wall = Number.isFinite(endedMs) ? Math.round((endedMs - startedMs) / 1000) : 0;
  const active = Number(enc.active_duration_s);
  const duration = Math.min(MAX_FIGHT_SEC, Math.max(1, Math.round(Number.isFinite(active) && active > 0 ? active : wall) || 1));

  const players = [];
  for (const p of (Array.isArray(enc.players) ? enc.players : []).slice(0, MAX_PLAYERS)) {
    const name = _cleanName(p && p.name);
    if (!name) continue;
    const direct = _count(p.directDamage), pet = _count(p.petDamage);
    const damage = _count(p.damage) || direct + pet;
    const healed = _count(p.healed);
    if (!damage && !healed) continue;
    players.push({
      name, damage, directDamage: direct, petDamage: pet, hasPets: pet > 0, healed,
      duration, dps: Math.round(damage / duration),
    });
  }
  players.sort((a, b) => b.damage - a.damage);
  players.forEach((p, i) => { p.rank = i + 1; });
  const totalDamage = players.reduce((s, p) => s + p.damage, 0);

  const healers = players.filter(p => p.healed > 0).map(p => ({ name: p.name, healed: p.healed, ticks: 0 }));
  const deaths = [];
  for (const d of (Array.isArray(enc.deaths) ? enc.deaths : []).slice(0, MAX_DEATHS)) {
    const name = _cleanName(d && d.name);
    const ts = Date.parse(d && d.ts);
    if (name && Number.isFinite(ts)) deaths.push({ name, ts: new Date(ts).toISOString() });
  }

  return {
    ok: true,
    rec: {
      bossKey, bossName, startedMs, duration,
      endedIso: new Date(startedMs + duration * 1000).toISOString(),
      confirmedKill: enc.confirmed_kill === true,
      character,
      rawParse: {
        game: 'wow', bossName, duration, totalDamage,
        totalDps: Math.round(totalDamage / duration),
        players, healers: healers.length ? healers : undefined,
        deaths: deaths.length ? deaths : undefined,
      },
    },
  };
}

// supabase is utils/supabase.js (injected so a test can pass a stub). Returns { encounterId, contributionId } or null.
async function recordWowUpload({ supabase, guildId, identity, payload, rec }) {
  if (!supabase.isEnabled()) return null;
  const encounterId = await supabase.rpc('find_or_create_encounter_by_key', {
    p_guild_id:   guildId,
    p_game:       'wow',
    p_boss_key:   rec.bossKey,
    p_boss_name:  rec.bossName,
    p_started_at: new Date(rec.startedMs).toISOString(),
    p_duration:   rec.duration,
    p_window_min: 30,
  });
  if (typeof encounterId !== 'string') return null;

  const contributionId = await supabase.recordContribution({
    encounterId,
    contributorDiscordId: null,
    contributorCharacter: rec.character,
    source: 'wow_logsync_v1',
    rawParse: rec.rawParse,
    agentVersion: payload.agent_version || null,
    hasAbilityDetail: false,
    uploadedByDiscordId: identity && identity.discord_id || null,
  });

  if (rec.confirmedKill) {
    // Set-once, like the EQ path: the first confirmed death time wins.
    await supabase.update('encounters',
      `id=eq.${encodeURIComponent(encounterId)}&ended_at=is.null`,
      { ended_at: rec.endedIso });
  }
  return { encounterId, contributionId };
}

module.exports = { isWowUpload, normalizeWowUpload, recordWowUpload, WOW_BOSS_KEY_RE };
