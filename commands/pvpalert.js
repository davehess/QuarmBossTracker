// commands/pvpalert.js — Ping the @PVP role and howl for the pack in a zone.
const {
  SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags,
} = require('discord.js');

async function getPvpTarget(client) {
  const id = process.env.PVP_THREAD_ID || process.env.PVP_CHANNEL_ID;
  if (!id) return null;
  return client.channels.fetch(id).catch(() => null);
}

function buildHowlRow(messageId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`pvpalert_howl:${messageId}`)
      .setLabel('🐺 Howl!')
      .setStyle(ButtonStyle.Danger),
  );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('pvpalert')
    .setDescription('Ping the @PVP role and howl for the pack in a zone.')
    .addStringOption(opt =>
      opt.setName('zone').setDescription('Zone where you need the pack').setRequired(true)
    ),

  async execute(interaction) {
    const zone   = interaction.options.getString('zone');
    const member = interaction.member;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const ch = (await getPvpTarget(interaction.client)) || interaction.channel;

    const pvpRoleName = process.env.PVP_ROLE || 'PVP';
    const pvpRole     = interaction.guild.roles.cache.find(r => r.name === pvpRoleName);
    const mention     = pvpRole ? `<@&${pvpRole.id}>` : '';

    const alertText = `The Bloodthirsty **${member.displayName}** howls for the pack in **${zone}**!`;
    const content   = mention ? `${mention}\n${alertText}` : alertText;

    // Post first to get the message ID, then edit to add the Howl button with that ID
    const sent = await ch.send({ content });
    await sent.edit({ content, components: [buildHowlRow(sent.id)] });

    await interaction.editReply(`✅ Howl posted!`);
  },

  buildHowlRow,
};
