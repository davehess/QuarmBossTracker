// commands/board.js
// /board — Posts the boss kill board, or edits it in place if already posted.
// Smart-diffs panel count so new bosses added to bosses.json are picked up
// without blowing away the existing board.

const { SlashCommandBuilder } = require('discord.js');
const bosses = require('../data/bosses.json');
const { getAllState, getBoardMessages, saveBoardMessages } = require('../utils/state');
const { buildBoardPanels } = require('../utils/board');
const { hasAllowedRole, allowedRolesList } = require('../utils/roles');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('board')
    .setDescription('Post or refresh the boss kill board (edits in place if already posted)'),

  async execute(interaction) {
    if (!hasAllowedRole(interaction.member)) {
      return interaction.reply({
        content: `❌ You need one of these roles to manage the board: ${allowedRolesList()}`,
        ephemeral: true,
      });
    }

    await interaction.deferReply({ ephemeral: true });

    const channel   = interaction.channel;
    const killState = getAllState();  // preserves existing kills
    const panels    = buildBoardPanels(bosses, killState);
    const existingIds = getBoardMessages();

    // ── Try in-place edit when panel count matches ────────────────────────────
    if (existingIds.length > 0 && existingIds.length === panels.length) {
      let allEdited = true;

      for (let i = 0; i < panels.length; i++) {
        try {
          const msg = await channel.messages.fetch(existingIds[i].messageId);
          await msg.edit(panels[i].payload);
        } catch {
          allEdited = false;
          break;
        }
      }

      if (allEdited) {
        return interaction.editReply('✅ Boss board updated in place.');
      }
      // Fall through to full repost if any message was missing
    }

    // ── Panel count changed (new bosses/zones added) — partial update ─────────
    // Edit panels that still exist, append new ones at the end.
    if (existingIds.length > 0 && existingIds.length !== panels.length) {
      const newIds  = [...existingIds];
      let anyFailed = false;

      for (let i = 0; i < panels.length; i++) {
        if (i < existingIds.length) {
          // Try to edit existing panel
          try {
            const msg = await channel.messages.fetch(existingIds[i].messageId);
            await msg.edit(panels[i].payload);
          } catch {
            anyFailed = true;
          }
        } else {
          // Append new panel for new boss/zone
          const sent = await channel.send(panels[i].payload);
          newIds.push({ messageId: sent.id, panelIndex: i });
        }
      }

      if (!anyFailed) {
        saveBoardMessages(newIds);
        return interaction.editReply(`✅ Board updated — ${panels.length - existingIds.length} new panel(s) added.`);
      }
      // If edits failed, fall through to full repost
    }

    // ── Full repost ───────────────────────────────────────────────────────────
    const newIds = [];
    for (const panel of panels) {
      const sent = await channel.send(panel.payload);
      newIds.push({ messageId: sent.id, panelIndex: newIds.length });
    }
    saveBoardMessages(newIds);

    await interaction.editReply(
      `✅ Boss board posted! (${newIds.length} panels)\nRun /board again any time to update in place.`
    );
  },
};
