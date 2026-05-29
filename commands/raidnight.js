// commands/raidnight.js — Open tonight's raid parse thread and post a live scoreboard.
// Officers trigger this at raid start; /parse auto-appends each kill.
// Midnight cleanup archives the thread to #raid-mobs-archive.

const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { nowPartsInTz, getDefaultTz, msUntilMidnightInTz } = require('../utils/timezone');
const { getRaidSession, saveRaidSession, getRaidSessionTargets } = require('../utils/state');
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

function buildSummaryEmbed(label, raidNight, tonightParses, targets = []) {
  delete require.cache[require.resolve('../data/bosses.json')];
  const bosses = require('../data/bosses.json');

  const guildId    = process.env.DISCORD_GUILD_ID;
  const logChannel = process.env.PARSES_LOG_THREAD_ID;

  const mobLines = Object.entries(tonightParses).map(([bossId, kills]) => {
    const boss   = bosses.find(b => b.id === bossId);
    const latest = kills[kills.length - 1];
    const dmg    = (latest.totalDamage / 1000).toFixed(1) + 'K';
    const count  = kills.length;
    const countTag = count > 1 ? ` · ${count} parses` : '';
    let link = '';
    if (guildId && logChannel && latest.discordMsgId) {
      link = ` · [view](<https://discord.com/channels/${guildId}/${logChannel}/${latest.discordMsgId}>)`;
    }
    return `${boss?.emoji || '⚔️'} **${boss?.name || bossId}** — ${dmg} dmg in ${latest.duration}s${countTag}${link}`;
  });

  const embed = new EmbedBuilder()
    .setColor(raidNight ? 0xe74c3c : 0x95a5a6)
    .setTitle((raidNight ? '🗡️ Raid Night — ' : '⚔️ Kill Log — ') + label)
    .addFields({
      name: `Parses Tonight (${mobLines.length})`,
      value: mobLines.length > 0 ? mobLines.join('\n') : '*No parses yet — use `/parse` after each kill*',
      inline: false,
    });

  // Targets list — strikethrough killed targets so officers can see at a
  // glance what's still on the board for tonight. Only rendered when at
  // least one target has been added via /addtarget.
  if (Array.isArray(targets) && targets.length > 0) {
    const killedIds = new Set(Object.keys(tonightParses));
    const lines = targets.map(tid => {
      const boss = bosses.find(b => b.id === tid);
      const name = boss?.name || tid;
      const emoji = boss?.emoji || '⚔️';
      const zone = boss?.zone ? ` *(${boss.zone})*` : '';
      return killedIds.has(tid)
        ? `~~${emoji} **${name}**${zone}~~ ✅`
        : `${emoji} **${name}**${zone}`;
    });
    embed.addFields({
      name: `🎯 Targets (${targets.length})`,
      value: lines.join('\n'),
      inline: false,
    });
  }

  return embed.setTimestamp();
}

function fmt(n) { return n.toLocaleString('en-US'); }

function buildParseboardEmbed(label, raidNight, tonightParses) {
  delete require.cache[require.resolve('../data/bosses.json')];

  // ── Boss Fights section — aggregated from parses.json boss kills ──────────────
  const playerMap = new Map();
  let totalNightDamage = 0;
  let totalDuration    = 0;

  for (const [, kills] of Object.entries(tonightParses)) {
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

  let bossTable = '';
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
    bossTable = '```\n' + [hdr, divider, ...rows].join('\n') + '\n```';
  } else {
    bossTable = '*No boss parses yet*';
  }

  // ── All Night section — accumulated from all agent encounter uploads ──────────
  // sessionDamage lives in state.json raidSession; Eye of X + Cannibalize already filtered.
  const { getRaidSession } = require('../utils/state');
  const session        = getRaidSession();
  const sessionDamage  = session?.sessionDamage || {};
  const allNightSorted = Object.values(sessionDamage).sort((a, b) => b.damage - a.damage);

  let allNightTable = '';
  if (allNightSorted.length > 0) {
    const hdr     = `${'#'.padStart(2)}  ${'Player'.padEnd(20)} ${'Total Dmg'.padStart(10)}  ${'Avg DPS'.padStart(7)}  Enc`;
    const divider = '─'.repeat(hdr.length);
    const rows = allNightSorted.slice(0, 15).map((p, i) => {
      const rank  = String(i + 1).padStart(2);
      const name  = p.name.padEnd(20);
      const dmg   = fmt(p.damage).padStart(10);
      const dps   = ((p.duration > 0 ? Math.round(p.damage / p.duration) : 0) + '/s').padStart(7);
      const encs  = String(p.encounters).padStart(3);
      return `${rank}. ${name} ${dmg}  ${dps}  ${encs}`;
    });
    allNightTable = '```\n' + [hdr, divider, ...rows].join('\n') + '\n```';
  } else {
    allNightTable = '*No data yet — agent uploads accumulate here automatically*';
  }

  return new EmbedBuilder()
    .setColor(raidNight ? 0xe74c3c : 0x95a5a6)
    .setTitle(`📊 Raid Parseboard — ${label}`)
    .setDescription(
      `**${bossCount}** bosses · Total: **${fmt(totalNightDamage)}** dmg · Raid DPS: **${fmt(totalRaidDps)}/s**`
    )
    .addFields(
      { name: `Boss Fights (${bossCount})`, value: bossTable, inline: false },
      { name: 'All Night (including trash)', value: allNightTable, inline: false },
    )
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
    const summaryEmbed  = buildSummaryEmbed(session.label, raidNight, tonightParses, getRaidSessionTargets());

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

    // Post or edit this mob's parse card in the thread.
    // Track per-boss message IDs in session.bossCards so subsequent submissions
    // from other parsers edit the existing card rather than creating a new one.
    const { buildParseEmbed } = require('./parse');
    const mobEmbed = buildParseEmbed(bossName, parsed, bossEmoji);
    const existingCardId = session.bossCards?.[bossId];
    let posted = false;
    if (existingCardId) {
      try {
        const existingMsg = await thread.messages.fetch(existingCardId);
        await existingMsg.edit({ embeds: [mobEmbed] });
        posted = true;
      } catch { /* message deleted — fall through to post new */ }
    }
    if (!posted) {
      const sent = await thread.send({ embeds: [mobEmbed] });
      const updated = { ...session, bossCards: { ...(session.bossCards || {}), [bossId]: sent.id } };
      saveRaidSession(updated);
    }
  } catch (err) {
    console.warn('[raidnight] appendParseToSession error:', err?.message);
  }
}

// Build a parseboard from a single combined parse object (used by /parsenight integration).
function buildParseboardEmbedFromParsed(label, raidNight, parsed) {
  const { players, totalDamage, duration } = parsed;
  const totalRaidDps = duration > 0 ? Math.round(totalDamage / duration) : 0;

  let table = '';
  if (players.length > 0) {
    const hdr     = `${'#'.padStart(2)}  ${'Player'.padEnd(20)} ${'Total Dmg'.padStart(10)}  ${'Avg DPS'.padStart(7)}`;
    const divider = '─'.repeat(hdr.length);
    const rows = players.slice(0, 15).map((p, i) => {
      const rank = String(i + 1).padStart(2);
      const name = (p.name + (p.hasPets ? ' +P' : '')).slice(0, 20).padEnd(20);
      const dmg  = fmt(p.damage).padStart(10);
      const dps  = (p.dps + '/s').padStart(7);
      return `${rank}. ${name} ${dmg}  ${dps}`;
    });
    table = '```\n' + [hdr, divider, ...rows].join('\n') + '\n```';
  } else {
    table = '*No player data yet*';
  }

  return new EmbedBuilder()
    .setColor(raidNight ? 0xe74c3c : 0x95a5a6)
    .setTitle(`📊 Raid Parseboard — ${label}`)
    .setDescription(`Combined parse · Total: **${fmt(totalDamage)}** dmg · Raid DPS: **${fmt(totalRaidDps)}/s**`)
    .addFields({ name: 'Player Rankings', value: table, inline: false })
    .setTimestamp();
}

// Edit the raid-night summary embed in place. Called by /addtarget +
// /removetarget after they mutate the targets list so the pinned summary
// reflects the new state immediately. No-op when no session is open.
async function refreshSessionSummary(client) {
  const session = getRaidSession();
  if (!session) return;
  try {
    const thread = await client.channels.fetch(session.threadId).catch(() => null);
    if (!thread) return;
    const raidNight     = isRaidNight();
    const tonightParses = getTonightParses();
    const summaryEmbed  = buildSummaryEmbed(session.label, raidNight, tonightParses, getRaidSessionTargets());
    const msg = await thread.messages.fetch(session.summaryMessageId).catch(() => null);
    if (msg) await msg.edit({ embeds: [summaryEmbed] });
  } catch (err) {
    console.warn('[raidnight] refreshSessionSummary:', err?.message);
  }
}

// Called by /parsenight when a session is active — posts the full-night summary to the thread
// and updates the parseboard with combined parse data.
async function postNightSummaryToSession(client, fullNightEmbed, parsed) {
  const session = getRaidSession();
  if (!session) return;
  try {
    const thread = await client.channels.fetch(session.threadId).catch(() => null);
    if (!thread) return;
    await thread.send({ embeds: [fullNightEmbed] });
    if (session.parseboardMessageId && parsed) {
      try {
        const pbMsg = await thread.messages.fetch(session.parseboardMessageId);
        await pbMsg.edit({ embeds: [buildParseboardEmbedFromParsed(session.label, isRaidNight(), parsed)] });
      } catch {}
    }
  } catch (err) {
    console.warn('[raidnight] postNightSummaryToSession:', err?.message);
  }
}

async function openSession(thread, channelId, label, tonightParses) {
  const raidNight      = isRaidNight();
  const summaryEmbed   = buildSummaryEmbed(label, raidNight, tonightParses, getRaidSessionTargets());
  const parseboardEmbed = buildParseboardEmbed(label, raidNight, tonightParses);

  const summaryMsg    = await thread.send({ embeds: [summaryEmbed] });
  const parseboardMsg = await thread.send({ embeds: [parseboardEmbed] });

  if (Object.keys(tonightParses).length > 0) {
    delete require.cache[require.resolve('../data/bosses.json')];
    const bosses = require('../data/bosses.json');
    const { buildParseEmbed } = require('./parse');
    for (const [bossId, kills] of Object.entries(tonightParses)) {
      const boss   = bosses.find(b => b.id === bossId);
      const latest = kills[kills.length - 1];
      await thread.send({ embeds: [buildParseEmbed(boss?.name || bossId, latest, boss?.emoji)] });
    }
  }

  saveRaidSession({
    date: todayDateKey(),
    label,
    threadId:            thread.id,
    channelId,
    summaryMessageId:    summaryMsg.id,
    parseboardMessageId: parseboardMsg.id,
    openedAt:            Date.now(),
  });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('raidnight')
    .setDescription('Open tonight\'s raid parse thread. /parse will auto-append each kill.')
    .addBooleanOption(opt =>
      opt.setName('here')
        .setDescription('Use the current channel as the raid thread instead of creating a new one')
        .setRequired(false)
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const useHere     = interaction.options.getBoolean('here') ?? false;
    const session     = getRaidSession();
    const label       = todayLabel();
    const tonightParses = getTonightParses();

    if (useHere) {
      // Use current channel/thread as the session — skip thread creation
      const thread = interaction.channel;
      await openSession(thread, thread.id, label, tonightParses);
      return interaction.editReply(`✅ Raid session started in <#${thread.id}>. Use \`/parse\` after each kill.`);
    }

    if (session && session.date === todayDateKey()) {
      return interaction.editReply(
        `✅ Tonight's thread is already open: <#${session.threadId}>\nUse \`/parse\` after each kill to append results.`
      );
    }

    const raidNight  = isRaidNight();
    const threadName = (raidNight ? '🗡️ Raid Night — ' : '⚔️ Kill Log — ') + label;

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
      thread = await targetChannel.threads.create({ name: threadName, autoArchiveDuration: 1440, reason: 'Raid night parse scoreboard' });
    } catch (err) {
      if (targetChannel.id !== process.env.TIMER_CHANNEL_ID) {
        console.warn(`[raidnight] Could not create thread in ${targetChannel.id} (${err?.message}), falling back`);
        const fallback = await interaction.client.channels.fetch(process.env.TIMER_CHANNEL_ID).catch(() => null);
        if (!fallback) return interaction.editReply(`❌ Could not create thread: ${err?.message}`);
        targetChannel = fallback;
        thread = await targetChannel.threads.create({ name: threadName, autoArchiveDuration: 1440, reason: 'Raid night parse scoreboard' });
      } else {
        return interaction.editReply(`❌ Could not create thread: ${err?.message}`);
      }
    }

    await openSession(thread, targetChannel.id, label, tonightParses);
    await interaction.editReply(`✅ Raid thread open: <#${thread.id}>\nUse \`/parse\` after each kill to post results.`);
  },

  appendParseToSession,
  postNightSummaryToSession,
  refreshSessionSummary,
  openSession,
  getTonightParses,
  buildSummaryEmbed,
  buildParseboardEmbed,
  buildParseboardEmbedFromParsed,
  isRaidNight,
  todayDateKey,
  todayLabel,
};
