// commands/parse.js — Submit an EQLogParser DPS parse for a boss fight.
const {
  SlashCommandBuilder, EmbedBuilder, MessageFlags,
  StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ActionRowBuilder,
} = require('discord.js');
const fs   = require('fs');
const path = require('path');

const PARSES_FILE = path.join(__dirname, '../data/parses.json');

function loadParses() {
  if (!fs.existsSync(PARSES_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(PARSES_FILE, 'utf8')); }
  catch { return {}; }
}

function saveParses(data) {
  const tmp = PARSES_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, PARSES_FILE);
}

// Parses EQLogParser "Send to EQ" format:
// "High Priest of Ssraeshza in 42s, 53.12K Damage @1.26K, 1. Statlander +Pets = 4.59K@148 in 31s | ..."
// Total damage may use K or M suffix; individual damage may be raw (e.g. 204@68 for tiny contributors).
function kmToInt(num, suffix) {
  const n = parseFloat(num);
  if (suffix === 'M') return Math.round(n * 1_000_000);
  if (suffix === 'K') return Math.round(n * 1_000);
  return Math.round(n);
}

function parseEQLog(str) {
  const headerMatch = str.match(/^(.+?)\s+in\s+(\d+)s,\s*([\d.]+)([KM])\s+Damage\s+@([\d.]+)([KM])/);
  if (!headerMatch) return null;

  const bossName    = headerMatch[1].trim();
  const duration    = parseInt(headerMatch[2]);
  const totalDamage = kmToInt(headerMatch[3], headerMatch[4]);
  const totalDps    = kmToInt(headerMatch[5], headerMatch[6]);

  // Handles K-suffixed damage (78.22K@216) and raw numbers (204@68)
  const playerRx = /(\d+)\.\s+(.+?)\s+=\s+([\d.]+)(K)?@(\d+)\s+in\s+(\d+)s/g;
  const players  = [];
  let m;
  while ((m = playerRx.exec(str)) !== null) {
    const raw     = m[2].trim();
    const hasPets = raw.includes('+Pets');
    const name    = raw.replace(/\s*\+Pets/g, '').trim();
    players.push({
      rank: parseInt(m[1]), name, hasPets,
      damage:   kmToInt(m[3], m[4]),
      dps:      parseInt(m[5]),
      duration: parseInt(m[6]),
    });
  }

  if (players.length === 0) return null;
  return { bossName, duration, totalDamage, totalDps, players };
}

// Boss matching: exact > nickname > partial (by closest name length, tie: longer name wins)
function findBossFromName(parsedName, bosses) {
  const nl = parsedName.toLowerCase().trim();
  const exact = bosses.find(b => b.name.toLowerCase() === nl);
  if (exact) return exact;
  const nick = bosses.find(b => (b.nicknames || []).some(n => n.toLowerCase() === nl));
  if (nick) return nick;
  const partials = bosses
    .filter(b => { const bn = b.name.toLowerCase(); return bn.includes(nl) || nl.includes(bn); })
    .sort((a, b) => {
      const da = Math.abs(a.name.length - nl.length);
      const db = Math.abs(b.name.length - nl.length);
      return da !== db ? da - db : b.name.length - a.name.length;
    });
  return partials[0] || null;
}

// Returns { exact: boss } | { partial: boss } | { candidates: [boss,...] } | { none: true }
function findBossWithQuality(parsedName, bosses) {
  const nl = parsedName.toLowerCase().trim();
  const exact = bosses.find(b => b.name.toLowerCase() === nl);
  if (exact) return { exact };
  const nick = bosses.find(b => (b.nicknames || []).some(n => n.toLowerCase() === nl));
  if (nick) return { exact: nick };

  // Build all partials with score
  const partials = bosses
    .filter(b => { const bn = b.name.toLowerCase(); return bn.includes(nl) || nl.includes(bn); })
    .map(b => ({ boss: b, diff: Math.abs(b.name.length - nl.length) }))
    .sort((a, b) => a.diff !== b.diff ? a.diff - b.diff : b.boss.name.length - a.boss.name.length);

  if (partials.length === 0) return { none: true };
  if (partials.length === 1) return { partial: partials[0].boss };

  // If the best score is significantly better than second, treat as single partial
  const best = partials[0].diff;
  const similar = partials.filter(p => p.diff <= best + 3); // within 3 chars of best
  if (similar.length === 1) return { partial: similar[0].boss };

  // Multiple similar candidates — return top 5 for select menu
  return { candidates: similar.slice(0, 5).map(p => p.boss) };
}

function fmt(n) { return n.toLocaleString('en-US'); }

function buildParseEmbed(bossName, parsed, bossEmoji) {
  const rows = parsed.players.slice(0, 15).map((p) => {
    const rank  = String(p.rank).padStart(2);
    const name  = (p.name + (p.hasPets ? ' +P' : '')).padEnd(20);
    const dmg   = fmt(p.damage).padStart(7);
    const dps   = (p.dps + '/s').padStart(7);
    const dur   = (p.duration + 's').padStart(4);
    return `${rank}. ${name} ${dmg}  ${dps}  ${dur}`;
  });

  const hdr     = `${'#'.padStart(2)}  ${'Player'.padEnd(20)} ${'Damage'.padStart(7)}  ${'DPS'.padStart(7)}  Time`;
  const divider = '─'.repeat(hdr.length);
  const table   = [hdr, divider, ...rows].join('\n');

  const title = ['📊', bossEmoji, bossName].filter(Boolean).join(' ');
  return new EmbedBuilder()
    .setColor(0xe74c3c)
    .setTitle(title)
    .setDescription(`Fight: **${parsed.duration}s** · ${fmt(parsed.totalDamage)} dmg · ${fmt(parsed.totalDps)}/s raid DPS`)
    .addFields({ name: 'DPS Rankings', value: '```\n' + table + '\n```', inline: false })
    .setTimestamp();
}

/**
 * Post a compact JSON embed to PARSES_LOG_THREAD_ID so parse data survives volume wipes.
 * Returns the sent message object (or null).
 */
async function logParseToDiscord(client, bossId, parseEntry) {
  const threadId = process.env.PARSES_LOG_THREAD_ID;
  if (!threadId) return null;
  const thread = await client.channels.fetch(threadId);
  const data = {
    bossId,
    ts:  parseEntry.timestamp,
    dur: parseEntry.duration,
    dmg: parseEntry.totalDamage,
    dps: parseEntry.totalDps,
    by:  parseEntry.submittedByName,
    p:   parseEntry.players.map(({ name, hasPets, damage, dps, duration }) => ({
      n: name, ...(hasPets ? { hp: 1 } : {}), d: damage, dps, dur: duration,
    })),
  };
  const msg = await thread.send({
    embeds: [new EmbedBuilder()
      .setTitle('📊 Parse Log')
      .setColor(0x2f3136)
      .setDescription(JSON.stringify(data))
    ]
  });
  return msg;
}

/**
 * Rebuild parses.json by fetching all '📊 Parse Log' embeds from PARSES_LOG_THREAD_ID.
 * Merges with whatever is already on the volume (union, dedup by timestamp).
 * Called on startup so Discord is the authoritative source of truth.
 */
async function loadParsesFromDiscord(client) {
  const threadId = process.env.PARSES_LOG_THREAD_ID;
  if (!threadId) { console.log('[parses] PARSES_LOG_THREAD_ID not set — skipping Discord recovery'); return; }

  try {
    const thread = await client.channels.fetch(threadId);

    // Fetch up to 2000 messages (20 pages × 100)
    const allMsgs = [];
    let lastId = null;
    for (let i = 0; i < 20; i++) {
      const opts = { limit: 100 };
      if (lastId) opts.before = lastId;
      const batch = await thread.messages.fetch(opts);
      if (batch.size === 0) break;
      allMsgs.push(...batch.values());
      lastId = batch.last().id;
    }

    // Parse log embeds → { bossId → [entry, ...] }
    const fromDiscord = {};
    for (const msg of allMsgs) {
      const embed = msg.embeds[0];
      if (!embed || embed.title !== '📊 Parse Log') continue;
      try {
        const data = JSON.parse(embed.description);
        if (!data.bossId || !data.ts) continue;
        if (!fromDiscord[data.bossId]) fromDiscord[data.bossId] = [];
        fromDiscord[data.bossId].push({
          timestamp:       data.ts,
          submittedByName: data.by || 'unknown',
          duration:        data.dur,
          totalDamage:     data.dmg,
          totalDps:        data.dps,
          discordMsgId:    msg.id,
          players: (data.p || []).map(p => ({
            name: p.n, hasPets: !!(p.hp), damage: p.d, dps: p.dps, duration: p.dur,
          })),
        });
      } catch {}
    }

    // Merge with existing volume data, dedup by (bossId, timestamp)
    const existing = loadParses();
    const merged   = { ...existing };
    for (const [bossId, kills] of Object.entries(fromDiscord)) {
      const knownTs = new Set((merged[bossId] || []).map(k => k.timestamp));
      if (!merged[bossId]) merged[bossId] = [];
      for (const k of kills) {
        if (!knownTs.has(k.timestamp)) { merged[bossId].push(k); knownTs.add(k.timestamp); }
      }
    }

    saveParses(merged);
    const total = Object.values(merged).reduce((s, v) => s + v.length, 0);
    console.log(`[parses] Loaded ${total} parses from Discord + volume`);
  } catch (err) {
    console.error('[parses] Failed to load from Discord:', err?.message);
  }
}

// ── Pending parses (for select-menu confirm flow) ──────────────────────────────
const pendingParses = new Map(); // userId → { parsed, rawData, ts }

// Expire entries after 2 minutes
setInterval(() => {
  const cutoff = Date.now() - 2 * 60 * 1000;
  for (const [userId, entry] of pendingParses.entries()) {
    if (entry.ts < cutoff) pendingParses.delete(userId);
  }
}, 30_000);

// ── Shared finish-parse logic ─────────────────────────────────────────────────
async function finishParse(interaction, bossId, boss, parsed) {
  delete require.cache[require.resolve('../data/bosses.json')];
  const bosses = require('../data/bosses.json');

  const parseEntry = {
    timestamp:        Date.now(),
    submittedBy:      interaction.user.id,
    submittedByName:  interaction.member?.displayName || interaction.user.username,
    duration:         parsed.duration,
    totalDamage:      parsed.totalDamage,
    totalDps:         parsed.totalDps,
    players:          parsed.players,
    discordMsgId:     null, // filled after logging
  };

  const parses = loadParses();
  if (!parses[bossId]) parses[bossId] = [];
  parses[bossId].push(parseEntry);
  saveParses(parses);

  const bossName = boss?.name || parsed.bossName;
  const embed    = buildParseEmbed(bossName, parsed, boss?.emoji);

  // Log to Discord thread for persistence (fire-and-forget, but capture msg id)
  logParseToDiscord(interaction.client, bossId, parseEntry).then(msg => {
    if (msg?.id) {
      // Update the stored entry with the discord message id
      const p2 = loadParses();
      if (p2[bossId]) {
        const idx = p2[bossId].findIndex(e => e.timestamp === parseEntry.timestamp && e.submittedBy === parseEntry.submittedBy);
        if (idx !== -1) { p2[bossId][idx].discordMsgId = msg.id; saveParses(p2); }
      }
    }
  }).catch(err => console.warn('[parse] Discord log failed:', err?.message));

  // Auto-kill boss if not already on cooldown
  const { getBossState, recordKill } = require('../utils/state');
  const { postKillUpdate } = require('../utils/killops');
  const bossState = getBossState(bossId);
  const now = Date.now();
  if (!bossState || !bossState.killedAt || bossState.nextSpawn <= now) {
    const freshBoss = bosses.find(b => b.id === bossId);
    if (freshBoss) {
      recordKill(bossId, freshBoss.timerHours, interaction.user.id);
      postKillUpdate(interaction.client, process.env.TIMER_CHANNEL_ID, bossId).catch(console.warn);
    }
  } else {
    try {
      await interaction.followUp({
        flags: MessageFlags.Ephemeral,
        content: `ℹ️ **${bossName}** is already marked as killed — timer running.`,
      });
    } catch {}
  }

  // Auto-append to active raid night thread (fire-and-forget)
  const { appendParseToSession } = require('./raidnight');
  appendParseToSession(interaction.client, bossId, parsed, bossName, boss?.emoji).catch(() => {});

  return embed;
}

// ── Select-menu confirm handler ────────────────────────────────────────────────
async function handleParseConfirm(interaction) {
  const pending = pendingParses.get(interaction.user.id);
  if (!pending) {
    return interaction.update({ content: '❌ Session expired. Run /parse again.', components: [] });
  }
  pendingParses.delete(interaction.user.id);
  const bossId = interaction.values[0];
  delete require.cache[require.resolve('../data/bosses.json')];
  const bosses = require('../data/bosses.json');
  const boss = bosses.find(b => b.id === bossId);
  await interaction.update({ content: `✅ Using **${boss?.name || bossId}**...`, components: [] });
  const embed = await finishParse(interaction, bossId, boss, pending.parsed);
  await interaction.followUp({ flags: MessageFlags.Ephemeral, embeds: [embed] }).catch(() => {});
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('parse')
    .setDescription('Submit an EQLogParser DPS parse for a boss fight.')
    .addStringOption(opt =>
      opt.setName('data')
        .setDescription('Paste the EQLogParser "Send to EQ" output')
        .setRequired(true)
        .setMaxLength(6000)
    ),

  async execute(interaction) {
    const rawData = interaction.options.getString('data');

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    delete require.cache[require.resolve('../data/bosses.json')];
    const bosses = require('../data/bosses.json');

    const parsed = parseEQLog(rawData);
    if (!parsed) {
      return interaction.editReply('❌ Could not parse that input. Paste the EQLogParser "Send to EQ" output directly (e.g. "Boss Name in 397s, 1.54M Damage @3.87K, 1. Player = 78.22K@216 in 362s | ...")');
    }

    const result = findBossWithQuality(parsed.bossName, bosses);

    if (result.none) {
      return interaction.editReply(`❌ Could not identify boss "**${parsed.bossName}**". Use \`/parseboss\` to specify manually.`);
    }

    if (result.exact) {
      const embed = await finishParse(interaction, result.exact.id, result.exact, parsed);
      return interaction.editReply({ embeds: [embed] });
    }

    if (result.partial) {
      const embed = await finishParse(interaction, result.partial.id, result.partial, parsed);
      return interaction.editReply({
        content: `ℹ️ Auto-matched to **${result.partial.name}** — use /parseboss to override`,
        embeds: [embed],
      });
    }

    // Multiple candidates — show select menu
    if (result.candidates) {
      pendingParses.set(interaction.user.id, { parsed, rawData, ts: Date.now() });

      const select = new StringSelectMenuBuilder()
        .setCustomId('parseConfirm')
        .setPlaceholder('Select the correct boss…')
        .addOptions(result.candidates.map(b =>
          new StringSelectMenuOptionBuilder()
            .setLabel(b.name)
            .setDescription(`${b.zone} — ${b.expansion}`)
            .setValue(b.id)
        ));
      const row = new ActionRowBuilder().addComponents(select);

      return interaction.editReply({
        content: `❓ Multiple bosses could match "**${parsed.bossName}**". Which one?`,
        components: [row],
      });
    }
  },

  parseEQLog,
  findBossFromName,
  loadParses,
  saveParses,
  buildParseEmbed,
  logParseToDiscord,
  loadParsesFromDiscord,
  pendingParses,
  handleParseConfirm,
  finishParse,
};
