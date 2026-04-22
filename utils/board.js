// utils/board.js
// Compact table-style board — one message per expansion chunk, max 25 buttons.
// 10 total reserved slots: 6 active (Classic/Kunark/Velious×2/Luclin×2) + 4 PoP placeholders.

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require('discord.js');

const EXPANSION_ORDER = ['Classic', 'Kunark', 'Velious', 'Luclin'];

const EXPANSION_META = {
  Classic: { label: '⚔️ Classic EverQuest', color: 0xaa6622 },
  Kunark:  { label: '🦎 Ruins of Kunark',    color: 0x228822 },
  Velious: { label: '❄️ Scars of Velious',   color: 0x2255aa },
  Luclin:  { label: '🌙 Shadows of Luclin',  color: 0x882299 },
};

// Reserved PoP placeholder panels (always posted, cannot have buttons yet)
const POP_PLACEHOLDERS = [
  { label: '🔥 Planes of Power — Reserved', color: 0x8b0000 },
  { label: '🔥 Planes of Power — Reserved', color: 0x8b0000 },
  { label: '🔥 Planes of Power — Reserved', color: 0x8b0000 },
  { label: '🔥 Planes of Power — Reserved', color: 0x8b0000 },
];

const TOTAL_RESERVED_SLOTS = 10;
const ZONE_COLS   = 3;
const MAX_BUTTONS = 25;

/**
 * Build ALL board panels including PoP placeholders.
 * Always returns exactly TOTAL_RESERVED_SLOTS panels.
 */
function buildBoardPanels(bosses, killState = {}) {
  const now = Date.now();

  const byExpansion = {};
  for (const exp of EXPANSION_ORDER) byExpansion[exp] = {};
  for (const boss of bosses) {
    const exp = boss.expansion || 'Luclin';
    if (!byExpansion[exp]) byExpansion[exp] = {};
    if (!byExpansion[exp][boss.zone]) byExpansion[exp][boss.zone] = [];
    byExpansion[exp][boss.zone].push(boss);
  }

  const panels = [];

  for (const exp of EXPANSION_ORDER) {
    const zones = Object.entries(byExpansion[exp]);
    if (zones.length === 0) continue;

    const meta       = EXPANSION_META[exp];
    const zoneChunks = splitZonesIntoChunks(zones, MAX_BUTTONS);

    zoneChunks.forEach((chunk, chunkIdx) => {
      const totalChunks = zoneChunks.length;
      const partLabel   = totalChunks > 1
        ? `${meta.label} (${chunkIdx + 1}/${totalChunks})`
        : meta.label;

      const embed = buildExpansionEmbed(meta.color, partLabel, chunk, killState, now, totalChunks, chunkIdx);
      const components = buildButtonRowsForChunk(chunk, killState, now);

      panels.push({
        type: 'expansion',
        expansion: exp,
        label: partLabel,
        payload: { embeds: [embed], components },
      });
    });
  }

  // Pad with PoP reserved placeholders to reach TOTAL_RESERVED_SLOTS
  const needed = TOTAL_RESERVED_SLOTS - panels.length;
  for (let i = 0; i < Math.min(needed, POP_PLACEHOLDERS.length); i++) {
    const ph = POP_PLACEHOLDERS[i];
    panels.push({
      type: 'reserved',
      expansion: 'PoP',
      label: ph.label,
      payload: {
        embeds: [
          new EmbedBuilder()
            .setColor(ph.color)
            .setTitle(ph.label)
            .setDescription('~Reserved for Planes of Power~\n\nThis board slot will be activated when PoP content is added.')
        ],
        components: [],
      },
    });
  }

  return panels;
}

function buildExpansionEmbed(color, title, chunk, killState, now, totalChunks, chunkIdx) {
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(
      'Click a boss to record a kill • Click 💀 to undo' +
      (totalChunks > 1 ? ` • Part ${chunkIdx + 1}/${totalChunks}` : '')
    );

  for (let i = 0; i < chunk.length; i += ZONE_COLS) {
    const row = chunk.slice(i, i + ZONE_COLS);
    for (const [zone, zoneBosses] of row) {
      const lines = zoneBosses.map((boss) => {
        const entry = killState[boss.id];
        const onCooldown = entry && entry.nextSpawn > now;
        if (onCooldown) {
          const d = new Date(entry.killedAt);
          return `💀 ~~${boss.name}~~ (${d.getMonth() + 1}/${d.getDate()})`;
        }
        return `${boss.emoji || '•'} ${boss.name}`;
      });
      embed.addFields({
        name:   `📍 ${zone}`,
        value:  lines.join('\n').slice(0, 1024) || '\u200b',
        inline: true,
      });
    }
    const rem = row.length % ZONE_COLS;
    if (rem !== 0) {
      for (let p = 0; p < ZONE_COLS - rem; p++) {
        embed.addFields({ name: '\u200b', value: '\u200b', inline: true });
      }
    }
  }

  return embed;
}

function splitZonesIntoChunks(zones, maxButtons) {
  const chunks = [];
  let current  = [];
  let count    = 0;

  for (const [zone, zoneBosses] of zones) {
    const sep  = current.length > 0 ? 1 : 0;
    const cost = sep + zoneBosses.length;
    if (current.length > 0 && count + cost > maxButtons) {
      chunks.push(current);
      current = [];
      count   = 0;
    }
    current.push([zone, zoneBosses]);
    count += (current.length > 1 ? 1 : 0) + zoneBosses.length;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

function buildButtonRowsForChunk(zoneChunk, killState, now) {
  const allButtons = [];
  for (let zi = 0; zi < zoneChunk.length; zi++) {
    const [zone, zoneBosses] = zoneChunk[zi];
    if (zi > 0) allButtons.push(makeSeparator(`— ${zone} —`));
    for (const boss of zoneBosses) allButtons.push(makeBossButton(boss, killState, now));
  }
  return packIntoRows(allButtons, 5);
}

function packIntoRows(buttons, maxRows) {
  const rows   = [];
  let current  = new ActionRowBuilder();
  let rowCount = 0;

  for (const btn of buttons) {
    const isSep = btn.data?.disabled === true;
    if (isSep && rowCount === 4) continue; // don't orphan separators at end of row
    current.addComponents(btn);
    rowCount++;
    if (rowCount === 5) {
      rows.push(current);
      if (rows.length === maxRows) break;
      current  = new ActionRowBuilder();
      rowCount = 0;
    }
  }
  if (rowCount > 0 && rows.length < maxRows) rows.push(current);
  return rows;
}

function makeBossButton(boss, killState, now) {
  const entry       = killState[boss.id];
  const isOnCooldown = entry && entry.nextSpawn > now;
  if (isOnCooldown) {
    const d = new Date(entry.killedAt);
    return new ButtonBuilder()
      .setCustomId(`kill:${boss.id}`)
      .setLabel(`💀 ${boss.name} (${d.getMonth() + 1}/${d.getDate()})`.slice(0, 80))
      .setStyle(ButtonStyle.Secondary);
  }
  return new ButtonBuilder()
    .setCustomId(`kill:${boss.id}`)
    .setLabel(`${boss.emoji || ''} ${boss.name}`.trim().slice(0, 80))
    .setStyle(ButtonStyle.Danger);
}

function makeSeparator(label) {
  const safeId = label.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 70);
  return new ButtonBuilder()
    .setCustomId(`sep_${safeId}`)
    .setLabel(label.slice(0, 80))
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(true);
}

module.exports = {
  buildBoardPanels,
  makeBossButton,
  EXPANSION_ORDER,
  EXPANSION_META,
  TOTAL_RESERVED_SLOTS,
};
