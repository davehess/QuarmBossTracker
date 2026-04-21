// commands/unkill.js
// /unkill - Clear a boss kill record (e.g. if someone recorded it wrong)

const { SlashCommandBuilder } = require('discord.js');
const bosses = require('../data/bosses.json');
const { clearKill, getBossState } = require('../utils/state');
const { EmbedBuilder } = require('discord.js');

const bossChoices = bosses.map((b) => ({ name: `${b.name} (${b.zone})`, value: b.id }));

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unkill')
    .setDescription('Clear a boss kill record (undo a /kill)')
    .addStringOption((option) =>
      option
        .setName('boss')
        .setDescription('Which boss kill to clear?')
        .setRequired(true)
        .setAutocomplete(true)
    ),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused().toLowerCase();
    const filtered = bossChoices
      .filter((c) => c.name.toLowerCase().includes(focused))
      .slice(0, 25);
    await interaction.respond(filtered);
  },

  async execute(interaction) {
    const allowedRole = process.env.ALLOWED_ROLE_NAME || 'Pack Member';
    const hasRole = interaction.member.roles.cache.some(
      (r) => r.name === allowedRole
    );
    if (!hasRole) {
      return interaction.reply({
        content: `❌ You need the **${allowedRole}** role to clear kills.`,
        ephemeral: true,
      });
    }

    const bossId = interaction.options.getString('boss');
    const boss = bosses.find((b) => b.id === bossId);

    if (!boss) {
      return interaction.reply({ content: '❌ Unknown boss.', ephemeral: true });
    }

    const existing = getBossState(bossId);
    if (!existing) {
      return interaction.reply({
        content: `⬜ **${boss.name}** has no recorded kill to clear.`,
        ephemeral: true,
      });
    }

    clearKill(bossId);

    const embed = new EmbedBuilder()
      .setColor(0x888888)
      .setTitle(`🗑️ Kill record cleared`)
      .setDescription(`**${boss.name}** (${boss.zone})\nCleared by <@${interaction.user.id}>`)
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  },
};
