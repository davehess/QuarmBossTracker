// utils/hubSync.js — the free tier: PoP flags for a player OUTSIDE Wolf Pack (the guild lead, 2026-11-02, DECISIONS
// §526/§527: "we need to build that ASAP"; docs/DESIGN-raidmimic-hosted.md §8e: what costs us money is what we charge for).
//
// A session that is linked to a hub guild, or to no guild at all (scope 'player'), uploads its flags here and ONLY here.
// index.js's _handleAgentPopFlags hands the request over right after requireAgentAuth, before any Wolf Pack write, so
// nothing in this file may reach a Wolf Pack surface: no kill, no lockout, no guild flag table, no upload stats, no Discord.
// It writes two person-scoped tables (supabase/migrations/20261102210000_hub_sync.sql): hub_characters (who holds which
// character name) and hub_flags (what each of them has earned). They carry no guild_id on purpose: a flag belongs to
// the person, so a player who moves guilds takes their flags along.
//
// The flag parsing is the Wolf Pack handler's, not a copy of its tables: the stage rules come from utils/popFlagStages.js
// and the boss map and key function are handed in by index.js (they live there). test/hub-sync.test.js runs both
// handlers over the same events and fails if they disagree on a flag.
'use strict';

const MAX_BODY_BYTES = 256 * 1024;   // the Wolf Pack handler's limit
const MAX_NAMES      = 40;           // distinct characters per request (the Wolf Pack handler's)
const MAX_ROWS       = 2000;         // flag rows per request
const FUTURE_SLACK_MS = 24 * 3600_000;   // a flag "earned" more than a day from now is a bad clock, not a flag
// An EverQuest character name is letters only. Holding to that also makes it safe to put in a query string.
const NAME_RX = /^[A-Za-z]{3,24}$/;

// ── the claim rule (pure) ────────────────────────────────────────────────────────────────────────────────────────
// An upload as character X from a player session CLAIMS X for that player (proof 'claimed'), except:
//   - Wolf Pack's characters table links X to a Discord id that is not this player's: refused, nothing is stored. Those
//     characters are Wolf Pack members' and are served on Wolf Pack's own surfaces.
//   - another player already holds X as 'proven': refused (the proof outranks a claim).
//   - another player already holds X as 'claimed' or 'contested': both are 'contested' and the rows are stored. A contested
//     character is later hidden from feeds until it is settled.
// A row never goes DOWN: proven stays proven, contested stays contested.
//   wolfpackDiscordId  the Discord id Wolf Pack's characters table gives X ('' / null / undefined = not linked)
//   holders            every hub_characters row for X: [{ player_id, proof }]
// Returns { verdict: 'refused', reason } or { verdict: 'claimed' | 'contested', proof } (the proof the row must carry).
function decideClaim({ playerId, discordId, wolfpackDiscordId, holders }) {
  const wolfpack = wolfpackDiscordId ? String(wolfpackDiscordId) : '';
  if (wolfpack && wolfpack !== String(discordId || '')) return { verdict: 'refused', reason: 'wolfpack_linked' };
  const rows = Array.isArray(holders) ? holders : [];
  const others = rows.filter(h => h && h.player_id !== playerId);
  const mine = rows.find(h => h && h.player_id === playerId);
  if (mine && mine.proof === 'proven') return { verdict: 'claimed', proof: 'proven' };
  if (others.some(h => h.proof === 'proven')) return { verdict: 'refused', reason: 'held_by_other' };
  if (others.length) return { verdict: 'contested', proof: 'contested' };
  if (mine) return { verdict: mine.proof === 'contested' ? 'contested' : 'claimed', proof: mine.proof || 'claimed' };
  return { verdict: 'claimed', proof: 'claimed' };
}

// ── events → flag rows (pure) ────────────────────────────────────────────────────────────────────────────────────
// The same reading as _handleAgentPopFlags: popflags steps, then the server's own step (resolveStage), then what each
// step proves in the catalog's terms (STAGE_IMPLIES), then the boss map for anything the step tables do not name. A witnessed
// hail is evidence about someone else and is not a flag: dropped here. An event the tables do not know is dropped, not
// stored as 'unmapped' (a free player's funnel is not worth a row).
// deps: { popFlagStages, bossFlagMap, bossKey }. Returns { rows, names }: the rows keyed by character, in the order read.
function flagRowsFromEvents(events, deps, nowMs = Date.now()) {
  const { popFlagStages: S, bossFlagMap, bossKey } = deps;
  const rows = [];
  const seen = new Set();
  const push = (e, ts, flagKey, source, stage) => {
    const nameLc = String(e.character).trim().toLowerCase();
    const key = `${nameLc}|${flagKey}|${ts}`;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({ character: String(e.character).trim(), name_lc: nameLc, flag_key: flagKey, stage: stage || null, source, earned_at: ts });
  };
  for (const e of Array.isArray(events) ? events : []) {
    if (!e || typeof e !== 'object' || !e.character || !e.ts) continue;
    if (e.source === 'hail_witnessed') continue;
    if (!NAME_RX.test(String(e.character).trim())) continue;
    const when = new Date(e.ts);
    if (isNaN(when.getTime()) || when.getTime() > nowMs + FUTURE_SLACK_MS) continue;
    const iso = when.toISOString();
    if (e.source === 'popflags') {
      for (const st of (Array.isArray(e.stages) ? e.stages.slice(0, 16) : [])) {
        if (!S.POPFLAGS_KEYS.has(st)) continue;
        push(e, iso, st, 'popflags', st);
        for (const k of S.STAGE_IMPLIES[st] || []) push(e, iso, k, 'popflags', st);
      }
      continue;
    }
    const bossLower = bossKey(e.boss);
    const hit = S.resolveStage(e, bossLower);
    const source = e.kind === 'recital' ? 'recital' : (e.kind === 'checklist' ? 'checklist'
      : (hit && hit.via === 'trial' && !hit.fresh ? 'credit' : 'event'));
    if (hit) {
      push(e, iso, hit.stage, source, hit.stage);
      for (const k of S.STAGE_IMPLIES[hit.stage] || []) push(e, iso, k, source, hit.stage);
      continue;
    }
    if (e.kind === 'recital' || e.kind === 'trial') continue;
    const mapped = bossFlagMap[bossLower];
    if (mapped) push(e, iso, mapped, source, null);
  }
  return rows.slice(0, MAX_ROWS);
}

const _q = (s) => encodeURIComponent(String(s));

// ── the upload ────────────────────────────────────────────────────────────────────────────────────────────────────
// handlePopFlags(identity, body, deps) → { status, body } so the route and the tests share one path.
//   identity  the resolved session: { discord_id, player_id? } (a player session or a hub-guild session)
//   body      the parsed JSON: { events: [...] }
//   deps      { supabase, popFlagStages, bossFlagMap, bossKey }
// Answers { ok, stored, refused } on 200: stored = flag rows newly written, refused = the character names whose rows were not
// stored. A failed read or write answers 503 (the agent's queue retries it); a 4xx would be dropped as permanent.
async function handlePopFlags(identity, body, deps) {
  const { supabase } = deps;
  const events = Array.isArray(body && body.events) ? body.events : [];
  if (events.length === 0) return { status: 200, body: { ok: true, stored: 0, refused: [] } };
  const retry = (error) => ({ status: 503, body: { error, retry: true } });

  const flagRows = flagRowsFromEvents(events, deps);
  if (flagRows.length === 0) return { status: 200, body: { ok: true, stored: 0, refused: [] } };
  const first = new Map();   // name_lc → the spelling it was first sent with
  for (const r of flagRows) if (!first.has(r.name_lc)) first.set(r.name_lc, r.character);
  const names = [...first.entries()].slice(0, MAX_NAMES);   // [name_lc, name]
  const lcs = names.map(([lc]) => lc);

  // Who is uploading, as a hub player. A session minted by an earlier read carries it; a kept-over one does not.
  let playerId = identity && identity.player_id;
  if (!playerId) {
    const p = await supabase.select('hub_players', `discord_id=eq.${_q(identity && identity.discord_id)}&select=player_id,deleted_at&limit=1`).catch(() => null);
    if (!Array.isArray(p)) return retry('store_unavailable');
    if (!p[0] || p[0].deleted_at) return { status: 403, body: { error: 'no_player' } };
    playerId = p[0].player_id;
  }
  const discordId = String((identity && identity.discord_id) || '');

  // Wolf Pack's side of the rule: which of these names it links to someone. Scoped to its own guild.
  const wp = await supabase.select('characters',
    `guild_id=eq.${encodeURIComponent(supabase.guildId())}&or=(${lcs.map(lc => `name.ilike.${lc}`).join(',')})&select=name,discord_id&limit=500`).catch(() => null);
  if (!Array.isArray(wp)) return retry('store_unavailable');
  const wpOwner = new Map();
  for (const r of wp) {
    const lc = String(r && r.name || '').toLowerCase();
    if (lc && r.discord_id && !wpOwner.has(lc)) wpOwner.set(lc, String(r.discord_id));
  }
  // The hub's side: who already holds them.
  const held = await supabase.select('hub_characters',
    `name_lc=in.(${lcs.join(',')})&select=player_id,name_lc,proof&limit=1000`).catch(() => null);
  if (!Array.isArray(held)) return retry('store_unavailable');
  const holdersOf = new Map();
  for (const h of held) {
    if (!holdersOf.has(h.name_lc)) holdersOf.set(h.name_lc, []);
    holdersOf.get(h.name_lc).push(h);
  }

  const verdicts = new Map();   // name_lc → decideClaim result
  const refused = [];
  for (const [lc, name] of names) {
    const v = decideClaim({ playerId, discordId, wolfpackDiscordId: wpOwner.get(lc), holders: holdersOf.get(lc) });
    verdicts.set(lc, v);
    if (v.verdict === 'refused') refused.push(name);
  }
  const live = names.filter(([lc]) => verdicts.get(lc).verdict !== 'refused');

  if (live.length) {
    const now = new Date().toISOString();
    const mine = new Set(live.filter(([lc]) => (holdersOf.get(lc) || []).some(h => h.player_id === playerId)).map(([lc]) => lc));
    const fresh = live.filter(([lc]) => !mine.has(lc));
    if (fresh.length) {
      const ins = await supabase.insertIgnoreDuplicates('hub_characters',
        fresh.map(([lc, name]) => ({ player_id: playerId, name, name_lc: lc, proof: verdicts.get(lc).proof, first_seen_at: now, last_seen_at: now })),
        { representation: true });
      if (!Array.isArray(ins)) return retry('store_unavailable');
    }
    if (mine.size) {
      const upd = await supabase.update('hub_characters', `player_id=eq.${_q(playerId)}&name_lc=in.(${[...mine].join(',')})`, { last_seen_at: now });
      if (upd === null) return retry('store_unavailable');
    }
    // Everyone who holds a name that is now contested is contested (never a proven row).
    const clash = live.filter(([lc]) => verdicts.get(lc).verdict === 'contested').map(([lc]) => lc);
    if (clash.length) {
      const flip = await supabase.update('hub_characters', `name_lc=in.(${clash.join(',')})&proof=eq.claimed`, { proof: 'contested' });
      if (flip === null) return retry('store_unavailable');
    }
  }

  const liveSet = new Set(live.map(([lc]) => lc));
  const rows = flagRows.filter(r => liveSet.has(r.name_lc)).map(r => ({ player_id: playerId, ...r }));
  let stored = 0;
  if (rows.length) {
    const inserted = await supabase.insertIgnoreDuplicates('hub_flags', rows, { representation: true });
    if (!Array.isArray(inserted)) return retry('store_unavailable');
    stored = inserted.length;
  }
  return { status: 200, body: { ok: true, stored, refused } };
}

// The route's wrapper: read the body (same limits as the Wolf Pack handler), run handlePopFlags, answer.
async function handleRequest(req, res, identity, deps) {
  const json = { 'Content-Type': 'application/json' };
  const chunks = []; let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) { res.writeHead(413); return res.end(); }
    chunks.push(chunk);
  }
  let payload;
  try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { res.writeHead(400); return res.end(JSON.stringify({ error: 'invalid JSON' })); }
  let out;
  try { out = await handlePopFlags(identity, payload, deps); }
  catch (err) {
    console.warn('[hub-sync] pop_flags failed:', err && err.message);
    out = { status: 503, body: { error: 'store_unavailable', retry: true } };
  }
  res.writeHead(out.status, json);
  return res.end(JSON.stringify(out.body));
}

module.exports = { decideClaim, flagRowsFromEvents, handlePopFlags, handleRequest, NAME_RX, MAX_BODY_BYTES };
