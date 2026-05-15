// utils/hateBoard.js — Persistent Plane of Hate board helpers.

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { HATE_SPOTS, HATE_AREA_GROUPS } = require('../data/hate-spots');
const {
  getAllLiveKills, getAllPvpKills,
  getHateBoardMessageId,
  getHateStateMessageId, setHateStateMessageId,
  setAllLiveKills, setAllPvpKills,
} = require('./state');
const { discordRelativeTime, discordAbsoluteTime } = require('./timer');

// Titles for the hidden JSON state embeds stored in the hate thread
const HATE_LIVE_DATA_TITLE = '🟣 Plane of Hate — Live State';
const HATE_PVP_DATA_TITLE  = '🔴 Plane of Hate — PVP State';

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

  // Persist kill state to Discord so it survives redeploys without a volume
  saveHateStateToDiscord(client, type).catch(err =>
    console.warn(`[hateBoard] saveHateStateToDiscord(${type}):`, err?.message)
  );
}

// Saves liveKills or pvpKills as a JSON embed in the hate thread (edit in place).
// Stores the message ID in state.json so future saves don't need a thread scan.
async function saveHateStateToDiscord(client, type) {
  const threadId = HATE_THREAD_ID();
  if (!threadId) return;

  const title = type === 'live' ? HATE_LIVE_DATA_TITLE : HATE_PVP_DATA_TITLE;
  const kills = type === 'live' ? getAllLiveKills() : getAllPvpKills();

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setColor(0x2b2d31)
    .setDescription(JSON.stringify(kills))
    .setTimestamp();

  try {
    const thread   = await client.channels.fetch(threadId);
    const storedId = getHateStateMessageId(type);

    if (storedId) {
      try {
        const msg = await thread.messages.fetch(storedId);
        await msg.edit({ embeds: [embed] });
        return;
      } catch {
        // message gone — fall through to post new
      }
    }

    const msg = await thread.send({ embeds: [embed] });
    setHateStateMessageId(type, msg.id);
  } catch (err) {
    console.warn(`[hateBoard] saveHateStateToDiscord(${type}):`, err?.message);
  }
}

// Loads hate kill state from Discord on startup. Only restores entries that are
// active (nextSpawn in the future, or timerUnknown) and missing from state.json —
// never overwrites existing state.json data.
async function loadHateStateFromDiscord(client) {
  const threadId = HATE_THREAD_ID();
  if (!threadId) {
    console.warn('[hateBoard] HATE_THREAD_ID not set — hate state not loaded from Discord');
    return;
  }

  const now = Date.now();

  try {
    const thread = await client.channels.fetch(threadId);
    const msgs   = await thread.messages.fetch({ limit: 100 });

    for (const msg of msgs.values()) {
      if (msg.author.id !== client.user.id) continue;
      const title = msg.embeds[0]?.title;
      if (title !== HATE_LIVE_DATA_TITLE && title !== HATE_PVP_DATA_TITLE) continue;

      let data;
      try { data = JSON.parse(msg.embeds[0].description); } catch { continue; }

      const isLive    = title === HATE_LIVE_DATA_TITLE;
      const existing  = isLive ? getAllLiveKills() : getAllPvpKills();
      const restored  = {};

      for (const [key, entry] of Object.entries(data)) {
        if (existing[key]) continue; // state.json already has this — don't overwrite
        const active = entry.timerUnknown || (entry.nextSpawn && entry.nextSpawn > now);
        if (!active) continue;       // expired — skip
        restored[key] = entry;
      }

      if (Object.keys(restored).length === 0) continue;

      const merged = { ...existing, ...restored };
      if (isLive) setAllLiveKills(merged);
      else        setAllPvpKills(merged);

      // Cache the message ID so future saves edit in place
      const type = isLive ? 'live' : 'pvp';
      if (!getHateStateMessageId(type)) setHateStateMessageId(type, msg.id);

      console.log(`[hateBoard] Restored ${Object.keys(restored).length} ${isLive ? 'live' : 'pvp'} hate kill(s) from Discord`);
    }
  } catch (err) {
    console.warn('[hateBoard] loadHateStateFromDiscord:', err?.message);
  }
}

module.exports = {
  buildHateBoardEmbed, buildHateBoardRows, refreshHateBoard,
  saveHateStateToDiscord, loadHateStateFromDiscord,
  HATE_THREAD_ID, spotStatus,
};
