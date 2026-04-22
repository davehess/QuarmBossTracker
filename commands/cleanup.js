// commands/cleanup.js
// /cleanup — Scans #raid-mobs for duplicate board posts from the bot,
// keeps only the EARLIEST set of board messages, deletes all later ones,
// and updates state.json to point at the surviving message IDs.

const { SlashCommandBuilder } = require('discord.js');
const bosses = require('../data/bosses.json');
const { getAllState, getBoardMessages, saveBoardMessages } = require('../utils/state');
const { buildBoardPanels } = require('../utils/board');
const { hasAllowedRole, allowedRolesList } = require('../utils/roles');

// Marker text that identifies the first message of a board set —
// the expansion header embed title for the first expansion.
const FIRST_EXPANSION_TITLE = '⚔️ Classic EverQuest';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('cleanup')
    .setDescription('Remove duplicate board posts and re-anchor to the earliest one'),

  async execute(interaction) {
    if (!hasAllowedRole(interaction.member)) {
      return interaction.reply({
        content: `❌ You need one of these roles to run cleanup: ${allowedRolesList()}`,
        ephemeral: true,
      });
    }

    await interaction.deferReply({ ephemeral: true });

    const channel = interaction.channel;

    // ── Fetch channel history to find ALL board message sets ─────────────────
    // We identify a "board set start" by looking for messages from this bot
    // that contain an embed with the first expansion header title.
    const botId = interaction.client.user.id;
    let allMessages = [];
    let lastId = null;

    // Fetch up to 500 messages (10 batches of 50)
    for (let i = 0; i < 10; i++) {
      const options = { limit: 50 };
      if (lastId) options.before = lastId;

      const batch = await channel.messages.fetch(options);
      if (batch.size === 0) break;

      allMessages = allMessages.concat([...batch.values()]);
      lastId = batch.last().id;
    }

    // Filter to bot messages only, sorted oldest first
    const botMessages = allMessages
      .filter((m) => m.author.id === botId)
      .sort((a, b) => a.createdTimestamp - b.createdTimestamp);

    // Find indices where a new board set begins (has the Classic header embed)
    const boardSetStartIndices = [];
    for (let i = 0; i < botMessages.length; i++) {
      const msg = botMessages[i];
      const hasClassicHeader = msg.embeds.some((e) => e.title === FIRST_EXPANSION_TITLE);
      if (hasClassicHeader) boardSetStartIndices.push(i);
    }

    if (boardSetStartIndices.length === 0) {
      return interaction.editReply('⬜ No board messages found in this channel.');
    }

    if (boardSetStartIndices.length === 1) {
      return interaction.editReply('✅ Only one board set found — nothing to clean up.');
    }

    // Keep the FIRST set, delete everything from the second set onwards
    const keepUpTo = boardSetStartIndices[1]; // first index of the second board set
    const messagesToDelete = botMessages.slice(keepUpTo);

    let deleted = 0;
    for (const msg of messagesToDelete) {
      try {
        await msg.delete();
        deleted++;
      } catch (err) {
        console.warn(`Could not delete message ${msg.id}:`, err?.message);
      }
    }

    // Now rebuild state: find the surviving board messages (the first set)
    // and update state.json so /board edits-in-place correctly going forward.
    const survivingBotMessages = botMessages.slice(0, keepUpTo);

    // Re-identify the board panels to match surviving messages to panel slots
    const killState = getAllState();
    const panels    = buildBoardPanels(bosses, killState);

    // The surviving board messages should line up with panels in order
    const newBoardIds = survivingBotMessages
      .slice(boardSetStartIndices[0]) // start from where the first board begins
      .slice(0, panels.length)
      .map((msg, i) => ({ messageId: msg.id, panelIndex: i }));

    saveBoardMessages(newBoardIds);

    await interaction.editReply(
      `✅ Cleanup complete.\n• Kept: **${newBoardIds.length}** board panels (earliest set)\n• Deleted: **${deleted}** duplicate messages\n• State updated — /board will now edit the surviving board in place.`
    );
  },
};
