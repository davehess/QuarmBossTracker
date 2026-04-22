// commands/cleanup.js
// /cleanup — Moves old board messages to their threads, replaces them with "." in main channel.
// Also handles re-anchoring state after a redeploy.

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { EXPANSION_ORDER, getThreadId, EXPANSION_META } = require('../utils/config');
const { postOrUpdateExpansionBoard, refreshSummaryCard } = require('../utils/killops');
const {
  getChannelSlots, setChannelPlaceholder, setSummaryMessageId, getSummaryMessageId,
  getAllState,
} = require('../utils/state');
const { buildSummaryCard } = require('../utils/embeds');
const { hasAllowedRole, allowedRolesList } = require('../utils/roles');

const BOARD_EMBED_TITLES = new Set([
  '⚔️ Classic EverQuest', '🦎 Ruins of Kunark', '❄️ Scars of Velious', '🌙 Shadows of Luclin', '🔥 Planes of Power',
  // part variants
  '⚔️ Classic EverQuest (1/2)', '🦎 Ruins of Kunark (1/2)', '❄️ Scars of Velious (1/3)',
  '🌙 Shadows of Luclin (1/3)', '🌙 Shadows of Luclin (2/3)', '🌙 Shadows of Luclin (3/3)',
]);

function isBoardMessage(msg) {
  return msg.embeds.some((e) => BOARD_EMBED_TITLES.has(e.title)) ||
    (msg.content === '.' && msg.components.length === 0);
}

function getBosses() {
  delete require.cache[require.resolve('../data/bosses.json')];
  return require('../data/bosses.json');
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('cleanup')
    .setDescription('Move old board content to threads and tidy up the main channel'),

  async execute(interaction) {
    if (!hasAllowedRole(interaction.member)) {
      return interaction.reply({ flags: MessageFlags.Ephemeral, content: `❌ You need one of these roles: ${allowedRolesList()}` });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const channel = interaction.channel;
    const client  = interaction.client;
    const botId   = client.user.id;
    const bosses  = getBosses();
    const results = [];

    // Fetch last 500 messages from main channel
    let allMessages = [];
    let lastId = null;
    for (let i = 0; i < 10; i++) {
      const opts = { limit: 50 };
      if (lastId) opts.before = lastId;
      const batch = await channel.messages.fetch(opts);
      if (batch.size === 0) break;
      allMessages = allMessages.concat([...batch.values()]);
      lastId = batch.last().id;
    }

    const botMsgs = allMessages
      .filter((m) => m.author.id === botId)
      .sort((a, b) => a.createdTimestamp - b.createdTimestamp);

    // Find old board messages (have board embed titles) and replace with "."
    let replaced = 0;
    for (const msg of botMsgs) {
      if (msg.embeds.some((e) => BOARD_EMBED_TITLES.has(e.title)) && msg.content !== '.') {
        try {
          await msg.edit({ content: '.', embeds: [], components: [] });
          replaced++;
        } catch (err) { console.warn(`cleanup: could not replace msg ${msg.id}:`, err?.message); }
      }
    }
    results.push(`🧹 Replaced ${replaced} old board messages with "."`);

    // Post/update expansion boards in their threads
    for (const exp of EXPANSION_ORDER) {
      const threadId = getThreadId(exp);
      if (!threadId) { results.push(`⬜ ${exp} — no thread`); continue; }
      const res = await postOrUpdateExpansionBoard(client, exp, threadId, bosses);
      results.push(`${res.ok ? '✅' : '❌'} ${exp} board — ${res.action || res.reason}`);
    }

    // Ensure summary card exists and is up to date
    const killState  = getAllState();
    const summaryEmbed = buildSummaryCard(bosses, killState);
    const summaryId    = getSummaryMessageId();
    if (summaryId) {
      try { const m = await channel.messages.fetch(summaryId); await m.edit({ embeds: [summaryEmbed] }); results.push('✅ Summary card updated'); }
      catch {
        const m = await channel.send({ embeds: [summaryEmbed] }); setSummaryMessageId(m.id); results.push('✅ Summary card posted');
      }
    } else {
      const m = await channel.send({ embeds: [summaryEmbed] }); setSummaryMessageId(m.id); results.push('✅ Summary card posted');
    }

    // Ensure "expansion → thread" placeholders exist
    const EXP_LABELS = { Classic: '⚔️ Classic', Kunark: '🦎 Kunark', Velious: '❄️ Velious', Luclin: '🌙 Luclin', PoP: '🔥 Planes of Power' };
    const slots = getChannelSlots();
    for (const exp of EXPANSION_ORDER) {
      const threadId = getThreadId(exp);
      const label    = EXP_LABELS[exp] || exp;
      const link     = threadId ? `<#${threadId}>` : '*(no thread configured)*';
      const existing = slots[exp];
      if (existing) {
        try { const m = await channel.messages.fetch(existing); await m.edit({ content: `${label} → ${link}`, embeds: [], components: [] }); continue; }
        catch { /* gone */ }
      }
      const m = await channel.send({ content: `${label} → ${link}` });
      setChannelPlaceholder(exp, m.id);
    }

    results.push('✅ Channel slot placeholders updated');
    await interaction.editReply(results.join('\n'));
  },
};
