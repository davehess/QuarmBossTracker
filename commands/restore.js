// commands/restore.js
// /restore <message_link>
//
// Takes a Discord message link to any previous "📊 Active Cooldowns" embed posted by this bot.
// Parses the boss lines, matches them to bosses.json, reconstructs kill state, then:
//   - Saves the restored state to state.json
//   - Refreshes all expansion thread boards (button states)
//   - Refreshes all thread cooldown cards
//   - Refreshes main channel Active Cooldowns and Spawning Tomorrow cards
//
// Supports message links in the forms:
//   https://discord.com/channels/GUILD_ID/CHANNEL_ID/MESSAGE_ID
//   https://discordapp.com/channels/...

const { SlashCommandBuilder, MessageFlags, EmbedBuilder } = require('discord.js');
const { hasAllowedRole, allowedRolesList } = require('../utils/roles');
const { EXPANSION_ORDER, getThreadId, getBossExpansion } = require('../utils/config');
const {
  getAllState, recordKill, clearKill, getBossState,
} = require('../utils/state');
const {
  postKillUpdate,
  postOrUpdateExpansionBoard,
  refreshSummaryCard,
  refreshSpawningTomorrowCard,
  refreshThreadCooldownCard,
} = require('../utils/killops');

function getBosses() {
  delete require.cache[require.resolve('../data/bosses.json')];
  return require('../data/bosses.json');
}

/**
 * Parse a Discord message link into { guildId, channelId, messageId }
 */
function parseMessageLink(link) {
  const m = link.trim().match(/discord(?:app)?\.com\/channels\/(\d+)\/(\d+)\/(\d+)/);
  if (!m) return null;
  return { guildId: m[1], channelId: m[2], messageId: m[3] };
}

/**
 * Parse a Discord absolute timestamp string like "<t:1745900100:F>" → Unix ms
 * Or a plain date string like "April 29, 2026 9:48 AM" → approximate ms
 */
function parseTimestamp(text) {
  // Discord timestamp tag
  const discordTs = text.match(/<t:(\d+)(?::[A-Za-z])?>/);
  if (discordTs) return parseInt(discordTs[1]) * 1000;

  // Human readable: "April 29, 2026 10:35 AM"
  const dateMatch = text.match(/(\w+ \d+, \d{4})\s+(\d+:\d+\s*[AP]M)/i);
  if (dateMatch) {
    const d = new Date(`${dateMatch[1]} ${dateMatch[2]} EST`);
    if (!isNaN(d)) return d.getTime();
  }
  return null;
}

/**
 * Parse the Active Cooldowns embed fields to extract boss kill data.
 *
 * Each field in the summary embed looks like:
 *   name:  "⚔️ Classic"  (expansion header, no boss data)
 *   value: lines of:
 *     "🐉 **Lord Nagafen** (Nagafen's Lair) — April 29, 2026 10:35 AM  in 5 days"
 *     "🐉 **Lord Nagafen** (Nagafen's Lair) — <t:1745900100:F>  <t:1745900100:R>"
 *
 * Returns array of { bossName, zone, nextSpawnMs }
 */
function parseSummaryEmbed(embed) {
  const entries = [];

  for (const field of (embed.fields || [])) {
    const lines = field.value.split('\n');
    for (const line of lines) {
      // Match: emoji **Boss Name** (Zone) — <timestamp> ...
      // or:    emoji **Boss Name** (Zone) — date string  ...
      const m = line.match(/\*\*([^*]+)\*\*\s*\(([^)]+)\)\s*[—–-]\s*(.+)/);
      if (!m) continue;

      const bossName = m[1].trim();
      const zone     = m[2].trim();
      const rest     = m[3].trim();

      // Try to parse the next spawn timestamp from the rest of the line
      // Look for Discord timestamp tags first
      const tsMs = parseTimestamp(rest);

      entries.push({ bossName, zone, nextSpawnMs: tsMs });
    }
  }

  return entries;
}

/**
 * Find a boss in bosses.json by name and/or zone (fuzzy match).
 */
function findBoss(bosses, bossName, zone) {
  const nameLower = bossName.toLowerCase();
  const zoneLower = zone.toLowerCase();

  // Exact name + zone match first
  let match = bosses.find(
    (b) => b.name.toLowerCase() === nameLower && b.zone.toLowerCase() === zoneLower
  );
  if (match) return match;

  // Exact name only
  match = bosses.find((b) => b.name.toLowerCase() === nameLower);
  if (match) return match;

  // Nickname match
  match = bosses.find((b) =>
    (b.nicknames || []).some((n) => n.toLowerCase() === nameLower)
  );
  if (match) return match;

  // Partial name match (boss name contains the search string or vice versa)
  match = bosses.find(
    (b) => b.name.toLowerCase().includes(nameLower) || nameLower.includes(b.name.toLowerCase())
  );
  return match || null;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('restore')
    .setDescription('Restore kill state from a previous Active Cooldowns message link')
    .addStringOption((opt) =>
      opt.setName('message_link')
        .setDescription('Discord message link to an "Active Cooldowns" embed')
        .setRequired(true)
    ),

  async execute(interaction) {
    if (!hasAllowedRole(interaction.member)) {
      return interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: `❌ You need one of these roles: ${allowedRolesList()}`,
      });
    }

    const link = interaction.options.getString('message_link').trim();
    const parsed = parseMessageLink(link);

    if (!parsed) {
      return interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: '❌ Invalid message link. Use the full Discord message URL: right-click a message → Copy Message Link.',
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // Fetch the referenced message
    let refMsg;
    try {
      const refChannel = await interaction.client.channels.fetch(parsed.channelId);
      refMsg = await refChannel.messages.fetch(parsed.messageId);
    } catch (err) {
      return interaction.editReply(`❌ Could not fetch that message: ${err?.message}\nMake sure the bot has access to that channel.`);
    }

    // Find the Active Cooldowns embed
    const cooldownEmbed = refMsg.embeds.find((e) => e.title === '📊 Active Cooldowns');
    if (!cooldownEmbed) {
      return interaction.editReply(
        `❌ That message doesn't contain an "📊 Active Cooldowns" embed.\n` +
        `Make sure you linked to the correct message — right-click the Active Cooldowns card → Copy Message Link.`
      );
    }

    const bosses  = getBosses();
    const entries = parseSummaryEmbed(cooldownEmbed);

    if (entries.length === 0) {
      return interaction.editReply(
        `⚠️ The Active Cooldowns embed was found but contained no readable boss entries. ` +
        `This can happen if all bosses were available at the time it was posted.`
      );
    }

    // Reconstruct kill state
    const now          = Date.now();
    const restored     = [];
    const notFound     = [];
    const alreadyGone  = []; // timers that have already expired

    for (const { bossName, zone, nextSpawnMs } of entries) {
      const boss = findBoss(bosses, bossName, zone);
      if (!boss) { notFound.push(`${bossName} (${zone})`); continue; }

      // Skip if the timer has already expired — this boss is now available
      if (nextSpawnMs && nextSpawnMs <= now) {
        alreadyGone.push(boss.name);
        continue;
      }

      // Reconstruct: killedAt = nextSpawn - timerHours, or best estimate
      const nextSpawn = nextSpawnMs || (now + boss.timerHours * 3600000);
      const killedAt  = nextSpawnMs
        ? nextSpawnMs - boss.timerHours * 3600000
        : now;

      // Write directly to state (bypass recordKill's dailyKills side effect)
      const stateModule = require('../utils/state');
      const s = require('../utils/state');

      // Use overrideTimer if the boss already has a kill, or inject manually
      const rawState = (() => {
        const fs   = require('fs');
        const path = require('path');
        const f    = path.join(__dirname, '../data/state.json');
        try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; }
      })();

      if (rawState) {
        if (!rawState.bosses) rawState.bosses = {};
        rawState.bosses[boss.id] = {
          killedAt,
          nextSpawn,
          killedBy: 'restored',
        };
        const fs   = require('fs');
        const path = require('path');
        const f    = path.join(__dirname, '../data/state.json');
        const tmp  = f + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(rawState, null, 2), 'utf8');
        fs.renameSync(tmp, f);
        restored.push(`${boss.emoji || '•'} **${boss.name}** → <t:${Math.floor(nextSpawn / 1000)}:F>`);
      }
    }

    if (restored.length === 0 && notFound.length === 0) {
      return interaction.editReply('⚠️ No active cooldowns were found (all timers have expired). Nothing to restore.');
    }

    // Refresh all cards and boards with the restored state
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
    const lines = ['✅ **State restored from Active Cooldowns snapshot**\n'];

    if (restored.length > 0) {
      lines.push(`**Restored (${restored.length} bosses on cooldown):**`);
      lines.push(...restored);
    }
    if (alreadyGone.length > 0) {
      lines.push(`\n**Skipped — timers already expired:**`);
      lines.push(alreadyGone.map((n) => `• ${n}`).join('\n'));
    }
    if (notFound.length > 0) {
      lines.push(`\n**Not matched to bosses.json:**`);
      lines.push(notFound.map((n) => `• ${n}`).join('\n'));
    }

    lines.push('\nAll boards and summary cards have been refreshed.');
    await interaction.editReply(lines.join('\n').slice(0, 2000));
  },
};
