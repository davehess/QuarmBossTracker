// commands/adjusttime.js — Move the time of an existing announce event.
// Must be run inside the announce thread.

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { hasAllowedRole, allowedRolesList } = require('../utils/roles');
const {
  getAnnounceByThreadId, updateAnnounceTime, getAnnounce,
} = require('../utils/state');
const { parseUserTime, formatInDefaultTz } = require('../utils/timezone');
const { buildControlPanelEmbed, buildTargetButtons, buildCancelRow } = require('./announce');

function getBosses() {
  delete require.cache[require.resolve('../data/bosses.json')];
  return require('../data/bosses.json');
}

async function updateControlPanel(thread, announceData, bosses) {
  try {
    const msgs = await thread.messages.fetch({ limit: 20 });
    const cp = msgs.find(m =>
      m.author.bot && m.components.length > 0 &&
      m.embeds[0]?.title === '📋 Raid Targets'
    );
    if (!cp) return;
    const cpEmbed    = buildControlPanelEmbed(announceData.targets, bosses, announceData.zone, announceData.plannedTimeStr);
    const targetRows = buildTargetButtons(announceData.targets, bosses);
    const cancelRow  = buildCancelRow(announceData.messageId);
    await cp.edit({ embeds: [cpEmbed], components: [...targetRows, cancelRow] });
  } catch (err) { console.warn('adjusttime: could not update control panel:', err?.message); }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('adjusttime')
    .setDescription('Move the time of a planned raid event. Run inside the announce thread.')
    .addStringOption(opt => opt.setName('time').setDescription('New time, e.g. "9:30 PM", "Friday 8pm"').setRequired(true)),

  async execute(interaction) {
    if (!hasAllowedRole(interaction.member))
      return interaction.reply({ flags: MessageFlags.Ephemeral, content: `❌ You need one of these roles: ${allowedRolesList()}` });

    const announce = getAnnounceByThreadId(interaction.channel.id);
    if (!announce)
      return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ This command must be used inside a raid announce thread.' });

    const timeStr  = interaction.options.getString('time');
    const newStart = parseUserTime(timeStr);
    if (!newStart || isNaN(newStart.getTime()))
      return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Could not parse that time. Try "8:30 PM", "Friday 9pm", etc.' });

    const newEnd       = new Date(newStart.getTime() + 2 * 3600000);
    const newTimeStr   = formatInDefaultTz(newStart);
    updateAnnounceTime(announce.messageId, newStart.getTime(), newTimeStr);

    // Update Discord event
    if (announce.eventId) {
      try {
        const event = await interaction.guild.scheduledEvents.fetch(announce.eventId);
        await event.edit({ scheduledStartTime: newStart, scheduledEndTime: newEnd });
      } catch (err) { console.warn('adjusttime: could not update Discord event:', err?.message); }
    }

    // Update the control panel in this thread
    const bosses       = getBosses();
    const freshAnnounce = { ...getAnnounce(announce.messageId), messageId: announce.messageId };
    await updateControlPanel(interaction.channel, freshAnnounce, bosses);

    // Update the announce message in its original channel
    try {
      const ch  = await interaction.client.channels.fetch(announce.channelId);
      const msg = await ch.messages.fetch(announce.messageId);
      const embed = msg.embeds[0];
      if (embed) {
        const { EmbedBuilder } = require('discord.js');
        const updated = EmbedBuilder.from(embed).setDescription(
          embed.description.replace(/\*\*[^\*]+\*\* at \*\*[^\*]+\*\*/, `<@${announce.organizer}> is planning a pack takedown on **${announce.zone || 'raid'}** at **${newTimeStr}**.`)
        );
        await msg.edit({ embeds: [updated] });
      }
    } catch { /* non-critical */ }

    await interaction.reply({ flags: MessageFlags.Ephemeral, content: `✅ Event time updated to **${newTimeStr}**.` });
  },
};
