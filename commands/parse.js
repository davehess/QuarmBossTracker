// commands/parse.js — Submit an EQLogParser DPS parse for a boss fight.
const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
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
 * Fire-and-forget — caller should .catch(() => {}).
 */
async function logParseToDiscord(client, bossId, parseEntry) {
  const threadId = process.env.PARSES_LOG_THREAD_ID;
  if (!threadId) return;
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
  await thread.send({
    embeds: [new EmbedBuilder()
      .setTitle('📊 Parse Log')
      .setColor(0x2f3136)
      .setDescription(JSON.stringify(data))
    ]
  });
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

    // Fetch up to 1000 messages (10 pages × 100)
    const allMsgs = [];
    let lastId = null;
    for (let i = 0; i < 10; i++) {
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

module.exports = {
  data: new SlashCommandBuilder()
    .setName('parse')
    .setDescription('Submit an EQLogParser DPS parse for a boss fight.')
    .addStringOption(opt =>
      opt.setName('boss').setDescription('Boss that was killed').setRequired(true).setAutocomplete(true)
    )
    .addStringOption(opt =>
      opt.setName('data')
        .setDescription('Paste the EQLogParser "Send to EQ" output')
        .setRequired(true)
        .setMaxLength(6000)
    ),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused().toLowerCase();
    delete require.cache[require.resolve('../data/bosses.json')];
    const bosses = require('../data/bosses.json');
    const matches = bosses
      .filter(b =>
        b.name.toLowerCase().includes(focused) ||
        (b.nicknames || []).some(n => n.toLowerCase().includes(focused))
      )
      .slice(0, 25)
      .map(b => ({ name: b.name, value: b.id }));
    await interaction.respond(matches);
  },

  async execute(interaction) {
    const bossId  = interaction.options.getString('boss');
    const rawData = interaction.options.getString('data');

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    delete require.cache[require.resolve('../data/bosses.json')];
    const bosses = require('../data/bosses.json');
    const boss   = bosses.find(b => b.id === bossId);

    const parsed = parseEQLog(rawData);
    if (!parsed) {
      return interaction.editReply('❌ Could not parse that input. Paste the EQLogParser "Send to EQ" output directly (e.g. "Boss Name in 397s, 1.54M Damage @3.87K, 1. Player = 78.22K@216 in 362s | ...")');
    }

    const parseEntry = {
      timestamp:        Date.now(),
      submittedBy:      interaction.user.id,
      submittedByName:  interaction.member?.displayName || interaction.user.username,
      duration:         parsed.duration,
      totalDamage:      parsed.totalDamage,
      totalDps:         parsed.totalDps,
      players:          parsed.players,
    };

    const parses = loadParses();
    if (!parses[bossId]) parses[bossId] = [];
    parses[bossId].push(parseEntry);
    saveParses(parses);

    const bossName = boss?.name || parsed.bossName;
    const embed    = buildParseEmbed(bossName, parsed, boss?.emoji);
    await interaction.editReply({ embeds: [embed] });

    // Log to Discord thread for persistence (fire-and-forget)
    logParseToDiscord(interaction.client, bossId, parseEntry).catch(err =>
      console.warn('[parse] Discord log failed:', err?.message)
    );

    // Auto-append to active raid night thread (fire-and-forget)
    const { appendParseToSession } = require('./raidnight');
    appendParseToSession(interaction.client, bossId, parsed, bossName, boss?.emoji).catch(() => {});
  },

  parseEQLog,
  loadParses,
  saveParses,
  buildParseEmbed,
  logParseToDiscord,
  loadParsesFromDiscord,
};
