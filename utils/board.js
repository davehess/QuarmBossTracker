// utils/board.js
// Builds the board messages (expansion headers + zone button rows).
// Used by /board (initial post & in-place edit) and the spawn checker (button reset).

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require('discord.js');

const EXPANSION_ORDER = ['Classic', 'Kunark', 'Velious', 'Luclin'];

const EXPANSION_HEADERS = {
  Classic: { label: '⚔️ Classic EverQuest', color: 0xaa6622 },
  Kunark:  { label: '🦎 Ruins of Kunark',    color: 0x228822 },
  Velious: { label: '❄️ Scars of Velious',   color: 0x2255aa },
  Luclin:  { label: '🌙 Shadows of Luclin',  color: 0x882299 },
};

/**
 * Group bosses into an ordered list of "panels" — one per expansion header
 * or zone block — ready to post or edit as individual Discord messages.
 *
 * Returns an array of panel descriptors:
 * [
 *   { type: 'header', expansion, payload: { embeds } },
 *   { type: 'zone',   zone, expansion, bossIds: [...], payload: { content, components } },
 *   ...
 * ]
 *
 * @param {Array}  bosses    Full boss definitions array
 * @param {Object} killState Map of bossId -> { killedAt, nextSpawn, ... } (may be empty)
 */
function buildBoardPanels(bosses, killState = {}) {
  const now = Date.now();

  // Group bosses by expansion then zone, preserving expansion order
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
    const zones = byExpansion[exp];
    if (!zones || Object.keys(zones).length === 0) continue;

    const header = EXPANSION_HEADERS[exp];

    // Expansion header panel
    panels.push({
      type: 'header',
      expansion: exp,
      label: header.label,
      payload: {
        embeds: [
          new EmbedBuilder()
            .setColor(header.color)
            .setTitle(header.label)
            .setDescription('Click a boss button to record a kill and start its respawn timer.')
        ],
        components: [],
      },
    });

    // Zone button panels
    for (const [zone, zoneBosses] of Object.entries(zones)) {
      const rows = buildButtonRows(zoneBosses, killState, now);

      // Discord max 5 rows per message — chunk if a zone has >25 bosses
      const rowChunks = [];
      for (let i = 0; i < rows.length; i += 5) rowChunks.push(rows.slice(i, i + 5));

      rowChunks.forEach((chunk, i) => {
        panels.push({
          type: 'zone',
          expansion: exp,
          zone,
          label: i === 0 ? `📍 **${zone}**` : `📍 **${zone}** (cont.)`,
          bossIds: zoneBosses.map((b) => b.id),
          payload: {
            content: i === 0 ? `📍 **${zone}**` : `📍 **${zone}** (cont.)`,
            components: chunk,
            embeds: [],
          },
        });
      });
    }
  }

  return panels;
}

/**
 * Build ActionRows of buttons for a set of bosses.
 * Killed bosses get a grey skull button; available bosses get the normal red button.
 */
function buildButtonRows(zoneBosses, killState, now) {
  const rows = [];
  let currentRow = new ActionRowBuilder();
  let buttonsInRow = 0;

  for (const boss of zoneBosses) {
    if (buttonsInRow === 5) {
      rows.push(currentRow);
      currentRow = new ActionRowBuilder();
      buttonsInRow = 0;
    }

    const entry = killState[boss.id];
    const isOnCooldown = entry && entry.nextSpawn > now;

    let label, style;

    if (isOnCooldown) {
      // Show skull + name + kill date, grey button
      const killDate = new Date(entry.killedAt);
      const dateStr = `${killDate.getMonth() + 1}/${killDate.getDate()}`;
      label = `💀 ${boss.name} (Died ${dateStr})`.slice(0, 80);
      style = ButtonStyle.Secondary; // grey
    } else {
      // Normal red button
      label = `${boss.emoji || ''} ${boss.name}`.trim().slice(0, 80);
      style = ButtonStyle.Danger; // red
    }

    currentRow.addComponents(
      new ButtonBuilder()
        .setCustomId(`kill:${boss.id}`)
        .setLabel(label)
        .setStyle(style)
    );
    buttonsInRow++;
  }

  if (buttonsInRow > 0) rows.push(currentRow);
  return rows;
}

module.exports = { buildBoardPanels, buildButtonRows, EXPANSION_ORDER, EXPANSION_HEADERS };
