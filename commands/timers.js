// commands/timers.js
// /timers - Show current spawn timers, optionally filtered by zone

const { SlashCommandBuilder } = require('discord.js');
const bosses = require('../data/bosses.json');
const { getAllState } = require('../utils/state');
const { buildStatusEmbed } = require('../utils/embeds');

// Build zone choices from unique zone names in boss list
const zones = [...new Set(bosses.map((b) => b.zone))].sort();
const zoneChoices = zones.map((z) => ({ name: z, value: z }));

module.exports = {
  data: new SlashCommandBuilder()
    .setName('timers')
    .setDescription('Show all current raid boss spawn timers')
    .addStringOption((option) =>
      option
        .setName('zone')
        .setDescription('Filter to a specific zone')
        .setRequired(false)
        .addChoices(...zoneChoices)
    )
    .addStringOption((option) =>
      option
        .setName('filter')
        .setDescription('Filter by spawn status')
        .setRequired(false)
        .addChoices(
          { name: 'All bosses', value: 'all' },
          { name: 'Spawned / available now', value: 'spawned' },
          { name: 'Spawning within 2 hours', value: 'soon' },
          { name: 'Unknown (never recorded)', value: 'unknown' }
        )
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const filterZone = interaction.options.getString('zone');
    const filterStatus = interaction.options.getString('filter') || 'all';
    const state = getAllState();
    const now = Date.now();

    // Apply status filter
    let filteredBosses = bosses;
    if (filterZone) {
      filteredBosses = filteredBosses.filter((b) => b.zone === filterZone);
    }
    if (filterStatus === 'spawned') {
      filteredBosses = filteredBosses.filter((b) => {
        const entry = state[b.id];
        return entry && entry.nextSpawn <= now;
      });
    } else if (filterStatus === 'soon') {
      filteredBosses = filteredBosses.filter((b) => {
        const entry = state[b.id];
        if (!entry) return false;
        const remaining = entry.nextSpawn - now;
        return remaining > 0 && remaining < 2 * 60 * 60 * 1000;
      });
    } else if (filterStatus === 'unknown') {
      filteredBosses = filteredBosses.filter((b) => !state[b.id]);
    }

    if (filteredBosses.length === 0) {
      return interaction.editReply('No bosses matched your filter.');
    }

    const embed = buildStatusEmbed(filteredBosses, state, filterZone);
    await interaction.editReply({ embeds: [embed] });
  },
};
