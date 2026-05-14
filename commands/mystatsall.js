// commands/mystatsall.js — Parse stats aggregated across a character's full main/alt family.
const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { getAllNames, getCharacter, getFamily } = require('../utils/roster');
const { loadParses } = require('./parse');
const { buildStatsEmbed } = require('./mystats');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('mystatsall')
    .setDescription('View parse stats across a full main/alt family. (Only you see the result)')
    .addStringOption(opt =>
      opt.setName('character')
        .setDescription('Any character in the family (main or alt)')
        .setRequired(true)
        .setAutocomplete(true)
    ),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused().toLowerCase();
    const names   = getAllNames();
    const matches = names.filter(n => n.includes(focused)).sort().slice(0, 25);
    await interaction.respond(
      matches.map(n => {
        const c = getCharacter(n);
        const label = c ? `${c.name} (${c.race} ${c.class}${c.isAlt ? ` · Alt of ${c.mainName}` : ''})` : n;
        return { name: label.slice(0, 100), value: c?.name || n };
      })
    );
  },

  async execute(interaction) {
    const name = interaction.options.getString('character');
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    delete require.cache[require.resolve('../data/bosses.json')];
    const bosses    = require('../data/bosses.json');
    const allParses = loadParses();

    const char   = getCharacter(name);
    const family = char ? getFamily(name) : null;

    let charNames, title;
    if (family) {
      const { main, alts } = family;
      charNames = [main.name, ...alts.map(a => a.name)];
      const altCount = alts.length;
      title = `📈 ${main.name} + ${altCount} alt${altCount !== 1 ? 's' : ''} — Family Parse Stats`;
    } else {
      charNames = [char?.name || name];
      title = `📈 ${char?.name || name} — Parse Stats`;
    }

    const embed = buildStatsEmbed(title, charNames, allParses, bosses);
    await interaction.editReply({ embeds: [embed] });
  },
};
