// commands/syncmembers.js — officer-only manual trigger for the Wolf Pack
// member → wolfpack_members Supabase sync. The bot also runs this on
// startup and every 6 hours; this command is for when you've just added a
// new recruit and want them showing up on wolfpack.quest immediately.
const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const { syncWolfpackMembers } = require('../utils/wolfpackMembers');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('syncmembers')
    .setDescription('Push current Discord guild membership to the web site (wolfpack_members table)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const result = await syncWolfpackMembers(interaction.client);
      if (result.skipped) {
        return interaction.editReply('⚠️ Sync skipped — Supabase env vars or DISCORD_GUILD_ID not set on the bot.');
      }
      return interaction.editReply(
        `✅ Synced ${result.synced}/${result.total} members to \`wolfpack_members\`. Visit https://wolfpack.quest to see the updated roster.`,
      );
    } catch (err) {
      return interaction.editReply(`❌ Sync failed: ${err?.message || err}`);
    }
  },
};
