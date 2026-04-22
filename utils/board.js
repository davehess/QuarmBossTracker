// utils/board.js
// Compact table-style board — one message per expansion chunk, max 5 ActionRows × 5 buttons.
// Each zone group starts on a NEW ROW for visual separation (Discord's natural line break).
// 10 total reserved slots: 6 active + 4 PoP placeholders.

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

const POP_PLACEHOLDERS = [
  { label: '🔥 Planes of Power — Reserved', color: 0x8b0000 },
  { label: '🔥 Planes of Power — Reserved', color: 0x8b0000 },
  { label: '🔥 Planes of Power — Reserved', color: 0x8b0000 },
  { label: '🔥 Planes of Power — Reserved', color: 0x8b0000 },
  { label: '🔥 Planes of Power — Reserved', color: 0x8b0000 },
];

const TOTAL_RESERVED_SLOTS = 14; // 9 active + 5 PoP reserved
const ZONE_COLS   = 3;
const MAX_ROWS    = 5;  // Discord hard limit per message
const BUTTONS_PER_ROW = 5;

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
    const zoneChunks = splitZonesIntoChunks(zones, MAX_ROWS, BUTTONS_PER_ROW);

    zoneChunks.forEach((chunk, chunkIdx) => {
      const totalChunks = zoneChunks.length;
      const partLabel   = totalChunks > 1
        ? `${meta.label} (${chunkIdx + 1}/${totalChunks})`
        : meta.label;

      const embed      = buildExpansionEmbed(meta.color, partLabel, chunk, killState, now, totalChunks, chunkIdx);
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

/**
 * Split zones into chunks where each chunk fits in MAX_ROWS ActionRows.
 *
 * Each zone gets its own row (starting on a new ActionRow).
 * A zone with N bosses occupies ceil(N / BUTTONS_PER_ROW) rows.
 * Zones are never split across chunks.
 */
function splitZonesIntoChunks(zones, maxRows, buttonsPerRow) {
  const chunks = [];
  let current  = [];
  let rowsUsed = 0;

  for (const [zone, zoneBosses] of zones) {
    // Each zone starts on its own row; calculate rows needed
    const zoneRows = Math.ceil(zoneBosses.length / buttonsPerRow);

    if (current.length > 0 && rowsUsed + zoneRows > maxRows) {
      chunks.push(current);
      current  = [];
      rowsUsed = 0;
    }

    current.push([zone, zoneBosses]);
    rowsUsed += zoneRows;
  }

  if (current.length > 0) chunks.push(current);
  return chunks;
}

/**
 * Build ActionRows for a zone chunk.
 * Each zone starts on a new ActionRow — this creates the natural "newline"
 * visual separation in Discord without needing separator buttons.
 * Bosses within a zone fill left-to-right, wrapping to the next row if needed.
 */
function buildButtonRowsForChunk(zoneChunk, killState, now) {
  const rows = [];

  for (const [zone, zoneBosses] of zoneChunk) {
    if (rows.length >= MAX_ROWS) break;

    // Start each zone on a fresh row
    let currentRow = new ActionRowBuilder();
    let count      = 0;

    for (const boss of zoneBosses) {
      if (count === BUTTONS_PER_ROW) {
        // Row full — push and start a new one (if still within limit)
        rows.push(currentRow);
        if (rows.length >= MAX_ROWS) break;
        currentRow = new ActionRowBuilder();
        count      = 0;
      }

      currentRow.addComponents(makeBossButton(boss, killState, now));
      count++;
    }

    // Push the last (possibly partial) row for this zone
    if (count > 0 && rows.length < MAX_ROWS) {
      rows.push(currentRow);
    }
  }

  return rows;
}

function makeBossButton(boss, killState, now) {
  const entry        = killState[boss.id];
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

module.exports = {
  buildBoardPanels,
  makeBossButton,
  EXPANSION_ORDER,
  EXPANSION_META,
  TOTAL_RESERVED_SLOTS,
};
