// commands/markzek.js — Flag/unflag a character as being affiliated with
// Zek (PVP guild). Useful when someone shows up as unguilded in /who but
// is actually Zek-aligned.
//
// The is_zek flag is sticky: once set, it persists until explicitly cleared
// here. Auto-flagging on guild="Zek" still happens via mergeWhoData on every
// upload — this command is for the manual cases. Open to any guildie with
// the standard allowed role; Zek intel benefits the whole pack and there's
// no destructive blast radius (worst case is an erroneous flag on a friendly,
// which any officer can flip back with `is_zek:false`).

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { hasAllowedRole, allowedRolesList } = require('../utils/roles');
const { setZekFlag, getWhoEntry } = require('../utils/state');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('markzek')
    .setDescription('Flag (or clear) a character as Zek-affiliated')
    .addStringOption(opt =>
      opt.setName('character').setDescription('Character name').setRequired(true)
    )
    .addBooleanOption(opt =>
      opt.setName('is_zek').setDescription('true = Zek, false = clear the flag').setRequired(true)
    ),

  async execute(interaction) {
    if (!hasAllowedRole(interaction.member)) {
      return interaction.reply({
        flags:   MessageFlags.Ephemeral,
        content: `❌ You need one of these roles to mark Zek affiliation: ${allowedRolesList()}`,
      });
    }

    const name  = interaction.options.getString('character', true).trim();
    const isZek = interaction.options.getBoolean('is_zek', true);
    const entry = setZekFlag(name, isZek);

    const verb = isZek ? '🚩 flagged as **Zek**' : '↩️ cleared Zek flag for';
    const cls  = entry.class ? ` *(${entry.class}${entry.level ? ` ${entry.level}` : ''})*` : '';
    return interaction.reply({
      flags:   MessageFlags.Ephemeral,
      content: `${verb} **${entry.name}**${cls}. /parsestats embeds will reflect this on the next parse.`,
    });
  },
};
