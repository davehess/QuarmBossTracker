// commands/syncopendkp.js — Officer-only manual OpenDKP → Supabase resync.
const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { hasOfficerRole, officerRolesList } = require('../utils/roles');
const { runSync } = require('../utils/openDkpSync');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('syncopendkp')
    .setDescription('Force a full OpenDKP → Supabase mirror sync (officers only)')
    .addBooleanOption(o => o.setName('full')
      .setDescription('Force re-fetch detail for every raid, not just new/stale').setRequired(false)),

  async execute(interaction) {
    if (!hasOfficerRole(interaction.member)) {
      return interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: `❌ Only officers can sync OpenDKP. Required roles: ${officerRolesList()}`,
      });
    }
    const full = interaction.options.getBoolean('full') ?? false;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const t0 = Date.now();
    const res = await runSync({ full }).catch(err => ({ error: err?.message || String(err) }));
    const took = ((Date.now() - t0) / 1000).toFixed(1);

    if (res.error) {
      return interaction.editReply(`❌ OpenDKP sync failed at ${res.phase || '?'}: ${res.error}`);
    }
    return interaction.editReply([
      `✅ OpenDKP sync done in ${took}s.`,
      `• Raids fetched: **${res.raids_fetched}** (upserted ${res.raids_upserted})`,
      `• Detail synced: **${res.detail_synced}** raid(s)${res.detail_errors ? ` — ${res.detail_errors} errored (see logs)` : ''}`,
      `• Ticks written: ${res.tick_rows_written}`,
      `• Loot rows written: ${res.loot_rows_written}`,
      full ? '• Mode: full re-sync (every raid)' : '• Mode: incremental (new + version-bumped only)',
    ].join('\n'));
  },
};
