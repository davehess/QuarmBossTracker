// commands/unkill.js
const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
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
    const filtered = bossChoices.filter((c) => c.name.toLowerCase().includes(focused)).slice(0, 25);
    await interaction.respond(filtered);
  },

  async execute(interaction) {
    if (!hasAllowedRole(interaction.member)) {
      return interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: `❌ You need one of these roles to clear kills: ${allowedRolesList()}`,
      });
    }

    const bossId  = interaction.options.getString('boss');
    const boss    = bosses.find((b) => b.id === bossId);
    if (!boss) return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Unknown boss.' });

    const existing = getBossState(bossId);
    if (!existing) {
      return interaction.reply({ flags: MessageFlags.Ephemeral, content: `⬜ **${boss.name}** has no recorded kill.` });
    }

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

    try {
      const boardMsgIds = getBoardMessages();
      if (!boardMsgIds.length) return;
      const killState = getAllState();
      const freshBosses = require('../data/bosses.json');
      const allPanels = buildBoardPanels(freshBosses, killState);
      if (allPanels.length !== boardMsgIds.length) return;
      for (let i = 0; i < boardMsgIds.length; i++) {
        const panel = allPanels[i];
        if (panel.type !== 'expansion') continue;
        try {
          const msg = await interaction.channel.messages.fetch(boardMsgIds[i].messageId);
          await msg.edit(panel.payload);
        } catch (_) {}
      }
    } catch (err) {
      console.warn('refreshBoard error in unkill:', err?.message);
    }
  },
};
