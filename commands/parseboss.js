// commands/parseboss.js — Submit an EQLogParser DPS parse with an explicit boss selection.
// Use this when /parse can't auto-match the boss name from the log string.

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { parseEQLog, buildParseEmbed, finishParse } = require('./parse');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('parseboss')
    .setDescription('Submit a DPS parse with an explicit boss override (use when /parse can\'t auto-match).')
    .addStringOption(opt =>
      opt.setName('boss').setDescription('Boss that was killed').setRequired(true).setAutocomplete(true)
    )
    .addStringOption(opt =>
      opt.setName('data')
        .setDescription('Paste the EQLogParser "Send to EQ" output')
        .setRequired(true)
        .setMaxLength(6000)
    ),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused().toLowerCase();
    delete require.cache[require.resolve('../data/bosses.json')];
    const bosses = require('../data/bosses.json');
    const matches = bosses
      .filter(b =>
        b.name.toLowerCase().includes(focused) ||
        (b.nicknames || []).some(n => n.toLowerCase().includes(focused))
      )
      .slice(0, 25)
      .map(b => ({ name: b.name, value: b.id }));
    await interaction.respond(matches);
  },

  async execute(interaction) {
    const bossId  = interaction.options.getString('boss');
    const rawData = interaction.options.getString('data');

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    delete require.cache[require.resolve('../data/bosses.json')];
    const bosses = require('../data/bosses.json');
    const boss   = bosses.find(b => b.id === bossId);

    if (!boss) {
      return interaction.editReply(`❌ Unknown boss id \`${bossId}\`. Use the autocomplete dropdown.`);
    }

    const parsed = parseEQLog(rawData);
    if (!parsed) {
      return interaction.editReply('❌ Could not parse that input. Paste the EQLogParser "Send to EQ" output directly (e.g. "Boss Name in 397s, 1.54M Damage @3.87K, 1. Player = 78.22K@216 in 362s | ...")');
    }

    const embed = await finishParse(interaction, bossId, boss, parsed);
    return interaction.editReply({ embeds: [embed] });
  },
};
