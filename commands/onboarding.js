// commands/onboarding.js — Show the Wolf Pack onboarding welcome message, or toggle opt-out.
const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const pkg = require('../package.json');
const {
  isOptedOut, getOptedOutVersion, setOptedOut, removeOptOut,
  changesSince, saveOnboardingData,
  buildWelcomeEmbed, buildWelcomeComponents, buildShowAgainComponents,
} = require('../utils/onboarding');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('onboarding')
    .setDescription('Show the Wolf Pack welcome message again, or toggle whether you see it on join.'),

  async execute(interaction) {
    const userId  = interaction.user.id;
    const version = pkg.version;

    if (isOptedOut(userId)) {
      // Show opted-out state with option to re-enable
      const optedAt = getOptedOutVersion(userId);
      const changes = optedAt ? changesSince(optedAt) : [];

      let content = `🔕 You've opted out of the welcome message (last seen at v${optedAt || '?'}).`;
      if (changes.length > 0) {
        content += `\n\n**New since v${optedAt}:**\n${changes.join('\n')}`;
      }
      content += '\n\nClick below to opt back in and see the full welcome message again.';

      return interaction.reply({
        content,
        components: buildShowAgainComponents(),
        flags: MessageFlags.Ephemeral,
      });
    }

    // Show the full welcome message
    await interaction.reply({
      embeds:     [buildWelcomeEmbed()],
      components: buildWelcomeComponents(version),
      flags:      MessageFlags.Ephemeral,
    });
  },
};
