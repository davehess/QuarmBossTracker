// commands/who.js — Look up a single character's race/class and main/alt status.
const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { getCharacter, getAllNames } = require('../utils/roster');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('who')
    .setDescription('Look up a character\'s race, class, and main/alt status. (Only you see the result)')
    .addStringOption(opt =>
      opt.setName('name')
        .setDescription('Character name')
        .setRequired(true)
        .setAutocomplete(true)
    ),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused().toLowerCase();
    const names = getAllNames();
    const matches = names
      .filter(n => n.includes(focused))
      .sort()
      .slice(0, 25)
      .map(n => {
        const c = getCharacter(n);
        const altSuffix = c?.isAlt ? (c.mainName ? ` · Alt of ${c.mainName}` : ' · Alt') : '';
        const label = c ? `${c.name} (${c.race} ${c.class}${altSuffix})` : n;
        return { name: label.slice(0, 100), value: c?.name || n };
      });
    await interaction.respond(matches);
  },

  async execute(interaction) {
    const name = interaction.options.getString('name');
    const char = getCharacter(name);

    if (!char) {
      return interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: `❌ No character named **${name}** found in the roster.`,
      });
    }

    const status = char.isAlt
      ? (char.mainName ? `Alt of **${char.mainName}**` : 'Alt *(main not linked)*')
      : 'Main';
    const active = char.active ? '' : ' *(inactive)*';
    return interaction.reply({
      flags: MessageFlags.Ephemeral,
      content: `**${char.name}** is a ${char.race} ${char.class} — ${status}${active}`,
    });
  },
};
