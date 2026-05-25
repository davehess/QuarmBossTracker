// commands/whoall.js — Look up a character and show their full main/alt family.
const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { getCharacter, getFamily, getAllNames } = require('../utils/roster');

// Build a display name with optional Quarmy and OpenDKP links
function _links(name, quarmyUrl, dkpUrl) {
  const parts = [];
  if (quarmyUrl) parts.push(`[Quarmy](<${quarmyUrl}>)`);
  if (dkpUrl)    parts.push(`[OpenDKP](<${dkpUrl}>)`);
  return parts.length ? `${name} *(${parts.join(' · ')})*` : name;
}

function charLink(name) {
  const c = getCharacter(name);
  return c?.quarmyUrl ? `[${name}](<${c.quarmyUrl}>)` : name;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('whoall')
    .setDescription('Show a character\'s full main/alt family. (Only you see the result)')
    .addStringOption(opt =>
      opt.setName('name')
        .setDescription('Character name (main or alt)')
        .setRequired(true)
        .setAutocomplete(true)
    ),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused().toLowerCase();
    const names = getAllNames();
    const matches = names
      .filter(n => n.includes(focused))
      .sort()
      .slice(0, 25)
      .map(n => {
        const c = getCharacter(n);
        const label = c ? `${c.name} (${c.race} ${c.class}${c.isAlt ? ` · Alt of ${c.mainName}` : ''})` : n;
        return { name: label.slice(0, 100), value: c?.name || n };
      });
    await interaction.respond(matches);
  },

  async execute(interaction) {
    const name   = interaction.options.getString('name');
    const char   = getCharacter(name);

    if (!char) {
      return interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: `❌ No character named **${name}** found in the roster.`,
      });
    }

    const family = getFamily(name);
    if (!family) {
      return interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: `❌ Could not resolve the family for **${name}**.`,
      });
    }

    const { main, alts } = family;
    const active = main.active ? '' : ' *(inactive)*';

    const mainLabel = `**${main.name}** ${_links('', main.quarmyUrl, main.dkpUrl)}`.trim();

    const altLines = alts.length > 0
      ? alts.map(a => {
          const suffix = _links('', a.quarmyUrl, a.dkpUrl);
          return `↳ **${a.name}** — ${a.race} ${a.class}${suffix ? ' ' + suffix : ''}`;
        }).join('\n')
      : '*No alts on record*';

    const intro = char.isAlt
      ? `**${charLink(char.name)}** is a ${char.race} ${char.class} (Alt of **${charLink(char.mainName)}**)`
      : `**${charLink(char.name)}** is a ${char.race} ${char.class} (Main)`;

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(`👤 ${main.name}${active}`)
      .setDescription(intro)
      .addFields(
        { name: `⚔️ Main`, value: `${mainLabel} — ${main.race} ${main.class}`, inline: false },
        { name: `🗡️ Alts (${alts.length})`, value: altLines, inline: false },
      );

    return interaction.reply({ flags: MessageFlags.Ephemeral, embeds: [embed] });
  },
};
