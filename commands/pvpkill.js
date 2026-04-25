// commands/pvpkill.js — Record a PVP mob kill with a respawn timer.

const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { hasAllowedRole, allowedRolesList } = require('../utils/roles');
const { recordPvpKill, getAllPvpKills, pvpMobKey } = require('../utils/state');
const { discordAbsoluteTime, discordRelativeTime } = require('../utils/timer');

const DEFAULT_TIMER_HOURS = parseFloat(process.env.PVP_DEFAULT_TIMER_HOURS || '72');

async function getPvpChannel(client) {
  // Prefer explicit PVP_CHANNEL_ID, then fall back to searching for #pvp
  if (process.env.PVP_CHANNEL_ID) {
    try { return await client.channels.fetch(process.env.PVP_CHANNEL_ID); } catch { /* fall through */ }
  }
  // Return null — caller must fall back to interaction channel
  return null;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('pvpkill')
    .setDescription('Record a PVP mob kill and start its respawn timer.')
    .addStringOption(opt => opt.setName('mob').setDescription('Mob name').setRequired(true))
    .addNumberOption(opt => opt.setName('timer_hours').setDescription(`Respawn timer in hours (default: ${DEFAULT_TIMER_HOURS})`).setRequired(false).setMinValue(0.1)),

  async execute(interaction) {
    if (!hasAllowedRole(interaction.member))
      return interaction.reply({ flags: MessageFlags.Ephemeral, content: `❌ You need one of these roles: ${allowedRolesList()}` });

    const name       = interaction.options.getString('mob').trim();
    const timer      = interaction.options.getNumber('timer_hours') ?? DEFAULT_TIMER_HOURS;
    const key        = pvpMobKey(name);

    // Check for duplicate
    const existing = getAllPvpKills()[key];
    if (existing && existing.nextSpawn > Date.now()) {
      return interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: `⚠️ **${existing.name}** is already tracked — spawns ${discordRelativeTime(existing.nextSpawn)}.`,
      });
    }

    recordPvpKill(name, timer, interaction.user.id);
    const entry = getAllPvpKills()[key];

    const embed = new EmbedBuilder()
      .setColor(0xcc0000)
      .setTitle(`🗡️ PVP Kill — ${name}`)
      .addFields(
        { name: 'Killed by', value: `<@${interaction.user.id}>`, inline: true },
        { name: 'Timer', value: `${timer}h`, inline: true },
        { name: 'Next Spawn', value: `${discordAbsoluteTime(entry.nextSpawn)} (${discordRelativeTime(entry.nextSpawn)})`, inline: false },
      )
      .setTimestamp();

    // Post to PVP channel/thread if configured, otherwise reply publicly
    const pvpChannelId = process.env.PVP_CHANNEL_ID;
    const pvpThreadId  = process.env.PVP_THREAD_ID;
    const targetId     = pvpThreadId || pvpChannelId;

    if (targetId) {
      try {
        const ch = await interaction.client.channels.fetch(targetId);
        await ch.send({ embeds: [embed] });
        await interaction.reply({ flags: MessageFlags.Ephemeral, content: `✅ PVP kill recorded for **${name}**.` });
        return;
      } catch { /* fall through to channel reply */ }
    }

    await interaction.reply({ embeds: [embed] });
  },
};
