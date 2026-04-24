// commands/cleanup.js
// Rule: the EARLIEST bot messages are always the canonical ones.
//
// Main channel:
//   - Old-format board embeds (pre-thread era) → DELETE them
//   - The 4 anchored slots (Active Cooldowns, Spawning Tomorrow, Daily Summary, Thread Links)
//     are identified by env-var message IDs or state → EDITED IN PLACE with current content
//   - Any duplicate anchor-slot messages posted later → DELETE
//
// Each expansion thread:
//   - Find all board sets → keep the EARLIEST, DELETE all newer ones
//   - Edit the earliest set in place with current state
//   - Thread cooldown card (top) → EDITED IN PLACE

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { EXPANSION_ORDER, getThreadId, EXPANSION_META } = require('../utils/config');
const { postOrUpdateExpansionBoard } = require('../utils/killops');
const {
  getSummaryMessageId,     setSummaryMessageId,
  getSpawningTomorrowId,   setSpawningTomorrowId,
  getDailySummaryMessageId, setDailySummaryMessageId,
  getThreadLinksMessageId, setThreadLinksMessageId,
  getThreadCooldownId,     setThreadCooldownId,
  saveExpansionBoard,
  getAllState,
} = require('../utils/state');
const {
  buildSummaryCard, buildSpawningTomorrowCard,
  buildExpansionCooldownCard, buildDailySummaryEmbed,
} = require('../utils/embeds');
const { hasAllowedRole, allowedRolesList } = require('../utils/roles');
const { buildExpansionPanels } = require('../utils/board');

const EXP_LABELS = {
  Classic: '⚔️ Classic', Kunark: '🦎 Kunark', Velious: '❄️ Velious',
  Luclin: '🌙 Luclin', PoP: '🔥 Planes of Power',
};

// Old-format board embed titles (from before the thread architecture)
const OLD_BOARD_TITLES = new Set([
  '⚔️ Classic EverQuest', '🦎 Ruins of Kunark', '❄️ Scars of Velious',
  '🌙 Shadows of Luclin', '🔥 Planes of Power', '🔥 Planes of Power — Reserved',
  '⚔️ Classic EverQuest (1/2)', '🦎 Ruins of Kunark (1/2)',
  '❄️ Scars of Velious (1/2)', '❄️ Scars of Velious (2/2)',
  '❄️ Scars of Velious (1/3)', '❄️ Scars of Velious (2/3)', '❄️ Scars of Velious (3/3)',
  '🌙 Shadows of Luclin (1/2)', '🌙 Shadows of Luclin (2/2)',
  '🌙 Shadows of Luclin (1/3)', '🌙 Shadows of Luclin (2/3)', '🌙 Shadows of Luclin (3/3)',
]);

// Titles that identify our canonical main-channel slot messages
const SLOT_TITLES = new Set(['📊 Active Cooldowns', '🌅 Spawning in the Next 24 Hours', '📅 Daily Raid Summary']);

function getBosses() {
  delete require.cache[require.resolve('../data/bosses.json')];
  return require('../data/bosses.json');
}

/** Fetch all bot messages oldest-first, up to 500 */
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
  return all
    .filter((m) => m.author.id === botId)
    .sort((a, b) => a.createdTimestamp - b.createdTimestamp);
}

/**
 * Find all board sets for an expansion in a message list.
 * A "set" starts when a message has an embed whose title matches the expansion anchor.
 * Collects panelCount consecutive bot messages as one set.
 * Returns array of sets (each set = array of Message objects).
 */
function findBoardSets(botMsgs, anchorTitle, panelCount) {
  const sets = [];
  let i = 0;
  while (i < botMsgs.length) {
    const msg = botMsgs[i];
    const isAnchor = msg.embeds.some(
      (e) => e.title && (e.title === anchorTitle || e.title.startsWith(anchorTitle + ' ('))
    );
    if (isAnchor) {
      const setMsgs = botMsgs.slice(i, i + panelCount);
      if (setMsgs.length === panelCount) {
        sets.push(setMsgs);
        i += panelCount;
        continue;
      }
    }
    i++;
  }
  return sets;
}

/**
 * Edit storedId in place if it exists and is accessible.
 * If not, post new and call onNewId(id).
 * Never silently fails — always returns the final message ID.
 */
async function editOrPost(channel, storedId, payload, onNewId) {
  if (storedId) {
    try {
      const m = await channel.messages.fetch(storedId);
      await m.edit(payload);
      return storedId;
    } catch { /* message gone — post once */ }
  }
  const m = await channel.send(payload);
  if (onNewId) onNewId(m.id);
  return m.id;
}

/**
 * Delete a Discord message, catching any error silently.
 */
async function tryDelete(msg, reason) {
  try { await msg.delete(); return true; }
  catch { return false; }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('cleanup')
    .setDescription('Anchor earliest board posts, delete duplicates, update all cards in place'),

  async execute(interaction) {
    if (!hasAllowedRole(interaction.member)) {
      return interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: `❌ You need one of these roles: ${allowedRolesList()}`,
      });
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

    // ── MAIN CHANNEL ──────────────────────────────────────────────────────────

    const mainBotMsgs = await fetchBotMessages(mainChannel, botId);

    // Delete old-format board embeds (they should not be in the main channel at all)
    let deletedOld = 0;
    for (const msg of mainBotMsgs) {
      if (msg.embeds.some((e) => OLD_BOARD_TITLES.has(e.title))) {
        if (await tryDelete(msg)) deletedOld++;
      }
    }
    if (deletedOld > 0) results.push(`🗑️ Deleted ${deletedOld} old-format board message(s) from main channel`);

    // Identify the canonical slot message IDs (from env or state)
    const canonicalIds = {
      summary:         getSummaryMessageId(),
      spawning:        getSpawningTomorrowId(),
      dailySummary:    getDailySummaryMessageId(),
      threadLinks:     getThreadLinksMessageId(),
    };

    // Find duplicate slot messages: if we see a 2nd Active Cooldowns / Spawning etc,
    // delete the newer one (keep earliest canonical)
    const seenTitles = new Set();
    for (const msg of mainBotMsgs) {
      for (const embed of msg.embeds) {
        if (SLOT_TITLES.has(embed.title)) {
          if (seenTitles.has(embed.title)) {
            // This is a duplicate — delete it unless it's the canonical ID
            const isCanonical = Object.values(canonicalIds).includes(msg.id);
            if (!isCanonical) {
              if (await tryDelete(msg)) results.push(`🗑️ Deleted duplicate "${embed.title}"`);
            }
          } else {
            seenTitles.add(embed.title);
          }
          break;
        }
      }
    }

    // Edit the 4 canonical slot messages in place
    await editOrPost(mainChannel, getSummaryMessageId(),
      { embeds: [buildSummaryCard(bosses, killState)] }, setSummaryMessageId);
    results.push('✅ Slot 1: Active Cooldowns updated');

    await editOrPost(mainChannel, getSpawningTomorrowId(),
      { embeds: [buildSpawningTomorrowCard(bosses, killState)] }, setSpawningTomorrowId);
    results.push('✅ Slot 2: Spawning Tomorrow updated');

    await editOrPost(mainChannel, getDailySummaryMessageId(),
      { embeds: [buildDailySummaryEmbed([], [], bosses)] }, setDailySummaryMessageId);
    results.push('✅ Slot 3: Daily Summary updated');

    const threadLinksContent = EXPANSION_ORDER.map((exp) => {
      const threadId = getThreadId(exp);
      return threadId
        ? `${EXP_LABELS[exp]} → <#${threadId}>`
        : `${EXP_LABELS[exp]} → *(no thread)*`;
    }).join('\n');
    await editOrPost(mainChannel, getThreadLinksMessageId(),
      { content: threadLinksContent, embeds: [], components: [] }, setThreadLinksMessageId);
    results.push('✅ Slot 4: Thread links updated');

    // ── EXPANSION THREADS ─────────────────────────────────────────────────────

    for (const exp of EXPANSION_ORDER) {
      const threadId = getThreadId(exp);
      if (!threadId) { results.push(`⬜ ${exp} — no thread configured`); continue; }

      try {
        const thread  = await client.channels.fetch(threadId);
        const botMsgs = await fetchBotMessages(thread, botId);
        const meta    = EXPANSION_META[exp];
        const panels  = buildExpansionPanels(exp, bosses, killState);

        // Find all board sets for this expansion in the thread
        const boardSets = findBoardSets(botMsgs, meta.label, panels.length);

        if (boardSets.length === 0) {
          results.push(`⬜ ${exp}: no board found in thread — will post fresh`);
        } else {
          // Keep EARLIEST set (index 0), DELETE all later duplicate sets
          let deletedPanels = 0;
          for (let si = 1; si < boardSets.length; si++) {
            for (const msg of boardSets[si]) {
              if (await tryDelete(msg)) deletedPanels++;
            }
          }
          if (deletedPanels > 0) results.push(`🗑️ ${exp}: deleted ${deletedPanels} duplicate panel(s)`);

          // Anchor state to the earliest set
          const earliestIds = boardSets[0].map((m) => m.id);
          saveExpansionBoard(exp, earliestIds);
          results.push(`📌 ${exp}: anchored to ${earliestIds[0].slice(-6)}…`);
        }

        // Update the thread cooldown card (top of thread, edited in place)
        await editOrPost(
          thread, getThreadCooldownId(exp),
          { embeds: [buildExpansionCooldownCard(exp, bosses, killState)] },
          (id) => setThreadCooldownId(exp, id)
        );

        // Edit the anchored board set (or post fresh if none existed)
        const boardResult = await postOrUpdateExpansionBoard(client, exp, threadId, bosses);
        results.push(`${boardResult.ok ? '✅' : '❌'} ${exp}: board ${boardResult.action || boardResult.reason}`);

      } catch (err) {
        results.push(`❌ ${exp}: ${err?.message}`);
      }
    }

    await interaction.editReply(results.join('\n'));
  },
};
