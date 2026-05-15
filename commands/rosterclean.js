// commands/rosterclean.js — Deduplicate roster entries and normalize Discord thread messages.
// Removes duplicate entries from in-memory rosters and edits the Discord thread messages
// in place (no new sends, no notifications). Extra duplicate message sets are deleted.
const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { hasAllowedRole, allowedRolesList } = require('../utils/roles');
const { deduplicateAndSave, getActiveRoster, getInactiveRoster, rosterCounts } = require('../utils/roster');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rosterclean')
    .setDescription('Remove duplicate roster entries and normalize roster thread messages in place.'),

  async execute(interaction) {
    if (!hasAllowedRole(interaction.member)) {
      return interaction.reply({ flags: MessageFlags.Ephemeral, content: `❌ You need one of these roles: ${allowedRolesList()}` });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const { mainCount: beforeMains, altCount: beforeAlts } = rosterCounts([
      ...getActiveRoster(), ...getInactiveRoster(),
    ]);

    const { removedActive, removedInactive } = await deduplicateAndSave(interaction.client)
      .catch(err => { console.warn('[rosterclean]', err?.message); return { removedActive: 0, removedInactive: 0 }; });

    const { mainCount: afterMains, altCount: afterAlts } = rosterCounts([
      ...getActiveRoster(), ...getInactiveRoster(),
    ]);

    const total = removedActive + removedInactive;
    if (total === 0) {
      return interaction.editReply('✅ Roster is already clean — no duplicates found.');
    }
    await interaction.editReply(
      `✅ Roster deduplicated and threads updated in place.\n` +
      `**Removed:** ${removedActive} active + ${removedInactive} inactive duplicate entries\n` +
      `**Before:** ${beforeMains} mains, ${beforeAlts} alts\n` +
      `**After:** ${afterMains} mains, ${afterAlts} alts`
    );
  },
};
