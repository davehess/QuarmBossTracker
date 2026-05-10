// commands/ari.js — Alias for /autoraidinvite
const { SlashCommandBuilder } = require('discord.js');
const { execute } = require('./autoraidinvite');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ari')
    .setDescription('View or set the current auto-raid invite character and password')
    .addStringOption(opt =>
      opt.setName('character')
        .setDescription('Character name to /who for an invite (use "clear" to clear ARI)')
        .setRequired(false))
    .addStringOption(opt =>
      opt.setName('password')
        .setDescription('ARI password (use "clear" to clear ARI)')
        .setRequired(false)),
  execute,
};
