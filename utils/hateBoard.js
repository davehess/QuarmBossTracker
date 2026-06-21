// utils/hateBoard.js — Plane of Hate board renderers.
//
// Backed by Supabase via utils/hateKills since 2026-06-21. The prior code
// pulled spot state from state.json's `liveKills`/`pvpKills` (single entry
// per spot, overwritten on each kill) and persisted to a hidden JSON embed
// in HATE_THREAD_ID. That model lost history (no second kill per spot) and
// could lose entries on Railway redeploy when the volume blanked + the next
// /pvphatekill save overwrote the Discord embed. Now both `live` and `pvp`
// boards render from the `hate_kills` table — the embed-recovery dance is
// retired and the legacy state.json keys are imported on startup.
//
// Renderer signatures are unchanged so command files and the button
// handlers in index.js don't need to know any of that switched under them.

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { HATE_SPOTS, HATE_AREA_GROUPS } = require('../data/hate-spots');
const { getHateBoardMessageId } = require('./state');
const { discordRelativeTime } = require('./timer');
const hateKills = require('./hateKills');

const HATE_THREAD_ID = () => process.env.HATE_THREAD_ID || '1502031518090924224';

// Tiny in-memory cache so a render burst (two boards refreshing 50ms apart,
// or a board + a /pvphate slash render landing back-to-back) doesn't fire
// duplicate Supabase reads. Stale-while-rebuild semantics: a fresh fetch
// always wins, but the cache fills the gap while it's flying.
const STATE_CACHE_TTL_MS = 2000;
const _stateCache = { live: { at: 0, value: {} }, pvp: { at: 0, value: {} } };

async function _spotState(server) {
  const cached = _stateCache[server];
  if (cached && (Date.now() - cached.at) < STATE_CACHE_TTL_MS) return cached.value;
  const value = await hateKills.getSpotStateForServer(server);
  _stateCache[server] = { at: Date.now(), value };
  return value;
}

// Force a cache bust — called after a write so the next render sees the new
// row immediately rather than waiting for TTL.
function invalidateSpotStateCache(server) {
  if (server) _stateCache[server] = { at: 0, value: {} };
  else        { _stateCache.live = { at: 0, value: {} }; _stateCache.pvp = { at: 0, value: {} }; }
}

// Returns { emoji, line } for one spot's current entry. `entry` is a row
// from hate_kills (or null if no active row exists).
function spotStatus(entry, type, now) {
  if (!entry) return { emoji: '🟢', line: 'Available' };
  if (entry.timer_unknown) return { emoji: '❓', line: 'Timer unknown — check manually' };

  const earliestMs = entry.next_spawn_earliest ? Date.parse(entry.next_spawn_earliest) : null;
  const latestMs   = entry.next_spawn_latest   ? Date.parse(entry.next_spawn_latest)   : null;

  if (!earliestMs || earliestMs <= now) {
    if (type === 'pvp' && latestMs && latestMs > now) {
      return { emoji: '🟡', line: `Window open — latest ${discordRelativeTime(latestMs)}` };
    }
    return { emoji: '🟢', line: 'Available (timer expired)' };
  }
  if (type === 'pvp' && latestMs) {
    return {
      emoji: '⏰',
      line:  `Earliest ${discordRelativeTime(earliestMs)} · Latest ${discordRelativeTime(latestMs)}`,
    };
  }
  return { emoji: '⏰', line: `Spawns ${discordRelativeTime(earliestMs)}` };
}

async function buildHateBoardEmbed(type, now) {
  const state = await _spotState(type);
  const label = type === 'live' ? '🟣 Live Server' : '🔴 PVP Server';
  const color = type === 'live' ? 0x9b59b6 : 0xcc0000;

  const lines = [];
  for (const group of HATE_AREA_GROUPS) {
    lines.push(`**${group.name}**`);
    for (const n of group.spots) {
      const spot  = HATE_SPOTS[n];
      const entry = state[n] || null;
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

async function buildHateBoardRows(type, now) {
  const state = await _spotState(type);
  const chunks = [[1,2,3],[5,7,8,9],[10,11,12]];
  const rows = [];
  for (const chunk of chunks) {
    const row = new ActionRowBuilder();
    for (const n of chunk) {
      const entry = state[n] || null;
      const earliestMs = entry && entry.next_spawn_earliest
        ? Date.parse(entry.next_spawn_earliest)
        : null;

      let style, label;
      if (!entry || (!entry.timer_unknown && earliestMs && earliestMs <= now)) {
        style = ButtonStyle.Success;
        label = `#${n} ✅`;
      } else if (entry.timer_unknown) {
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
    const thread = await client.channels.fetch(threadId);
    const msg    = await thread.messages.fetch(msgId);
    const now    = Date.now();
    const [embed, components] = await Promise.all([
      buildHateBoardEmbed(type, now),
      buildHateBoardRows(type, now),
    ]);
    await msg.edit({ embeds: [embed], components });
  } catch (err) {
    console.warn(`[hateBoard] Could not refresh ${type} board:`, err?.message);
  }
}

module.exports = {
  buildHateBoardEmbed,
  buildHateBoardRows,
  refreshHateBoard,
  invalidateSpotStateCache,
  HATE_THREAD_ID,
  spotStatus,
};
