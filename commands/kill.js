// commands/kill.js
// /kill - Mark a boss as killed and record the spawn timer

const { SlashCommandBuilder } = require('discord.js');
const bosses = require('../data/bosses.json');
const { recordKill, setKillMessageId } = require('../utils/state');
const { buildKillEmbed } = require('../utils/embeds');

const bossChoices = bosses.map((b) => ({
  name: `${b.emoji ? b.emoji + ' ' : ''}${b.name} (${b.zone})`,
  value: b.id,
  terms: [b.name.toLowerCase(), ...(b.nicknames || []).map((n) => n.toLowerCase())],
}));

module.exports = {
  data: new SlashCommandBuilder()
    .setName('kill')
    .setDescription('Record a raid boss kill and start the respawn timer')
    .addStringOption((option) =>
      option
        .setName('boss')
        .setDescription('Which boss was killed? (try nicknames like "naggy", "emp", "ahr")')
        .setRequired(true)
        .setAutocomplete(true)
    )
    .addStringOption((option) =>
      option
        .setName('note')
        .setDescription('Optional note (e.g. "clean kill", "partial loot")')
        .setRequired(false)
    ),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused().toLowerCase().trim();
    const filtered = bossChoices
      .filter((c) => !focused || c.terms.some((t) => t.includes(focused)) || c.name.toLowerCase().includes(focused))
      .slice(0, 25)
      .map(({ name, value }) => ({ name, value }));
    await interaction.respond(filtered);
  },

  async execute(interaction) {
    const allowedRole = process.env.ALLOWED_ROLE_NAME || 'Pack Member';
    const hasRole = interaction.member.roles.cache.some(
      (r) => r.name === allowedRole
    );
    if (!hasRole) {
      return interaction.reply({
        content: `❌ You need the **${allowedRole}** role to record kills.`,
        ephemeral: true,
      });
    }

    const bossId = interaction.options.getString('boss');
    const note   = interaction.options.getString('note');
    const boss   = bosses.find((b) => b.id === bossId);

    if (!boss) {
      return interaction.reply({
        content: '❌ Unknown boss. Please use the autocomplete to select a valid boss.',
        ephemeral: true,
      });
    }

    const stateEntry = recordKill(bossId, boss.timerHours, interaction.user.id, null);
    const embed = buildKillEmbed(boss, stateEntry, interaction.user.id);

    if (note) embed.addFields({ name: 'Note', value: note, inline: false });

    // fetchReply: true lets us grab the message ID to store for later archiving
    const reply = await interaction.reply({ embeds: [embed], fetchReply: true });
    setKillMessageId(bossId, reply.id);

    // Refresh board buttons so this boss shows skull immediately
    try {
      const { getBoardMessages } = require('../utils/state');
      const { buildBoardPanels }  = require('../utils/board');
      const { getAllState }        = require('../utils/state');

      const boardMsgIds = getBoardMessages();
      if (boardMsgIds.length) {
        const channel   = interaction.channel;
        const killState = getAllState();
        const allPanels = buildBoardPanels(bosses, killState);

        if (allPanels.length === boardMsgIds.length) {
          for (let i = 0; i < boardMsgIds.length; i++) {
            const panel = allPanels[i];
            if (panel.type !== 'zone') continue;
            try {
              const msg = await channel.messages.fetch(boardMsgIds[i].messageId);
              await msg.edit({ components: panel.payload.components });
            } catch (_) {}
          }
        }
      }
    } catch (err) {
      console.warn('Could not refresh board after /kill:', err?.message);
    }
  },
};
