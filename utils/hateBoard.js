// utils/hateBoard.js — Persistent Plane of Hate board helpers.

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { HATE_SPOTS, HATE_AREA_GROUPS } = require('../data/hate-spots');
const { getAllLiveKills, getAllPvpKills, getHateBoardMessageId } = require('./state');
const { discordRelativeTime, discordAbsoluteTime } = require('./timer');

const HATE_THREAD_ID = () => process.env.HATE_THREAD_ID || '1502031518090924224';

// Returns { emoji, line } for a given spot entry (or null if not killed)
function spotStatus(entry, type, now) {
  if (!entry) return { emoji: '🟢', line: 'Available' };
  if (entry.timerUnknown) return { emoji: '❓', line: 'Timer unknown — check manually' };
  if (!entry.nextSpawn || entry.nextSpawn <= now) return { emoji: '🟢', line: 'Available (timer expired)' };
  if (type === 'pvp' && entry.nextSpawn <= now && entry.nextSpawnLatest && entry.nextSpawnLatest > now) {
    return { emoji: '🟡', line: `Window open — latest ${discordRelativeTime(entry.nextSpawnLatest)}` };
  }
  if (type === 'pvp' && entry.nextSpawnLatest && entry.nextSpawn > now) {
    // Earliest hasn't passed
    const earliest = discordRelativeTime(entry.nextSpawn);
    const latest   = discordRelativeTime(entry.nextSpawnLatest);
    return { emoji: '⏰', line: `Earliest ${earliest} · Latest ${latest}` };
  }
  return { emoji: '⏰', line: `Spawns ${discordRelativeTime(entry.nextSpawn)}` };
}

function buildHateBoardEmbed(type, now) {
  const kills = type === 'live' ? getAllLiveKills() : getAllPvpKills();
  const keyPrefix = type === 'live' ? 'hate_' : 'hate_pvp_';
  const label = type === 'live' ? '🟣 Live Server' : '🔴 PVP Server';
  const color = type === 'live' ? 0x9b59b6 : 0xcc0000;

  const lines = [];
  for (const group of HATE_AREA_GROUPS) {
    lines.push(`**${group.name}**`);
    for (const n of group.spots) {
      const spot  = HATE_SPOTS[n];
      const key   = keyPrefix + n;
      const entry = kills[key] || null;
      const { emoji, line } = spotStatus(entry, type, now);
      lines.push(`${emoji} **#${n}** — ${spot.label.replace(/^Spot \d+ — /, '')}  ↳ ${line}`);
    }
    lines.push('');
  }

  return new EmbedBuilder()
    .setColor(color)
    .setTitle(`Plane of Hate — ${label} Tracker`)
    .setDescription(lines.join('\n').trimEnd())
    .setFooter({ text: 'Click a button below to toggle kill/unkill' })
    .setTimestamp(now);
}

function buildHateBoardRows(type, now) {
  const kills = type === 'live' ? getAllLiveKills() : getAllPvpKills();
  const keyPrefix = type === 'live' ? 'hate_' : 'hate_pvp_';

  // 10 valid spots grouped by area across 3 rows
  const rows = [];
  const chunks = [[1,2,3],[5,7,8,9],[10,11,12]];
  for (const chunk of chunks) {
    const row = new ActionRowBuilder();
    for (const n of chunk) {
      const key   = keyPrefix + n;
      const entry = kills[key] || null;
      let style, label;
      if (!entry || (!entry.timerUnknown && entry.nextSpawn && entry.nextSpawn <= now)) {
        style = ButtonStyle.Success;
        label = `#${n} ✅`;
      } else if (entry.timerUnknown) {
        style = ButtonStyle.Secondary;
        label = `#${n} ❓`;
      } else {
        style = ButtonStyle.Danger;
        label = `#${n} ⏰`;
      }
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`hate_kill:${type}:${n}`)
          .setLabel(label)
          .setStyle(style)
      );
    }
    rows.push(row);
  }
  return rows;
}

async function refreshHateBoard(client, type) {
  const threadId = HATE_THREAD_ID();
  const msgId    = getHateBoardMessageId(type);
  if (!threadId || !msgId) return;

  try {
    const thread  = await client.channels.fetch(threadId);
    const msg     = await thread.messages.fetch(msgId);
    const now     = Date.now();
    await msg.edit({
      embeds:     [buildHateBoardEmbed(type, now)],
      components: buildHateBoardRows(type, now),
    });
  } catch (err) {
    console.warn(`[hateBoard] Could not refresh ${type} board:`, err?.message);
  }
}

module.exports = { buildHateBoardEmbed, buildHateBoardRows, refreshHateBoard, HATE_THREAD_ID, spotStatus };
