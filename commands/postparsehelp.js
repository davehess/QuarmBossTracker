// commands/postparsehelp.js — Officer command: post the parsing setup
// instructions as a PUBLIC (non-ephemeral) message so it can be broadcast in a
// channel for everyone to see, instead of the ephemeral /parsehelp.
//
// Reuses the exact embed /parsehelp renders so the two never drift.
'use strict';

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { hasOfficerRole, officerRolesList } = require('../utils/roles');
const { buildParseHelpEmbed } = require('./parsehelp');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('postparsehelp')
    .setDescription('Officer: post the Mimic Parser setup instructions publicly in this channel'),

  async execute(interaction) {
    if (!hasOfficerRole(interaction.member)) {
      return interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: `❌ Officers only. Required roles: ${officerRolesList()}`,
      });
    }
    // Post publicly in the channel the command was run in.
    await interaction.channel.send({ embeds: [buildParseHelpEmbed()] });
    return interaction.reply({ flags: MessageFlags.Ephemeral, content: '✅ Posted the setup instructions here.' });
  },
};
