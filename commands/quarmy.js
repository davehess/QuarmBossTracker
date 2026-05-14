// commands/quarmy.js — Register a Quarmy profile URL for a character name.
// The registered URL makes the character's name a clickable link in /who and /whoall.
const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { hasAllowedRole, allowedRolesList } = require('../utils/roles');
const { getAllNames, getCharacter, setRosterQuarmyLink, clearRosterQuarmyLink, saveRosters } = require('../utils/roster');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('quarmy')
    .setDescription('Register a Quarmy profile link for a character.')
    .addSubcommand(sub =>
      sub.setName('set')
        .setDescription('Register a Quarmy URL for a character name.')
        .addStringOption(opt =>
          opt.setName('name')
            .setDescription('Character name')
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addStringOption(opt =>
          opt.setName('url')
            .setDescription('Quarmy profile URL (e.g. https://quarmy.com/b/abc123)')
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub.setName('clear')
        .setDescription('Remove the Quarmy URL for a character.')
        .addStringOption(opt =>
          opt.setName('name')
            .setDescription('Character name')
            .setRequired(true)
            .setAutocomplete(true)
        )
    )
    .addSubcommand(sub =>
      sub.setName('view')
        .setDescription('Show the registered Quarmy URL for a character.')
        .addStringOption(opt =>
          opt.setName('name')
            .setDescription('Character name')
            .setRequired(true)
            .setAutocomplete(true)
        )
    ),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused().toLowerCase();
    const names   = getAllNames();
    const matches = names
      .filter(n => n.includes(focused))
      .sort()
      .slice(0, 25)
      .map(n => {
        const c = getCharacter(n);
        return { name: c ? `${c.name} (${c.race} ${c.class})` : n, value: c?.name || n };
      });
    await interaction.respond(matches);
  },

  async execute(interaction) {
    if (!hasAllowedRole(interaction.member))
      return interaction.reply({ flags: MessageFlags.Ephemeral, content: `❌ You need one of these roles: ${allowedRolesList()}` });

    const sub  = interaction.options.getSubcommand();
    const name = interaction.options.getString('name');

    if (sub === 'view') {
      const url = getCharacter(name)?.quarmyUrl;
      if (!url) return interaction.reply({ flags: MessageFlags.Ephemeral, content: `ℹ️ No Quarmy link registered for **${name}**.` });
      return interaction.reply({ flags: MessageFlags.Ephemeral, content: `🔗 **${name}**: ${url}` });
    }

    if (sub === 'clear') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      clearRosterQuarmyLink(name);
      await saveRosters(interaction.client).catch(err => console.warn('[quarmy] saveRosters:', err?.message));
      return interaction.editReply(`✅ Quarmy link cleared for **${name}**.`);
    }

    const url = interaction.options.getString('url').trim();
    if (!url.startsWith('http')) {
      return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ URL must start with http:// or https://' });
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const found = setRosterQuarmyLink(name, url);
    if (!found) return interaction.editReply(`❌ **${name}** not found in the roster.`);
    await saveRosters(interaction.client).catch(err => console.warn('[quarmy] saveRosters:', err?.message));
    return interaction.editReply(`✅ Quarmy link registered for **${name}**: ${url}\nTheir name will now appear as a clickable link in \`/who\` and \`/whoall\`.`);
  },
};
