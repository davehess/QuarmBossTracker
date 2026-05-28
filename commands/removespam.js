// commands/removespam.js — Bulk-delete spammy auto-parse cards from
// AUTOPARSE_TEST_THREAD_ID. Officer-gated.
//
// Targets the cards left behind by the historical backfill before v2.5.18
// stopped them at the source — and any future trash-mob single-parser
// uploads. "Spam" means BOTH of:
//   1. Single-source — the footer starts with "1 parser" (no other parser
//      ever merged into this card, so it's a one-off and not validated)
//   2. Not a boss — the mob name in the title does not slug-match any
//      boss in bosses.json
//
// Both conditions must hold. A single-parser kill of an actual boss
// stays (rare but real); a multi-parser trash mob stays (we want to keep
// merged data even on non-bosses — it's how we get DPS coverage of named
// pulls outside the boss list).
//
// `hours` (default 24, max 168) bounds the scan. We page bot messages
// from newest to oldest and stop when we cross the window.

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { hasOfficerRole, officerRolesList }  = require('../utils/roles');
const { getAllAgentTestCards, setAgentTestCard } = require('../utils/state');
const { findBossFromName }                  = require('./parse');

function getBosses() {
  delete require.cache[require.resolve('../data/bosses.json')];
  return require('../data/bosses.json');
}

// Strip the title prefix ("📊 🤖 ") and the appended fight time suffix
// (" · 1:23:45 PM") that index.js adds when posting the card. Falls back
// to the raw title if either is missing.
function extractMobName(rawTitle) {
  if (!rawTitle) return '';
  let t = rawTitle;
  // Drop everything up to and including the last emoji + space pair.
  // "📊 🤖 zombie of an Unrest noble  ·  2:11:00 PM" → "zombie of an Unrest noble  ·  2:11:00 PM"
  t = t.replace(/^[^A-Za-z]+/, '');
  // Drop trailing "  ·  TIME" appended by index.js.
  t = t.replace(/\s+·\s+\d{1,2}:\d{2}(:\d{2})?\s*[AP]M\s*$/i, '');
  return t.trim();
}

async function fetchRecentBotMessages(channel, botId, sinceMs) {
  const out = [];
  let beforeId = null;
  // Cap at 500 messages so a huge thread doesn't burn the interaction budget.
  for (let page = 0; page < 10; page++) {
    const opts = { limit: 50 };
    if (beforeId) opts.before = beforeId;
    const batch = await channel.messages.fetch(opts);
    if (batch.size === 0) break;
    let crossedWindow = false;
    for (const m of batch.values()) {
      if (m.createdTimestamp < sinceMs) { crossedWindow = true; break; }
      if (m.author.id === botId) out.push(m);
    }
    if (crossedWindow) break;
    beforeId = batch.last().id;
  }
  return out;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('removespam')
    .setDescription('Delete single-parser, non-boss parse cards from the auto-parse thread (officers only)')
    .addIntegerOption(o => o
      .setName('hours')
      .setDescription('Look back this many hours (default 24, max 168)')
      .setMinValue(1)
      .setMaxValue(168)
      .setRequired(false)),

  async execute(interaction) {
    if (!hasOfficerRole(interaction.member)) {
      return interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: `❌ Only officers can run /removespam. Required roles: ${officerRolesList()}`,
      });
    }

    const testThreadId = process.env.AUTOPARSE_TEST_THREAD_ID;
    if (!testThreadId) {
      return interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: '❌ AUTOPARSE_TEST_THREAD_ID env var is not set — nothing to clean.',
      });
    }

    const hours   = interaction.options.getInteger('hours') ?? 24;
    const sinceMs = Date.now() - hours * 3600 * 1000;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const thread = await interaction.client.channels.fetch(testThreadId).catch(() => null);
    if (!thread) return interaction.editReply('❌ Could not access the auto-parse thread.');

    const botId = interaction.client.user.id;
    const msgs  = await fetchRecentBotMessages(thread, botId, sinceMs);
    const bosses = getBosses();

    const candidates = [];
    let totalScanned = 0;
    let skippedMultiParser = 0;
    let skippedBoss = 0;
    let skippedNotParseCard = 0;

    for (const m of msgs) {
      totalScanned++;
      const embed = m.embeds?.[0];
      if (!embed) { skippedNotParseCard++; continue; }
      const footer = embed.footer?.text || '';
      // Parse cards always start their footer with "N parser(s)" — the
      // session leaderboard / other embeds in this thread don't.
      const parserMatch = footer.match(/^(\d+)\s+parser/);
      if (!parserMatch) { skippedNotParseCard++; continue; }
      const parserCount = parseInt(parserMatch[1], 10);
      if (parserCount > 1) { skippedMultiParser++; continue; }

      const mobName = extractMobName(embed.title);
      const matched = findBossFromName(mobName, bosses);
      if (matched) { skippedBoss++; continue; }

      candidates.push({ msg: m, mobName });
    }

    // Delete + track which agentTestCards entries we orphaned.
    const cards = getAllAgentTestCards();
    const idToKey = new Map();
    for (const k of Object.keys(cards)) {
      if (cards[k]?.messageId) idToKey.set(cards[k].messageId, k);
    }

    let deleted = 0;
    let stateCleared = 0;
    for (const c of candidates) {
      try {
        await c.msg.delete();
        deleted++;
      } catch { /* already gone or insufficient perms */ }
      const key = idToKey.get(c.msg.id);
      if (key) { setAgentTestCard(key, null); stateCleared++; }
    }

    const lines = [
      `✅ Spam cleanup (last ${hours}h).`,
      `• Scanned ${totalScanned} bot message${totalScanned === 1 ? '' : 's'} in the auto-parse thread.`,
      `• Deleted **${deleted}** single-parser non-boss card${deleted === 1 ? '' : 's'}.`,
      `• Kept ${skippedMultiParser} multi-parser, ${skippedBoss} boss-matched, ${skippedNotParseCard} non-parse-card message${skippedNotParseCard === 1 ? '' : 's'}.`,
      stateCleared > 0
        ? `• Cleared ${stateCleared} stale dedup window${stateCleared === 1 ? '' : 's'} so future parses re-post fresh cards.`
        : '• No in-memory dedup state needed clearing.',
    ];
    return interaction.editReply(lines.join('\n'));
  },
};
