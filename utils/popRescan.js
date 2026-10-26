// utils/popRescan.js — "Sync from my logs" (the guild lead, 2026-10-26): a member asks THEIR OWN Mimic to re-read
// recent EverQuest logs for Planes of Power flag lines.
//
// The row is filed by the website (web/lib/popRescan.ts, table pop_rescan_requests, migration
// 20261026170000). This module is the bot's two halves of it, with the database passed in so both can be run
// against a fake (test/pop-rescan-bot.test.js):
//   rescanRequestsFor  the `rescan` stream of GET /api/agent/poll: the caller's open rows, each CLAIMED on the way out
//   finishRescan       POST /api/agent/rescan-done {id, found, ok}: the same member's agent closes the row
//
// Why this is not agent_backfill_requests: that loop is officer-filed, nothing ever completes it, and its handler
// checks no owner. Here every row has an owner (discord_id), the claim is one conditional update (two agents of one
// member can never both get a row), and a finish is refused unless the caller IS the owner.
//
// Lifecycle: pending -> taken (on serve, taken_at) -> done | failed (on rescan-done). An agent that dies leaves a
// row `taken`; it is handed out again once taken_at is STALE_TAKEN_MS old. A `pending` row nobody's Mimic took in
// PENDING_TTL_MS is dropped from service. The same two numbers are web/lib/popRescan.ts's (a test keeps them equal).
'use strict';

const PENDING_TTL_MS = 24 * 3600_000;
const STALE_TAKEN_MS = 30 * 60_000;
const MAX_DAYS = 60;
const MAX_SERVE = 3;              // rows handed out in one poll; the web allows one open row per member anyway
const MAX_FOUND = 1_000_000;

const T = 'pop_rescan_requests';
const enc = encodeURIComponent;

function _eligible(r, nowMs) {
  if (!r || r.id == null) return false;
  if (r.status === 'pending') return nowMs - Date.parse(r.requested_at) < PENDING_TTL_MS;
  if (r.status === 'taken') return r.taken_at != null && nowMs - Date.parse(r.taken_at) >= STALE_TAKEN_MS;
  return false;
}

/** The open rows for this member that this agent can serve, claimed. `characters` = the agent's watched characters.
 *  → { requests: [{ id, character|null, days }] }. Never throws: a database that will not answer is an empty list. */
async function rescanRequestsFor(supabase, guildId, discordId, characters, nowMs = Date.now()) {
  if (!supabase || !supabase.isEnabled()) return { requests: [] };
  if (!discordId) return { requests: [] };
  const mine = new Set((Array.isArray(characters) ? characters : []).map(c => String(c).toLowerCase()).filter(Boolean));
  let rows;
  try {
    rows = await supabase.select(T,
      `guild_id=eq.${enc(guildId)}&discord_id=eq.${enc(discordId)}&status=in.(pending,taken)`
      + `&select=id,character,days,status,requested_at,taken_at&order=requested_at.asc&limit=10`);
  } catch { return { requests: [] }; }
  if (!Array.isArray(rows)) return { requests: [] };

  const out = [];
  for (const r of rows) {
    if (out.length >= MAX_SERVE) break;
    if (!_eligible(r, nowMs)) continue;
    // A row for one character goes only to an agent that has that character's log; "all mine" goes to any.
    if (r.character != null && !mine.has(String(r.character).toLowerCase())) continue;
    // Claim: one conditional update. The filter repeats what we read, so a row another agent already claimed (or
    // that a finish already closed) matches nothing and is not served twice.
    const cond = r.status === 'taken' ? `&status=eq.taken&taken_at=eq.${enc(r.taken_at)}` : '&status=eq.pending';
    let claimed;
    try {
      claimed = await supabase.update(T, `id=eq.${enc(r.id)}&discord_id=eq.${enc(discordId)}${cond}`,
        { status: 'taken', taken_at: new Date(nowMs).toISOString() });
    } catch { continue; }
    if (!Array.isArray(claimed) || claimed.length === 0) continue;
    const days = Math.max(1, Math.min(MAX_DAYS, Math.trunc(Number(r.days)) || 14));
    out.push({ id: r.id, character: r.character == null ? null : String(r.character), days });
  }
  return { requests: out };
}

/** POST /api/agent/rescan-done. → { status, body } for the caller to send.
 *  200 closed (or already closed) · 400 bad body · 404 not your request · 409 not taken yet · 502 database down. */
async function finishRescan(supabase, guildId, discordId, payload, nowIso = new Date().toISOString()) {
  if (!supabase || !supabase.isEnabled()) return { status: 502, body: { error: 'database unavailable' } };
  const b = payload && typeof payload === 'object' ? payload : {};
  const id = Number(b.id);
  if (!Number.isInteger(id) || id <= 0) return { status: 400, body: { error: 'bad id' } };
  if (typeof b.ok !== 'boolean') return { status: 400, body: { error: 'ok must be true or false' } };
  const found = Math.max(0, Math.min(MAX_FOUND, Math.trunc(Number(b.found)) || 0));
  if (!discordId) return { status: 404, body: { error: 'not your request' } };

  const rows = await supabase.select(T,
    `id=eq.${id}&guild_id=eq.${enc(guildId)}&select=id,discord_id,status&limit=1`);
  if (!Array.isArray(rows)) return { status: 502, body: { error: 'database unavailable' } };
  const row = rows[0];
  // Not found and not yours read the same, so a guessed id tells a stranger nothing.
  if (!row || String(row.discord_id) !== String(discordId)) return { status: 404, body: { error: 'not your request' } };
  if (row.status === 'done' || row.status === 'failed') return { status: 200, body: { ok: true, id, already: true } };
  if (row.status !== 'taken') return { status: 409, body: { error: 'request was not taken' } };

  const patch = { status: b.ok ? 'done' : 'failed', done_at: nowIso, found };
  const res = await supabase.update(T, `id=eq.${id}&discord_id=eq.${enc(discordId)}&status=eq.taken`, patch);
  if (!Array.isArray(res)) return { status: 502, body: { error: 'database unavailable' } };
  if (res.length === 0) return { status: 409, body: { error: 'request changed under you' } };
  return { status: 200, body: { ok: true, id, status: patch.status, found } };
}

module.exports = { rescanRequestsFor, finishRescan, PENDING_TTL_MS, STALE_TAKEN_MS, MAX_DAYS, MAX_SERVE, MAX_FOUND };
