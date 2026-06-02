// utils/reconcileKills.js — rebuild raid-boss spawn timers from Supabase.
//
// Supabase `encounters` is the source of truth for "what did we kill and when"
// (every parse / agent upload lands there). The bot's local state.json timer
// board, by contrast, only advances when someone clicks /kill or an agent
// bosskill broadcast fires — so after a volume wipe (or when kills only ever
// came in as parses) the board shows everything "Available now" even though
// the kills are sitting in Supabase.
//
// This module reconciles the two: pull recent encounters, map each to a
// tracked boss, and seed `nextSpawn = killedAt + timerHours`. It's the same
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

  const encounters = await supabase.select(
    'encounters',
    `started_at=gte.${encodeURIComponent(sinceTs)}&select=id,npc_id,started_at,zone_short&order=started_at.desc&limit=1000`,
  ).catch(err => { console.warn('[reconcile] encounters select failed:', err?.message); return []; });

  const skipped = { notTracked: 0, noTimer: 0, alreadyRespawned: 0, alreadyCurrent: 0 };
  if (!Array.isArray(encounters) || encounters.length === 0) {
    return { recoverList: [], skipped, scanned: 0, bosses };
  }

  // Map npc_id → tracked boss internal_id via bosses_local.
  const npcIds = Array.from(new Set(encounters.map(e => e.npc_id).filter(Boolean)));
  const inList = '(' + npcIds.join(',') + ')';
  const localRows = await supabase.select(
    'bosses_local',
    `npc_id=in.${encodeURIComponent(inList)}&select=internal_id,npc_id`,
  ).catch(() => []);
  const internalByNpc = new Map((Array.isArray(localRows) ? localRows : []).map(r => [r.npc_id, r.internal_id]));

  const existing = loadStateBosses();
  const killMap  = {};
  for (const enc of encounters) {
    const bossId = internalByNpc.get(enc.npc_id);
    if (!bossId)            { skipped.notTracked++; continue; }
    const boss = bossById[bossId];
    if (!boss?.timerHours)  { skipped.noTimer++;    continue; }
    const killedAt  = new Date(enc.started_at).getTime();
    const nextSpawn = killedAt + boss.timerHours * 3600000;
    if (nextSpawn <= now)   { skipped.alreadyRespawned++; continue; }
    const live = existing[bossId];
    if (live?.nextSpawn && live.nextSpawn >= nextSpawn) { skipped.alreadyCurrent++; continue; }
    // encounters are ordered desc, so the first hit for a boss is its latest kill.
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

module.exports = { reconcileKillsFromSupabase };
