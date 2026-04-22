// commands/cleanup.js
// Replaces old board embeds with "." in main channel, then rebuilds all slots
// in the correct order and posts boards in threads.

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { EXPANSION_ORDER, getThreadId, EXPANSION_META } = require('../utils/config');
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

// Embed titles that belong to old board messages (pre-thread architecture)
const OLD_BOARD_TITLES = new Set([
  '⚔️ Classic EverQuest', '🦎 Ruins of Kunark', '❄️ Scars of Velious',
  '🌙 Shadows of Luclin', '🔥 Planes of Power',
  '⚔️ Classic EverQuest (1/2)', '⚔️ Classic EverQuest (2/2)',
  '🦎 Ruins of Kunark (1/2)', '🦎 Ruins of Kunark (2/2)',
  '❄️ Scars of Velious (1/2)', '❄️ Scars of Velious (2/2)', '❄️ Scars of Velious (1/3)',
  '❄️ Scars of Velious (2/3)', '❄️ Scars of Velious (3/3)',
  '🌙 Shadows of Luclin (1/2)', '🌙 Shadows of Luclin (2/2)',
  '🌙 Shadows of Luclin (1/3)', '🌙 Shadows of Luclin (2/3)', '🌙 Shadows of Luclin (3/3)',
  '🔥 Planes of Power — Reserved',
]);

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
    try { const m = await channel.messages.fetch(currentId); await m.edit(payload); return currentId; }
    catch { /* gone */ }
  }
  const m = await channel.send(payload);
  setter(m.id);
  return m.id;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('cleanup')
    .setDescription('Migrate old board to threads: replace old panels with ".", rebuild all slots'),

  async execute(interaction) {
    if (!hasAllowedRole(interaction.member)) {
      return interaction.reply({ flags: MessageFlags.Ephemeral, content: `❌ You need one of these roles: ${allowedRolesList()}` });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const channel   = interaction.channel;
    const client    = interaction.client;
    const botId     = client.user.id;
    const bosses    = getBosses();
    const killState = getAllState();
    const results   = [];

    // ── Step 1: Replace old board embed messages with "." ─────────────────────
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

    const botMsgs = allMessages.filter((m) => m.author.id === botId);
    let replaced = 0;
    for (const msg of botMsgs) {
      if (msg.embeds.some((e) => OLD_BOARD_TITLES.has(e.title)) && msg.content !== '.') {
        try { await msg.edit({ content: '.', embeds: [], components: [] }); replaced++; }
        catch (err) { console.warn(`cleanup: could not replace ${msg.id}:`, err?.message); }
      }
    }
    results.push(`🧹 Replaced ${replaced} old board message(s) with "."`);

    // ── Step 2: Main channel slots in correct order ───────────────────────────

    // Slot 1: Active Cooldowns
    await ensureSlot(
      channel, getSummaryMessageId(),
      { embeds: [buildSummaryCard(bosses, killState)] },
      setSummaryMessageId
    );
    results.push('✅ Slot 1: Active Cooldowns');

    // Slot 2: Spawning Tomorrow
    await ensureSlot(
      channel, getSpawningTomorrowId(),
      { embeds: [buildSpawningTomorrowCard(bosses, killState)] },
      setSpawningTomorrowId
    );
    results.push('✅ Slot 2: Spawning Tomorrow');

    // Slots 3-7: Expansion thread links
    for (const exp of EXPANSION_ORDER) {
      const threadId = getThreadId(exp);
      const label    = EXP_LABELS[exp] || exp;
      const content  = threadId ? `${label} → <#${threadId}>` : `${label} → *(no thread configured)*`;
      await ensureSlot(
        channel, getChannelPlaceholder(exp),
        { content, embeds: [], components: [] },
        (id) => setChannelPlaceholder(exp, id)
      );
      results.push(`✅ Slot: ${label} placeholder`);
    }

    // ── Step 3: Each expansion thread ─────────────────────────────────────────
    for (const exp of EXPANSION_ORDER) {
      const threadId = getThreadId(exp);
      if (!threadId) { results.push(`⬜ ${exp} — no thread`); continue; }

      try {
        const thread = await client.channels.fetch(threadId);

        // Thread slot 1: Active Cooldowns card for this expansion
        const cooldownEmbed   = buildExpansionCooldownCard(exp, bosses, killState);
        const storedCooldownId = getThreadCooldownId(exp);
        if (storedCooldownId) {
          try { const m = await thread.messages.fetch(storedCooldownId); await m.edit({ embeds: [cooldownEmbed] }); }
          catch { const m = await thread.send({ embeds: [cooldownEmbed] }); setThreadCooldownId(exp, m.id); }
        } else {
          const m = await thread.send({ embeds: [cooldownEmbed] });
          setThreadCooldownId(exp, m.id);
        }

        // Thread: Board panels (buttons)
        const boardResult = await postOrUpdateExpansionBoard(client, exp, threadId, bosses);
        results.push(`${boardResult.ok ? '✅' : '❌'} ${exp} thread — cooldowns + board (${boardResult.action || boardResult.reason})`);
      } catch (err) {
        results.push(`❌ ${exp} thread error — ${err?.message}`);
      }
    }

    await interaction.editReply(results.join('\n'));
  },
};
