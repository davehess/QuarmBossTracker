// commands/board.js
// Post or refresh the full board layout:
//
// Main channel slot order (edited in place, never re-posted if already exist):
//   Slot 1: 📊 Active Cooldowns  (all expansions)
//   Slot 2: 🌅 Spawning Tomorrow
//   Slots 3-7: "⚔️ Classic → #classic-thread" placeholders
//
// Each expansion thread (top to bottom):
//   1. Active Cooldowns card for that expansion   ← new
//   2. Zone kill cards (posted on /kill)
//   3. Board panels (buttons)

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { EXPANSION_ORDER, getThreadId } = require('../utils/config');
const {
  postOrUpdateExpansionBoard,
  refreshSummaryCard, refreshSpawningTomorrowCard, refreshThreadCooldownCard,
} = require('../utils/killops');
const {
  getChannelSlots, getSummaryMessageId, setSummaryMessageId,
  getSpawningTomorrowId, setSpawningTomorrowId,
  getChannelPlaceholder, setChannelPlaceholder,
  getThreadCooldownId, setThreadCooldownId,
  getAllState,
} = require('../utils/state');
const { buildSummaryCard, buildSpawningTomorrowCard, buildExpansionCooldownCard } = require('../utils/embeds');
const { hasAllowedRole, allowedRolesList } = require('../utils/roles');

const EXP_LABELS = {
  Classic: '⚔️ Classic', Kunark: '🦎 Kunark', Velious: '❄️ Velious',
  Luclin: '🌙 Luclin', PoP: '🔥 Planes of Power',
};

function getBosses() {
  delete require.cache[require.resolve('../data/bosses.json')];
  return require('../data/bosses.json');
}

async function ensureSlot(channel, currentId, payload, setter) {
  if (currentId) {
    try {
      const m = await channel.messages.fetch(currentId);
      await m.edit(payload);
      return currentId;
    } catch { /* message gone — fall through to post */ }
  }
  const m = await channel.send(payload);
  setter(m.id);
  return m.id;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('board')
    .setDescription('Post or refresh all expansion boards in their threads, and update main channel slots'),

  async execute(interaction) {
    if (!hasAllowedRole(interaction.member)) {
      return interaction.reply({ flags: MessageFlags.Ephemeral, content: `❌ You need one of these roles: ${allowedRolesList()}` });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const channel   = interaction.channel;
    const client    = interaction.client;
    const bosses    = getBosses();
    const killState = getAllState();
    const results   = [];

    // ── MAIN CHANNEL SLOTS (in order) ────────────────────────────────────────

    // Slot 1: Active Cooldowns summary
    await ensureSlot(
      channel,
      getSummaryMessageId(),
      { embeds: [buildSummaryCard(bosses, killState)] },
      setSummaryMessageId
    );
    results.push('✅ Main channel: Active Cooldowns card');

    // Slot 2: Spawning Tomorrow
    await ensureSlot(
      channel,
      getSpawningTomorrowId(),
      { embeds: [buildSpawningTomorrowCard(bosses, killState)] },
      setSpawningTomorrowId
    );
    results.push('✅ Main channel: Spawning Tomorrow card');

    // Slots 3-7: Expansion → Thread placeholders
    for (const exp of EXPANSION_ORDER) {
      const threadId = getThreadId(exp);
      const label    = EXP_LABELS[exp] || exp;
      const content  = threadId ? `${label} → <#${threadId}>` : `${label} → *(no thread configured)*`;
      await ensureSlot(
        channel,
        getChannelPlaceholder(exp),
        { content, embeds: [], components: [] },
        (id) => setChannelPlaceholder(exp, id)
      );
      results.push(`✅ Main channel: ${label} placeholder`);
    }

    // ── EXPANSION THREADS ─────────────────────────────────────────────────────
    for (const exp of EXPANSION_ORDER) {
      const threadId = getThreadId(exp);
      if (!threadId) { results.push(`⬜ ${exp} thread — not configured`); continue; }

      try {
        const thread = await client.channels.fetch(threadId);

        // Thread slot 1: Active Cooldowns for this expansion
        const cooldownEmbed = buildExpansionCooldownCard(exp, bosses, killState);
        const storedCooldownId = getThreadCooldownId(exp);
        if (storedCooldownId) {
          try {
            const m = await thread.messages.fetch(storedCooldownId);
            await m.edit({ embeds: [cooldownEmbed] });
          } catch {
            const m = await thread.send({ embeds: [cooldownEmbed] });
            setThreadCooldownId(exp, m.id);
          }
        } else {
          const m = await thread.send({ embeds: [cooldownEmbed] });
          setThreadCooldownId(exp, m.id);
        }

        // Thread slots 2+: Board panels (kill buttons)
        const boardResult = await postOrUpdateExpansionBoard(client, exp, threadId, bosses);
        results.push(`${boardResult.ok ? '✅' : '❌'} ${exp} thread — cooldowns + board (${boardResult.action || boardResult.reason})`);
      } catch (err) {
        results.push(`❌ ${exp} thread — ${err?.message}`);
      }
    }

    await interaction.editReply(results.join('\n'));
  },
};
