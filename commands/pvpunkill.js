// commands/pvpunkill.js — Remove a PVP mob kill record.

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { hasAllowedRole, allowedRolesList } = require('../utils/roles');
const { clearPvpKill, getAllPvpKills } = require('../utils/state');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('pvpunkill')
    .setDescription('Remove a PVP mob kill record.')
    .addStringOption(opt => opt.setName('mob').setDescription('Mob name').setRequired(true).setAutocomplete(true)),

  async autocomplete(interaction) {
    const kills   = getAllPvpKills();
    const focused = interaction.options.getFocused().toLowerCase();
    const choices = Object.entries(kills)
      .filter(([, v]) => v.name.toLowerCase().includes(focused))
      .map(([key, v]) => ({ name: `${v.name} (${new Date(v.nextSpawn).toLocaleDateString()})`, value: key }));
    await interaction.respond(choices.slice(0, 25));
  },

  async execute(interaction) {
    if (!hasAllowedRole(interaction.member))
      return interaction.reply({ flags: MessageFlags.Ephemeral, content: `❌ You need one of these roles: ${allowedRolesList()}` });

    const key   = interaction.options.getString('mob');
    const kills = getAllPvpKills();
    const entry = kills[key];

    if (!entry) return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ No PVP kill found with that mob name.' });

    clearPvpKill(key);
    await interaction.reply({ flags: MessageFlags.Ephemeral, content: `↩️ PVP kill record removed for **${entry.name}**.` });
  },
};
