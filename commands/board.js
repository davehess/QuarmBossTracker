// commands/board.js
// /board — Posts the boss kill board, or edits it in place if already posted.
// Board message IDs are persisted in state.json so edits survive restarts.

const { SlashCommandBuilder } = require('discord.js');
const bosses = require('../data/bosses.json');
const { getAllState, getBoardMessages, saveBoardMessages } = require('../utils/state');
const { buildBoardPanels } = require('../utils/board');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('board')
    .setDescription('Post or refresh the boss kill board in this channel (edits in place if already posted)'),

  async execute(interaction) {
    const allowedRole = process.env.ALLOWED_ROLE_NAME || 'Pack Member';
    const hasRole = interaction.member.roles.cache.some((r) => r.name === allowedRole);
    if (!hasRole) {
      return interaction.reply({
        content: `❌ You need the **${allowedRole}** role to manage the boss board.`,
        ephemeral: true,
      });
    }

    await interaction.deferReply({ ephemeral: true });

    const channel = interaction.channel;
    const killState = getAllState();
    const panels = buildBoardPanels(bosses, killState);
    const existingIds = getBoardMessages(); // [ { messageId, panelIndex } ]

    // ── Try to edit existing board messages ─────────────────────────────────
    if (existingIds.length > 0 && existingIds.length === panels.length) {
      let allEdited = true;

      for (let i = 0; i < panels.length; i++) {
        try {
          const msg = await channel.messages.fetch(existingIds[i].messageId);
          await msg.edit(panels[i].payload);
        } catch (err) {
          // Message was deleted or not found — fall through to full repost
          console.warn(`Board message ${existingIds[i].messageId} not found, will repost.`);
          allEdited = false;
          break;
        }
      }

      if (allEdited) {
        return interaction.editReply({ content: '✅ Boss board updated in place.' });
      }
    }

    // ── Full post (first time or board messages were deleted) ────────────────
    const newIds = [];

    for (const panel of panels) {
      const sent = await channel.send(panel.payload);
      newIds.push({ messageId: sent.id, panelIndex: newIds.length });
    }

    saveBoardMessages(newIds);

    await interaction.editReply({
      content: `✅ Boss board posted! (${newIds.length} panels)\nThese messages will be edited in place on future /board calls — no need to pin unless you want them anchored.`,
    });
  },
};
