// utils/embeds.js
// Builds Discord embeds for timer displays

const { EmbedBuilder } = require('discord.js');
const { discordRelativeTime, discordAbsoluteTime, statusEmoji } = require('./timer');

/**
 * Build a single-boss kill confirmation embed
 */
function buildKillEmbed(boss, stateEntry, killedBy) {
  const nextSpawnMs = stateEntry.nextSpawn;
  const embed = new EmbedBuilder()
    .setColor(0xcc2200)
    .setTitle(`☠️ ${boss.name} killed`)
    .setDescription(`Recorded by <@${killedBy}>`)
    .addFields(
      { name: 'Zone', value: boss.zone, inline: true },
      { name: 'Timer', value: `${boss.timerHours}h`, inline: true },
      { name: 'Next spawn', value: discordAbsoluteTime(nextSpawnMs), inline: false },
      { name: 'That is', value: discordRelativeTime(nextSpawnMs), inline: false },
    )
    .setFooter({ text: `PQDI: ${boss.pqdiUrl}` })
    .setTimestamp();
  return embed;
}

/**
 * Build a full status embed grouped by zone
 * @param {Array} bosses - boss definitions array
 * @param {Object} state - full state map from state.js
 * @param {string|null} filterZone - optional zone name to filter to
 */
function buildStatusEmbed(bosses, state, filterZone = null) {
  const now = Date.now();

  // Group bosses by zone
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
      if (!entry) {
        return `⬜ **${boss.name}** — unknown`;
      }
      const remaining = entry.nextSpawn - now;
      const emoji = statusEmoji(entry.nextSpawn);
      if (remaining <= 0) {
        return `${emoji} **${boss.name}** — SPAWNED (killed ${discordRelativeTime(entry.killedAt)})`;
      }
      return `${emoji} **${boss.name}** — ${discordAbsoluteTime(entry.nextSpawn)} (${discordRelativeTime(entry.nextSpawn)})`;
    });

    // Discord field value max is 1024 chars; chunk if needed
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
    .setDescription(`**Zone:** ${boss.zone}\n**Spawns:** in less than 30 minutes`)
    .setTimestamp();
}

/**
 * Build a spawned notification embed
 */
function buildSpawnedEmbed(boss) {
  return new EmbedBuilder()
    .setColor(0x00ff00)
    .setTitle(`🟢 ${boss.name} has spawned!`)
    .setDescription(`**Zone:** ${boss.zone}\nReady to pull!`)
    .setTimestamp();
}

/**
 * Split an array of lines into chunks under maxLen chars each
 */
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
};
