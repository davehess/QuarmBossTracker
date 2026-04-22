// commands/board.js — Post or in-place edit the boss board (10 reserved slots total)
const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { getAllState, getBoardMessages, saveBoardMessages } = require('../utils/state');
const { buildBoardPanels, TOTAL_RESERVED_SLOTS } = require('../utils/board');
const { hasAllowedRole, allowedRolesList } = require('../utils/roles');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('board')
    .setDescription('Post or refresh the boss kill board (always 10 reserved message slots)'),

  async execute(interaction) {
    if (!hasAllowedRole(interaction.member)) {
      return interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: `❌ You need one of these roles to manage the board: ${allowedRolesList()}`,
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const channel   = interaction.channel;
    const killState = getAllState();
    const bosses    = require('../data/bosses.json');
    const panels    = buildBoardPanels(bosses, killState); // always TOTAL_RESERVED_SLOTS panels
    const existingIds = getBoardMessages();

    // ── In-place edit (panel count matches) ──────────────────────────────────
    if (existingIds.length === panels.length) {
      let allEdited = true;
      for (let i = 0; i < panels.length; i++) {
        try {
          const msg = await channel.messages.fetch(existingIds[i].messageId);
          await msg.edit(panels[i].payload);
        } catch { allEdited = false; break; }
      }
      if (allEdited) return interaction.editReply('✅ Boss board updated in place.');
    }

    // ── Full repost (first time, or messages were deleted) ────────────────────
    const newIds = [];
    for (const panel of panels) {
      const sent = await channel.send(panel.payload);
      newIds.push({ messageId: sent.id, panelIndex: newIds.length });
    }
    saveBoardMessages(newIds);

    await interaction.editReply(
      `✅ Boss board posted! ${newIds.length} slots (${newIds.length - 4} active + 5 PoP reserved).\nRun /board again to update in place.`
    );
  },
};
