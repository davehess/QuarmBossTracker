// commands/raidnight.js — Open tonight's raid parse thread and post a live scoreboard.
// Officers trigger this at raid start; /parse auto-appends each kill.
// Midnight cleanup archives the thread to #raid-mobs-archive.

const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { nowPartsInTz, getDefaultTz, msUntilMidnightInTz } = require('../utils/timezone');
const { getRaidSession, saveRaidSession } = require('../utils/state');
const { loadParses }  = require('./parse');

const RAID_DAYS = new Set(['sunday', 'wednesday', 'thursday']);

function isRaidNight() {
  const { dayOfWeek, hour, minute } = nowPartsInTz(getDefaultTz());
  if (!RAID_DAYS.has(dayOfWeek)) return false;
  return hour * 60 + minute >= 20 * 60 + 30; // 8:30 PM+
}

function todayLabel() {
  return new Date().toLocaleDateString('en-US', {
    timeZone: getDefaultTz(), weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
}

function todayDateKey() {
  return new Date().toLocaleDateString('en-US', {
    timeZone: getDefaultTz(), year: 'numeric', month: '2-digit', day: '2-digit',
  });
}

function sinceLastMidnightMs() {
  const msUntilMidnight = msUntilMidnightInTz(getDefaultTz());
  return Date.now() - (24 * 60 * 60 * 1000 - msUntilMidnight);
}

function getTonightParses() {
  const cutoff    = sinceLastMidnightMs();
  const allParses = loadParses();
  const result    = {};
  for (const [bossId, kills] of Object.entries(allParses)) {
    const tonight = kills.filter(k => k.timestamp >= cutoff);
    if (tonight.length > 0) result[bossId] = tonight;
  }
  return result;
}

function buildSummaryEmbed(label, raidNight, tonightParses) {
  delete require.cache[require.resolve('../data/bosses.json')];
  const bosses = require('../data/bosses.json');

  const mobLines = Object.entries(tonightParses).map(([bossId, kills]) => {
    const boss   = bosses.find(b => b.id === bossId);
    const latest = kills[kills.length - 1];
    const dmg    = (latest.totalDamage / 1000).toFixed(1) + 'K';
    return `${boss?.emoji || '⚔️'} **${boss?.name || bossId}** — ${dmg} dmg in ${latest.duration}s`;
  });

  return new EmbedBuilder()
    .setColor(raidNight ? 0xe74c3c : 0x95a5a6)
    .setTitle((raidNight ? '🗡️ Raid Night — ' : '⚔️ Kill Log — ') + label)
    .addFields({
      name: `Parses Tonight (${mobLines.length})`,
      value: mobLines.length > 0 ? mobLines.join('\n') : '*No parses yet — use `/parse` after each kill*',
      inline: false,
    })
    .setTimestamp();
}

function fmt(n) { return n.toLocaleString('en-US'); }

function buildParseboardEmbed(label, raidNight, tonightParses) {
  delete require.cache[require.resolve('../data/bosses.json')];
  const bosses = require('../data/bosses.json');

  // Aggregate total damage and active seconds per player across all bosses tonight
  const playerMap = new Map();
  let totalNightDamage = 0;
  let totalDuration    = 0;

  for (const [bossId, kills] of Object.entries(tonightParses)) {
    const latest = kills[kills.length - 1];
    totalNightDamage += latest.totalDamage || 0;
    totalDuration    += latest.duration    || 0;
    for (const p of (latest.players || [])) {
      const key = p.name.toLowerCase();
      if (!playerMap.has(key)) {
        playerMap.set(key, { name: p.name, hasPets: p.hasPets, totalDmg: 0, totalDuration: 0, bosses: 0 });
      }
      const agg = playerMap.get(key);
      agg.totalDmg      += p.damage;
      agg.totalDuration += p.duration;
      agg.bosses++;
      agg.hasPets = agg.hasPets || p.hasPets;
    }
  }

  const sorted = [...playerMap.values()]
    .map(p => ({ ...p, avgDps: p.totalDuration > 0 ? Math.round(p.totalDmg / p.totalDuration) : 0 }))
    .sort((a, b) => b.totalDmg - a.totalDmg);

  const totalRaidDps = totalDuration > 0 ? Math.round(totalNightDamage / totalDuration) : 0;
  const bossCount    = Object.keys(tonightParses).length;

  let table = '';
  if (sorted.length > 0) {
    const hdr     = `${'#'.padStart(2)}  ${'Player'.padEnd(20)} ${'Total Dmg'.padStart(10)}  ${'Avg DPS'.padStart(7)}  Bosses`;
    const divider = '─'.repeat(hdr.length);
    const rows = sorted.slice(0, 15).map((p, i) => {
      const rank   = String(i + 1).padStart(2);
      const name   = (p.name + (p.hasPets ? ' +P' : '')).padEnd(20);
      const dmg    = fmt(p.totalDmg).padStart(10);
      const dps    = (p.avgDps + '/s').padStart(7);
      const bossCt = String(p.bosses).padStart(6);
      return `${rank}. ${name} ${dmg}  ${dps}  ${bossCt}`;
    });
    table = '```\n' + [hdr, divider, ...rows].join('\n') + '\n```';
  } else {
    table = '*No player data yet*';
  }

  const title = `📊 Raid Parseboard — ${label}`;
  return new EmbedBuilder()
    .setColor(raidNight ? 0xe74c3c : 0x95a5a6)
    .setTitle(title)
    .setDescription(
      `**${bossCount}** bosses · Total: **${fmt(totalNightDamage)}** dmg · Raid DPS: **${fmt(totalRaidDps)}/s**`
    )
    .addFields({ name: 'Player Rankings', value: table, inline: false })
    .setTimestamp();
}

// Called by /parse after each new parse is stored — updates thread summary, parseboard, and appends mob card.
async function appendParseToSession(client, bossId, parsed, bossName, bossEmoji) {
  const session = getRaidSession();
  if (!session) return;

  try {
    const thread = await client.channels.fetch(session.threadId).catch(() => null);
    if (!thread) return;

    // Re-build and edit the pinned summary at top
    const raidNight     = isRaidNight();
    const tonightParses = getTonightParses();
    const summaryEmbed  = buildSummaryEmbed(session.label, raidNight, tonightParses);

    try {
      const summaryMsg = await thread.messages.fetch(session.summaryMessageId);
      await summaryMsg.edit({ embeds: [summaryEmbed] });
    } catch {}

    // Update the parseboard (second pinned message)
    if (session.parseboardMessageId) {
      try {
        const parseboardMsg = await thread.messages.fetch(session.parseboardMessageId);
        const parseboardEmbed = buildParseboardEmbed(session.label, raidNight, tonightParses);
        await parseboardMsg.edit({ embeds: [parseboardEmbed] });
      } catch {}
    }

    // Append this mob's parse card to the thread
    const { buildParseEmbed } = require('./parse');
    const mobEmbed = buildParseEmbed(bossName, parsed, bossEmoji);
    await thread.send({ embeds: [mobEmbed] });

    // Also post the individual parse embed to the parent channel
    if (session.channelId && session.channelId !== session.threadId) {
      try {
        const parentCh = await client.channels.fetch(session.channelId).catch(() => null);
        if (parentCh) {
          await parentCh.send({ embeds: [mobEmbed] });
        }
      } catch {}
    }
  } catch (err) {
    console.warn('[raidnight] appendParseToSession error:', err?.message);
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('raidnight')
    .setDescription('Open tonight\'s raid parse thread. /parse will auto-append each kill.'),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const session = getRaidSession();
    if (session && session.date === todayDateKey()) {
      return interaction.editReply(
        `✅ Tonight's thread is already open: <#${session.threadId}>\nUse \`/parse\` after each kill to append results.`
      );
    }

    const raidNight   = isRaidNight();
    const label       = todayLabel();
    const threadName  = (raidNight ? '🗡️ Raid Night — ' : '⚔️ Kill Log — ') + label;
    const tonightParses = getTonightParses();
    const summaryEmbed  = buildSummaryEmbed(label, raidNight, tonightParses);

    let targetChannel;
    if (raidNight && process.env.RAID_CHAT_CHANNEL_ID) {
      targetChannel = await interaction.client.channels.fetch(process.env.RAID_CHAT_CHANNEL_ID).catch(() => null);
    }
    if (!targetChannel) {
      targetChannel = await interaction.client.channels.fetch(process.env.TIMER_CHANNEL_ID).catch(() => null);
    }
    if (!targetChannel) {
      return interaction.editReply('❌ Could not find a channel to post in. Check RAID_CHAT_CHANNEL_ID / TIMER_CHANNEL_ID.');
    }

    // Check if a thread for tonight already exists (prevents duplicates on re-run)
    try {
      const active = await targetChannel.threads.fetchActive();
      const existing = active.threads.find(t => t.name === threadName);
      if (existing) {
        saveRaidSession({
          date: todayDateKey(),
          label,
          threadId: existing.id,
          channelId: targetChannel.id,
          summaryMessageId: session?.summaryMessageId || null,
          parseboardMessageId: session?.parseboardMessageId || null,
          openedAt: Date.now(),
        });
        return interaction.editReply(`✅ Tonight's thread already exists: <#${existing.id}>\nUse \`/parse\` after each kill.`);
      }
    } catch {}

    // Create thread — if RAID_CHAT_CHANNEL_ID lacks permission, fall back to TIMER_CHANNEL_ID
    let thread;
    try {
      thread = await targetChannel.threads.create({
        name: threadName,
        autoArchiveDuration: 1440,
        reason: 'Raid night parse scoreboard',
      });
    } catch (err) {
      if (targetChannel.id !== process.env.TIMER_CHANNEL_ID) {
        console.warn(`[raidnight] Could not create thread in ${targetChannel.id} (${err?.message}), falling back to TIMER_CHANNEL_ID`);
        const fallback = await interaction.client.channels.fetch(process.env.TIMER_CHANNEL_ID).catch(() => null);
        if (!fallback) return interaction.editReply(`❌ Could not create thread: ${err?.message}`);
        targetChannel = fallback;
        thread = await targetChannel.threads.create({
          name: threadName,
          autoArchiveDuration: 1440,
          reason: 'Raid night parse scoreboard',
        });
      } else {
        return interaction.editReply(`❌ Could not create thread: ${err?.message}`);
      }
    }

    // Post summary as first message (will be edited in place as parses come in)
    const summaryMsg = await thread.send({ embeds: [summaryEmbed] });

    // Post parseboard as second message
    const parseboardEmbed = buildParseboardEmbed(label, raidNight, tonightParses);
    const parseboardMsg   = await thread.send({ embeds: [parseboardEmbed] });

    // Post any parses already submitted tonight
    if (Object.keys(tonightParses).length > 0) {
      delete require.cache[require.resolve('../data/bosses.json')];
      const bosses = require('../data/bosses.json');
      const { buildParseEmbed } = require('./parse');

      for (const [bossId, kills] of Object.entries(tonightParses)) {
        const boss   = bosses.find(b => b.id === bossId);
        const latest = kills[kills.length - 1];
        const embed  = buildParseEmbed(boss?.name || bossId, latest, boss?.emoji);
        await thread.send({ embeds: [embed] });
      }
    }

    saveRaidSession({
      date:               todayDateKey(),
      label,
      threadId:           thread.id,
      channelId:          targetChannel.id,
      summaryMessageId:   summaryMsg.id,
      parseboardMessageId: parseboardMsg.id,
      openedAt:           Date.now(),
    });

    await interaction.editReply(`✅ Raid thread open: <#${thread.id}>\nUse \`/parse\` after each kill to post results.`);
  },

  appendParseToSession,
  getTonightParses,
  buildSummaryEmbed,
  buildParseboardEmbed,
  isRaidNight,
  todayDateKey,
  todayLabel,
};
