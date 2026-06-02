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
const { hasOfficerRole, officerRolesList } = require('../utils/roles');
const { parseTimeString } = require('../utils/timer');
const { reconcileKillsFromSupabase } = require('../utils/reconcileKills');
const supabase = require('../utils/supabase');

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

    // Compute + (unless dry-run) apply via the shared reconcile, so the manual
    // command and the startup/interval auto-reconcile can't drift apart.
    const { recoverList, skipped, scanned } = await reconcileKillsFromSupabase({
      client: interaction.client,
      sinceMs: windowMs,
      dryRun,
    });

    if (recoverList.length === 0) {
      return interaction.editReply(
        `Looked at **${scanned}** encounters since ${sinceRaw}, nothing to recover.\n` +
        `• Already-respawned: ${skipped.alreadyRespawned || 0}\n` +
        `• Already-current in state: ${skipped.alreadyCurrent || 0}\n` +
        `• Not tracked (no bosses_local mapping): ${skipped.notTracked || 0}\n` +
        `• No timerHours configured: ${skipped.noTimer || 0}`
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
        `Looked back ${sinceRaw} · ${scanned} encounters scanned · ` +
        `${skipped.alreadyRespawned} already respawned, ${skipped.alreadyCurrent} already current, ` +
        `${skipped.notTracked} untracked, ${skipped.noTimer} no-timer`
      });

    return interaction.editReply({ embeds: [summary] });
  },
};
