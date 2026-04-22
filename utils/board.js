// utils/board.js — Per-expansion board panels (live in threads, not main channel)

const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder,
} = require('discord.js');
const { EXPANSION_ORDER, EXPANSION_META } = require('./config');

const ZONE_COLS      = 3;
const MAX_ROWS       = 5;
const BUTTONS_PER_ROW = 5;

/**
 * Build panels for ONE expansion only.
 * Returns array of { type, expansion, label, payload }
 */
function buildExpansionPanels(expansion, bosses, killState = {}) {
  const now  = Date.now();
  const meta = EXPANSION_META[expansion] || { label: expansion, color: 0x555555 };

  // Collect zones for this expansion
  const byZone = {};
  for (const boss of bosses) {
    if ((boss.expansion || 'Luclin') !== expansion) continue;
    if (!byZone[boss.zone]) byZone[boss.zone] = [];
    byZone[boss.zone].push(boss);
  }

  const zones = Object.entries(byZone);
  if (zones.length === 0) {
    // Reserved placeholder panel
    return [{
      type: 'reserved', expansion, label: `${meta.label} — Reserved`,
      payload: {
        embeds: [new EmbedBuilder().setColor(meta.color).setTitle(meta.label)
          .setDescription('~Reserved — no bosses configured yet~')],
        components: [],
      },
    }];
  }

  const chunks = splitZonesIntoChunks(zones, MAX_ROWS, BUTTONS_PER_ROW);
  return chunks.map((chunk, idx) => {
    const partLabel = chunks.length > 1 ? `${meta.label} (${idx+1}/${chunks.length})` : meta.label;
    return {
      type: 'expansion', expansion, label: partLabel,
      payload: {
        embeds: [buildExpansionEmbed(meta.color, partLabel, chunk, killState, now, chunks.length, idx)],
        components: buildButtonRowsForChunk(chunk, killState, now),
      },
    };
  });
}

/**
 * Build panels for ALL expansions (used by cleanup / initial setup).
 */
function buildAllExpansionPanels(bosses, killState = {}) {
  const result = {};
  for (const exp of EXPANSION_ORDER) {
    result[exp] = buildExpansionPanels(exp, bosses, killState);
  }
  return result;
}

function buildExpansionEmbed(color, title, chunk, killState, now, totalChunks, chunkIdx) {
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription('Click a boss to record a kill • Click 💀 to undo' +
      (totalChunks > 1 ? ` • Part ${chunkIdx+1}/${totalChunks}` : ''));

  for (let i = 0; i < chunk.length; i += ZONE_COLS) {
    const row = chunk.slice(i, i + ZONE_COLS);
    for (const [zone, zoneBosses] of row) {
      const lines = zoneBosses.map((boss) => {
        const entry = killState[boss.id];
        const onCD  = entry && entry.nextSpawn > now;
        if (onCD) {
          const d = new Date(entry.killedAt);
          return `💀 ~~${boss.name}~~ (${d.getMonth()+1}/${d.getDate()})`;
        }
        return `${boss.emoji || '•'} ${boss.name}`;
      });
      embed.addFields({ name: `📍 ${zone}`, value: lines.join('\n').slice(0, 1024) || '\u200b', inline: true });
    }
    const rem = row.length % ZONE_COLS;
    if (rem !== 0) for (let p = 0; p < ZONE_COLS - rem; p++) embed.addFields({ name: '\u200b', value: '\u200b', inline: true });
  }
  return embed;
}

function splitZonesIntoChunks(zones, maxRows, bpr) {
  const chunks = []; let cur = [], rows = 0;
  for (const [zone, zb] of zones) {
    const zr = Math.ceil(zb.length / bpr);
    if (cur.length > 0 && rows + zr > maxRows) { chunks.push(cur); cur = []; rows = 0; }
    cur.push([zone, zb]); rows += zr;
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

function buildButtonRowsForChunk(zoneChunk, killState, now) {
  const rows = [];
  for (const [, zoneBosses] of zoneChunk) {
    if (rows.length >= MAX_ROWS) break;
    let cr = new ActionRowBuilder(), c = 0;
    for (const boss of zoneBosses) {
      if (c === BUTTONS_PER_ROW) { rows.push(cr); if (rows.length >= MAX_ROWS) break; cr = new ActionRowBuilder(); c = 0; }
      cr.addComponents(makeBossButton(boss, killState, now)); c++;
    }
    if (c > 0 && rows.length < MAX_ROWS) rows.push(cr);
  }
  return rows;
}

function makeBossButton(boss, killState, now) {
  const entry = killState[boss.id];
  const onCD  = entry && entry.nextSpawn > now;
  if (onCD) {
    const d = new Date(entry.killedAt);
    return new ButtonBuilder().setCustomId(`kill:${boss.id}`)
      .setLabel(`💀 ${boss.name} (${d.getMonth()+1}/${d.getDate()})`.slice(0, 80))
      .setStyle(ButtonStyle.Secondary);
  }
  return new ButtonBuilder().setCustomId(`kill:${boss.id}`)
    .setLabel(`${boss.emoji || ''} ${boss.name}`.trim().slice(0, 80))
    .setStyle(ButtonStyle.Danger);
}

module.exports = { buildExpansionPanels, buildAllExpansionPanels, makeBossButton, EXPANSION_ORDER, EXPANSION_META };
