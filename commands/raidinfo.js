// commands/raidinfo.js — post tonight's raid info to the raid channel on
// demand. The same embed the bot posts automatically at midday on raid days
// (Hitya 2026-08-21: "post the raid info midday to our channel").
const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { hasAllowedRole, allowedRolesList } = require('../utils/roles');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('raidinfo')
    .setDescription('Post tonight\'s raid info (muster, leads, signups, classes wanted) to the raid channel.'),

  async execute(interaction) {
    if (!hasAllowedRole(interaction.member)) {
      return interaction.reply({ flags: MessageFlags.Ephemeral,
        content: `❌ You need one of these roles: ${allowedRolesList()}` });
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const { postMiddayRaidInfo } = require('./preraid');
    const res = await postMiddayRaidInfo(interaction.client).catch(err => ({ ok: false, reason: err?.message }));
    return interaction.editReply(res.ok ? '✅ Posted the raid info.' : `❌ ${res.reason || 'failed'}`);
  },
};
