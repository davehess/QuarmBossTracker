// commands/backfillfunevents.js — /backfillfunevents [since] [dry_run]
//
// Officer command. Credits encounter-backed fun counters (currently Lord of
// Ire) from parse encounters when the live broadcast relay missed the kill
// (no agent online with the broadcast in its log — the 1am open-world gap).
//
// All dedup lives in the backfill_fun_events_from_encounters RPC: a kill already
// credited by the live relay, the historical manual backfill, or a previous run
// of this command is never double-counted (fight-window match + encounter_id
// link). Wipes and data_incomplete encounters are skipped. Safe to run anytime.
//
// dry_run shows the would-credit list without writing.
'use strict';

const { SlashCommandBuilder, MessageFlags, EmbedBuilder } = require('discord.js');
const { hasOfficerRole, officerRolesList } = require('../utils/roles');
const { parseTimeString } = require('../utils/timer');
const { reconcileFunEventsFromEncounters } = require('../utils/reconcileFunEvents');
const supabase = require('../utils/supabase');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('backfillfunevents')
    .setDescription('Officer: credit fun counters (Lord of Ire) from parse encounters the relay missed.')
    .addStringOption(opt =>
      opt.setName('since')
        .setDescription('How far back to scan (e.g. "30d", "72h"). Default: all time.')
        .setRequired(false)
    )
    .addBooleanOption(opt =>
      opt.setName('dry_run')
        .setDescription('Show what would be credited without writing.')
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
        content: '❌ Supabase isn\'t configured — `/backfillfunevents` reads from `encounters`.',
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const sinceRaw = interaction.options.getString('since') || null;
    const dryRun   = !!interaction.options.getBoolean('dry_run');
    const sinceMs  = sinceRaw ? parseTimeString(sinceRaw) : 0;
    if (sinceRaw && !sinceMs) {
      return interaction.editReply(`❌ Couldn't parse "${sinceRaw}". Try formats like \`30d\`, \`72h\`, or \`2 days\`.`);
    }

    let result;
    try {
      result = await reconcileFunEventsFromEncounters({ sinceMs, dryRun });
    } catch (err) {
      return interaction.editReply(`❌ Backfill failed: ${err?.message || err}`);
    }

    const scope = sinceRaw ? `last ${sinceRaw}` : 'all time';
    if (result.rows.length === 0) {
      return interaction.editReply(
        `Scanned encounters (${scope}) — nothing to credit. Every kill is already counted ` +
        `(live relay, manual backfill, or a prior run).`
      );
    }

    const verb  = dryRun ? 'Would credit' : 'Credited';
    const lines = result.rows.slice(0, 20).map(r => {
      const sec = Math.floor(new Date(r.event_ts).getTime() / 1000);
      return `• **${r.caster}** — <t:${sec}:f>`;
    });
    if (result.rows.length > 20) lines.push(`_…and ${result.rows.length - 20} more._`);

    const embed = new EmbedBuilder()
      .setColor(dryRun ? 0xf1c40f : 0x2ecc71)
      .setTitle(`${dryRun ? '🧪 ' : '✅ '}${verb} ${result.rows.length} fun event${result.rows.length === 1 ? '' : 's'}`)
      .setDescription(lines.join('\n'))
      .setFooter({ text: dryRun ? `Scope: ${scope} · run without dry_run to commit` : `Scope: ${scope}` });

    return interaction.editReply({ embeds: [embed] });
  },
};
