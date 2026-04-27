// commands/board.js
// Main channel slot order (ALL slots only ever edited in place — never re-posted if they exist):
//   Slot 1: 📊 Active Cooldowns        — hardcoded via SUMMARY_MESSAGE_ID env var
//   Slot 2: 🌅 Spawning Tomorrow        — hardcoded via SPAWNING_TOMORROW_MESSAGE_ID env var
//   Slot 3: 📅 Daily Summary            — hardcoded via DAILY_SUMMARY_MESSAGE_ID env var
//   Slot 4: Thread links (ONE message)  — hardcoded via THREAD_LINKS_MESSAGE_ID env var
//
// Expansion threads (top to bottom):
//   1. Active Cooldowns for that expansion (edited in place)
//   2. Zone kill cards (posted as kills happen)
//   3. Board panels with kill buttons (edited in place)
//
// IMPORTANT: /board must ONLY update TIMER_CHANNEL_ID slots.
// If run from a thread, it still only posts/edits in the main channel.

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { EXPANSION_ORDER, getThreadId } = require('../utils/config');
const { postOrUpdateExpansionBoard } = require('../utils/killops');
const {
  getSummaryMessageId, setSummaryMessageId,
  getSpawningTomorrowId, setSpawningTomorrowId,
  getDailySummaryMessageId, setDailySummaryMessageId,
  getThreadLinksMessageId, setThreadLinksMessageId,
  getThreadCooldownId, setThreadCooldownId,
  getAllState,
} = require('../utils/state');
const { buildSummaryCard, buildSpawningTomorrowCard, buildExpansionCooldownCard, buildDailySummaryEmbed } = require('../utils/embeds');
const { hasAllowedRole, allowedRolesList } = require('../utils/roles');

const EXP_LABELS = {
  Classic: '⚔️ Classic', Kunark: '🦎 Kunark', Velious: '❄️ Velious',
  Luclin: '🌙 Luclin', PoP: '🔥 Planes of Power',
};

function getBosses() {
  delete require.cache[require.resolve('../data/bosses.json')];
  return require('../data/bosses.json');
}

/**
 * Edit a message in place if it exists, or post once and save the ID.
 * Never duplicates — always tries edit first.
 */
async function editOrPost(channel, storedId, payload, onNewId) {
  if (storedId) {
    try { const m = await channel.messages.fetch(storedId); await m.edit(payload); return storedId; }
    catch { /* gone — post once */ }
  }
  const m = await channel.send(payload);
  if (onNewId) onNewId(m.id);
  return m.id;
}

async function runBoard(client) {
  const bosses    = getBosses();
  const killState = getAllState();
  const results   = [];

  const mainChannelId = process.env.TIMER_CHANNEL_ID;
  if (!mainChannelId) { console.warn('[board] TIMER_CHANNEL_ID not set'); return results; }
  const mainChannel = await client.channels.fetch(mainChannelId);

  await editOrPost(mainChannel, getSummaryMessageId(),
    { embeds: [buildSummaryCard(bosses, killState)] }, setSummaryMessageId);
  results.push('✅ Slot 1: Active Cooldowns');

  await editOrPost(mainChannel, getSpawningTomorrowId(),
    { embeds: [buildSpawningTomorrowCard(bosses, killState)] }, setSpawningTomorrowId);
  results.push('✅ Slot 2: Spawning Tomorrow');

  await editOrPost(mainChannel, getDailySummaryMessageId(),
    { embeds: [buildDailySummaryEmbed([], [], bosses)] }, setDailySummaryMessageId);
  results.push('✅ Slot 3: Daily Summary');

  const threadLinksContent = EXPANSION_ORDER.map((exp) => {
    const threadId = getThreadId(exp);
    const label    = EXP_LABELS[exp] || exp;
    return threadId ? `${label} → <#${threadId}>` : `${label} → *(no thread)*`;
  }).join('\n');

  let threadLinksMsgId = getThreadLinksMessageId();
  if (!threadLinksMsgId) {
    try {
      const msgs     = await mainChannel.messages.fetch({ limit: 30 });
      const existing = msgs.find(m =>
        m.author.id === client.user.id && m.embeds.length === 0 &&
        m.components.length === 0 && m.content.includes('Classic') && m.content.includes('→')
      );
      if (existing) { threadLinksMsgId = existing.id; setThreadLinksMessageId(existing.id); }
    } catch {}
  }
  await editOrPost(mainChannel, threadLinksMsgId,
    { content: threadLinksContent, embeds: [], components: [] }, setThreadLinksMessageId);
  results.push('✅ Slot 4: Thread links (single message)');

  for (const exp of EXPANSION_ORDER) {
    const threadId = getThreadId(exp);
    if (!threadId) { results.push(`⬜ ${exp} — no thread`); continue; }
    try {
      const thread = await client.channels.fetch(threadId);
      await editOrPost(thread, getThreadCooldownId(exp),
        { embeds: [buildExpansionCooldownCard(exp, bosses, killState)] },
        (id) => setThreadCooldownId(exp, id));
      const boardResult = await postOrUpdateExpansionBoard(client, exp, threadId, bosses);
      results.push(`${boardResult.ok ? '✅' : '❌'} ${exp} thread (${boardResult.action || boardResult.reason})`);
    } catch (err) {
      results.push(`❌ ${exp} thread — ${err?.message}`);
    }
  }

  return results;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('board')
    .setDescription('Refresh expansion boards in threads and update main channel slots'),

  async execute(interaction) {
    if (!hasAllowedRole(interaction.member)) {
      return interaction.reply({ flags: MessageFlags.Ephemeral, content: `❌ You need one of these roles: ${allowedRolesList()}` });
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const results = await runBoard(interaction.client);
    await interaction.editReply(results.join('\n') || '✅ Done');
  },

  runBoard,
};
