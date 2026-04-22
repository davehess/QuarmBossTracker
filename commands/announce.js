// commands/announce.js
const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags } = require('discord.js');
const bosses = require('../data/bosses.json');
const { addAnnounceMessageId } = require('../utils/state');
const { hasAllowedRole, allowedRolesList, getAllowedRoles } = require('../utils/roles');

const bossChoices = bosses.map((b) => ({
  name: `${b.emoji ? b.emoji + ' ' : ''}${b.name} (${b.zone})`,
  value: b.id,
  terms: [b.name.toLowerCase(), ...(b.nicknames || []).map((n) => n.toLowerCase())],
}));

module.exports = {
  data: new SlashCommandBuilder()
    .setName('announce')
    .setDescription('Announce a planned raid and @ the guild roles')
    .addStringOption((opt) => opt.setName('boss').setDescription('Which boss?').setRequired(true).setAutocomplete(true))
    .addStringOption((opt) => opt.setName('time').setDescription('When? (e.g. "9:00 PM EST")').setRequired(true))
    .addStringOption((opt) => opt.setName('note').setDescription('Optional extra info').setRequired(false)),

  async autocomplete(interaction) {
    const focused  = interaction.options.getFocused().toLowerCase().trim();
    const filtered = bossChoices
      .filter((c) => !focused || c.terms.some((t) => t.includes(focused)) || c.name.toLowerCase().includes(focused))
      .slice(0, 25).map(({ name, value }) => ({ name, value }));
    await interaction.respond(filtered);
  },

  async execute(interaction) {
    if (!hasAllowedRole(interaction.member)) {
      return interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: `❌ You need one of these roles: ${allowedRolesList()}`,
      });
    }

    const bossId = interaction.options.getString('boss');
    const time   = interaction.options.getString('time');
    const note   = interaction.options.getString('note');
    const boss   = bosses.find((b) => b.id === bossId);
    if (!boss) return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Unknown boss.' });

    const allowedRoleNames = getAllowedRoles();
    const guildRoles       = interaction.guild.roles.cache;
    const roleMentions     = allowedRoleNames
      .map((name) => { const r = guildRoles.find((r) => r.name === name); return r ? `<@&${r.id}>` : null; })
      .filter(Boolean).join(' ');

    const embed = new EmbedBuilder()
      .setColor(0xf5a623)
      .setTitle(`📣 Pack Takedown Announced: ${boss.name}`)
      .setDescription(
        `<@${interaction.user.id}> is planning a pack takedown on **[${boss.name}](${boss.pqdiUrl})** at **${time}**.\n\n` +
        `**Zone:** ${boss.zone}\n` +
        (note ? `**Note:** ${note}\n\n` : '\n') +
        `Use the button below to record the kill when it happens.`
      )
      .setTimestamp()
      .setFooter({ text: 'Archived to Historic Kills at midnight.' });

    const killButton = new ButtonBuilder()
      .setCustomId(`kill:${boss.id}`)
      .setLabel(`${boss.emoji || '⚔️'} Kill ${boss.name}`)
      .setStyle(ButtonStyle.Danger);

    const row = new ActionRowBuilder().addComponents(killButton);

    const { resource } = await interaction.reply({
      content: roleMentions || undefined,
      embeds:  [embed],
      components: [row],
      withResponse: true,
    });

    addAnnounceMessageId(resource.message.id);
  },
};
