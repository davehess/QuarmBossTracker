// commands/recoverkills.js — /recoverkills [since] [dry_run]
//
// Officer command. Rebuilds state.json kill timers from Supabase encounters
// when the live state was lost (volume wipe, missed updates) or got out of
// sync (e.g. the bug where agent re-runs are tagged backfill=true and so
// don't trigger the auto-`recordKill` path in /api/agent/encounter).
//
// Strategy:
//   1. Pull every encounter in [now - since, now] (default 72h).
//   2. Join each encounter.npc_id to bosses_local.internal_id → bosses.json
//      timerHours so we can compute nextSpawn.
//   3. For each (boss, encounter pair): nextSpawn = started_at + timerHours.
//      Skip if nextSpawn <= now (boss is back up already; nothing to recover).
//      Skip if state already has a >= nextSpawn entry for that boss.
//   4. Write merged map to state.json, mirror to Supabase bot_boards, and
//      refresh every expansion board / cooldown card / summary so Discord
//      catches up immediately.
//
// dry_run shows the would-recover list without writing anything — handy if
// you want to sanity-check before committing.
'use strict';

const { SlashCommandBuilder, MessageFlags, EmbedBuilder } = require('discord.js');
const fs   = require('fs');
const path = require('path');
const { hasOfficerRole, officerRolesList } = require('../utils/roles');
const { EXPANSION_ORDER, getThreadId } = require('../utils/config');
const { parseTimeString } = require('../utils/timer');
const {
  postOrUpdateExpansionBoard,
  refreshSummaryCard,
  refreshSpawningTomorrowCard,
  refreshThreadCooldownCard,
  mirrorBoardsToSupabase,
} = require('../utils/killops');
const supabase = require('../utils/supabase');

function getBosses() {
  delete require.cache[require.resolve('../data/bosses.json')];
  return require('../data/bosses.json');
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

function loadStateBosses() {
  const f = path.join(__dirname, '../data/state.json');
  try { return JSON.parse(fs.readFileSync(f, 'utf8'))?.bosses || {}; } catch { return {}; }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('recoverkills')
    .setDescription('Officer: rebuild kill timers from Supabase encounters in the given window.')
    .addStringOption(opt =>
      opt.setName('since')
        .setDescription('How far back to look (e.g. "72h", "3d", "2 days"). Default: 72h.')
        .setRequired(false)
    )
    .addBooleanOption(opt =>
      opt.setName('dry_run')
        .setDescription('Show what would be recovered without writing to state.')
        .setRequired(false)
    ),

  async execute(interaction) {
    if (!hasOfficerRole(interaction.member)) {
      return interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: `❌ Officers only (one of: ${officerRolesList()}).`,
      });
    }
    if (!supabase.isEnabled()) {
      return interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: '❌ Supabase isn\'t configured — `/recoverkills` reads from `encounters`.',
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const sinceRaw = interaction.options.getString('since') || '72h';
    const dryRun   = !!interaction.options.getBoolean('dry_run');
    const windowMs = parseTimeString(sinceRaw);
    if (!windowMs) {
      return interaction.editReply(`❌ Couldn't parse "${sinceRaw}". Try formats like \`72h\`, \`3d\`, or \`2 days\`.`);
    }

    const now     = Date.now();
    const sinceTs = new Date(now - windowMs).toISOString();
    const bosses  = getBosses();
    const bossById = Object.fromEntries(bosses.map(b => [b.id, b]));

    // Pull every encounter in the window. The bot writes encounters with
    // started_at = the kill time, which is what we use to seed killedAt.
    const encounters = await supabase.select(
      'encounters',
      `started_at=gte.${encodeURIComponent(sinceTs)}&select=id,npc_id,started_at,zone_short&order=started_at.desc&limit=500`,
    ).catch(err => { console.warn('[recoverkills] encounters select failed:', err?.message); return []; });
    if (!Array.isArray(encounters) || encounters.length === 0) {
      return interaction.editReply(`No encounters found since ${sinceRaw}. Nothing to recover.`);
    }

    // Map npc_id → internal_id via bosses_local so we can pick a tracked boss.
    const npcIds = Array.from(new Set(encounters.map(e => e.npc_id).filter(Boolean)));
    const inList = '(' + npcIds.join(',') + ')';
    const localRows = await supabase.select(
      'bosses_local',
      `npc_id=in.${encodeURIComponent(inList)}&select=internal_id,npc_id`,
    ).catch(() => []);
    const internalByNpc = new Map((Array.isArray(localRows) ? localRows : []).map(r => [r.npc_id, r.internal_id]));

    // Build the kill map. Latest started_at per boss wins.
    const existing = loadStateBosses();
    const killMap  = {};
    const skipped  = { notTracked: 0, noTimer: 0, alreadyRespawned: 0, alreadyCurrent: 0 };
    for (const enc of encounters) {
      const bossId = internalByNpc.get(enc.npc_id);
      if (!bossId)             { skipped.notTracked++; continue; }
      const boss = bossById[bossId];
      if (!boss?.timerHours)   { skipped.noTimer++;    continue; }
      const killedAt  = new Date(enc.started_at).getTime();
      const nextSpawn = killedAt + boss.timerHours * 3600000;
      if (nextSpawn <= now)    { skipped.alreadyRespawned++; continue; }
      // Don't downgrade a state row that's already at/past this encounter.
      const live = existing[bossId];
      if (live?.nextSpawn && live.nextSpawn >= nextSpawn) { skipped.alreadyCurrent++; continue; }
      // Latest started_at wins (encounters were ordered desc, so the first
      // hit for a boss is its latest kill).
      if (!killMap[bossId] || killMap[bossId].nextSpawn < nextSpawn) {
        killMap[bossId] = { killedAt, nextSpawn, bossName: boss.name, zone: boss.zone };
      }
    }
    const recoverList = Object.entries(killMap)
      .map(([bossId, k]) => ({ bossId, ...k }))
      .sort((a, b) => a.nextSpawn - b.nextSpawn);

    if (recoverList.length === 0) {
      return interaction.editReply(
        `Looked at **${encounters.length}** encounters since ${sinceRaw}, nothing to recover.\n` +
        `• Already-respawned: ${skipped.alreadyRespawned}\n` +
        `• Already-current in state: ${skipped.alreadyCurrent}\n` +
        `• Not tracked (no bosses_local mapping): ${skipped.notTracked}\n` +
        `• No timerHours configured: ${skipped.noTimer}`
      );
    }

    if (dryRun) {
      const lines = recoverList.slice(0, 25).map(r => {
        const respawnSec = Math.max(0, Math.floor(r.nextSpawn / 1000));
        return `• **${r.bossName}** _(${r.zone})_ — respawn <t:${respawnSec}:R>`;
      });
      if (recoverList.length > 25) lines.push(`_…and ${recoverList.length - 25} more._`);
      return interaction.editReply(
        `🧪 **Dry run** — would recover **${recoverList.length}** boss timer${recoverList.length === 1 ? '' : 's'}:\n` +
        lines.join('\n') +
        `\n\nRun without \`dry_run\` to commit.`
      );
    }

    // Commit: write state + mirror + refresh every board.
    writeKillsToState(Object.fromEntries(recoverList.map(r => [r.bossId, r])));
    try { await mirrorBoardsToSupabase(bosses); }
    catch (err) { console.warn('[recoverkills] bot_boards mirror failed:', err?.message); }

    const client        = interaction.client;
    const mainChannelId = process.env.TIMER_CHANNEL_ID;
    await Promise.allSettled(EXPANSION_ORDER.map(async (exp) => {
      const threadId = getThreadId(exp);
      if (!threadId) return;
      await postOrUpdateExpansionBoard(client, exp, threadId, bosses).catch(err => console.warn('[recoverkills] board refresh failed:', err?.message));
      await refreshThreadCooldownCard(client, exp, threadId, bosses).catch(err => console.warn('[recoverkills] thread cooldown failed:', err?.message));
    }));
    if (mainChannelId) {
      await refreshSummaryCard(client, mainChannelId, bosses).catch(err => console.warn('[recoverkills] summary refresh failed:', err?.message));
      await refreshSpawningTomorrowCard(client, mainChannelId, bosses).catch(err => console.warn('[recoverkills] spawning-tomorrow refresh failed:', err?.message));
    }

    const lines = recoverList.slice(0, 12).map(r => {
      const respawnSec = Math.max(0, Math.floor(r.nextSpawn / 1000));
      return `• **${r.bossName}** _(${r.zone})_ — respawn <t:${respawnSec}:R>`;
    });
    if (recoverList.length > 12) lines.push(`_…and ${recoverList.length - 12} more._`);

    const summary = new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle(`✅ Recovered ${recoverList.length} boss timer${recoverList.length === 1 ? '' : 's'}`)
      .setDescription(lines.join('\n'))
      .setFooter({ text:
        `Looked back ${sinceRaw} · ${encounters.length} encounters scanned · ` +
        `${skipped.alreadyRespawned} already respawned, ${skipped.alreadyCurrent} already current, ` +
        `${skipped.notTracked} untracked, ${skipped.noTimer} no-timer`
      });

    return interaction.editReply({ embeds: [summary] });
  },
};
