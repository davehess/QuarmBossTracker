// utils/embeds.js

const { EmbedBuilder } = require('discord.js');
const { discordRelativeTime, discordAbsoluteTime, statusEmoji } = require('./timer');

/** Zone kill card — one card per zone in the expansion thread, edited in place */
function buildZoneKillCard(zone, killedBosses) {
  const color = killedBosses.length >= 3 ? 0xcc0000 : killedBosses.length === 2 ? 0xff6600 : 0xcc2200;
  const embed = new EmbedBuilder().setColor(color).setTitle(`☠️ ${zone}`).setTimestamp();
  for (const { boss, entry, killedBy } of killedBosses) {
    embed.addFields({
      name: `${boss.emoji || '☠️'} ${boss.name} killed`,
      value: `Recorded by <@${killedBy}> • [PQDI](${boss.pqdiUrl})\n**Next spawn:** ${discordAbsoluteTime(entry.nextSpawn)} (${discordRelativeTime(entry.nextSpawn)})`,
      inline: false,
    });
  }
  return embed;
}

/** Summary card — top of main channel, shows only currently-on-cooldown bosses */
function buildSummaryCard(bosses, killState) {
  const now  = Date.now();
  const embed = new EmbedBuilder()
    .setColor(0x2f3136)
    .setTitle('📊 Active Cooldowns')
    .setTimestamp()
    .setFooter({ text: 'Updated automatically • Check expansion threads for kill buttons' });

  // Group by expansion
  const byExp = {};
  for (const boss of bosses) {
    const entry = killState[boss.id];
    if (!entry || entry.nextSpawn <= now) continue;
    const exp = boss.expansion || 'Luclin';
    if (!byExp[exp]) byExp[exp] = [];
    byExp[exp].push({ boss, entry });
  }

  const EXP_ORDER = ['Classic', 'Kunark', 'Velious', 'Luclin', 'PoP'];
  const EXP_EMOJI = { Classic: '⚔️', Kunark: '🦎', Velious: '❄️', Luclin: '🌙', PoP: '🔥' };
  let any = false;

  for (const exp of EXP_ORDER) {
    if (!byExp[exp] || byExp[exp].length === 0) continue;
    any = true;
    const lines = byExp[exp].map(({ boss, entry }) =>
      `${boss.emoji || '•'} **${boss.name}** (${boss.zone}) — ${discordAbsoluteTime(entry.nextSpawn)} ${discordRelativeTime(entry.nextSpawn)}`
    );
    const chunks = chunkLines(lines, 1000);
    chunks.forEach((chunk, i) => embed.addFields({
      name: i === 0 ? `${EXP_EMOJI[exp] || ''} ${exp}` : `${exp} (cont.)`,
      value: chunk, inline: false,
    }));
  }

  if (!any) embed.setDescription('*No bosses currently on cooldown.*');
  return embed;
}

function buildStatusEmbed(bosses, state, filterZone = null) {
  const now = Date.now();
  const byZone = {};
  for (const boss of bosses) {
    if (filterZone && boss.zone !== filterZone) continue;
    if (!byZone[boss.zone]) byZone[boss.zone] = [];
    byZone[boss.zone].push(boss);
  }
  const embed = new EmbedBuilder()
    .setColor(0x5865f2).setTitle('📋 Raid Boss Spawn Timers')
    .setDescription('🔴 spawned  🟡 <2h  🟢 cooldown  ⬜ unknown')
    .setTimestamp().setFooter({ text: 'PQDI.cc • Quarm instances' });
  for (const [zone, zoneBosses] of Object.entries(byZone)) {
    const lines = zoneBosses.map((boss) => {
      const entry = state[boss.id];
      if (!entry) return `⬜ **${boss.name}** — unknown`;
      const rem = entry.nextSpawn - now;
      const emoji = statusEmoji(entry.nextSpawn);
      if (rem <= 0) return `${emoji} **${boss.name}** — SPAWNED (${discordRelativeTime(entry.killedAt)})`;
      return `${emoji} **${boss.name}** — ${discordAbsoluteTime(entry.nextSpawn)} (${discordRelativeTime(entry.nextSpawn)})`;
    });
    const chunks = chunkLines(lines, 1000);
    chunks.forEach((chunk, i) => embed.addFields({ name: i === 0 ? zone : `${zone} (cont.)`, value: chunk, inline: false }));
  }
  return embed;
}

function buildSpawnAlertEmbed(boss) {
  return new EmbedBuilder().setColor(0xffaa00)
    .setTitle(`⚠️ ${boss.name} spawning soon!`)
    .setDescription(`**Zone:** ${boss.zone}\n**Spawns:** in less than 30 minutes\n[View on PQDI.cc](${boss.pqdiUrl})`)
    .setTimestamp();
}

function buildSpawnedEmbed(boss) {
  return new EmbedBuilder().setColor(0x00ff00)
    .setTitle(`🟢 ${boss.name} has spawned!`)
    .setDescription(`**Zone:** ${boss.zone}\nReady to pull! [View on PQDI.cc](${boss.pqdiUrl})`)
    .setTimestamp();
}

function buildDailySummaryEmbed(killedToday, availableNow, bosses) {
  const embed = new EmbedBuilder().setColor(0x4b0082).setTitle('📅 Daily Raid Summary')
    .setDescription(new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric' }))
    .setTimestamp();
  if (killedToday.length === 0) {
    embed.addFields({ name: '☠️ Killed Today', value: 'No kills recorded today.', inline: false });
  } else {
    const lines = killedToday.map((e) => {
      const boss = bosses.find((b) => b.id === e.bossId);
      return `• **${boss?.name || e.bossId}** (${boss?.zone || '?'}) — <t:${Math.floor(e.killedAt/1000)}:t> by <@${e.killedBy}>`;
    });
    embed.addFields({ name: `☠️ Killed Today (${killedToday.length})`, value: lines.join('\n').slice(0, 1020), inline: false });
  }
  if (availableNow.length === 0) {
    embed.addFields({ name: '🟢 Available Now', value: 'No bosses currently available.', inline: false });
  } else {
    embed.addFields({ name: `🟢 Available Now (${availableNow.length})`, value: availableNow.map((b) => `• **${b.name}** (${b.zone})`).join('\n').slice(0, 1020), inline: false });
  }
  return embed;
}

function chunkLines(lines, maxLen) {
  const chunks = []; let cur = '';
  for (const line of lines) {
    if (cur.length + line.length + 1 > maxLen) { chunks.push(cur); cur = line; }
    else { cur = cur ? cur + '\n' + line : line; }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

module.exports = { buildZoneKillCard, buildSummaryCard, buildStatusEmbed, buildSpawnAlertEmbed, buildSpawnedEmbed, buildDailySummaryEmbed };
