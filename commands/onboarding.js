// commands/onboarding.js — Show the Wolf Pack onboarding welcome message.
//
// Behavior (post-DB-cutover, 2026-05-30+):
//   1. Never seen onboarding before → full welcome embed.
//   2. Seen before, prior version < current → DIFF-ONLY (changesSince) with a
//      [Show full welcome] button next to a [Don't ping me on revisions] dismiss.
//   3. Already at current version → "You're up to date" + [Show full welcome].
//
// Opt-out (set via the Don't-ping button) only suppresses the GuildMemberAdd DM
// on rejoin. `/onboarding` always responds.
const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const pkg = require('../package.json');
const {
  getLastSeenVersion, setLastSeenVersion,
  changesSince,
  buildWelcomeEmbed, buildWelcomeComponents,
  buildChangesEmbed, buildChangesComponents,
} = require('../utils/onboarding');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('onboarding')
    .setDescription('Show what\'s new since you last checked, or the full welcome.'),

  async execute(interaction) {
    const userId  = interaction.user.id;
    const version = pkg.version;
    const lastSeen = getLastSeenVersion(userId);

    // First-ever view → full welcome.
    if (!lastSeen) {
      setLastSeenVersion(userId, version);
      return interaction.reply({
        embeds:     [buildWelcomeEmbed()],
        components: buildWelcomeComponents(version),
        flags:      MessageFlags.Ephemeral,
      });
    }

    // Already current → quick "up to date" with full-welcome escape hatch.
    if (lastSeen === version) {
      return interaction.reply({
        content:    `✅ You're up to date on **v${version}**.`,
        components: buildChangesComponents(version),
        flags:      MessageFlags.Ephemeral,
      });
    }

    // Diff-only since their last-seen version.
    const changes = changesSince(lastSeen);
    setLastSeenVersion(userId, version);
    return interaction.reply({
      embeds:     [buildChangesEmbed(version, lastSeen, changes)],
      components: buildChangesComponents(version),
      flags:      MessageFlags.Ephemeral,
    });
  },
};
