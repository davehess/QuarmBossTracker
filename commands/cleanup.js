// commands/cleanup.js — Remove duplicate board posts, keep earliest set
const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { getAllState, getBoardMessages, saveBoardMessages } = require('../utils/state');
const { buildBoardPanels } = require('../utils/board');
const { hasAllowedRole, allowedRolesList } = require('../utils/roles');

const FIRST_EXPANSION_TITLE = '⚔️ Classic EverQuest';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('cleanup')
    .setDescription('Remove duplicate board posts, keep only the earliest set'),

  async execute(interaction) {
    if (!hasAllowedRole(interaction.member)) {
      return interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: `❌ You need one of these roles: ${allowedRolesList()}`,
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const channel = interaction.channel;
    const botId   = interaction.client.user.id;
    let allMessages = [];
    let lastId = null;

    for (let i = 0; i < 10; i++) {
      const options = { limit: 50 };
      if (lastId) options.before = lastId;
      const batch = await channel.messages.fetch(options);
      if (batch.size === 0) break;
      allMessages = allMessages.concat([...batch.values()]);
      lastId = batch.last().id;
    }

    const botMessages = allMessages
      .filter((m) => m.author.id === botId)
      .sort((a, b) => a.createdTimestamp - b.createdTimestamp);

    const boardSetStartIndices = [];
    for (let i = 0; i < botMessages.length; i++) {
      if (botMessages[i].embeds.some((e) => e.title === FIRST_EXPANSION_TITLE)) {
        boardSetStartIndices.push(i);
      }
    }

    if (boardSetStartIndices.length === 0) return interaction.editReply('⬜ No board messages found.');
    if (boardSetStartIndices.length === 1) return interaction.editReply('✅ Only one board set found — nothing to clean up.');

    const keepUpTo     = boardSetStartIndices[1];
    const toDelete     = botMessages.slice(keepUpTo);
    let deleted = 0;
    for (const msg of toDelete) {
      try { await msg.delete(); deleted++; } catch (err) { console.warn(`Delete failed ${msg.id}:`, err?.message); }
    }

    const surviving = botMessages.slice(boardSetStartIndices[0], keepUpTo);
    const bosses    = require('../data/bosses.json');
    const killState = getAllState();
    const panels    = buildBoardPanels(bosses, killState);
    const newBoardIds = surviving.slice(0, panels.length).map((msg, i) => ({ messageId: msg.id, panelIndex: i }));
    saveBoardMessages(newBoardIds);

    await interaction.editReply(
      `✅ Cleanup complete.\n• Kept: **${newBoardIds.length}** board panels\n• Deleted: **${deleted}** duplicate messages\n• State updated — /board will now edit the surviving board in place.`
    );
  },
};
