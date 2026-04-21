// commands/kill.js
// /kill - Mark a boss as killed and record the spawn timer

const { SlashCommandBuilder } = require('discord.js');
const bosses = require('../data/bosses.json');
const { recordKill } = require('../utils/state');
const { buildKillEmbed } = require('../utils/embeds');

// Build searchable index: maps every nickname and the boss name itself -> boss id
// Used for autocomplete matching
const bossChoices = bosses.map((b) => ({
  name: `${b.emoji ? b.emoji + ' ' : ''}${b.name} (${b.zone})`,
  value: b.id,
  // searchable terms: full name + all nicknames, all lowercased
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

  // Handle autocomplete — matches on boss name AND all nicknames
  async autocomplete(interaction) {
    const focused = interaction.options.getFocused().toLowerCase().trim();
    const filtered = bossChoices
      .filter((c) => !focused || c.terms.some((t) => t.includes(focused)) || c.name.toLowerCase().includes(focused))
      .slice(0, 25)
      .map(({ name, value }) => ({ name, value })); // strip internal `terms` field
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
