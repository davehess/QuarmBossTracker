// commands/pvpspawn.js — Mark a PVP mob as spawned (clear its timer).
// Gives the officer an ephemeral "Alert PVP" button to rally the pack.

const {
  SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags,
} = require('discord.js');
const { hasAllowedRole, allowedRolesList } = require('../utils/roles');
const { clearPvpKill, getAllPvpKills } = require('../utils/state');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('pvpspawn')
    .setDescription('Clear a PVP mob timer when it spawns. (Officers only)')
    .addStringOption(opt =>
      opt.setName('mob').setDescription('Mob on cooldown').setRequired(true).setAutocomplete(true)
    ),

  async autocomplete(interaction) {
    const kills   = getAllPvpKills();
    const focused = interaction.options.getFocused().toLowerCase();
    const choices = Object.entries(kills)
      .filter(([, v]) => v.name.toLowerCase().includes(focused))
      .map(([key, v]) => ({ name: v.name, value: key }));
    await interaction.respond(choices.slice(0, 25));
  },

  async execute(interaction) {
    if (!hasAllowedRole(interaction.member))
      return interaction.reply({ flags: MessageFlags.Ephemeral, content: `❌ You need one of these roles: ${allowedRolesList()}` });

    const key   = interaction.options.getString('mob');
    const kills = getAllPvpKills();
    const entry = kills[key];

    if (!entry)
      return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ No active PVP timer found for that mob.' });

    // Delete the kill card from the kills thread
    const killsThreadId = process.env.PVP_KILLS_THREAD_ID;
    if (killsThreadId && entry.threadMessageId) {
      try {
        const thread = await interaction.client.channels.fetch(killsThreadId);
        const msg    = await thread.messages.fetch(entry.threadMessageId);
        await msg.delete();
      } catch { /* message already gone */ }
    }

    clearPvpKill(key);

    // Ephemeral reply with "Alert PVP" button
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`pvp_spawn_alert:${key}`)
        .setLabel('🐺 Alert PVP')
        .setStyle(ButtonStyle.Danger),
    );

    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      content: `✅ **${entry.name}** timer cleared — it's up! Want to rally the pack?`,
      components: [row],
    });
  },
};
