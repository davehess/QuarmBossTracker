// commands/cleanup.js
// Prunes duplicate boards in channel and threads — keeps earliest, removes newer ones.
// Rebuilds all main channel slots in correct order.

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { EXPANSION_ORDER, getThreadId, EXPANSION_META } = require('../utils/config');
const { postOrUpdateExpansionBoard } = require('../utils/killops');
const {
  getSummaryMessageId, setSummaryMessageId,
  getSpawningTomorrowId, setSpawningTomorrowId,
  getDailySummaryMessageId, setDailySummaryMessageId,
  getThreadLinksMessageId, setThreadLinksMessageId,
  getThreadCooldownId, setThreadCooldownId,
  getExpansionBoard, saveExpansionBoard,
  getAllState,
} = require('../utils/state');
const { buildSummaryCard, buildSpawningTomorrowCard, buildExpansionCooldownCard, buildDailySummaryEmbed } = require('../utils/embeds');
const { hasAllowedRole, allowedRolesList } = require('../utils/roles');

const EXP_LABELS = {
  Classic: '⚔️ Classic', Kunark: '🦎 Kunark', Velious: '❄️ Velious',
  Luclin: '🌙 Luclin', PoP: '🔥 Planes of Power',
};

// Embed titles that identify old board-format messages to replace with "."
const OLD_BOARD_TITLES = new Set([
  '⚔️ Classic EverQuest', '🦎 Ruins of Kunark', '❄️ Scars of Velious',
  '🌙 Shadows of Luclin', '🔥 Planes of Power', '🔥 Planes of Power — Reserved',
  '⚔️ Classic EverQuest (1/2)', '🦎 Ruins of Kunark (1/2)',
  '❄️ Scars of Velious (1/2)', '❄️ Scars of Velious (2/2)', '❄️ Scars of Velious (1/3)',
  '❄️ Scars of Velious (2/3)', '❄️ Scars of Velious (3/3)',
  '🌙 Shadows of Luclin (1/2)', '🌙 Shadows of Luclin (2/2)',
  '🌙 Shadows of Luclin (1/3)', '🌙 Shadows of Luclin (2/3)', '🌙 Shadows of Luclin (3/3)',
]);

function getBosses() {
  delete require.cache[require.resolve('../data/bosses.json')];
  return require('../data/bosses.json');
}

/** Fetch all bot messages from a channel (up to 500) sorted oldest first */
async function fetchBotMessages(channel, botId) {
  let all = [], lastId = null;
  for (let i = 0; i < 10; i++) {
    const opts = { limit: 50 };
    if (lastId) opts.before = lastId;
    const batch = await channel.messages.fetch(opts);
    if (batch.size === 0) break;
    all = all.concat([...batch.values()]);
    lastId = batch.last().id;
  }
  return all.filter((m) => m.author.id === botId).sort((a, b) => a.createdTimestamp - b.createdTimestamp);
}

/**
 * Find duplicate board panel sets in a channel/thread.
 * A "board set" starts with a message containing the expansion's anchor title.
 * Keeps the EARLIEST set, deletes or replaces subsequent duplicates.
 */
async function pruneDuplicateBoardsInThread(thread, botId, expansion, bosses, killState) {
  const meta = EXPANSION_META[expansion];
  if (!meta) return { kept: 0, removed: 0 };

  const botMsgs  = await fetchBotMessages(thread, botId);
  const anchorTitle = meta.label;

  // Find all messages that start a board set for this expansion
  const boardStarts = botMsgs.filter((m) =>
    m.embeds.some((e) => e.title === anchorTitle || (e.title && e.title.startsWith(anchorTitle)))
  );

  if (boardStarts.length <= 1) return { kept: boardStarts.length, removed: 0 };

  // Keep earliest (index 0), delete/blank everything from index 1+
  let removed = 0;
  for (let i = 1; i < boardStarts.length; i++) {
    try { await boardStarts[i].delete(); removed++; }
    catch { try { await boardStarts[i].edit({ content: '.', embeds: [], components: [] }); removed++; } catch {} }
  }

  // Update stored board IDs to the earliest set
  const stored = getExpansionBoard(expansion);
  if (!stored || stored.messageIds[0] !== boardStarts[0].id) {
    // Re-scan the earliest board's consecutive messages
    const startIdx = botMsgs.indexOf(boardStarts[0]);
    const panels   = require('../utils/board').buildExpansionPanels(expansion, bosses, killState);
    const ids      = botMsgs.slice(startIdx, startIdx + panels.length).map((m) => m.id);
    if (ids.length === panels.length) saveExpansionBoard(expansion, ids);
  }

  return { kept: 1, removed };
}

async function editOrPost(channel, storedId, payload, onNewId) {
  if (storedId) {
    try { const m = await channel.messages.fetch(storedId); await m.edit(payload); return storedId; }
    catch {}
  }
  const m = await channel.send(payload);
  if (onNewId) onNewId(m.id);
  return m.id;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('cleanup')
    .setDescription('Prune duplicate boards, rebuild channel slots and thread boards'),

  async execute(interaction) {
    if (!hasAllowedRole(interaction.member)) {
      return interaction.reply({ flags: MessageFlags.Ephemeral, content: `❌ You need one of these roles: ${allowedRolesList()}` });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const client    = interaction.client;
    const botId     = client.user.id;
    const bosses    = getBosses();
    const killState = getAllState();
    const results   = [];

    const mainChannelId = process.env.TIMER_CHANNEL_ID;
    if (!mainChannelId) return interaction.editReply('❌ TIMER_CHANNEL_ID not set');
    const mainChannel = await client.channels.fetch(mainChannelId);

    // ── Step 1: Replace old board embed messages in MAIN CHANNEL with "." ─────
    const mainBotMsgs = await fetchBotMessages(mainChannel, botId);
    let replaced = 0;
    for (const msg of mainBotMsgs) {
      if (msg.embeds.some((e) => OLD_BOARD_TITLES.has(e.title)) && msg.content !== '.') {
        try { await msg.edit({ content: '.', embeds: [], components: [] }); replaced++; } catch {}
      }
    }
    results.push(`🧹 Replaced ${replaced} old board panel(s) in main channel with "."`);

    // ── Step 2: Main channel slots (strict order) ─────────────────────────────

    // Slot 1: Active Cooldowns
    await editOrPost(mainChannel, getSummaryMessageId(),
      { embeds: [buildSummaryCard(bosses, killState)] }, setSummaryMessageId);
    results.push('✅ Slot 1: Active Cooldowns');

    // Slot 2: Spawning Tomorrow
    await editOrPost(mainChannel, getSpawningTomorrowId(),
      { embeds: [buildSpawningTomorrowCard(bosses, killState)] }, setSpawningTomorrowId);
    results.push('✅ Slot 2: Spawning Tomorrow');

    // Slot 3: Daily Summary
    await editOrPost(mainChannel, getDailySummaryMessageId(),
      { embeds: [buildDailySummaryEmbed([], [], bosses)] }, setDailySummaryMessageId);
    results.push('✅ Slot 3: Daily Summary');

    // Slot 4: Thread links — single message
    const threadLinksContent = EXPANSION_ORDER.map((exp) => {
      const threadId = getThreadId(exp);
      return threadId ? `${EXP_LABELS[exp]} → <#${threadId}>` : `${EXP_LABELS[exp]} → *(no thread)*`;
    }).join('\n');
    await editOrPost(mainChannel, getThreadLinksMessageId(),
      { content: threadLinksContent, embeds: [], components: [] }, setThreadLinksMessageId);
    results.push('✅ Slot 4: Thread links (single message)');

    // ── Step 3: Expansion threads — prune duplicates, rebuild boards ──────────
    for (const exp of EXPANSION_ORDER) {
      const threadId = getThreadId(exp);
      if (!threadId) { results.push(`⬜ ${exp} — no thread`); continue; }

      try {
        const thread = await client.channels.fetch(threadId);

        // Prune duplicate boards
        const pruneResult = await pruneDuplicateBoardsInThread(thread, botId, exp, bosses, killState);
        if (pruneResult.removed > 0) results.push(`🧹 ${exp}: removed ${pruneResult.removed} duplicate board panel(s)`);

        // Thread slot 1: Active Cooldowns card
        await editOrPost(thread, getThreadCooldownId(exp),
          { embeds: [buildExpansionCooldownCard(exp, bosses, killState)] },
          (id) => setThreadCooldownId(exp, id));

        // Thread slot 2+: Board panels (buttons)
        const boardResult = await postOrUpdateExpansionBoard(client, exp, threadId, bosses);
        results.push(`${boardResult.ok ? '✅' : '❌'} ${exp} board (${boardResult.action || boardResult.reason})`);
      } catch (err) {
        results.push(`❌ ${exp}: ${err?.message}`);
      }
    }

    await interaction.editReply(results.join('\n'));
  },
};
