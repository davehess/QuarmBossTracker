// commands/parsenight.js — Full-night DPS summary from a Combined EQLogParser string.
const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { parseEQLog, buildParseEmbed } = require('./parse');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('parsenight')
    .setDescription('Show a full-night DPS summary from a Combined EQLogParser parse string.')
    .addStringOption(opt =>
      opt.setName('data')
        .setDescription('Paste the EQLogParser "Combined (N):" output for the full night')
        .setRequired(true)
        .setMaxLength(6000)
    )
    .addBooleanOption(opt =>
      opt.setName('public')
        .setDescription('Post publicly (default: ephemeral)')
        .setRequired(false)
    ),

  async execute(interaction) {
    const rawData  = interaction.options.getString('data');
    const isPublic = interaction.options.getBoolean('public') ?? false;

    if (!isPublic) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    } else {
      await interaction.deferReply();
    }

    const parsed = parseEQLog(rawData);
    if (!parsed) {
      return interaction.editReply(
        '❌ Could not parse that input. Paste the EQLogParser "Combined (N):" output for the full night ' +
        '(e.g. "Combined (55): Boss in 162s, 737.8K Damage @4.55K, 1. Player = 231.20K@5.78K in 40s | ...")'
      );
    }

    const combinedMatch = rawData.match(/^Combined\s*\((\d+)\)/);
    const killCount = combinedMatch ? parseInt(combinedMatch[1]) : null;

    const embed = buildParseEmbed('Full Night', parsed, '⚔️');
    embed.setTitle('⚔️ Full Night Summary');
    if (killCount !== null) {
      const fmt = (n) => n.toLocaleString('en-US');
      embed.setDescription(
        `Combined **${killCount}** kills · Fight time: **${parsed.duration}s** · ` +
        `${fmt(parsed.totalDamage)} dmg · ${fmt(parsed.totalDps)}/s raid DPS`
      );
    }

    await interaction.editReply({ embeds: [embed] });
  },
};
