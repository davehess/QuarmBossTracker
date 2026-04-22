// commands/board.js
// Channel slot order (each slot is ALWAYS edited in place, NEVER re-posted if it exists):
//   Slot 1: 📊 Active Cooldowns
//   Slot 2: 🌅 Spawning in Next 24 Hours
//   Slot 3: "." (reserved placeholder, third RaidBosses line)
//   Slots 4-8: Expansion → Thread links (Classic, Kunark, Velious, Luclin, PoP)
//              These are posted ONCE and then only edited, never re-posted.
//
// Each expansion thread (top to bottom):
//   1. Active Cooldowns card for that expansion (edited in place)
//   2. Zone kill cards (posted as kills happen)
//   3. Board panels with kill buttons (edited in place)

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { EXPANSION_ORDER, getThreadId } = require('../utils/config');
const { postOrUpdateExpansionBoard } = require('../utils/killops');
const {
  getSummaryMessageId, setSummaryMessageId,
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

/**
 * Edit a message in place if it exists, or post once and save the ID.
 * This is the core of "never duplicate" — always try edit first.
 */
async function editOrPost(channel, storedId, payload, onNewId) {
  if (storedId) {
    try {
      const m = await channel.messages.fetch(storedId);
      await m.edit(payload);
      return storedId;
    } catch {
      // Message was deleted — fall through to post once
    }
  }
  const m = await channel.send(payload);
  onNewId(m.id);
  return m.id;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('board')
    .setDescription('Post or refresh all expansion boards in threads and update main channel slots'),

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

    // ── MAIN CHANNEL — strict slot order ─────────────────────────────────────

    // Slot 1: Active Cooldowns
    await editOrPost(
      channel, getSummaryMessageId(),
      { embeds: [buildSummaryCard(bosses, killState)] },
      setSummaryMessageId
    );
    results.push('✅ Slot 1: Active Cooldowns');

    // Slot 2: Spawning Tomorrow
    await editOrPost(
      channel, getSpawningTomorrowId(),
      { embeds: [buildSpawningTomorrowCard(bosses, killState)] },
      setSpawningTomorrowId
    );
    results.push('✅ Slot 2: Spawning Tomorrow');

    // Slot 3: "." placeholder (third RaidBosses line, reserved)
    // We use the 'dot' key in channelSlots
    const dotId = getChannelPlaceholder('dot');
    await editOrPost(
      channel, dotId,
      { content: '.', embeds: [], components: [] },
      (id) => setChannelPlaceholder('dot', id)
    );
    results.push('✅ Slot 3: "." placeholder');

    // Slots 4-8: Expansion → Thread links (ONLY posted once per expansion, then edited)
    for (const exp of EXPANSION_ORDER) {
      const threadId = getThreadId(exp);
      const label    = EXP_LABELS[exp] || exp;
      const content  = threadId ? `${label} → <#${threadId}>` : `${label} → *(no thread configured)*`;
      await editOrPost(
        channel,
        getChannelPlaceholder(exp),
        { content, embeds: [], components: [] },
        (id) => setChannelPlaceholder(exp, id)
      );
      results.push(`✅ ${label} link`);
    }

    // ── EXPANSION THREADS ─────────────────────────────────────────────────────
    for (const exp of EXPANSION_ORDER) {
      const threadId = getThreadId(exp);
      if (!threadId) { results.push(`⬜ ${exp} — no thread configured`); continue; }

      try {
        const thread = await client.channels.fetch(threadId);

        // Thread slot 1: Active Cooldowns for this expansion (top of thread, edited in place)
        const cooldownEmbed = buildExpansionCooldownCard(exp, bosses, killState);
        await editOrPost(
          thread, getThreadCooldownId(exp),
          { embeds: [cooldownEmbed] },
          (id) => setThreadCooldownId(exp, id)
        );

        // Thread slot 2+: Board panels with kill buttons
        const boardResult = await postOrUpdateExpansionBoard(client, exp, threadId, bosses);
        results.push(`${boardResult.ok ? '✅' : '❌'} ${exp} thread (${boardResult.action || boardResult.reason})`);
      } catch (err) {
        results.push(`❌ ${exp} thread — ${err?.message}`);
      }
    }

    await interaction.editReply(results.join('\n'));
  },
};
