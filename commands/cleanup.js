// commands/cleanup.js
// Rule: the EARLIEST bot messages in any channel/thread are canonical.
// Never replaces with ".". Always deletes transient/duplicate messages.
//
// Transient messages deleted from main channel AND all expansion threads:
//   ☠️ <zone>              — zone kill cards (old format, replaced by thread zone cards)
//   ⚠️ <boss> spawning soon!
//   🟢 <boss> has spawned!
//   📣 Pack Takedown: <boss>  — old announce format (if not already archived)
//
// Structural messages — keep earliest, delete duplicates:
//   Main channel: Active Cooldowns, Spawning Tomorrow, Daily Summary, Thread Links
//   Each thread: <Expansion> — Active Cooldowns card, board panel sets

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { EXPANSION_ORDER, getThreadId, EXPANSION_META } = require('../utils/config');
const { postOrUpdateExpansionBoard } = require('../utils/killops');
const {
  getSummaryMessageId,      setSummaryMessageId,
  getSpawningTomorrowId,    setSpawningTomorrowId,
  getDailySummaryMessageId, setDailySummaryMessageId,
  getThreadLinksMessageId,  setThreadLinksMessageId,
  getThreadCooldownId,      setThreadCooldownId,
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

// Messages whose embed titles mean "delete this — it's transient"
function isTransientEmbed(title) {
  if (!title) return false;
  return (
    title.startsWith('☠️ ')           ||  // zone kill cards  "☠️ Plane of Fear"
    title.startsWith('⚠️ ')           ||  // spawn alerts     "⚠️ Magi Rokyl spawning soon!"
    title.startsWith('🟢 ')           ||  // spawned notices  "🟢 Magi Rokyl has spawned!"
    title.startsWith('📣 Pack Takedown')  // old announce format
  );
}

// Old-format board embed titles (pre-thread architecture — in main channel, delete them)
const OLD_BOARD_TITLES = new Set([
  '⚔️ Classic EverQuest', '🦎 Ruins of Kunark', '❄️ Scars of Velious',
  '🌙 Shadows of Luclin', '🔥 Planes of Power', '🔥 Planes of Power — Reserved',
  '⚔️ Classic EverQuest (1/2)', '🦎 Ruins of Kunark (1/2)',
  '❄️ Scars of Velious (1/2)', '❄️ Scars of Velious (2/2)',
  '❄️ Scars of Velious (1/3)', '❄️ Scars of Velious (2/3)', '❄️ Scars of Velious (3/3)',
  '🌙 Shadows of Luclin (1/2)', '🌙 Shadows of Luclin (2/2)',
  '🌙 Shadows of Luclin (1/3)', '🌙 Shadows of Luclin (2/3)', '🌙 Shadows of Luclin (3/3)',
]);

// Canonical slot titles in main channel (keep earliest, delete later duplicates)
const MAIN_SLOT_TITLES = new Set([
  '📊 Active Cooldowns',
  '🌅 Spawning in the Next 24 Hours',
  '📅 Daily Raid Summary',
]);

// Thread link message pattern (text content, no embed)
function isThreadLinksMessage(msg) {
  return !msg.embeds.length &&
    msg.content.includes('→') &&
    (msg.content.includes('Classic') || msg.content.includes('Kunark') || msg.content.includes('Luclin'));
}

function getBosses() {
  delete require.cache[require.resolve('../data/bosses.json')];
  return require('../data/bosses.json');
}

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
 * Purge transient and old-format messages from a channel.
 * Returns count deleted.
 */
async function purgeTransient(botMsgs, protectedIds) {
  let deleted = 0;
  for (const msg of botMsgs) {
    if (protectedIds.has(msg.id)) continue;
    const shouldDelete =
      msg.embeds.some((e) => isTransientEmbed(e.title)) ||
      msg.embeds.some((e) => OLD_BOARD_TITLES.has(e.title));
    if (shouldDelete) {
      if (await tryDelete(msg)) deleted++;
    }
  }
  return deleted;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('cleanup')
    .setDescription('Delete transient/duplicate messages, anchor earliest boards, update all cards'),

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
    const mainBotMsgs = await fetchBotMessages(mainChannel, botId);

    // ── MAIN CHANNEL: identify canonical slot message IDs ─────────────────
    // For each slot type, the EARLIEST occurrence is canonical.
    // Later duplicates get deleted.
    const canonicalIds = new Set([
      getSummaryMessageId(),
      getSpawningTomorrowId(),
      getDailySummaryMessageId(),
      getThreadLinksMessageId(),
    ].filter(Boolean));

    // Find earliest of each slot type if not already in canonical set
    const seenSlotTitles = new Set();
    let earliestThreadLinks = getThreadLinksMessageId();

    for (const msg of mainBotMsgs) {
      // Check canonical embed slots
      for (const embed of msg.embeds) {
        if (MAIN_SLOT_TITLES.has(embed.title)) {
          if (!seenSlotTitles.has(embed.title)) {
            seenSlotTitles.add(embed.title);
            canonicalIds.add(msg.id);
            // Update state to point to earliest if different
            if (embed.title === '📊 Active Cooldowns' && msg.id !== getSummaryMessageId()) {
              setSummaryMessageId(msg.id); canonicalIds.add(msg.id);
            } else if (embed.title === '🌅 Spawning in the Next 24 Hours' && msg.id !== getSpawningTomorrowId()) {
              setSpawningTomorrowId(msg.id); canonicalIds.add(msg.id);
            } else if (embed.title === '📅 Daily Raid Summary' && msg.id !== getDailySummaryMessageId()) {
              setDailySummaryMessageId(msg.id); canonicalIds.add(msg.id);
            }
          }
          break;
        }
      }
      // Check thread links message (text-only, no embed)
      if (isThreadLinksMessage(msg) && !earliestThreadLinks) {
        earliestThreadLinks = msg.id;
        setThreadLinksMessageId(msg.id);
        canonicalIds.add(msg.id);
      }
    }

    // ── MAIN CHANNEL: delete transient + old board + duplicate slot messages ──
    let deletedMain = 0;
    const seenSlotDups = new Set();
    let seenThreadLinks = false;

    for (const msg of mainBotMsgs) {
      if (canonicalIds.has(msg.id)) continue; // always keep canonical IDs

      let shouldDelete = false;

      // Transient and old-format embeds
      if (msg.embeds.some((e) => isTransientEmbed(e.title) || OLD_BOARD_TITLES.has(e.title))) {
        shouldDelete = true;
      }

      // Duplicate slot embeds (2nd+ occurrence of same title)
      for (const embed of msg.embeds) {
        if (MAIN_SLOT_TITLES.has(embed.title)) {
          if (seenSlotDups.has(embed.title)) { shouldDelete = true; break; }
          else seenSlotDups.add(embed.title);
        }
      }

      // Duplicate thread links messages (2nd+ occurrence)
      if (!shouldDelete && isThreadLinksMessage(msg)) {
        if (seenThreadLinks) { shouldDelete = true; }
        else seenThreadLinks = true;
      }

      if (shouldDelete && await tryDelete(msg)) deletedMain++;
    }

    if (deletedMain > 0) results.push(`🗑️ Main channel: deleted ${deletedMain} transient/duplicate message(s)`);

    // ── MAIN CHANNEL: edit canonical slots in place ───────────────────────
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
    results.push('✅ Slot 4: Thread links (one message)');

    // ── EXPANSION THREADS ─────────────────────────────────────────────────
    for (const exp of EXPANSION_ORDER) {
      const threadId = getThreadId(exp);
      if (!threadId) { results.push(`⬜ ${exp} — no thread`); continue; }

      try {
        const thread  = await client.channels.fetch(threadId);
        const botMsgs = await fetchBotMessages(thread, botId);
        const meta    = EXPANSION_META[exp];
        const panels  = buildExpansionPanels(exp, bosses, killState);

        // Collect IDs to protect (board panel sets will be identified below)
        const protectedInThread = new Set();

        // Find board sets — keep earliest, delete rest
        const boardSets = findBoardSets(botMsgs, meta.label, panels.length);
        if (boardSets.length > 0) {
          const earliest = boardSets[0];
          earliest.forEach((m) => protectedInThread.add(m.id));
          saveExpansionBoard(exp, earliest.map((m) => m.id));
          results.push(`📌 ${exp}: anchored to earliest board`);

          let deletedPanels = 0;
          for (let si = 1; si < boardSets.length; si++) {
            for (const msg of boardSets[si]) {
              if (!protectedInThread.has(msg.id) && await tryDelete(msg)) deletedPanels++;
            }
          }
          if (deletedPanels > 0) results.push(`🗑️ ${exp}: deleted ${deletedPanels} duplicate panel(s)`);
        }

        // Protect the thread cooldown card (earliest "X — Active Cooldowns" embed)
        const cooldownMsg = botMsgs.find((m) =>
          m.embeds.some((e) => e.title && e.title.endsWith('— Active Cooldowns'))
        );
        if (cooldownMsg) protectedInThread.add(cooldownMsg.id);

        // Delete transient messages in thread (zone kill cards, spawn alerts, spawned notices)
        const deletedThread = await purgeTransient(botMsgs, protectedInThread);
        if (deletedThread > 0) results.push(`🗑️ ${exp} thread: deleted ${deletedThread} transient message(s)`);

        // Update thread cooldown card
        await editOrPost(thread, getThreadCooldownId(exp),
          { embeds: [buildExpansionCooldownCard(exp, bosses, killState)] },
          (id) => setThreadCooldownId(exp, id));

        // Update board panels
        const boardResult = await postOrUpdateExpansionBoard(client, exp, threadId, bosses);
        results.push(`${boardResult.ok ? '✅' : '❌'} ${exp}: board ${boardResult.action || boardResult.reason}`);

      } catch (err) {
        results.push(`❌ ${exp}: ${err?.message}`);
      }
    }

    await interaction.editReply(results.join('\n'));
  },
};
