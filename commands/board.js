// commands/board.js
// /board — Post or update expansion boards in their threads.
// Also updates the "." placeholders and summary card in main channel.

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { EXPANSION_ORDER, getThreadId } = require('../utils/config');
const { postOrUpdateExpansionBoard, refreshSummaryCard } = require('../utils/killops');
const { getChannelSlots, setChannelPlaceholder, getSummaryMessageId, setSummaryMessageId } = require('../utils/state');
const { hasAllowedRole, allowedRolesList } = require('../utils/roles');
const { buildSummaryCard } = require('../utils/embeds');

function getBosses() {
  delete require.cache[require.resolve('../data/bosses.json')];
  return require('../data/bosses.json');
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('board')
    .setDescription('Post or refresh all expansion boards in their threads'),

  async execute(interaction) {
    if (!hasAllowedRole(interaction.member)) {
      return interaction.reply({ flags: MessageFlags.Ephemeral, content: `❌ You need one of these roles: ${allowedRolesList()}` });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const channel = interaction.channel;
    const client  = interaction.client;
    const bosses  = getBosses();
    const results = [];

    // 1. Update each expansion board in its thread
    for (const exp of EXPANSION_ORDER) {
      const threadId = getThreadId(exp);
      if (!threadId) { results.push(`⬜ ${exp} — no thread configured`); continue; }
      const res = await postOrUpdateExpansionBoard(client, exp, threadId, bosses);
      results.push(`${res.ok ? '✅' : '❌'} ${exp} — ${res.action || res.reason}`);
    }

    // 2. Ensure "." placeholder exists in main channel for each expansion + summary
    const slots = getChannelSlots();
    const EXP_LABELS = { Classic: '⚔️ Classic', Kunark: '🦎 Kunark', Velious: '❄️ Velious', Luclin: '🌙 Luclin', PoP: '🔥 Planes of Power' };

    // Summary card
    let summaryId = getSummaryMessageId();
    if (summaryId) {
      try { const m = await channel.messages.fetch(summaryId); await m.edit({ embeds: [buildSummaryCard(bosses, require('../utils/state').getAllState())] }); }
      catch { summaryId = null; }
    }
    if (!summaryId) {
      const m = await channel.send({ embeds: [buildSummaryCard(bosses, require('../utils/state').getAllState())] });
      setSummaryMessageId(m.id);
    }

    // Expansion placeholders
    for (const exp of EXPANSION_ORDER) {
      const threadId = getThreadId(exp);
      const label    = EXP_LABELS[exp] || exp;
      const link     = threadId ? `<#${threadId}>` : '*(no thread)*';
      const existing = slots[exp];
      if (existing) {
        try { const m = await channel.messages.fetch(existing); await m.edit({ content: `${label} → ${link}` }); continue; }
        catch { /* message gone */ }
      }
      const m = await channel.send({ content: `${label} → ${link}` });
      setChannelPlaceholder(exp, m.id);
    }

    await interaction.editReply(results.join('\n'));
  },
};
