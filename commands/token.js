// commands/token.js — Show the current Wolf Pack Parser agent token to guild members.
// Value comes from WOLFPACK_AGENT_TOKEN env var (set on Railway). Ephemeral reply.

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { hasAllowedRole, allowedRolesList } = require('../utils/roles');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('token')
    .setDescription('Show the current Wolf Pack Parser agent token (ephemeral)'),

  async execute(interaction) {
    if (!hasAllowedRole(interaction.member)) {
      return interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: `❌ Guild members only. Required roles: ${allowedRolesList()}`,
      });
    }

    const token = process.env.WOLFPACK_AGENT_TOKEN;
    if (!token) {
      return interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: '⚠️ `WOLFPACK_AGENT_TOKEN` is not set on Railway.',
      });
    }

    return interaction.reply({
      flags: MessageFlags.Ephemeral,
      content: `\`\`\`${token}\`\`\``,
    });
  },
};
