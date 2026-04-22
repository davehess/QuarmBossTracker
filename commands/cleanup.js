// commands/cleanup.js
// Migrates old board messages to threads, rebuilds main channel slots in correct order.
// Uses the same editOrPost logic — NEVER duplicates a slot if it already exists.

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

// Old-format board embed titles to replace with "."
const OLD_BOARD_TITLES = new Set([
  '⚔️ Classic EverQuest', '🦎 Ruins of Kunark', '❄️ Scars of Velious',
  '🌙 Shadows of Luclin', '🔥 Planes of Power', '🔥 Planes of Power — Reserved',
  '⚔️ Classic EverQuest (1/2)', '⚔️ Classic EverQuest (2/2)',
  '🦎 Ruins of Kunark (1/2)', '🦎 Ruins of Kunark (2/2)',
  '❄️ Scars of Velious (1/2)', '❄️ Scars of Velious (2/2)',
  '❄️ Scars of Velious (1/3)', '❄️ Scars of Velious (2/3)', '❄️ Scars of Velious (3/3)',
  '🌙 Shadows of Luclin (1/2)', '🌙 Shadows of Luclin (2/2)',
  '🌙 Shadows of Luclin (1/3)', '🌙 Shadows of Luclin (2/3)', '🌙 Shadows of Luclin (3/3)',
]);

const EXP_LABELS = {
  Classic: '⚔️ Classic', Kunark: '🦎 Kunark', Velious: '❄️ Velious',
  Luclin: '🌙 Luclin', PoP: '🔥 Planes of Power',
};

function getBosses() {
  delete require.cache[require.resolve('../data/bosses.json')];
  return require('../data/bosses.json');
}

async function editOrPost(channel, storedId, payload, onNewId) {
  if (storedId) {
    try { const m = await channel.messages.fetch(storedId); await m.edit(payload); return storedId; }
    catch { /* gone — post once */ }
  }
  const m = await channel.send(payload);
  onNewId(m.id);
  return m.id;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('cleanup')
    .setDescription('Replace old board panels with ".", rebuild all channel slots and thread boards'),

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

    // ── Step 1: Replace old board embeds with "." ─────────────────────────────
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
    results.push(`🧹 Replaced ${replaced} old board panel(s) with "."`);

    // ── Step 2: Main channel slots in correct order ───────────────────────────

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

    // Slot 3: "." placeholder
    await editOrPost(
      channel, getChannelPlaceholder('dot'),
      { content: '.', embeds: [], components: [] },
      (id) => setChannelPlaceholder('dot', id)
    );
    results.push('✅ Slot 3: "." placeholder');

    // Slots 4-8: Expansion thread links (each only posted once, then edited)
    for (const exp of EXPANSION_ORDER) {
      const threadId = getThreadId(exp);
      const label    = EXP_LABELS[exp] || exp;
      const content  = threadId ? `${label} → <#${threadId}>` : `${label} → *(no thread configured)*`;
      await editOrPost(
        channel, getChannelPlaceholder(exp),
        { content, embeds: [], components: [] },
        (id) => setChannelPlaceholder(exp, id)
      );
      results.push(`✅ ${label} link`);
    }

    // ── Step 3: Expansion threads ─────────────────────────────────────────────
    for (const exp of EXPANSION_ORDER) {
      const threadId = getThreadId(exp);
      if (!threadId) { results.push(`⬜ ${exp} — no thread`); continue; }
      try {
        const thread = await client.channels.fetch(threadId);

        // Thread slot 1: Active Cooldowns card (edited in place at top of thread)
        await editOrPost(
          thread, getThreadCooldownId(exp),
          { embeds: [buildExpansionCooldownCard(exp, bosses, killState)] },
          (id) => setThreadCooldownId(exp, id)
        );

        // Thread slot 2+: Board panels
        const boardResult = await postOrUpdateExpansionBoard(client, exp, threadId, bosses);
        results.push(`${boardResult.ok ? '✅' : '❌'} ${exp} thread (${boardResult.action || boardResult.reason})`);
      } catch (err) {
        results.push(`❌ ${exp} thread — ${err?.message}`);
      }
    }

    await interaction.editReply(results.join('\n'));
  },
};
