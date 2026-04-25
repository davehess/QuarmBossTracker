// commands/pvprole.js — Toggle the @PVP role for the user.
// /pvprole          → toggles role + posts announcement in PVP channel
// /pvprole silent   → toggles role silently (no announcement)

const {
  SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  EmbedBuilder, MessageFlags,
} = require('discord.js');

function getPvpRoleName() { return process.env.PVP_ROLE || 'PVP'; }

async function getPvpRole(guild) {
  return guild.roles.cache.find(r => r.name === getPvpRoleName()) || null;
}

async function getPvpTarget(client) {
  const id = process.env.PVP_THREAD_ID || process.env.PVP_CHANNEL_ID;
  if (!id) return null;
  try { return await client.channels.fetch(id); } catch { return null; }
}

function buildAnnouncementEmbed(member) {
  return new EmbedBuilder()
    .setColor(0xcc0000)
    .setTitle('🐺 A wolf joins the bloodthirsty!')
    .setDescription(`**${member.displayName}** is a bloodthirsty wolf! AWROOOOOO!`)
    .setThumbnail(member.user.displayAvatarURL())
    .setTimestamp();
}

function buildRoleRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('pvprole_toggle')
      .setLabel('🐺 Join / Leave PVP')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('pvprole_toggle_silent')
      .setLabel('🤫 Join / Leave Silently')
      .setStyle(ButtonStyle.Secondary),
  );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('pvprole')
    .setDescription('Toggle your @PVP role on or off.')
    .addBooleanOption(opt =>
      opt.setName('silent').setDescription('Add/remove quietly without an announcement').setRequired(false)
    ),

  async execute(interaction) {
    const silent  = interaction.options.getBoolean('silent') ?? false;
    const member  = interaction.member;
    const pvpRole = await getPvpRole(interaction.guild);

    if (!pvpRole) {
      return interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: `❌ Could not find a role named **${getPvpRoleName()}**. Ask an admin to create it or set \`PVP_ROLE\` in env.`,
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const hasRole = member.roles.cache.has(pvpRole.id);
    if (hasRole) {
      await member.roles.remove(pvpRole);
      await interaction.editReply(`↩️ Your **${pvpRole.name}** role has been removed. You can rejoin anytime.`);
    } else {
      await member.roles.add(pvpRole);
      if (!silent) {
        const ch = await getPvpTarget(interaction.client) || interaction.channel;
        await ch.send({
          content: `<@&${pvpRole.id}>`,
          embeds: [buildAnnouncementEmbed(member)],
          components: [buildRoleRow()],
        });
      }
      await interaction.editReply(`✅ You now have the **${pvpRole.name}** role! ${silent ? '(quietly added)' : 'AWROOOOOO!'}`);
    }
  },

  // Exported helpers for button handler in index.js
  buildAnnouncementEmbed,
  buildRoleRow,
  getPvpRole,
  getPvpRoleName,
};
