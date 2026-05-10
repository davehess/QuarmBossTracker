// commands/suggest.js — Non-officer command to request an event be hosted.
// Posts a formatted request card to SUGGEST_CHANNEL_ID so officers can claim it.

const {
  SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder,
  ButtonStyle, MessageFlags,
} = require('discord.js');
const { hasAllowedRole, allowedRolesList } = require('../utils/roles');

function getBosses() {
  delete require.cache[require.resolve('../data/bosses.json')];
  return require('../data/bosses.json');
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('suggest')
    .setDescription('Request an officer to host an event for you')
    .addStringOption(opt =>
      opt.setName('boss')
        .setDescription('Boss or zone you want to run')
        .setRequired(true)
        .setAutocomplete(true))
    .addStringOption(opt =>
      opt.setName('time')
        .setDescription('When you want to do it — e.g. "9pm Tuesday", "tonight", "now"')
        .setRequired(true))
    .addStringOption(opt =>
      opt.setName('note')
        .setDescription('Any extra info for the officers')
        .setRequired(false)),

  async autocomplete(interaction) {
    const bosses  = getBosses();
    const focused = interaction.options.getFocused().toLowerCase().trim();
    const choices = [];
    const seen    = new Set();

    for (const boss of bosses) {
      const terms = [boss.name.toLowerCase(), ...(boss.nicknames || []).map(n => n.toLowerCase())];
      if (!focused || terms.some(t => t.includes(focused)) || boss.zone.toLowerCase().includes(focused)) {
        if (!seen.has(boss.id)) {
          seen.add(boss.id);
          choices.push({ name: `${boss.emoji ? boss.emoji + ' ' : ''}${boss.name} (${boss.zone})`, value: boss.id });
        }
      }
    }

    await interaction.respond(choices.slice(0, 25));
  },

  async execute(interaction) {
    if (!hasAllowedRole(interaction.member))
      return interaction.reply({ flags: MessageFlags.Ephemeral, content: `❌ You need one of these roles: ${allowedRolesList()}` });

    const suggestChannelId = process.env.SUGGEST_CHANNEL_ID;
    if (!suggestChannelId)
      return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ `SUGGEST_CHANNEL_ID` is not configured — ask an officer to set it up.' });

    const bosses  = getBosses();
    const bossId  = interaction.options.getString('boss');
    const timeStr = interaction.options.getString('time');
    const note    = interaction.options.getString('note');

    // Resolve boss — by ID (autocomplete pick) or fuzzy name match (raw type)
    let boss = bosses.find(b => b.id === bossId);
    if (!boss) {
      const q = bossId.toLowerCase();
      boss = bosses.find(b =>
        b.name.toLowerCase().includes(q) ||
        (b.nicknames || []).some(n => n.toLowerCase().includes(q))
      );
    }

    const bossLabel = boss
      ? `${boss.emoji ? boss.emoji + ' ' : ''}${boss.name} — ${boss.zone}`
      : bossId;

    const channel = await interaction.client.channels.fetch(suggestChannelId).catch(() => null);
    if (!channel)
      return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Could not find the suggestions channel.' });

    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('📣 Event Request')
      .addFields(
        { name: 'Requested by', value: `<@${interaction.user.id}>`, inline: true },
        { name: 'Boss / Zone',  value: bossLabel,                   inline: true },
        { name: 'Wanted time', value: timeStr,                      inline: true },
      )
      .setTimestamp()
      .setFooter({ text: 'Use the buttons below to respond to this request' });

    if (note) embed.addFields({ name: 'Note', value: note, inline: false });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`suggest_host:${interaction.user.id}`)
        .setLabel("I'll host it")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`suggest_nohost:${interaction.user.id}`)
        .setLabel('No hosts available')
        .setStyle(ButtonStyle.Danger),
    );

    await channel.send({ embeds: [embed], components: [row] });

    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      content: `✅ Your request for **${boss ? boss.name : bossId}** has been posted to the officers. You'll be notified when someone responds!`,
    });
  },
};
