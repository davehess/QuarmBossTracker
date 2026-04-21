// commands/kill.js
// /kill - Mark a boss as killed and record the spawn timer

const { SlashCommandBuilder } = require('discord.js');
const bosses = require('../data/bosses.json');
const { recordKill } = require('../utils/state');
const { buildKillEmbed } = require('../utils/embeds');

// Build autocomplete choices list (Discord max is 25 visible but handles search filtering)
const bossChoices = bosses.map((b) => ({ name: `${b.name} (${b.zone})`, value: b.id }));

module.exports = {
  data: new SlashCommandBuilder()
    .setName('kill')
    .setDescription('Record a raid boss kill and start the respawn timer')
    .addStringOption((option) =>
      option
        .setName('boss')
        .setDescription('Which boss was killed?')
        .setRequired(true)
        .setAutocomplete(true)
    )
    .addStringOption((option) =>
      option
        .setName('note')
        .setDescription('Optional note (e.g. "clean kill", "partial loot")')
        .setRequired(false)
    ),

  // Handle autocomplete — filters boss list as the user types
  async autocomplete(interaction) {
    const focused = interaction.options.getFocused().toLowerCase();
    const filtered = bossChoices
      .filter((c) => c.name.toLowerCase().includes(focused))
      .slice(0, 25);
    await interaction.respond(filtered);
  },

  async execute(interaction) {
    // Check role permission
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
    const note = interaction.options.getString('note');
    const boss = bosses.find((b) => b.id === bossId);

    if (!boss) {
      return interaction.reply({
        content: '❌ Unknown boss. Please use the autocomplete to select a valid boss.',
        ephemeral: true,
      });
    }

    const stateEntry = recordKill(bossId, boss.timerHours, interaction.user.id);
    const embed = buildKillEmbed(boss, stateEntry, interaction.user.id);

    if (note) {
      embed.addFields({ name: 'Note', value: note, inline: false });
    }

    await interaction.reply({ embeds: [embed] });
  },
};
