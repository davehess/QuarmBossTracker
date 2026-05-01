// commands/whoall.js — Look up a character and show their full main/alt family.
const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { getCharacter, getFamily, getAllNames } = require('../utils/roster');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('whoall')
    .setDescription('Show a character\'s full main/alt family. (Only you see the result)')
    .addStringOption(opt =>
      opt.setName('name')
        .setDescription('Character name (main or alt)')
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
        const label = c ? `${c.name} (${c.race} ${c.class}${c.isAlt ? ` · Alt of ${c.mainName}` : ''})` : n;
        return { name: label.slice(0, 100), value: c?.name || n };
      });
    await interaction.respond(matches);
  },

  async execute(interaction) {
    const name   = interaction.options.getString('name');
    const char   = getCharacter(name);

    if (!char) {
      return interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: `❌ No character named **${name}** found in the roster.`,
      });
    }

    const family = getFamily(name);
    if (!family) {
      return interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: `❌ Could not resolve the family for **${name}**.`,
      });
    }

    const { main, alts } = family;
    const active = main.active ? '' : ' *(inactive)*';

    const altLines = alts.length > 0
      ? alts.map(a => `↳ **${a.name}** — ${a.race} ${a.class}`).join('\n')
      : '*No alts on record*';

    const intro = char.isAlt
      ? `**${char.name}** is a ${char.race} ${char.class} (Alt of **${char.mainName}**)`
      : `**${char.name}** is a ${char.race} ${char.class} (Main)`;

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(`👤 ${main.name}${active}`)
      .setDescription(intro)
      .addFields(
        { name: `⚔️ Main`, value: `**${main.name}** — ${main.race} ${main.class}`, inline: false },
        { name: `🗡️ Alts (${alts.length})`, value: altLines, inline: false },
      );

    return interaction.reply({ flags: MessageFlags.Ephemeral, embeds: [embed] });
  },
};
