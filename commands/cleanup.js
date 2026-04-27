// commands/cleanup.js — v0.9.3
//
// What gets DELETED:
//   Main channel:
//     - Transient: ☠️ zone cards, ⚠️ spawn alerts, 🟢 spawned notices
//     - Old-format board embeds (pre-thread era)
//     - Duplicate canonical slots (2nd+ Active Cooldowns, Spawning Tomorrow, Daily Summary)
//     - Duplicate thread-link messages (keep earliest, delete rest)
//     - Thread-link messages that ended up posted INSIDE a thread (wrong place)
//   Each expansion thread:
//     - Transient: ☠️ zone cards, ⚠️ spawn alerts, 🟢 spawned notices
//     - Duplicate board panel sets (keep earliest, delete rest)
//     - Duplicate "X — Active Cooldowns" cards (keep earliest, delete rest)
//     - Thread-link messages (those should only be in main channel)
//   Historic Kills thread:
//     - Duplicate Daily Raid Summaries for the same date (keep earliest, delete rest)
//     - Retroactively edit existing Daily Summaries to remove "Available Now" section
//
// What gets EDITED IN PLACE (canonical messages):
//   Main channel: Active Cooldowns, Spawning Tomorrow, Daily Summary, Thread Links
//   Each thread: <Expansion> — Active Cooldowns (top post), board panels

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { EXPANSION_ORDER, getThreadId, EXPANSION_META } = require('../utils/config');
const { postOrUpdateExpansionBoard } = require('../utils/killops');
const {
  getSummaryMessageId,      setSummaryMessageId,
  getSpawningTomorrowId,    setSpawningTomorrowId,
  getDailySummaryMessageId, setDailySummaryMessageId,
  getThreadLinksMessageId,  setThreadLinksMessageId,
  getThreadCooldownId,      setThreadCooldownId,
  saveExpansionBoard,       getAllState,
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

// Transient embed title prefixes — always delete
function isTransient(title) {
  if (!title) return false;
  return (
    title.startsWith('☠️ ') ||        // zone kill cards
    title.startsWith('⚠️ ') ||        // spawn alerts
    title.startsWith('🟢 ') ||        // spawned notices
    title.startsWith('📣 Pack Takedown') // old announce format
  );
}

// Old-format board titles that should never be in any channel
const OLD_BOARD_TITLES = new Set([
  '⚔️ Classic EverQuest', '🦎 Ruins of Kunark', '❄️ Scars of Velious',
  '🌙 Shadows of Luclin', '🔥 Planes of Power', '🔥 Planes of Power — Reserved',
  '⚔️ Classic EverQuest (1/2)', '🦎 Ruins of Kunark (1/2)',
  '❄️ Scars of Velious (1/2)', '❄️ Scars of Velious (2/2)',
  '❄️ Scars of Velious (1/3)', '❄️ Scars of Velious (2/3)', '❄️ Scars of Velious (3/3)',
  '🌙 Shadows of Luclin (1/2)', '🌙 Shadows of Luclin (2/2)',
  '🌙 Shadows of Luclin (1/3)', '🌙 Shadows of Luclin (2/3)', '🌙 Shadows of Luclin (3/3)',
]);

// Canonical slot titles in main channel (one each, edit in place)
const MAIN_SLOT_TITLES = new Set([
  '📊 Active Cooldowns',
  '🌅 Spawning in the Next 24 Hours',
  '📅 Daily Raid Summary',
]);

// Identifies a thread-link message: text-only, contains → arrows and expansion names
function isThreadLinksMsg(msg) {
  if (msg.embeds.length || msg.components.length) return false;
  const c = msg.content || '';
  return c.includes('→') && (
    c.includes('Classic') || c.includes('Kunark') || c.includes('Velious') ||
    c.includes('Luclin')  || c.includes('Power')
  );
}

function getBosses() {
  delete require.cache[require.resolve('../data/bosses.json')];
  return require('../data/bosses.json');
}

async function fetchBotMessages(channel, botId, limit = 500) {
  let all = [], lastId = null;
  const pages = Math.ceil(limit / 50);
  for (let i = 0; i < pages; i++) {
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

// Find all consecutive board sets for an expansion in a message list
function findBoardSets(botMsgs, anchorTitle, panelCount) {
  const sets = [];
  let i = 0;
  while (i < botMsgs.length) {
    const isAnchor = botMsgs[i].embeds.some(
      (e) => e.title && (e.title === anchorTitle || e.title.startsWith(anchorTitle + ' ('))
    );
    if (isAnchor) {
      const set = botMsgs.slice(i, i + panelCount);
      if (set.length === panelCount) { sets.push(set); i += panelCount; continue; }
    }
    i++;
  }
  return sets;
}

async function tryDelete(msg) {
  try { await msg.delete(); return true; } catch { return false; }
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

/**
 * Strip "Available Now" fields from a Daily Raid Summary embed.
 * Returns the cleaned embed data (for use with msg.edit).
 */
function stripAvailableNow(originalEmbed) {
  const { EmbedBuilder } = require('discord.js');
  const e = new EmbedBuilder()
    .setColor(originalEmbed.color || 0x4b0082)
    .setTitle(originalEmbed.title || '📅 Daily Raid Summary')
    .setTimestamp(originalEmbed.timestamp ? new Date(originalEmbed.timestamp) : null);

  if (originalEmbed.description) e.setDescription(originalEmbed.description);

  // Keep all fields EXCEPT those whose name includes "Available Now"
  const keptFields = (originalEmbed.fields || []).filter(
    (f) => !f.name.includes('Available Now') && !f.name.includes('🟢 Available')
  );
  if (keptFields.length > 0) e.addFields(keptFields);

  return e;
}

async function runCleanup(client) {
  const botId     = client.user.id;
  const bosses    = getBosses();
  const killState = getAllState();
  const results   = [];

  const mainChannelId = process.env.TIMER_CHANNEL_ID;
  if (!mainChannelId) { console.warn('[cleanup] TIMER_CHANNEL_ID not set'); return results; }
    const mainChannel = await client.channels.fetch(mainChannelId);

    // ══════════════════════════════════════════════════════════════
    // MAIN CHANNEL
    // ══════════════════════════════════════════════════════════════
    const mainBotMsgs = await fetchBotMessages(mainChannel, botId);

    // Identify canonical slot IDs from env/state
    const canonicalIds = new Set([
      getSummaryMessageId(), getSpawningTomorrowId(),
      getDailySummaryMessageId(), getThreadLinksMessageId(),
    ].filter(Boolean));

    // Walk messages oldest-first: first occurrence of each slot title = canonical
    const seenSlotTitle = new Set();
    let seenThreadLinks = false;

    for (const msg of mainBotMsgs) {
      for (const embed of msg.embeds) {
        if (MAIN_SLOT_TITLES.has(embed.title) && !seenSlotTitle.has(embed.title)) {
          seenSlotTitle.add(embed.title);
          canonicalIds.add(msg.id);
          // Re-anchor state pointers to earliest if they differ
          if (embed.title === '📊 Active Cooldowns'               && !getSummaryMessageId())      setSummaryMessageId(msg.id);
          if (embed.title === '🌅 Spawning in the Next 24 Hours'  && !getSpawningTomorrowId())    setSpawningTomorrowId(msg.id);
          if (embed.title === '📅 Daily Raid Summary'             && !getDailySummaryMessageId()) setDailySummaryMessageId(msg.id);
          break;
        }
      }
      if (isThreadLinksMsg(msg) && !seenThreadLinks) {
        seenThreadLinks = true;
        canonicalIds.add(msg.id);
        if (!getThreadLinksMessageId()) setThreadLinksMessageId(msg.id);
      }
    }

    // Delete everything that isn't canonical and shouldn't be in main channel
    let deletedMain = 0;
    const seenDupTitle  = new Set();
    let   dupThreadLinks = false;

    for (const msg of mainBotMsgs) {
      if (canonicalIds.has(msg.id)) continue;
      let del = false;

      // Transient or old-format board embed
      if (msg.embeds.some((e) => isTransient(e.title) || OLD_BOARD_TITLES.has(e.title))) del = true;

      // Duplicate canonical slot embed
      if (!del) {
        for (const embed of msg.embeds) {
          if (MAIN_SLOT_TITLES.has(embed.title)) {
            if (seenDupTitle.has(embed.title)) { del = true; break; }
            seenDupTitle.add(embed.title);
          }
        }
      }

      // Duplicate thread-link message
      if (!del && isThreadLinksMsg(msg)) {
        if (dupThreadLinks) del = true;
        else dupThreadLinks = true;
      }

      if (del && await tryDelete(msg)) deletedMain++;
    }

    if (deletedMain > 0) results.push(`🗑️ Main channel: deleted ${deletedMain} message(s)`);

    // Edit canonical slots in place
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
      const tId = getThreadId(exp);
      return tId ? `${EXP_LABELS[exp]} → <#${tId}>` : `${EXP_LABELS[exp]} → *(no thread)*`;
    }).join('\n');
    await editOrPost(mainChannel, getThreadLinksMessageId(),
      { content: threadLinksContent, embeds: [], components: [] }, setThreadLinksMessageId);
    results.push('✅ Slot 4: Thread links (single message)');

    // ══════════════════════════════════════════════════════════════
    // EXPANSION THREADS
    // ══════════════════════════════════════════════════════════════
    for (const exp of EXPANSION_ORDER) {
      const threadId = getThreadId(exp);
      if (!threadId) { results.push(`⬜ ${exp} — no thread`); continue; }

      try {
        const thread  = await client.channels.fetch(threadId);
        const botMsgs = await fetchBotMessages(thread, botId);
        const meta    = EXPANSION_META[exp];
        const panels  = buildExpansionPanels(exp, bosses, killState);

        const protectedInThread = new Set();

        // ── Board panels: keep earliest set, delete duplicates ────────────
        const boardSets = findBoardSets(botMsgs, meta.label, panels.length);
        if (boardSets.length > 0) {
          boardSets[0].forEach((m) => protectedInThread.add(m.id));
          saveExpansionBoard(exp, boardSets[0].map((m) => m.id));

          let delPanels = 0;
          for (let si = 1; si < boardSets.length; si++) {
            for (const msg of boardSets[si]) {
              if (!protectedInThread.has(msg.id) && await tryDelete(msg)) delPanels++;
            }
          }
          if (delPanels > 0) results.push(`🗑️ ${exp}: deleted ${delPanels} duplicate board panel(s)`);
          results.push(`📌 ${exp}: anchored to earliest board`);
        }

        // ── Cooldown cards: keep EARLIEST "X — Active Cooldowns", delete rest ──
        const cooldownTitle = `${meta.emoji} ${exp} — Active Cooldowns`;
        const allCooldownMsgs = botMsgs.filter((m) =>
          m.embeds.some((e) => e.title && e.title.endsWith('— Active Cooldowns'))
        );
        if (allCooldownMsgs.length > 0) {
          // Earliest is canonical
          protectedInThread.add(allCooldownMsgs[0].id);
          // Update state if it differs
          if (getThreadCooldownId(exp) !== allCooldownMsgs[0].id) {
            setThreadCooldownId(exp, allCooldownMsgs[0].id);
          }
          let delCooldowns = 0;
          for (let ci = 1; ci < allCooldownMsgs.length; ci++) {
            if (await tryDelete(allCooldownMsgs[ci])) delCooldowns++;
          }
          if (delCooldowns > 0) results.push(`🗑️ ${exp}: deleted ${delCooldowns} duplicate cooldown card(s)`);
        }

        // ── Delete transient messages and stray thread-link messages ───────
        let delTransient = 0;
        for (const msg of botMsgs) {
          if (protectedInThread.has(msg.id)) continue;
          const shouldDel =
            msg.embeds.some((e) => isTransient(e.title)) ||  // zone cards, alerts, spawned
            isThreadLinksMsg(msg);                            // thread links belong in main channel only
          if (shouldDel && await tryDelete(msg)) delTransient++;
        }
        if (delTransient > 0) results.push(`🗑️ ${exp}: deleted ${delTransient} transient/misplaced message(s)`);

        // ── Update thread cooldown card ────────────────────────────────────
        await editOrPost(thread, getThreadCooldownId(exp),
          { embeds: [buildExpansionCooldownCard(exp, bosses, killState)] },
          (id) => setThreadCooldownId(exp, id));

        // ── Update board panels ────────────────────────────────────────────
        const boardResult = await postOrUpdateExpansionBoard(client, exp, threadId, bosses);
        results.push(`${boardResult.ok ? '✅' : '❌'} ${exp}: board ${boardResult.action || boardResult.reason}`);

      } catch (err) {
        results.push(`❌ ${exp}: ${err?.message}`);
      }
    }

    // ══════════════════════════════════════════════════════════════
    // HISTORIC KILLS THREAD
    // ══════════════════════════════════════════════════════════════
    const histThreadId = process.env.HISTORIC_KILLS_THREAD_ID;
    if (histThreadId) {
      try {
        const histThread  = await client.channels.fetch(histThreadId);
        const histBotMsgs = await fetchBotMessages(histThread, botId, 300);

        // Find all Daily Raid Summary messages, group by date description
        const summaryMsgsByDate = {}; // dateKey → [Message, ...]
        for (const msg of histBotMsgs) {
          if (msg.embeds.some((e) => e.title === '📅 Daily Raid Summary')) {
            const embed   = msg.embeds.find((e) => e.title === '📅 Daily Raid Summary');
            const dateKey = (embed.description || '').trim() || msg.id;
            if (!summaryMsgsByDate[dateKey]) summaryMsgsByDate[dateKey] = [];
            summaryMsgsByDate[dateKey].push(msg);
          }
        }

        let deletedHistoric = 0, editedHistoric = 0;

        for (const [dateKey, msgs] of Object.entries(summaryMsgsByDate)) {
          // Sort oldest first — keep earliest, delete duplicates
          msgs.sort((a, b) => a.createdTimestamp - b.createdTimestamp);

          // Delete duplicates (keep index 0)
          for (let i = 1; i < msgs.length; i++) {
            if (await tryDelete(msgs[i])) deletedHistoric++;
          }

          // Edit the canonical one: strip "Available Now" if present
          const canonical = msgs[0];
          const embed     = canonical.embeds.find((e) => e.title === '📅 Daily Raid Summary');
          const hasAvailableNow = (embed?.fields || []).some(
            (f) => f.name.includes('Available Now') || f.name.includes('🟢 Available')
          );
          if (hasAvailableNow) {
            try {
              await canonical.edit({ embeds: [stripAvailableNow(embed)] });
              editedHistoric++;
            } catch {}
          }
        }

        if (deletedHistoric > 0) results.push(`🗑️ Historic Kills: deleted ${deletedHistoric} duplicate Daily Summary message(s)`);
        if (editedHistoric  > 0) results.push(`✏️ Historic Kills: removed "Available Now" from ${editedHistoric} Daily Summary message(s)`);

      } catch (err) {
        results.push(`❌ Historic Kills thread: ${err?.message}`);
      }
    }

  return results;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('cleanup')
    .setDescription('Delete transient/duplicate messages, anchor earliest boards, update all cards'),

  async execute(interaction) {
    if (!hasAllowedRole(interaction.member)) {
      return interaction.reply({ flags: MessageFlags.Ephemeral, content: `❌ You need one of these roles: ${allowedRolesList()}` });
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const results = await runCleanup(interaction.client);
    await interaction.editReply(results.join('\n').slice(0, 2000) || '✅ Done');
  },

  runCleanup,
};
