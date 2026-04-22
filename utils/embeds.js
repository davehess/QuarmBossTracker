// utils/embeds.js
// Builds Discord embeds for timer displays

const { EmbedBuilder } = require('discord.js');
const { discordRelativeTime, discordAbsoluteTime, statusEmoji } = require('./timer');

/**
 * Build a single-boss kill confirmation embed with clickable PQDI link
 */
function buildKillEmbed(boss, stateEntry, killedBy) {
  const nextSpawnMs = stateEntry.nextSpawn;
  const embed = new EmbedBuilder()
    .setColor(0xcc2200)
    .setTitle(`☠️ ${boss.name} killed`)
    .setDescription(
      `Recorded by <@${killedBy}>\n[View on PQDI.cc](${boss.pqdiUrl})`
    )
    .addFields(
      { name: 'Zone',       value: boss.zone,                        inline: true  },
      { name: 'Timer',      value: `${boss.timerHours}h`,            inline: true  },
      { name: 'Next spawn', value: discordAbsoluteTime(nextSpawnMs), inline: false },
      { name: 'That is',    value: discordRelativeTime(nextSpawnMs), inline: false },
    )
    .setTimestamp();
  return embed;
}

/**
 * Build a full status embed grouped by zone
 */
function buildStatusEmbed(bosses, state, filterZone = null) {
  const now = Date.now();

  const byZone = {};
  for (const boss of bosses) {
    if (filterZone && boss.zone !== filterZone) continue;
    if (!byZone[boss.zone]) byZone[boss.zone] = [];
    byZone[boss.zone].push(boss);
  }

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('📋 Raid Boss Spawn Timers')
    .setDescription('🔴 = spawned/available  🟡 = spawning soon (<2h)  🟢 = on cooldown  ⬜ = unknown')
    .setTimestamp()
    .setFooter({ text: 'Data from PQDI.cc • Quarm Luclin instances' });

  for (const [zone, zoneBosses] of Object.entries(byZone)) {
    const lines = zoneBosses.map((boss) => {
      const entry = state[boss.id];
      if (!entry) return `⬜ **${boss.name}** — unknown`;
      const remaining = entry.nextSpawn - now;
      const emoji = statusEmoji(entry.nextSpawn);
      if (remaining <= 0) {
        return `${emoji} **${boss.name}** — SPAWNED (killed ${discordRelativeTime(entry.killedAt)})`;
      }
      return `${emoji} **${boss.name}** — ${discordAbsoluteTime(entry.nextSpawn)} (${discordRelativeTime(entry.nextSpawn)})`;
    });

    const chunks = chunkLines(lines, 1000);
    chunks.forEach((chunk, i) => {
      embed.addFields({
        name: i === 0 ? zone : `${zone} (cont.)`,
        value: chunk,
        inline: false,
      });
    });
  }

  return embed;
}

/**
 * Build a spawn alert embed for when a boss is about to spawn
 */
function buildSpawnAlertEmbed(boss) {
  return new EmbedBuilder()
    .setColor(0xffaa00)
    .setTitle(`⚠️ ${boss.name} spawning soon!`)
    .setDescription(`**Zone:** ${boss.zone}\n**Spawns:** in less than 30 minutes\n[View on PQDI.cc](${boss.pqdiUrl})`)
    .setTimestamp();
}

/**
 * Build a spawned notification embed
 */
function buildSpawnedEmbed(boss) {
  return new EmbedBuilder()
    .setColor(0x00ff00)
    .setTitle(`🟢 ${boss.name} has spawned!`)
    .setDescription(`**Zone:** ${boss.zone}\nReady to pull!\n[View on PQDI.cc](${boss.pqdiUrl})`)
    .setTimestamp();
}

/**
 * Build the midnight daily summary embed
 */
function buildDailySummaryEmbed(killedToday, availableNow, bosses) {
  const embed = new EmbedBuilder()
    .setColor(0x4b0082)
    .setTitle('📅 Daily Raid Summary')
    .setDescription(`Summary for ${new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric' })}`)
    .setTimestamp();

  if (killedToday.length === 0) {
    embed.addFields({ name: '☠️ Killed Today', value: 'No kills recorded today.', inline: false });
  } else {
    const lines = killedToday.map((entry) => {
      const boss = bosses.find((b) => b.id === entry.bossId);
      if (!boss) return `• Unknown (${entry.bossId})`;
      return `• **${boss.name}** (${boss.zone}) — killed <t:${Math.floor(entry.killedAt / 1000)}:t> by <@${entry.killedBy}>`;
    });
    embed.addFields({ name: `☠️ Killed Today (${killedToday.length})`, value: lines.join('\n').slice(0, 1020), inline: false });
  }

  if (availableNow.length === 0) {
    embed.addFields({ name: '🟢 Available Now', value: 'No bosses currently available.', inline: false });
  } else {
    const lines = availableNow.map((boss) => `• **${boss.name}** (${boss.zone})`);
    embed.addFields({ name: `🟢 Available Now (${availableNow.length})`, value: lines.join('\n').slice(0, 1020), inline: false });
  }

  return embed;
}

function chunkLines(lines, maxLen) {
  const chunks = [];
  let current = '';
  for (const line of lines) {
    if (current.length + line.length + 1 > maxLen) {
      chunks.push(current);
      current = line;
    } else {
      current = current ? current + '\n' + line : line;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

module.exports = {
  buildKillEmbed,
  buildStatusEmbed,
  buildSpawnAlertEmbed,
  buildSpawnedEmbed,
  buildDailySummaryEmbed,
};
