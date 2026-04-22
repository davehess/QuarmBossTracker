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
// Source: EQ body types matched to best-fit emoji
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
  'muramite':          '👹',
  'demon':             '👹',
  'god':               '⚡',
  'unknown':           '🐉',
};

function bodyTypeToEmoji(bodyType) {
  if (!bodyType) return '🐉';
  const lower = bodyType.toLowerCase().trim();
  // Exact match first
  if (BODY_TYPE_EMOJI[lower]) return BODY_TYPE_EMOJI[lower];
  // Partial match
  for (const [key, emoji] of Object.entries(BODY_TYPE_EMOJI)) {
    if (lower.includes(key)) return emoji;
  }
  return '🐉'; // default fallback
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

/**
 * Parse a PQDI NPC page and extract boss fields.
 * Returns { name, zone, timerHours, bodyType, expansion } or throws.
 */
function parsePqdiPage(html, url) {
  // Name: <title>NAME :: NPC :: PQDI</title> or <h1>NAME</h1>
  const titleMatch = html.match(/<title>([^:]+)\s*::/);
  const name = titleMatch ? titleMatch[1].trim() : null;
  if (!name) throw new Error('Could not parse boss name from PQDI page');

  // Instance Spawn Timer: extract hours from "X days and Y hours" or "Z hours"
  let timerHours = 66; // sensible default
  const timerMatch = html.match(/Instance Spawn Timer[^:]*:\s*([^<\n]+)/i);
  if (timerMatch) {
    const timerText = timerMatch[1].trim();
    let hours = 0;
    const weeks  = timerText.match(/(\d+)\s*week/i);
    const days   = timerText.match(/(\d+)\s*day/i);
    const hrs    = timerText.match(/(\d+)\s*hour/i);
    const mins   = timerText.match(/(\d+)\s*minute/i);
    if (weeks)  hours += parseInt(weeks[1])  * 168;
    if (days)   hours += parseInt(days[1])   * 24;
    if (hrs)    hours += parseInt(hrs[1]);
    if (mins)   hours += parseInt(mins[1])   / 60;
    if (hours > 0) timerHours = Math.round(hours * 100) / 100;
  }

  // Zone: "Zone: <a href="/zone/...">ZONENAME</a>"
  const zoneMatch = html.match(/Zone:\s*<a[^>]+>([^<]+)<\/a>/i);
  const zone = zoneMatch ? zoneMatch[1].trim() : 'Unknown';

  // Expansion: look for "Expansion: XXXX" or "Luclin", "Velious" etc near top
  const expMatch = html.match(/Expansion:\s*([A-Za-z\s]+?)(?:<|\n|$)/i);
  let expansion = 'Classic';
  if (expMatch) {
    const raw = expMatch[1].trim().toLowerCase();
    if (raw.includes('luclin'))  expansion = 'Luclin';
    else if (raw.includes('velious')) expansion = 'Velious';
    else if (raw.includes('kunark'))  expansion = 'Kunark';
    else if (raw.includes('planes') || raw.includes('pop')) expansion = 'PoP';
    else expansion = 'Classic';
  } else {
    // Infer from zone name
    const luclinZones = ['ssraeshza','sanctus seru','vex thal','umbral','akheva','grieg','katta','the deep','acrylia','maiden'];
    const veliousZones = ['kael','icewell','skyshrine','wakening','veeshan','western wastes','cobalt','sleeper','velketor'];
    const kunarkZones  = ['sebilis','karnor','howling stones','timorous','veeshan\'s peak','skyfire','emerald jungle','the hole'];
    const zl = zone.toLowerCase();
    if (luclinZones.some(z => zl.includes(z)))  expansion = 'Luclin';
    else if (veliousZones.some(z => zl.includes(z))) expansion = 'Velious';
    else if (kunarkZones.some(z => zl.includes(z)))  expansion = 'Kunark';
  }

  // Body Type: "Giant (body type)" or "Dragon (body type)"
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
      parsed = parsePqdiPage(html, url);
    } catch (err) {
      return interaction.editReply(`❌ Failed to fetch/parse PQDI page: ${err.message}`);
    }

    const { name, zone, timerHours, bodyType, expansion } = parsed;
    const emoji = bodyTypeToEmoji(bodyType);
    const id    = toSnakeId(name);

    // Load current bosses
    let bosses = [];
    try {
      bosses = JSON.parse(fs.readFileSync(BOSSES_FILE, 'utf8'));
    } catch {
      bosses = [];
    }

    // Check for duplicate
    const existing = bosses.find(b => b.id === id || b.pqdiUrl === url);
    if (existing) {
      return interaction.editReply(
        `⚠️ **${existing.name}** is already in bosses.json (id: \`${existing.id}\`).\nNo changes made.`
      );
    }

    const newBoss = {
      id,
      name,
      zone,
      expansion,
      timerHours,
      nicknames: [id.replace(/_/g, ' ')],
      emoji,
      pqdiUrl: url,
    };

    bosses.push(newBoss);
    fs.writeFileSync(BOSSES_FILE, JSON.stringify(bosses, null, 2), 'utf8');

    // Trigger board refresh — re-require bosses to pick up the new file
    // (clear require cache so index.js gets fresh data on next interaction)
    delete require.cache[require.resolve('../data/bosses.json')];

    // Refresh board in the raid-mobs channel
    const channelId = process.env.TIMER_CHANNEL_ID;
    let boardRefreshed = false;
    if (channelId) {
      try {
        const { getAllState, getBoardMessages, saveBoardMessages } = require('../utils/state');
        const { buildBoardPanels } = require('../utils/board');
        const freshBosses = require('../data/bosses.json');
        const channel     = await interaction.client.channels.fetch(channelId);
        const killState   = getAllState();
        const panels      = buildBoardPanels(freshBosses, killState);
        const boardIds    = getBoardMessages();

        if (boardIds.length === panels.length) {
          for (let i = 0; i < panels.length; i++) {
            try {
              const msg = await channel.messages.fetch(boardIds[i].messageId);
              await msg.edit(panels[i].payload);
            } catch (_) {}
          }
          boardRefreshed = true;
        } else if (boardIds.length > 0) {
          // Panel count changed (new zone/expansion) — append new panels
          const newIds = [...boardIds];
          for (let i = boardIds.length; i < panels.length; i++) {
            const sent = await channel.send(panels[i].payload);
            newIds.push({ messageId: sent.id, panelIndex: i });
          }
          // Edit existing panels
          for (let i = 0; i < boardIds.length; i++) {
            try {
              const msg = await channel.messages.fetch(boardIds[i].messageId);
              await msg.edit(panels[i].payload);
            } catch (_) {}
          }
          saveBoardMessages(newIds);
          boardRefreshed = true;
        }
      } catch (err) {
        console.warn('addboss board refresh failed:', err?.message);
      }
    }

    await interaction.editReply(
      `✅ **${name}** added to bosses.json!\n` +
      `• Zone: ${zone} (${expansion})\n` +
      `• Timer: ${timerHours}h\n` +
      `• Body type: ${bodyType || 'unknown'} → ${emoji}\n` +
      `• PQDI: ${url}\n` +
      (boardRefreshed ? '• Board updated in place.' : '• Run `/board` to update the board.')
    );
  },
};
