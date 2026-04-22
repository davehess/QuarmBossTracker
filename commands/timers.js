// commands/timers.js
const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const bosses = require('../data/bosses.json');
const { getAllState } = require('../utils/state');
const { buildStatusEmbed } = require('../utils/embeds');

const zones = [...new Set(bosses.map((b) => b.zone))].sort();
const zoneChoices = zones.map((z) => ({ name: z, value: z }));

module.exports = {
  data: new SlashCommandBuilder()
    .setName('timers')
    .setDescription('Show all current raid boss spawn timers')
    .addStringOption((opt) =>
      opt.setName('zone').setDescription('Filter to a specific zone').setRequired(false).addChoices(...zoneChoices.slice(0, 25))
    )
    .addStringOption((opt) =>
      opt.setName('filter').setDescription('Filter by spawn status').setRequired(false)
        .addChoices(
          { name: 'All bosses', value: 'all' },
          { name: 'Spawned / available now', value: 'spawned' },
          { name: 'Spawning within 2 hours', value: 'soon' },
          { name: 'Unknown (never recorded)', value: 'unknown' }
        )
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const filterZone   = interaction.options.getString('zone');
    const filterStatus = interaction.options.getString('filter') || 'all';
    const state = getAllState();
    const now   = Date.now();

    let filtered = bosses;
    if (filterZone) filtered = filtered.filter((b) => b.zone === filterZone);
    if (filterStatus === 'spawned') filtered = filtered.filter((b) => { const e = state[b.id]; return e && e.nextSpawn <= now; });
    else if (filterStatus === 'soon') filtered = filtered.filter((b) => { const e = state[b.id]; if (!e) return false; const r = e.nextSpawn - now; return r > 0 && r < 2 * 3600000; });
    else if (filterStatus === 'unknown') filtered = filtered.filter((b) => !state[b.id]);

    if (filtered.length === 0) return interaction.editReply('No bosses matched your filter.');

    const embed = buildStatusEmbed(filtered, state, filterZone);
    await interaction.editReply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
