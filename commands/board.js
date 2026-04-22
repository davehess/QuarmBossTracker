// commands/board.js
// /board — Always edits the EARLIEST existing board in the channel.
// NEVER posts a new board if one already exists.
// On startup or after a redeploy, scans the channel to re-anchor to the earliest board.

const { SlashCommandBuilder, MessageFlags, EmbedBuilder } = require('discord.js');
const { getAllState, getBoardMessages, saveBoardMessages } = require('../utils/state');
const { buildBoardPanels, TOTAL_RESERVED_SLOTS } = require('../utils/board');
const { hasAllowedRole, allowedRolesList } = require('../utils/roles');

// The title of the first panel — used to identify board messages in channel history
const BOARD_ANCHOR_TITLE = '⚔️ Classic EverQuest';

/**
 * Scan the channel for the EARLIEST complete board set posted by this bot.
 * Returns an ordered array of { messageId } or null if none found.
 */
async function findEarliestBoard(channel, botId, expectedPanelCount) {
  let allMessages = [];
  let lastId = null;

  // Fetch up to 500 messages (10 × 50)
  for (let i = 0; i < 10; i++) {
    const opts = { limit: 50 };
    if (lastId) opts.before = lastId;
    const batch = await channel.messages.fetch(opts);
    if (batch.size === 0) break;
    allMessages = allMessages.concat([...batch.values()]);
    lastId = batch.last().id;
  }

  // Sort oldest first, filter to bot messages only
  const botMsgs = allMessages
    .filter((m) => m.author.id === botId)
    .sort((a, b) => a.createdTimestamp - b.createdTimestamp);

  // Find the index where the first board starts (has Classic header embed)
  const startIdx = botMsgs.findIndex((m) =>
    m.embeds.some((e) => e.title === BOARD_ANCHOR_TITLE)
  );

  if (startIdx === -1) return null;

  // Collect exactly expectedPanelCount messages from that start point
  const boardMsgs = botMsgs.slice(startIdx, startIdx + expectedPanelCount);
  if (boardMsgs.length < expectedPanelCount) {
    // Incomplete set — return what we have and we'll post missing ones
    return boardMsgs.map((m, i) => ({ messageId: m.id, panelIndex: i }));
  }

  return boardMsgs.map((m, i) => ({ messageId: m.id, panelIndex: i }));
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('board')
    .setDescription('Update the boss kill board in place (never posts a new board if one exists)'),

  async execute(interaction) {
    if (!hasAllowedRole(interaction.member)) {
      return interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: `❌ You need one of these roles: ${allowedRolesList()}`,
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const channel   = interaction.channel;
    const botId     = interaction.client.user.id;
    const killState = getAllState();
    const bosses    = require('../data/bosses.json');
    const panels    = buildBoardPanels(bosses, killState);

    // Step 1: Try state.json first (fastest path)
    let boardIds = getBoardMessages();

    // Step 2: If state.json is empty or stale after a redeploy, scan the channel
    if (boardIds.length === 0) {
      const found = await findEarliestBoard(channel, botId, panels.length);
      if (found && found.length > 0) {
        boardIds = found;
        saveBoardMessages(boardIds);
      }
    }

    // Step 3: Verify the stored IDs still exist (messages may have been deleted)
    if (boardIds.length > 0) {
      try {
        await channel.messages.fetch(boardIds[0].messageId);
      } catch {
        // First message gone — re-scan
        const found = await findEarliestBoard(channel, botId, panels.length);
        if (found && found.length > 0) {
          boardIds = found;
          saveBoardMessages(boardIds);
        } else {
          boardIds = [];
        }
      }
    }

    // Step 4: Edit existing board in place
    if (boardIds.length > 0) {
      let editedCount = 0;
      const newIds = [...boardIds];

      for (let i = 0; i < panels.length; i++) {
        if (i < boardIds.length) {
          try {
            const msg = await channel.messages.fetch(boardIds[i].messageId);
            await msg.edit(panels[i].payload);
            editedCount++;
          } catch {
            // Message missing — will need to post this one
          }
        } else {
          // New panel needed (boss list grew)
          const sent = await channel.send(panels[i].payload);
          newIds.push({ messageId: sent.id, panelIndex: i });
          editedCount++;
        }
      }

      if (newIds.length !== boardIds.length) saveBoardMessages(newIds);
      return interaction.editReply(`✅ Board updated in place. (${editedCount}/${panels.length} panels refreshed)`);
    }

    // Step 5: No existing board found anywhere — post fresh (first time only)
    const newIds = [];
    for (const panel of panels) {
      const sent = await channel.send(panel.payload);
      newIds.push({ messageId: sent.id, panelIndex: newIds.length });
    }
    saveBoardMessages(newIds);

    await interaction.editReply(
      `✅ Boss board posted for the first time! (${newIds.length} panels)\nThis is the only time new messages will be posted — all future /board calls will edit these in place.`
    );
  },
};
