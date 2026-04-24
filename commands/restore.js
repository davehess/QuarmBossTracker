// commands/restore.js
// /restore <message_link>
//
// Restores kill state from any of these bot-posted message types:
//   📊 Active Cooldowns          — main channel summary (boss name, zone, next spawn time)
//   🌙 Luclin — Active Cooldowns — expansion thread cooldown card (same format)
//   📅 Daily Raid Summary        — parses "Killed Today" list + reconstructs nextSpawn
//
// After restoring state, refreshes all boards, cooldown cards, summary and spawning cards.

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { hasAllowedRole, allowedRolesList } = require('../utils/roles');
const { EXPANSION_ORDER, getThreadId } = require('../utils/config');
const { EXPANSION_META } = require('../utils/config');
const {
  postOrUpdateExpansionBoard,
  refreshSummaryCard,
  refreshSpawningTomorrowCard,
  refreshThreadCooldownCard,
} = require('../utils/killops');

function getBosses() {
  delete require.cache[require.resolve('../data/bosses.json')];
  return require('../data/bosses.json');
}

function parseMessageLink(link) {
  const m = link.trim().match(/discord(?:app)?\.com\/channels\/(\d+)\/(\d+)\/(\d+)/);
  if (!m) return null;
  return { guildId: m[1], channelId: m[2], messageId: m[3] };
}

/**
 * Find a boss in bosses.json by name and optionally zone.
 * Tries: exact name+zone → exact name → nickname → partial name.
 */
function findBoss(bosses, bossName, zone) {
  const nl = bossName.toLowerCase();
  const zl = (zone || '').toLowerCase();
  return (
    bosses.find((b) => b.name.toLowerCase() === nl && b.zone.toLowerCase() === zl) ||
    bosses.find((b) => b.name.toLowerCase() === nl) ||
    bosses.find((b) => (b.nicknames || []).some((n) => n.toLowerCase() === nl)) ||
    bosses.find((b) => b.name.toLowerCase().includes(nl) || nl.includes(b.name.toLowerCase())) ||
    null
  );
}

/**
 * Parse a Discord <t:unix:?> tag or date string into ms timestamp.
 */
function parseNextSpawnMs(text) {
  const discord = text.match(/<t:(\d+)(?::[A-Za-z])?>/);
  if (discord) return parseInt(discord[1]) * 1000;

  // "April 29, 2026 10:35 AM" style
  const human = text.match(/([A-Z][a-z]+ \d{1,2},? \d{4})\s+(\d{1,2}:\d{2}\s*[AP]M)/i);
  if (human) {
    const d = new Date(`${human[1]} ${human[2]} EST`);
    if (!isNaN(d)) return d.getTime();
  }
  return null;
}

/**
 * Parse "📊 Active Cooldowns" or "<Expansion> — Active Cooldowns" embed.
 * Returns array of { bossName, zone, nextSpawnMs }
 *
 * Each field value looks like:
 *   🐉 **Lord Nagafen** (Nagafen's Lair) — <t:1745900100:F>  <t:1745900100:R>
 *   🐉 **Lord Nagafen** (Nagafen's Lair) — April 29, 2026 10:35 AM  in 5 days
 */
function parseCooldownEmbed(embed) {
  const entries = [];
  for (const field of (embed.fields || [])) {
    for (const line of field.value.split('\n')) {
      // Match: (anything) **Boss Name** (Zone) — timestamp...
      const m = line.match(/\*\*([^*]+)\*\*\s*\(([^)]+)\)\s*[—–-]\s*(.+)/);
      if (!m) continue;
      const bossName   = m[1].trim();
      const zone       = m[2].trim();
      const nextSpawnMs = parseNextSpawnMs(m[3].trim());
      entries.push({ bossName, zone, nextSpawnMs });
    }
  }
  return entries;
}

/**
 * Parse "📅 Daily Raid Summary" embed.
 * Looks at the "Killed Today" field and reconstructs nextSpawn = killedAt + timerHours.
 *
 * Each line in the field:
 *   • **Lord Nagafen** (Nagafen's Lair) — <t:unix:t> by <@userId>
 *   • **Lord Nagafen** (Nagafen's Lair) — 10:30 AM by @Username
 */
function parseDailySummaryEmbed(embed, bosses) {
  const entries = [];
  const killedField = (embed.fields || []).find((f) =>
    f.name.includes('Killed Today') || f.name.includes('Killed ')
  );
  if (!killedField) return entries;

  for (const line of killedField.value.split('\n')) {
    // Match: • **Boss Name** (Zone) — <t:unix:t> by ...
    //    or: • **Boss Name** (Zone) — time by ...
    const m = line.match(/[•·-]?\s*\*\*([^*]+)\*\*\s*\(([^)]+)\)\s*[—–-]\s*(<t:\d+[^>]*>|[\d:]+\s*[AP]M)\s*by/i);
    if (!m) continue;

    const bossName  = m[1].trim();
    const zone      = m[2].trim();
    const timeStr   = m[3].trim();

    // Parse the kill time
    let killedAt = null;
    const discordTs = timeStr.match(/<t:(\d+)/);
    if (discordTs) {
      killedAt = parseInt(discordTs[1]) * 1000;
    } else {
      // Try to parse "10:30 AM" as today's date
      const today = new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'long', day: 'numeric', year: 'numeric' });
      const d = new Date(`${today} ${timeStr} EST`);
      if (!isNaN(d)) killedAt = d.getTime();
    }

    if (killedAt) entries.push({ bossName, zone, killedAt });
  }
  return entries;
}

/**
 * Write kill entries directly to state.json atomically.
 * Merges with existing state — does not wipe other data.
 */
function writeKillsToState(killEntries) {
  const fs   = require('fs');
  const path = require('path');
  const f    = path.join(__dirname, '../data/state.json');

  let raw;
  try { raw = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { raw = {}; }
  if (!raw.bosses) raw.bosses = {};

  for (const { bossId, killedAt, nextSpawn } of killEntries) {
    raw.bosses[bossId] = { killedAt, nextSpawn, killedBy: 'restored' };
  }

  const tmp = f + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(raw, null, 2), 'utf8');
  fs.renameSync(tmp, f);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('restore')
    .setDescription('Restore kill state from any Active Cooldowns or Daily Summary message link')
    .addStringOption((opt) =>
      opt.setName('message_link')
        .setDescription('Discord message link — right-click any Active Cooldowns or Daily Summary → Copy Message Link')
        .setRequired(true)
    ),

  async execute(interaction) {
    if (!hasAllowedRole(interaction.member)) {
      return interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: `❌ You need one of these roles: ${allowedRolesList()}`,
      });
    }

    const link   = interaction.options.getString('message_link').trim();
    const parsed = parseMessageLink(link);

    if (!parsed) {
      return interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: '❌ Invalid message link. Right-click the message → Copy Message Link.',
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // Fetch the message
    let refMsg;
    try {
      const refChannel = await interaction.client.channels.fetch(parsed.channelId);
      refMsg = await refChannel.messages.fetch(parsed.messageId);
    } catch (err) {
      return interaction.editReply(`❌ Could not fetch that message: ${err?.message}`);
    }

    const bosses = getBosses();
    const now    = Date.now();

    // Determine which embed type this is
    const embed = refMsg.embeds[0];
    if (!embed) {
      return interaction.editReply('❌ That message has no embed. Link to an Active Cooldowns or Daily Raid Summary message.');
    }

    const title = embed.title || '';
    let   rawEntries     = [];   // { bossName, zone, nextSpawnMs? killedAt? }
    let   sourceType     = '';

    if (title === '📊 Active Cooldowns' || title.endsWith('— Active Cooldowns')) {
      // Main channel summary OR expansion thread cooldown card
      sourceType  = title === '📊 Active Cooldowns' ? 'main Active Cooldowns' : `"${title}"`;
      rawEntries  = parseCooldownEmbed(embed).map((e) => ({ ...e, source: 'cooldown' }));
    } else if (title === '📅 Daily Raid Summary') {
      sourceType  = 'Daily Raid Summary';
      rawEntries  = parseDailySummaryEmbed(embed, bosses).map((e) => ({ ...e, source: 'daily' }));
    } else {
      return interaction.editReply(
        `❌ Unrecognised embed type: "${title}"\n` +
        `Supported: "📊 Active Cooldowns", any "<Expansion> — Active Cooldowns", "📅 Daily Raid Summary".`
      );
    }

    if (rawEntries.length === 0) {
      return interaction.editReply(`⚠️ Found the "${title}" embed but could not parse any boss entries from it.`);
    }

    // Resolve entries to bosses + compute nextSpawn
    const killsToWrite = [];
    const restored     = [];
    const alreadyGone  = [];
    const notFound     = [];

    for (const entry of rawEntries) {
      const boss = findBoss(bosses, entry.bossName, entry.zone);
      if (!boss) { notFound.push(`${entry.bossName} (${entry.zone || '?'})`); continue; }

      if (entry.source === 'cooldown') {
        // nextSpawnMs is the authoritative spawn time
        if (!entry.nextSpawnMs || entry.nextSpawnMs <= now) {
          alreadyGone.push(boss.name); continue;
        }
        const killedAt = entry.nextSpawnMs - boss.timerHours * 3600000;
        killsToWrite.push({ bossId: boss.id, killedAt, nextSpawn: entry.nextSpawnMs });
        restored.push(`${boss.emoji || '•'} **${boss.name}** → <t:${Math.floor(entry.nextSpawnMs / 1000)}:F>`);

      } else if (entry.source === 'daily') {
        // killedAt is the kill time from the summary; reconstruct nextSpawn
        const nextSpawn = entry.killedAt + boss.timerHours * 3600000;
        if (nextSpawn <= now) { alreadyGone.push(boss.name); continue; }
        killsToWrite.push({ bossId: boss.id, killedAt: entry.killedAt, nextSpawn });
        restored.push(`${boss.emoji || '•'} **${boss.name}** → <t:${Math.floor(nextSpawn / 1000)}:F>`);
      }
    }

    if (killsToWrite.length === 0) {
      const lines = ['⚠️ No active cooldowns to restore from this message.'];
      if (alreadyGone.length) lines.push(`All ${alreadyGone.length} boss timer(s) have already expired.`);
      if (notFound.length) lines.push(`Could not match: ${notFound.join(', ')}`);
      return interaction.editReply(lines.join('\n'));
    }

    // Write to state.json
    writeKillsToState(killsToWrite);

    // Refresh everything
    const mainChannelId = process.env.TIMER_CHANNEL_ID;
    const freshBosses   = getBosses();

    await Promise.allSettled(
      EXPANSION_ORDER.map(async (exp) => {
        const threadId = getThreadId(exp);
        if (!threadId) return;
        await postOrUpdateExpansionBoard(interaction.client, exp, threadId, freshBosses).catch(console.warn);
        await refreshThreadCooldownCard(interaction.client, exp, threadId, freshBosses).catch(console.warn);
      })
    );
    if (mainChannelId) {
      await refreshSummaryCard(interaction.client, mainChannelId, freshBosses).catch(console.warn);
      await refreshSpawningTomorrowCard(interaction.client, mainChannelId, freshBosses).catch(console.warn);
    }

    // Build reply
    const lines = [`✅ **State restored from ${sourceType}**\n`];
    if (restored.length > 0) {
      lines.push(`**Restored (${restored.length} active cooldown${restored.length !== 1 ? 's' : ''}):**`);
      lines.push(...restored);
    }
    if (alreadyGone.length > 0) lines.push(`\n⏰ **Expired (${alreadyGone.length}):** ${alreadyGone.join(', ')}`);
    if (notFound.length > 0)    lines.push(`\n❓ **Not matched (${notFound.length}):** ${notFound.join(', ')}`);
    lines.push('\nAll boards and cards refreshed.');

    await interaction.editReply(lines.join('\n').slice(0, 2000));
  },
};
