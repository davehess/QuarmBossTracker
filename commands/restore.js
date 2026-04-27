// commands/restore.js — v0.9.3
// /restore <links...>
//
// Accepts 1–10 space/newline-separated Discord message links.
// Supported embed types:
//   📊 Active Cooldowns          — main channel (nextSpawn is authoritative)
//   <Expansion> — Active Cooldowns — thread cooldown card (same)
//   📅 Daily Raid Summary        — reconstruct nextSpawn = killedAt + timerHours
//
// Multi-message merging:
//   All entries are collected, grouped by bossId.
//   For each boss the LATEST nextSpawn across all sources wins — so you can paste
//   the entire week of daily summaries plus a cooldowns card and get a complete picture.
//   Entries whose nextSpawn has already passed are skipped (boss is available now).
//
// After writing state, refreshes every board, cooldown card, summary card.

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { hasAllowedRole, allowedRolesList } = require('../utils/roles');
const { EXPANSION_ORDER, getThreadId } = require('../utils/config');
const { EXPANSION_META } = require('../utils/config');
const {
  postOrUpdateExpansionBoard,
  refreshSummaryCard,
  refreshSpawningTomorrowCard,
  refreshThreadCooldownCard,
} = require('../utils/killops');

function getBosses() {
  delete require.cache[require.resolve('../data/bosses.json')];
  return require('../data/bosses.json');
}

function parseMessageLink(link) {
  const m = link.trim().match(/discord(?:app)?\.com\/channels\/(\d+)\/(\d+)\/(\d+)/);
  if (!m) return null;
  return { guildId: m[1], channelId: m[2], messageId: m[3] };
}

/** Extract all message links from a string (handles spaces, newlines, commas) */
function extractLinks(input) {
  return (input.match(/https?:\/\/discord(?:app)?\.com\/channels\/\d+\/\d+\/\d+/g) || []);
}

function findBoss(bosses, bossName, zone) {
  const nl = bossName.toLowerCase().trim();
  const zl = (zone || '').toLowerCase().trim();
  return (
    bosses.find((b) => b.name.toLowerCase() === nl && b.zone.toLowerCase() === zl) ||
    bosses.find((b) => b.name.toLowerCase() === nl) ||
    bosses.find((b) => (b.nicknames || []).some((n) => n.toLowerCase() === nl)) ||
    bosses.find((b) => b.name.toLowerCase().includes(nl) || nl.includes(b.name.toLowerCase())) ||
    null
  );
}

/** Parse Discord <t:unix:?> tag or readable date string → ms, or null */
function parseTimeMs(text) {
  if (!text) return null;
  const discord = text.match(/<t:(\d+)(?::[A-Za-z])?>/);
  if (discord) return parseInt(discord[1]) * 1000;
  const human = text.match(/([A-Z][a-z]+ \d{1,2},? \d{4})\s+(\d{1,2}:\d{2}\s*[AP]M)/i);
  if (human) {
    const d = new Date(`${human[1]} ${human[2]} EST`);
    if (!isNaN(d)) return d.getTime();
  }
  return null;
}

/**
 * Parse Active Cooldowns embed (main channel or thread).
 * Lines: emoji **Boss Name** (Zone) — <t:unix:F>  <t:unix:R>
 * Returns [{bossName, zone, nextSpawnMs}]
 */
function parseCooldownEmbed(embed) {
  const entries = [];
  for (const field of (embed.fields || [])) {
    for (const line of field.value.split('\n')) {
      const m = line.match(/\*\*([^*]+)\*\*\s*\(([^)]+)\)\s*[—–-]\s*(.+)/);
      if (!m) continue;
      const nextSpawnMs = parseTimeMs(m[3].trim());
      entries.push({ bossName: m[1].trim(), zone: m[2].trim(), nextSpawnMs });
    }
  }
  return entries;
}

/**
 * Parse Daily Raid Summary embed.
 * Killed field lines: • **Boss Name** (Zone) — <t:unix:t> by <@id>
 * Returns [{bossName, zone, killedAt}]
 */
function parseDailySummaryEmbed(embed) {
  const entries = [];
  const killedField = (embed.fields || []).find(
    (f) => f.name.startsWith('☠️ Killed')
  );
  if (!killedField) return entries;

  for (const line of killedField.value.split('\n')) {
    // • **Boss Name** (Zone) — <t:unix:t> by ...
    const m = line.match(/[•·\-]?\s*\*\*([^*]+)\*\*\s*\(([^)]+)\)\s*[—–-]\s*(<t:\d+[^>]*>|[\d:]+\s*[AP]M)\s*by/i);
    if (!m) continue;
    const killedAt = parseTimeMs(m[3].trim());
    if (!killedAt) continue;
    entries.push({ bossName: m[1].trim(), zone: m[2].trim(), killedAt });
  }
  return entries;
}

/** Write a map of { bossId → {killedAt, nextSpawn} } to state.json atomically */
function writeKillsToState(killMap) {
  const fs   = require('fs');
  const path = require('path');
  const f    = path.join(__dirname, '../data/state.json');
  let raw;
  try { raw = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { raw = {}; }
  if (!raw.bosses) raw.bosses = {};
  for (const [bossId, entry] of Object.entries(killMap)) {
    raw.bosses[bossId] = { killedAt: entry.killedAt, nextSpawn: entry.nextSpawn, killedBy: 'restored' };
  }
  const tmp = f + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(raw, null, 2), 'utf8');
  fs.renameSync(tmp, f);
}

async function runAutoRestore(client) {
  const histThreadId = process.env.HISTORIC_KILLS_THREAD_ID;
  if (!histThreadId) { console.warn('[startup/restore] HISTORIC_KILLS_THREAD_ID not set — skipping'); return; }

  let links;
  try {
    const histThread  = await client.channels.fetch(histThreadId);
    const fetched     = await histThread.messages.fetch({ limit: 100 });
    const summaryMsgs = [...fetched.values()]
      .filter(m => m.embeds[0]?.title === '📅 Daily Raid Summary')
      .sort((a, b) => b.createdTimestamp - a.createdTimestamp)
      .slice(0, 7);
    if (summaryMsgs.length === 0) { console.log('[startup/restore] No Daily Raid Summary messages found'); return; }
    links = summaryMsgs.map(m =>
      `https://discord.com/channels/${m.guildId}/${m.channelId}/${m.id}`
    );
  } catch (err) {
    console.error('[startup/restore] Could not fetch Historic Kills thread:', err?.message);
    return;
  }

  const bosses  = getBosses();
  const now     = Date.now();
  const killMap = {};

  for (const link of links) {
    const parsed = parseMessageLink(link);
    if (!parsed) continue;
    let refMsg;
    try {
      const ch = await client.channels.fetch(parsed.channelId);
      refMsg   = await ch.messages.fetch(parsed.messageId);
    } catch { continue; }

    const embed = refMsg.embeds[0];
    if (!embed) continue;
    const title = embed.title || '';

    if (title === '📅 Daily Raid Summary') {
      for (const { bossName, zone, killedAt } of parseDailySummaryEmbed(embed)) {
        const boss = findBoss(bosses, bossName, zone);
        if (!boss) continue;
        const nextSpawn = killedAt + boss.timerHours * 3600000;
        if (nextSpawn <= now) continue;
        if (!killMap[boss.id] || nextSpawn > killMap[boss.id].nextSpawn)
          killMap[boss.id] = { killedAt, nextSpawn };
      }
    } else if (title === '📊 Active Cooldowns' || title.endsWith('— Active Cooldowns')) {
      for (const { bossName, zone, nextSpawnMs } of parseCooldownEmbed(embed)) {
        const boss = findBoss(bosses, bossName, zone);
        if (!boss || !nextSpawnMs || nextSpawnMs <= now) continue;
        const killedAt = nextSpawnMs - boss.timerHours * 3600000;
        if (!killMap[boss.id] || nextSpawnMs > killMap[boss.id].nextSpawn)
          killMap[boss.id] = { killedAt, nextSpawn: nextSpawnMs };
      }
    }
  }

  const killCount = Object.keys(killMap).length;
  if (killCount === 0) { console.log('[startup/restore] No active cooldowns to restore'); return; }

  writeKillsToState(killMap);
  console.log(`[startup/restore] Restored ${killCount} active cooldown(s)`);

  const freshBosses   = getBosses();
  const mainChannelId = process.env.TIMER_CHANNEL_ID;
  await Promise.allSettled(
    EXPANSION_ORDER.map(async (exp) => {
      const threadId = getThreadId(exp);
      if (!threadId) return;
      await postOrUpdateExpansionBoard(client, exp, threadId, freshBosses).catch(console.warn);
      await refreshThreadCooldownCard(client, exp, threadId, freshBosses).catch(console.warn);
    })
  );
  if (mainChannelId) {
    await refreshSummaryCard(client, mainChannelId, freshBosses).catch(console.warn);
    await refreshSpawningTomorrowCard(client, mainChannelId, freshBosses).catch(console.warn);
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('restore')
    .setDescription('Restore kill state from message links, or auto-restore from last 7 daily summaries')
    .addStringOption((opt) =>
      opt.setName('links')
        .setDescription('Discord message links (space/newline separated) — omit to auto-restore from last 7 summaries')
        .setRequired(false)
    ),

  async execute(interaction) {
    if (!hasAllowedRole(interaction.member)) {
      return interaction.reply({ flags: MessageFlags.Ephemeral, content: `❌ You need one of these roles: ${allowedRolesList()}` });
    }

    const input = interaction.options.getString('links')?.trim() || '';
    let links   = extractLinks(input);

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // ── Auto mode: no links provided — pull last 7 daily summaries from Historic Kills thread ──
    if (links.length === 0) {
      const histThreadId = process.env.HISTORIC_KILLS_THREAD_ID;
      if (!histThreadId) {
        return interaction.editReply('❌ No links provided and HISTORIC_KILLS_THREAD_ID is not set.');
      }
      try {
        const histThread = await interaction.client.channels.fetch(histThreadId);
        // Fetch recent messages, filter to daily summary embeds, take last 7
        const fetched = await histThread.messages.fetch({ limit: 100 });
        const summaryMsgs = [...fetched.values()]
          .filter(m => m.embeds[0]?.title === '📅 Daily Raid Summary')
          .sort((a, b) => b.createdTimestamp - a.createdTimestamp)
          .slice(0, 7);

        if (summaryMsgs.length === 0) {
          return interaction.editReply('❌ No Daily Raid Summary messages found in the Historic Kills thread.');
        }

        // Build synthetic links so the existing processing loop handles them
        links = summaryMsgs.map(m =>
          `https://discord.com/channels/${m.guildId}/${m.channelId}/${m.id}`
        );
      } catch (err) {
        return interaction.editReply(`❌ Could not fetch Historic Kills thread: ${err?.message}`);
      }
    }

    const bosses = getBosses();
    const now    = Date.now();

    // Accumulated kill map: bossId → {killedAt, nextSpawn}
    // When the same boss appears in multiple sources, LATEST nextSpawn wins.
    const killMap    = {};
    const sourceLog  = [];
    const notFound   = new Set();
    let   parseErrors = 0;

    // Process each link
    for (const link of links) {
      const parsed = parseMessageLink(link);
      if (!parsed) { parseErrors++; continue; }

      let refMsg;
      try {
        const ch = await interaction.client.channels.fetch(parsed.channelId);
        refMsg   = await ch.messages.fetch(parsed.messageId);
      } catch (err) {
        sourceLog.push(`❌ Could not fetch \`${parsed.messageId}\`: ${err?.message}`);
        continue;
      }

      const embed = refMsg.embeds[0];
      if (!embed) { sourceLog.push(`⚠️ Message \`${parsed.messageId}\` has no embed — skipped`); continue; }

      const title = embed.title || '';

      // ── Active Cooldowns (main or thread) ──────────────────────────────
      if (title === '📊 Active Cooldowns' || title.endsWith('— Active Cooldowns')) {
        const entries = parseCooldownEmbed(embed);
        let found = 0, skipped = 0;

        for (const { bossName, zone, nextSpawnMs } of entries) {
          const boss = findBoss(bosses, bossName, zone);
          if (!boss) { notFound.add(`${bossName} (${zone})`); continue; }

          if (!nextSpawnMs || nextSpawnMs <= now) { skipped++; continue; }

          const killedAt = nextSpawnMs - boss.timerHours * 3600000;
          // Latest nextSpawn wins across all sources
          if (!killMap[boss.id] || nextSpawnMs > killMap[boss.id].nextSpawn) {
            killMap[boss.id] = { killedAt, nextSpawn: nextSpawnMs };
            found++;
          }
        }
        sourceLog.push(`✅ "${title}" — ${found} active, ${skipped} expired`);

      // ── Daily Raid Summary ──────────────────────────────────────────────
      } else if (title === '📅 Daily Raid Summary') {
        const entries = parseDailySummaryEmbed(embed);
        let found = 0, skipped = 0;

        for (const { bossName, zone, killedAt } of entries) {
          const boss = findBoss(bosses, bossName, zone);
          if (!boss) { notFound.add(`${bossName} (${zone})`); continue; }

          const nextSpawn = killedAt + boss.timerHours * 3600000;
          if (nextSpawn <= now) { skipped++; continue; }

          // Latest nextSpawn wins
          if (!killMap[boss.id] || nextSpawn > killMap[boss.id].nextSpawn) {
            killMap[boss.id] = { killedAt, nextSpawn };
            found++;
          }
        }
        sourceLog.push(`✅ "Daily Summary" (${new Date(refMsg.createdTimestamp).toLocaleDateString('en-US', {timeZone:'America/New_York', month:'short', day:'numeric'})}) — ${found} still active, ${skipped} expired`);

      } else {
        sourceLog.push(`⚠️ Unrecognised embed type: "${title}" — skipped`);
      }
    }

    const killCount = Object.keys(killMap).length;

    if (killCount === 0) {
      const lines = ['⚠️ No active cooldowns to restore across all provided messages.', '', ...sourceLog];
      if (notFound.size) lines.push(`\nNot matched: ${[...notFound].join(', ')}`);
      return interaction.editReply(lines.join('\n').slice(0, 2000));
    }

    // Write to state
    writeKillsToState(killMap);

    // Refresh all cards and boards
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
    const restoredLines = Object.entries(killMap).map(([bossId, { nextSpawn }]) => {
      const boss = freshBosses.find((b) => b.id === bossId);
      return `${boss?.emoji || '•'} **${boss?.name || bossId}** → <t:${Math.floor(nextSpawn / 1000)}:F>`;
    });

    const reply = [
      `✅ **Restored ${killCount} active cooldown${killCount !== 1 ? 's' : ''} from ${links.length} message${links.length !== 1 ? 's' : ''}**`,
      '',
      '**Sources processed:**',
      ...sourceLog,
      '',
      `**Active cooldowns restored (${killCount}):**`,
      ...restoredLines,
    ];
    if (notFound.size) reply.push(`\n❓ Not matched in bosses.json: ${[...notFound].join(', ')}`);
    reply.push('\nAll boards and cards refreshed.');

    await interaction.editReply(reply.join('\n').slice(0, 2000));
  },

  runAutoRestore,
};
