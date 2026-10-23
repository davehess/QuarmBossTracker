// utils/reconcileKills.js — rebuild raid-boss spawn timers from Supabase.
//
// Supabase `encounters` is the source of truth for "what did we kill and when"
// (every parse / agent upload lands there). The bot's local state.json timer
// board, by contrast, only advances when someone clicks /kill or an agent
// bosskill broadcast fires — so after a volume wipe (or when kills only ever
// came in as parses) the board shows everything "Available now" even though
// the kills are sitting in Supabase.
//
// This module reconciles the two: pull each tracked boss's newest encounter,
// and seed `nextSpawn = killedAt + timerHours`. It's the same
// logic /recoverkills runs by hand, factored out so it can also run
// automatically on startup + on an interval (self-healing boards).
//
// Non-destructive: it never downgrades a state row that already has an
// equal-or-later nextSpawn, and skips bosses that have already respawned.
//
// NOTE on kill-type classification (lockout → instance, none → live/open-world,
// pvp message → pvpkill): that distinction lives at INGEST time and selects
// which timer SYSTEM a kill feeds (raid board vs live vs pvp ±20%). This
// reconcile only rebuilds the raid-boss board from `encounters`, which are the
// instance/open-world combat kills — both use the boss's exact timerHours. The
// pvp/live-hate systems persist separately and aren't rebuilt here.
'use strict';

const fs   = require('fs');
const path = require('path');
const { EXPANSION_ORDER, getThreadId } = require('./config');
const {
  postOrUpdateExpansionBoard,
  refreshSummaryCard,
  refreshSpawningTomorrowCard,
  refreshThreadCooldownCard,
  mirrorBoardsToSupabase,
} = require('./killops');
const supabase = require('./supabase');

function getBosses() {
  delete require.cache[require.resolve('../data/bosses.json')];
  return require('../data/bosses.json');
}

function loadStateBosses() {
  const f = path.join(__dirname, '../data/state.json');
  try { return JSON.parse(fs.readFileSync(f, 'utf8'))?.bosses || {}; } catch { return {}; }
}

function writeKillsToState(killMap) {
  const f = path.join(__dirname, '../data/state.json');
  let raw;
  try { raw = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { raw = {}; }
  if (!raw.bosses) raw.bosses = {};
  for (const [bossId, entry] of Object.entries(killMap)) {
    raw.bosses[bossId] = { killedAt: entry.killedAt, nextSpawn: entry.nextSpawn, killedBy: 'recovered' };
  }
  const tmp = f + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(raw, null, 2), 'utf8');
  fs.renameSync(tmp, f);
}

// A sensible default look-back: at least as long as the longest boss timer (so
// a long-cooldown boss like Nagafen/Vox killed days ago is still recovered),
// plus a day of slack, capped at 21 days so the encounter scan stays bounded.
function defaultWindowMs(bosses) {
  const maxTimerH = bosses.reduce((m, b) => Math.max(m, b.timerHours || 0), 0);
  const hours = Math.min(21 * 24, Math.max(168, maxTimerH + 24));
  return hours * 3600000;
}

// Compute the recover list from Supabase encounters in [now - sinceMs, now].
// Returns { recoverList, skipped, scanned, bosses }. No writes.
async function computeRecoverList(sinceMs) {
  const now     = Date.now();
  const bosses   = getBosses();
  const bossById = Object.fromEntries(bosses.map(b => [b.id, b]));
  const windowMs = sinceMs || defaultWindowMs(bosses);
  const sinceTs  = new Date(now - windowMs).toISOString();

  const skipped = { notTracked: 0, noTimer: 0, alreadyRespawned: 0, alreadyCurrent: 0 };

  // Map npc_id → tracked boss internal_id via bosses_local. The tracked bosses come FIRST so the
  // encounter read below can be limited to them: `encounters` holds every named mob the guild has
  // killed (~790 a day since auto-registration), and PostgREST cuts any response at 1,000 rows, so an
  // unfiltered newest-first read reached back under a day and saw one of the 128 bosses.
  const trackedIds = bosses.map(b => b.id).filter(Boolean);
  const localRows = await supabase.select(
    'bosses_local',
    `internal_id=in.${encodeURIComponent('(' + trackedIds.join(',') + ')')}&select=internal_id,npc_id`,
  ).catch(() => []);
  const internalByNpc = new Map((Array.isArray(localRows) ? localRows : [])
    .filter(r => r.npc_id).map(r => [r.npc_id, r.internal_id]));
  if (internalByNpc.size === 0) return { recoverList: [], skipped, scanned: 0, bosses };

  // The newest encounter per tracked boss, one row each, so the answer cannot outgrow the cap.
  const encounters = await supabase.rpc('latest_kill_per_npc', {
    p_guild_id: process.env.SUPABASE_GUILD_ID || 'wolfpack',
    p_since:    sinceTs,
    p_npc_ids:  [...internalByNpc.keys()],
  }).catch(err => { console.warn('[reconcile] encounters select failed:', err?.message); return []; });

  if (!Array.isArray(encounters) || encounters.length === 0) {
    return { recoverList: [], skipped, scanned: 0, bosses };
  }

  const existing = loadStateBosses();
  const killMap  = {};
  for (const enc of encounters) {
    const bossId = internalByNpc.get(enc.npc_id);
    if (!bossId)            { skipped.notTracked++; continue; }
    const boss = bossById[bossId];
    if (!boss?.timerHours)  { skipped.noTimer++;    continue; }
    const killedAt  = new Date(enc.started_at).getTime();
    // A slow-mode kill runs 18h, not timerHours (utils/slowMode.js) — this rebuild bypasses recordKill.
    // Quarm is on the Plane of Time's fixed cycle instead (utils/potimeCycle.js): his timer is the cycle end.
    const nextSpawn = require('./potimeCycle').endForKill(bossId, killedAt)
      || killedAt + require('./slowMode').effectiveTimerHours(boss, boss.timerHours, killedAt) * 3600000;
    if (nextSpawn <= now)   { skipped.alreadyRespawned++; continue; }
    const live = existing[bossId];
    if (live?.nextSpawn && live.nextSpawn >= nextSpawn) { skipped.alreadyCurrent++; continue; }
    // One row per boss (latest_kill_per_npc), so this is already its latest kill.
    if (!killMap[bossId] || killMap[bossId].nextSpawn < nextSpawn) {
      killMap[bossId] = { killedAt, nextSpawn, bossName: boss.name, zone: boss.zone };
    }
  }
  const recoverList = Object.entries(killMap)
    .map(([bossId, k]) => ({ bossId, ...k }))
    .sort((a, b) => a.nextSpawn - b.nextSpawn);
  return { recoverList, skipped, scanned: encounters.length, bosses };
}

// Write the recovered timers to state, mirror bot_boards, and refresh Discord
// boards/cards (when a client is supplied — startup/interval pass one; a
// dry-run never reaches here).
async function applyRecover(client, recoverList, bosses) {
  writeKillsToState(Object.fromEntries(recoverList.map(r => [r.bossId, r])));
  try { await mirrorBoardsToSupabase(bosses); }
  catch (err) { console.warn('[reconcile] bot_boards mirror failed:', err?.message); }
  if (!client) return;
  const mainChannelId = process.env.TIMER_CHANNEL_ID;
  await Promise.allSettled(EXPANSION_ORDER.map(async (exp) => {
    const threadId = getThreadId(exp);
    if (!threadId) return;
    await postOrUpdateExpansionBoard(client, exp, threadId, bosses).catch(err => console.warn('[reconcile] board refresh failed:', err?.message));
    await refreshThreadCooldownCard(client, exp, threadId, bosses).catch(err => console.warn('[reconcile] thread cooldown failed:', err?.message));
  }));
  if (mainChannelId) {
    await refreshSummaryCard(client, mainChannelId, bosses).catch(err => console.warn('[reconcile] summary refresh failed:', err?.message));
    await refreshSpawningTomorrowCard(client, mainChannelId, bosses).catch(err => console.warn('[reconcile] spawning-tomorrow refresh failed:', err?.message));
  }
}

// High-level entry point. Used by /recoverkills (explicit window + client) and
// the startup/interval auto-reconcile (default full-timer window).
//   opts.client  — Discord client; when present, boards/cards are refreshed.
//   opts.sinceMs — look-back window; defaults to the longest boss timer + slack.
//   opts.dryRun  — compute only, never write.
async function reconcileKillsFromSupabase(opts = {}) {
  const { client = null, sinceMs = null, dryRun = false } = opts;
  if (!supabase.isEnabled()) return { ok: false, reason: 'supabase-disabled', recoverList: [], skipped: {}, scanned: 0 };
  const { recoverList, skipped, scanned } = await computeRecoverList(sinceMs);
  let applied = false;
  if (!dryRun && recoverList.length > 0) {
    const bosses = getBosses();
    await applyRecover(client, recoverList, bosses);
    applied = true;
  }
  return { ok: true, recoverList, skipped, scanned, applied };
}

// ── Engaged-encounter reconcile ─────────────────────────────────────────────
// The /parses "Engaged now" section keys on encounters.ended_at IS NULL, but
// nothing populated ended_at — so a fight whose slain line no agent happened to
// catch lingered as "ENGAGED" forever (the guild lead, 2026-06-29: "this looks like all
// of these mobs are still engaged"). The primary fix is at ingest (a
// confirmed_kill upload sets ended_at). This sweep keeps the section honest:
//
//   1. STALE → not currently engaged. Any engaged encounter whose fight ended
//      more than STALE_MIN ago is, by definition, not being fought right now —
//      clear it (set ended_at = fight-end). Agents only upload an encounter
//      AFTER it concludes (death or idle flush), so a row older than a few
//      minutes is over (The guild lead: "make all the engaged mobs no longer engaged
//      if they aren't currently engaged").
//   2. RECENT + loot evidence → register the kill early (before STALE_MIN)
//      when loot was posted for that npc AND there's no same-name ambiguity
//      (the guild lead's earlier rule). Mostly redundant with the confirmed_kill
//      ingest path, but covers a death no agent flagged.
//
// ended_at is set-once via the ended_at=is.null filter, so a precise death time
// from a confirmed upload is never overwritten by this estimate.
//
// A WIPE IS NOT A KILL (the guild lead, 2026-10-23, picked "the nightly cleanup leaves the end time
// off a wipe"): readers take `ended_at != null` to mean "the boss died" (raid review kills, the
// kill recap, latest_kill_per_npc timer recovery, the replay/timeline feeds), so stamping a wipe
// turned it into a phantom kill. This sweep therefore leaves ended_at NULL on a row that is a wipe:
//   · officer-marked — is_wipe, or classification 'wipe' (both paths below);
//   · or, on the STALE path only and for CURATED bosses only, total_damage under 90% of the boss's
//     catalog HP (a fight that never got the boss down). Loot posted for the boss is positive death evidence and outranks that
//     estimate, so the loot path ignores the damage rule. HP unknown → no estimate, stamp as before.
const ENGAGED_STALE_MIN = 12;   // fight concluded > this many min ago = not live
const WIPE_HP_FRACTION = 0.9;   // under this share of catalog HP, an unflagged fight is a wipe

/** True when the row is an officer-marked wipe (is_wipe, or classification 'wipe'). */
function isMarkedWipe(e) {
  return !!e && (e.is_wipe === true || e.classification === 'wipe');
}

/** True when the parsed damage is under WIPE_HP_FRACTION of the boss's catalog HP. Unknown HP → false. */
function fellShortOfBossHp(e) {
  const npc = Array.isArray(e && e.eqemu_npc_types) ? e.eqemu_npc_types[0] : (e && e.eqemu_npc_types);
  const hp = Number(npc && npc.hp);
  const dmg = Number(e && e.total_damage);
  return hp > 0 && Number.isFinite(dmg) && dmg < WIPE_HP_FRACTION * hp;
}

async function reconcileEngagedEncounters() {
  if (!supabase.isEnabled()) return { ok: false, promoted: 0, skippedWipes: 0 };
  const guildId = process.env.SUPABASE_GUILD_ID || 'wolfpack';
  const enc = encodeURIComponent;
  const now = Date.now();
  // Scope to the last 12h (the only window the web shows as "engaged" is 90min;
  // 12h gives slack for a late reconcile after an outage). Older rows were
  // backfilled once via SQL and don't render as engaged anyway.
  const sinceIso = new Date(now - 12 * 3600 * 1000).toISOString();
  const engaged = await supabase.select('encounters',
    `guild_id=eq.${enc(guildId)}&ended_at=is.null&total_damage=gt.0` +
    `&started_at=gte.${enc(sinceIso)}` +
    `&select=id,npc_id,started_at,duration_sec,total_damage,is_wipe,classification,eqemu_npc_types(hp)` +
    `&order=started_at.desc&limit=300`
  ).catch(err => { console.warn('[reconcile-engaged] select failed:', err?.message); return []; });
  if (!Array.isArray(engaged) || engaged.length === 0) return { ok: true, promoted: 0, skippedWipes: 0 };

  const staleBefore = now - ENGAGED_STALE_MIN * 60 * 1000;

  // The damage rule is for CURATED bosses only (bosses_local.auto_registered = false): the ~790 auto-registered
  // mobs a day are trash and uncurated nameds whose parses routinely under-count a real kill (a fifth of them
  // sit under 90% of catalog HP while the median is 1.02), so judging them by HP would leave real kills open.
  // One narrow read, only when some stale row is short of HP; a failed read leaves the set empty (old behaviour).
  const shortNpcIds = [...new Set(engaged
    .filter(e => e.npc_id && !isMarkedWipe(e) && fellShortOfBossHp(e)
      && (Date.parse(e.started_at) || 0) + (e.duration_sec || 0) * 1000 < staleBefore)
    .map(e => e.npc_id))];
  let curatedNpcIds = new Set();
  if (shortNpcIds.length) {
    const rows = await supabase.select('bosses_local',
      `auto_registered=eq.false&npc_id=in.(${shortNpcIds.join(',')})&select=npc_id&limit=300`
    ).catch(err => { console.warn('[reconcile-engaged] curated read failed:', err?.message); return []; });
    if (Array.isArray(rows)) curatedNpcIds = new Set(rows.map(r => r.npc_id));
  }

  let promoted = 0, skippedWipes = 0;
  for (const e of engaged) {
    if (!e.npc_id) continue;
    const startMs = Date.parse(e.started_at) || 0;
    if (!startMs) continue;
    if (isMarkedWipe(e)) { skippedWipes++; continue; }     // a wipe never gets an end time
    const fightEndMs = startMs + (e.duration_sec || 0) * 1000;
    let doSet = false;

    if (fightEndMs < staleBefore) {
      // (1) Concluded more than STALE_MIN ago — not currently engaged. Unless it never got the boss down.
      if (curatedNpcIds.has(e.npc_id) && fellShortOfBossHp(e)) { skippedWipes++; continue; }
      doSet = true;
    } else {
      // (2) Recent — only register early with positive death evidence (loot)
      //     and no same-name ambiguity.
      const wStart = new Date(startMs - 30 * 60 * 1000).toISOString();
      const wEnd   = new Date(startMs + 30 * 60 * 1000).toISOString();
      const sibs = await supabase.select('encounters',
        `guild_id=eq.${enc(guildId)}&npc_id=eq.${e.npc_id}` +
        `&started_at=gte.${enc(wStart)}&started_at=lte.${enc(wEnd)}&select=id&limit=3`
      ).catch(() => []);
      if (Array.isArray(sibs) && sibs.length > 1) continue;   // ambiguous — skip
      const lStart = new Date(startMs - 2 * 3600 * 1000).toISOString();
      const lEnd   = new Date(startMs + 6 * 3600 * 1000).toISOString();
      const loot = await supabase.select('loot_observations',
        `guild_id=eq.${enc(guildId)}&npc_id=eq.${e.npc_id}` +
        `&posted_at=gte.${enc(lStart)}&posted_at=lte.${enc(lEnd)}&select=id&limit=1`
      ).catch(() => []);
      doSet = Array.isArray(loot) && loot.length > 0;
    }
    if (!doSet) continue;
    const endedIso = new Date(fightEndMs).toISOString();
    await supabase.update('encounters',
      `id=eq.${enc(e.id)}&ended_at=is.null`,
      { ended_at: endedIso }
    ).catch(err => { console.warn('[reconcile-engaged] update failed:', err?.message); });
    promoted++;
  }
  if (promoted) console.log(`[reconcile-engaged] marked ${promoted} encounter(s) no-longer-engaged (stale or loot-confirmed)`);
  return { ok: true, promoted, skippedWipes };
}

module.exports = { reconcileKillsFromSupabase, reconcileEngagedEncounters, isMarkedWipe, fellShortOfBossHp };
