// commands/announce.js — Adds a "Cancel / Archive" button alongside the kill button

const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags } = require('discord.js');
const { addAnnounceMessageId } = require('../utils/state');
const { hasAllowedRole, allowedRolesList, getAllowedRoles } = require('../utils/roles');

function getBosses() {
  delete require.cache[require.resolve('../data/bosses.json')];
  return require('../data/bosses.json');
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('announce')
    .setDescription('Announce a planned raid takedown, tagged to guild roles')
    .addStringOption((opt) => opt.setName('boss').setDescription('Which boss?').setRequired(true).setAutocomplete(true))
    .addStringOption((opt) => opt.setName('time').setDescription('When? (e.g. "9:00 PM EST")').setRequired(true))
    .addStringOption((opt) => opt.setName('note').setDescription('Optional extra info').setRequired(false)),

  async autocomplete(interaction) {
    const bosses  = getBosses();
    const focused = interaction.options.getFocused().toLowerCase().trim();
    const choices = bosses.map((b) => ({
      name: `${b.emoji ? b.emoji + ' ' : ''}${b.name} (${b.zone})`, value: b.id,
      terms: [b.name.toLowerCase(), ...(b.nicknames || []).map((n) => n.toLowerCase())],
    }));
    await interaction.respond(
      choices.filter((c) => !focused || c.terms.some((t) => t.includes(focused)) || c.name.toLowerCase().includes(focused))
        .slice(0, 25).map(({ name, value }) => ({ name, value }))
    );
  },

  async execute(interaction) {
    if (!hasAllowedRole(interaction.member)) {
      return interaction.reply({ flags: MessageFlags.Ephemeral, content: `❌ You need one of these roles: ${allowedRolesList()}` });
    }

    const bosses = getBosses();
    const bossId = interaction.options.getString('boss');
    const time   = interaction.options.getString('time');
    const note   = interaction.options.getString('note');
    const boss   = bosses.find((b) => b.id === bossId);
    if (!boss) return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Unknown boss.' });

    const allowedRoleNames = getAllowedRoles();
    const roleMentions     = allowedRoleNames
      .map((name) => { const r = interaction.guild.roles.cache.find((r) => r.name === name); return r ? `<@&${r.id}>` : null; })
      .filter(Boolean).join(' ');

    const embed = new EmbedBuilder()
      .setColor(0xf5a623)
      .setTitle(`📣 Pack Takedown: ${boss.name}`)
      .setDescription(
        `<@${interaction.user.id}> is planning a pack takedown on **[${boss.name}](${boss.pqdiUrl})** at **${time}**.\n\n` +
        `**Zone:** ${boss.zone}` + (note ? `\n**Note:** ${note}` : '') +
        `\n\nUse the button below to record the kill when it happens.`
      )
      .setTimestamp()
      .setFooter({ text: 'Archived to Historic Kills at midnight • Use Cancel to archive early' });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`kill:${boss.id}`).setLabel(`${boss.emoji || '⚔️'} Kill ${boss.name}`).setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`cancel_announce`).setLabel('❌ Cancel / Archive').setStyle(ButtonStyle.Secondary),
    );

    const { resource } = await interaction.reply({
      content: roleMentions || undefined,
      embeds: [embed], components: [row], withResponse: true,
    });

    addAnnounceMessageId(resource.message.id);
  },
};
