// commands/addboss.js
// /addboss <pqdi_url> — Scrapes a PQDI NPC page, extracts boss data,
// appends to bosses.json, and triggers a board refresh.

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const fs   = require('fs');
const path = require('path');
const https = require('https');
const { hasAllowedRole, allowedRolesList } = require('../utils/roles');

const BOSSES_FILE = path.join(__dirname, '../data/bosses.json');

// Maps PQDI body type strings → emoji
const BODY_TYPE_EMOJI = {
  'dragon':            '🐉',
  'giant dragon':      '🐉',
  'greater dragon':    '🐉',
  'lesser dragon':     '🐲',
  'giant':             '🗿',
  'bane giant':        '🗿',
  'undead':            '💀',
  'greater undead':    '💀',
  'humanoid':          '🧍',
  'human':             '🧍',
  'elf':               '🧝',
  'dark elf':          '🧝',
  'iksar':             '🦎',
  'lizard man':        '🦎',
  'troll':             '🧌',
  'ogre':              '🧌',
  'animal':            '🐾',
  'wolf':              '🐺',
  'bear':              '🐻',
  'snake':             '🐍',
  'shissar':           '🐍',
  'spider':            '🕷️',
  'insect':            '🪲',
  'fish':              '🐟',
  'aqua mob':          '🐟',
  'water':             '🌊',
  'plant':             '🌿',
  'construct':         '🤖',
  'golem':             '🪨',
  'elemental':         '🔥',
  'fire':              '🔥',
  'akheva':            '👁️',
  'greater akheva':    '👁️',
  'shadow':            '🌑',
  'burrower':          '🪱',
  'summon':            '✨',
  'magical':           '✨',
  'muramite':          '👹',
  'demon':             '👹',
  'god':               '⚡',
  'unknown':           '🐉',
};

// PQDI raw data expansion numbers → our expansion strings
// Source: pqdi.cc/zones lists zones by expansion
const EXPANSION_NUM_MAP = {
  0: 'Classic',
  1: 'Kunark',
  2: 'Velious',
  3: 'Luclin',
  4: 'PoP',
};

// Zone name → expansion (authoritative list from pqdi.cc/zones)
// Used as fallback if numeric expansion field isn't found
const ZONE_EXPANSION_MAP = {
  // Classic
  "nagafen's lair": 'Classic', 'permafrost caverns': 'Classic',
  'kedge keep': 'Classic', 'plane of fear': 'Classic', 'plane of hate': 'Classic',
  'plane of sky': 'Classic', 'castle of mistmoore': 'Classic',
  'estate of unrest': 'Classic', 'crushbone': 'Classic',
  'accursed temple of cazic thule': 'Classic', 'kithicor forest': 'Classic',
  // Kunark
  'ruins of sebilis': 'Kunark', "karnor's castle": 'Kunark',
  'the hole': 'Kunark', "veeshan's peak": 'Kunark', 'chardok': 'Kunark',
  'skyfire mountains': 'Kunark', 'emerald jungle': 'Kunark',
  'timorous deep': 'Kunark', 'howling stones': 'Kunark',
  'city of mist': 'Kunark', 'the city of mist': 'Kunark', 'veksar': 'Kunark',
  // Velious
  "velketor's labyrinth": 'Velious', 'kael drakkel': 'Velious',
  'icewell keep': 'Velious', 'skyshrine': 'Velious', 'iceclad ocean': 'Velious',
  'cobalt scar': 'Velious', 'western wastes': 'Velious',
  'dragon necropolis': 'Velious', 'the wakening land': 'Velious',
  "sleeper's tomb": 'Velious', 'temple of veeshan': 'Velious',
  'plane of growth': 'Velious', 'plane of mischief': 'Velious',
  'great divide': 'Velious', 'the great divide': 'Velious',
  'eastern wastes': 'Velious', 'crystal caverns': 'Velious',
  'tower of frozen shadow': 'Velious',
  // Luclin
  'ssraeshza temple': 'Luclin', 'sanctus seru': 'Luclin',
  "grieg's end": 'Luclin', 'katta castellum': 'Luclin',
  'the deep': 'Luclin', 'akheva ruins': 'Luclin',
  'the umbral plains': 'Luclin', 'vex thal': 'Luclin',
  'acrylia caverns': 'Luclin', "the maiden's eye": 'Luclin',
  'the fungus grove': 'Luclin', 'paludal caverns': 'Luclin',
  'echo caverns': 'Luclin', 'twilight': 'Luclin',
  'the grey': 'Luclin', 'grimling forest': 'Luclin',
  'the tenebrous mountains': 'Luclin', 'the dawnshroud peaks': 'Luclin',
  'scarlet desert': 'Luclin', 'shadeweaver\'s thicket': 'Luclin',
  // PoP
  'plane of knowledge': 'PoP', 'plane of time': 'PoP',
  'plane of air': 'PoP', 'plane of earth': 'PoP',
  'plane of fire': 'PoP', 'plane of water': 'PoP',
  'plane of disease': 'PoP', 'plane of nightmare': 'PoP',
  'plane of justice': 'PoP', 'plane of innovation': 'PoP',
  'halls of honor': 'PoP', 'bastion of thunder': 'PoP',
  'plane of tactics': 'PoP', 'drunder': 'PoP',
};

function bodyTypeToEmoji(bodyType) {
  if (!bodyType) return '🐉';
  const lower = bodyType.toLowerCase().trim();
  if (BODY_TYPE_EMOJI[lower]) return BODY_TYPE_EMOJI[lower];
  for (const [key, emoji] of Object.entries(BODY_TYPE_EMOJI)) {
    if (lower.includes(key)) return emoji;
  }
  return '🐉';
}

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'QuarmRaidBot/1.0' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function parsePqdiPage(html) {
  // Name from title tag
  const titleMatch = html.match(/<title>([^:]+)\s*::/);
  const name = titleMatch ? titleMatch[1].trim() : null;
  if (!name) throw new Error('Could not parse boss name from PQDI page');

  // Instance Spawn Timer — prefer the human-readable Quick Facts text.
  // Only fall back to instance_spawn_timer_override (stored in SECONDS on PQDI) if
  // the human-readable text is absent or parsed as 0.
  let timerHours = 66;

  function parseTimerText(text) {
    let h = 0;
    const weeks = text.match(/(\d+)\s*week/i);
    const days  = text.match(/(\d+)\s*day/i);
    const hrs   = text.match(/(\d+)\s*hour/i);
    const mins  = text.match(/(\d+)\s*minute/i);
    if (weeks) h += parseInt(weeks[1]) * 168;
    if (days)  h += parseInt(days[1])  * 24;
    if (hrs)   h += parseInt(hrs[1]);
    if (mins)  h += parseInt(mins[1])  / 60;
    return Math.round(h * 100) / 100;
  }

  // 1. Try Quick Facts human-readable text first (most reliable)
  const timerMatch = html.match(/Instance Spawn Timer[^:]*:\s*([^<\n\*]+)/i);
  if (timerMatch) {
    const parsed = parseTimerText(timerMatch[1].trim());
    if (parsed > 0) timerHours = parsed;
  }

  // 2. Only use instance_spawn_timer_override if still at default (66h)
  //    PQDI stores this field in SECONDS (not ms). A value of 259200 = 72h, 583200 = 162h.
  if (timerHours === 66) {
    const overrideMatch = html.match(/instance_spawn_timer_override["'\s]*[=:]\s*(\d+)/i);
    if (overrideMatch) {
      const seconds = parseInt(overrideMatch[1]);
      // Sanity check: PQDI override values are typically 3600–700000 seconds
      if (seconds >= 3600 && seconds <= 700000) {
        timerHours = Math.round((seconds / 3600) * 100) / 100;
      }
    }
  }

  // Zone from Quick Facts
  const zoneMatch = html.match(/Zone:\s*<a[^>]+>([^<]+)<\/a>/i);
  const zone = zoneMatch ? zoneMatch[1].trim() : 'Unknown';

  // Expansion — use the numeric field from raw data (most reliable)
  // expansion: 0 = Classic, 1 = Kunark, 2 = Velious, 3 = Luclin, 4 = PoP
  const expNumMatch = html.match(/\*\*expansion:\*\*\s*(\d+)|expansion:\s*(\d+)/i);
  let expansion = null;
  if (expNumMatch) {
    const num = parseInt(expNumMatch[1] || expNumMatch[2]);
    expansion = EXPANSION_NUM_MAP[num] || null;
  }

  // Fallback: check Expansion: label in Quick Facts
  if (!expansion) {
    const expLabelMatch = html.match(/Expansion:\s*([A-Za-z\s]+?)(?:<|\n|:|\*|$)/i);
    if (expLabelMatch) {
      const raw = expLabelMatch[1].trim().toLowerCase();
      if (raw.includes('luclin'))        expansion = 'Luclin';
      else if (raw.includes('velious'))  expansion = 'Velious';
      else if (raw.includes('kunark'))   expansion = 'Kunark';
      else if (raw.includes('planes') || raw.includes('pop')) expansion = 'PoP';
      else if (raw.includes('classic') || raw.includes('vanilla')) expansion = 'Classic';
    }
  }

  // Final fallback: zone-name lookup (authoritative — from pqdi.cc/zones)
  if (!expansion) {
    expansion = ZONE_EXPANSION_MAP[zone.toLowerCase()] || 'Classic';
  }

  // Body type — look for "(body type)" pattern
  const bodyMatch = html.match(/([A-Za-z\s]+)\s*\(body type\)/i);
  const bodyType = bodyMatch ? bodyMatch[1].trim() : null;

  return { name, zone, timerHours, bodyType, expansion };
}

function toSnakeId(name) {
  return name.toLowerCase()
    .replace(/[`']/g, '')
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, 60);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('addboss')
    .setDescription('Add a boss from a PQDI.cc NPC URL and refresh the board')
    .addStringOption(opt =>
      opt.setName('url')
        .setDescription('Full PQDI.cc NPC URL, e.g. https://www.pqdi.cc/npc/32040')
        .setRequired(true)
    ),

  async execute(interaction) {
    if (!hasAllowedRole(interaction.member)) {
      return interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: `❌ You need one of these roles: ${allowedRolesList()}`,
      });
    }

    const url = interaction.options.getString('url').trim();
    if (!url.startsWith('https://www.pqdi.cc/npc/')) {
      return interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: '❌ URL must be a PQDI.cc NPC page, e.g. `https://www.pqdi.cc/npc/32040`',
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    let parsed;
    try {
      const html = await fetchUrl(url);
      parsed = parsePqdiPage(html);
    } catch (err) {
      return interaction.editReply(`❌ Failed to fetch/parse PQDI page: ${err.message}`);
    }

    const { name, zone, timerHours, bodyType, expansion } = parsed;
    const emoji = bodyTypeToEmoji(bodyType);
    const id    = toSnakeId(name);

    let bosses = [];
    try { bosses = JSON.parse(fs.readFileSync(BOSSES_FILE, 'utf8')); } catch { bosses = []; }

    const existing = bosses.find(b => b.id === id || b.pqdiUrl === url);
    if (existing) {
      return interaction.editReply(
        `⚠️ **${existing.name}** is already in bosses.json (id: \`${existing.id}\`, expansion: ${existing.expansion}).\nNo changes made.`
      );
    }

    const newBoss = { id, name, zone, expansion, timerHours, nicknames: [id.replace(/_/g, ' ')], emoji, pqdiUrl: url };
    bosses.push(newBoss);
    fs.writeFileSync(BOSSES_FILE, JSON.stringify(bosses, null, 2), 'utf8');
    delete require.cache[require.resolve('../data/bosses.json')];

    // Refresh the expansion thread board for this boss's expansion
    const { postOrUpdateExpansionBoard } = require('../utils/killops');
    const { getThreadId } = require('../utils/config');
    let boardRefreshed = false;
    try {
      const threadId = getThreadId(expansion);
      if (threadId) {
        const freshBosses = require('../data/bosses.json');
        const result = await postOrUpdateExpansionBoard(interaction.client, expansion, threadId, freshBosses);
        boardRefreshed = result.ok;
      }
    } catch (err) {
      console.warn('addboss board refresh failed:', err?.message);
    }

    await interaction.editReply(
      `✅ **${name}** added to bosses.json!\n` +
      `• Zone: ${zone}\n` +
      `• Expansion: **${expansion}**\n` +
      `• Timer: ${timerHours}h\n` +
      `• Body type: ${bodyType || 'unknown'} → ${emoji}\n` +
      `• PQDI: ${url}\n` +
      (boardRefreshed ? '• Board updated in place.' : '• Run `/board` to update the board.')
    );
  },
};
