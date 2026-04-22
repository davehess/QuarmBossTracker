// commands/unkill.js

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const bosses = require('../data/bosses.json');
const { clearKill, getBossState, getBoardMessages, getAllState } = require('../utils/state');
const { buildBoardPanels } = require('../utils/board');
const { hasAllowedRole, allowedRolesList } = require('../utils/roles');

const bossChoices = bosses.map((b) => ({ name: `${b.name} (${b.zone})`, value: b.id }));

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unkill')
    .setDescription('Clear a boss kill record (undo a /kill)')
    .addStringOption((opt) =>
      opt.setName('boss').setDescription('Which boss kill to clear?').setRequired(true).setAutocomplete(true)
    ),

  async autocomplete(interaction) {
    const focused  = interaction.options.getFocused().toLowerCase();
    const filtered = bossChoices
      .filter((c) => c.name.toLowerCase().includes(focused))
      .slice(0, 25);
    await interaction.respond(filtered);
  },

  async execute(interaction) {
    if (!hasAllowedRole(interaction.member)) {
      return interaction.reply({
        content: `❌ You need one of these roles to clear kills: ${allowedRolesList()}`,
        ephemeral: true,
      });
    }

    const bossId  = interaction.options.getString('boss');
    const boss    = bosses.find((b) => b.id === bossId);
    if (!boss) return interaction.reply({ content: '❌ Unknown boss.', ephemeral: true });

    const existing = getBossState(bossId);
    if (!existing) {
      return interaction.reply({ content: `⬜ **${boss.name}** has no recorded kill.`, ephemeral: true });
    }

    // Delete the kill message from the channel if it exists
    if (existing.killMessageId) {
      try {
        const msg = await interaction.channel.messages.fetch(existing.killMessageId);
        await msg.delete();
      } catch (_) {}
    }

    clearKill(bossId);

    const embed = new EmbedBuilder()
      .setColor(0x888888)
      .setTitle('🗑️ Kill record cleared')
      .setDescription(`**${boss.name}** (${boss.zone})\nCleared by <@${interaction.user.id}>`)
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });

    // Refresh board buttons
    try {
      const boardMsgIds = getBoardMessages();
      if (!boardMsgIds.length) return;
      const killState = getAllState();
      const allPanels = buildBoardPanels(bosses, killState);
      if (allPanels.length !== boardMsgIds.length) return;
      for (let i = 0; i < boardMsgIds.length; i++) {
        const panel = allPanels[i];
        if (panel.type !== 'zone') continue;
        try {
          const msg = await interaction.channel.messages.fetch(boardMsgIds[i].messageId);
          await msg.edit({ components: panel.payload.components });
        } catch (_) {}
      }
    } catch (err) {
      console.warn('refreshBoard error in unkill:', err?.message);
    }
  },
};
