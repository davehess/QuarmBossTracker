// commands/board.js
// /board - Posts (or refreshes) the pinned clickable boss board in the timer thread.
// Each boss shows as a button. Clicking it triggers /kill for that boss.
// Organized by expansion: Classic → Kunark → Velious → Luclin

const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require('discord.js');
const bosses = require('../data/bosses.json');

// Discord allows max 5 buttons per ActionRow, max 5 ActionRows per message = 25 buttons per message.
// With 60+ bosses we need multiple messages — one per zone is clean and readable.

const EXPANSION_ORDER = ['Classic', 'Kunark', 'Velious', 'Luclin'];

const EXPANSION_HEADERS = {
  Classic: { label: '⚔️ Classic EverQuest', color: 0xaa6622 },
  Kunark:  { label: '🦎 Ruins of Kunark',    color: 0x228822 },
  Velious: { label: '❄️ Scars of Velious',   color: 0x2255aa },
  Luclin:  { label: '🌙 Shadows of Luclin',  color: 0x882299 },
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('board')
    .setDescription('Post (or refresh) the pinned clickable boss kill board in this channel'),

  async execute(interaction) {
    // Only officers / specific role should be able to post/refresh the board
    const allowedRole = process.env.ALLOWED_ROLE_NAME || 'Pack Member';
    const hasRole = interaction.member.roles.cache.some((r) => r.name === allowedRole);
    if (!hasRole) {
      return interaction.reply({
        content: `❌ You need the **${allowedRole}** role to post the boss board.`,
        ephemeral: true,
      });
    }

    await interaction.deferReply({ ephemeral: true });

    const channel = interaction.channel;

    // Group bosses by expansion then by zone
    const byExpansion = {};
    for (const exp of EXPANSION_ORDER) {
      byExpansion[exp] = {};
    }
    for (const boss of bosses) {
      const exp = boss.expansion || 'Luclin';
      if (!byExpansion[exp]) byExpansion[exp] = {};
      if (!byExpansion[exp][boss.zone]) byExpansion[exp][boss.zone] = [];
      byExpansion[exp][boss.zone].push(boss);
    }

    let postedCount = 0;

    for (const exp of EXPANSION_ORDER) {
      const zones = byExpansion[exp];
      if (!zones || Object.keys(zones).length === 0) continue;

      const header = EXPANSION_HEADERS[exp];

      // Post a header embed for the expansion
      await channel.send({
        embeds: [
          new EmbedBuilder()
            .setColor(header.color)
            .setTitle(header.label)
            .setDescription('Click a boss button to record a kill and start its respawn timer.')
        ],
      });

      // Post one message per zone with buttons
      for (const [zone, zoneBosses] of Object.entries(zones)) {
        // Build rows of up to 5 buttons each
        const rows = [];
        let currentRow = new ActionRowBuilder();
        let buttonsInRow = 0;

        for (const boss of zoneBosses) {
          if (buttonsInRow === 5) {
            rows.push(currentRow);
            currentRow = new ActionRowBuilder();
            buttonsInRow = 0;
          }

          // Truncate label to 80 chars (Discord limit is 80)
          const label = `${boss.emoji || ''} ${boss.name}`.slice(0, 80);

          currentRow.addComponents(
            new ButtonBuilder()
              .setCustomId(`kill:${boss.id}`)
              .setLabel(label)
              .setStyle(ButtonStyle.Danger) // Red = kill action
          );
          buttonsInRow++;
        }

        if (buttonsInRow > 0) rows.push(currentRow);

        // Discord max 5 rows per message — split into multiple messages if needed
        const rowChunks = [];
        for (let i = 0; i < rows.length; i += 5) {
          rowChunks.push(rows.slice(i, i + 5));
        }

        for (let i = 0; i < rowChunks.length; i++) {
          const zoneLabel = i === 0 ? `📍 **${zone}**` : `📍 **${zone}** (cont.)`;
          await channel.send({
            content: zoneLabel,
            components: rowChunks[i],
          });
          postedCount++;
        }
      }
    }

    await interaction.editReply({
      content: `✅ Boss board posted! (${postedCount} zone panels)\nPin these messages so they stay at the top of the channel.`,
    });
  },
};
