// utils/embeds.js

const { EmbedBuilder } = require('discord.js');
const { discordRelativeTime, discordAbsoluteTime, statusEmoji } = require('./timer');

const EXP_ORDER = ['Classic', 'Kunark', 'Velious', 'Luclin', 'PoP'];
const EXP_EMOJI = { Classic: '⚔️', Kunark: '🦎', Velious: '❄️', Luclin: '🌙', PoP: '🔥' };
const EXP_COLOR = { Classic: 0xaa6622, Kunark: 0x228822, Velious: 0x2255aa, Luclin: 0x882299, PoP: 0x8b0000 };

// ── Zone kill card ────────────────────────────────────────────────────────────
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

// ── Main channel: Active Cooldowns (all expansions) ───────────────────────────
function buildSummaryCard(bosses, killState) {
  const now   = Date.now();
  const embed = new EmbedBuilder()
    .setColor(0x2f3136).setTitle('📊 Active Cooldowns').setTimestamp()
    .setFooter({ text: 'Updated automatically • Check expansion threads for kill buttons' });

  const byExp = {};
  for (const boss of bosses) {
    const entry = killState[boss.id];
    if (!entry || entry.nextSpawn <= now) continue;
    const exp = boss.expansion || 'Luclin';
    if (!byExp[exp]) byExp[exp] = [];
    byExp[exp].push({ boss, entry });
  }

  let any = false;
  for (const exp of EXP_ORDER) {
    if (!byExp[exp]?.length) continue;
    any = true;
    const lines = byExp[exp].map(({ boss, entry }) =>
      `${boss.emoji || '•'} **${boss.name}** (${boss.zone}) — ${discordAbsoluteTime(entry.nextSpawn)} ${discordRelativeTime(entry.nextSpawn)}`
    );
    chunkLines(lines, 1000).forEach((chunk, i) =>
      embed.addFields({ name: i === 0 ? `${EXP_EMOJI[exp]} ${exp}` : `${exp} (cont.)`, value: chunk, inline: false })
    );
  }
  if (!any) embed.setDescription('*No bosses currently on cooldown.*');
  return embed;
}

// ── Main channel: Spawning Tomorrow ──────────────────────────────────────────
function buildSpawningTomorrowCard(bosses, killState) {
  const now       = Date.now();
  const in24h     = now + 24 * 3600000;
  const embed = new EmbedBuilder()
    .setColor(0xf59e0b).setTitle('🌅 Spawning in the Next 24 Hours').setTimestamp()
    .setFooter({ text: 'Updated automatically' });

  const byExp = {};
  for (const boss of bosses) {
    const entry = killState[boss.id];
    if (!entry) continue;
    if (entry.nextSpawn <= now || entry.nextSpawn > in24h) continue;
    const exp = boss.expansion || 'Luclin';
    if (!byExp[exp]) byExp[exp] = [];
    byExp[exp].push({ boss, entry });
  }

  // Sort each group by nextSpawn ascending
  for (const exp of Object.keys(byExp)) {
    byExp[exp].sort((a, b) => a.entry.nextSpawn - b.entry.nextSpawn);
  }

  let any = false;
  for (const exp of EXP_ORDER) {
    if (!byExp[exp]?.length) continue;
    any = true;
    const lines = byExp[exp].map(({ boss, entry }) =>
      `${boss.emoji || '•'} **${boss.name}** (${boss.zone}) — ${discordAbsoluteTime(entry.nextSpawn)} ${discordRelativeTime(entry.nextSpawn)}`
    );
    chunkLines(lines, 1000).forEach((chunk, i) =>
      embed.addFields({ name: i === 0 ? `${EXP_EMOJI[exp]} ${exp}` : `${exp} (cont.)`, value: chunk, inline: false })
    );
  }
  if (!any) embed.setDescription('*No bosses spawning in the next 24 hours.*');
  return embed;
}

// ── Per-thread: Active Cooldowns for one expansion ────────────────────────────
function buildExpansionCooldownCard(expansion, bosses, killState) {
  const now   = Date.now();
  const meta  = { label: expansion, emoji: EXP_EMOJI[expansion] || '', color: EXP_COLOR[expansion] || 0x555555 };
  const embed = new EmbedBuilder()
    .setColor(meta.color)
    .setTitle(`${meta.emoji} ${expansion} — Active Cooldowns`)
    .setTimestamp()
    .setFooter({ text: 'Updated automatically • Use buttons below to record kills' });

  const expBosses = bosses.filter((b) => (b.expansion || 'Luclin') === expansion);
  const onCooldown = expBosses.filter((b) => {
    const e = killState[b.id];
    return e && e.nextSpawn > now;
  });

  if (onCooldown.length === 0) {
    embed.setDescription('*No bosses currently on cooldown.*');
    return embed;
  }

  // Group by zone for readability
  const byZone = {};
  for (const boss of onCooldown) {
    if (!byZone[boss.zone]) byZone[boss.zone] = [];
    byZone[boss.zone].push({ boss, entry: killState[boss.id] });
  }

  for (const [zone, items] of Object.entries(byZone)) {
    const lines = items.map(({ boss, entry }) =>
      `${boss.emoji || '•'} **${boss.name}** — ${discordAbsoluteTime(entry.nextSpawn)} ${discordRelativeTime(entry.nextSpawn)}`
    );
    chunkLines(lines, 1000).forEach((chunk, i) =>
      embed.addFields({ name: i === 0 ? `📍 ${zone}` : `${zone} (cont.)`, value: chunk, inline: false })
    );
  }

  return embed;
}

// ── /timers embed ─────────────────────────────────────────────────────────────
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
      if (rem <= 0) return `${emoji} **${boss.name}** — SPAWNED`;
      return `${emoji} **${boss.name}** — ${discordAbsoluteTime(entry.nextSpawn)} (${discordRelativeTime(entry.nextSpawn)})`;
    });
    chunkLines(lines, 1000).forEach((chunk, i) =>
      embed.addFields({ name: i === 0 ? zone : `${zone} (cont.)`, value: chunk, inline: false })
    );
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

function buildDailySummaryEmbed(killedToday, availableNow, bosses, dateLabel) {
  // dateLabel: e.g. "April 24, 2026" — used as "Killed <dateLabel>" header when archiving
  const isArchive = !!dateLabel;
  const displayDate = dateLabel || new Date().toLocaleDateString('en-US', {
    timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric',
  });
  const embed = new EmbedBuilder()
    .setColor(0x4b0082)
    .setTitle('📅 Daily Raid Summary')
    .setDescription(displayDate)
    .setTimestamp();

  if (killedToday.length === 0) {
    embed.addFields({ name: isArchive ? `☠️ Killed ${dateLabel}` : '☠️ Killed Today', value: 'No kills recorded.', inline: false });
  } else {
    const lines = killedToday.map((e) => {
      const boss = bosses.find((b) => b.id === e.bossId);
      return `• **${boss?.name || e.bossId}** (${boss?.zone || '?'}) — <t:${Math.floor(e.killedAt/1000)}:t> by <@${e.killedBy}>`;
    });
    const headerName = isArchive ? `☠️ Killed ${dateLabel} (${killedToday.length})` : `☠️ Killed Today (${killedToday.length})`;
    embed.addFields({ name: headerName, value: lines.join('\n').slice(0, 1020), inline: false });
  }
  // Note: "Available Now" intentionally omitted per request — keep summary concise
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

module.exports = {
  buildZoneKillCard, buildSummaryCard, buildSpawningTomorrowCard,
  buildExpansionCooldownCard, buildStatusEmbed,
  buildSpawnAlertEmbed, buildSpawnedEmbed, buildDailySummaryEmbed,
};
