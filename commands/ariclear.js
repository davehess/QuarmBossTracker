// commands/ariclear.js — Clear the current auto-raid invite (officers only).

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { hasOfficerRole, officerRolesList } = require('../utils/roles');
const { clearAri } = require('../utils/state');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ariclear')
    .setDescription('Clear the current auto-raid invite (officers only)'),

  async execute(interaction) {
    if (!hasOfficerRole(interaction.member)) {
      return interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: `❌ Only officers can clear the ARI. Required roles: ${officerRolesList()}`,
      });
    }

    clearAri();
    return interaction.reply({
      flags: MessageFlags.Ephemeral,
      content: '✅ Auto-raid invite cleared.',
    });
  },
};
