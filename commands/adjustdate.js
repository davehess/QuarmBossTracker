// commands/adjustdate.js — Move the date of an existing announce event.
// Must be run inside the announce thread.

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { hasAllowedRole, allowedRolesList } = require('../utils/roles');
const {
  getAnnounceByThreadId, updateAnnounceTime, getAnnounce,
} = require('../utils/state');
const { parseUserTime, formatInDefaultTz, getDefaultTz, localToUTC } = require('../utils/timezone');
const { buildControlPanelEmbed, buildTargetButtons, buildCancelRow } = require('./announce');

function getBosses() {
  delete require.cache[require.resolve('../data/bosses.json')];
  return require('../data/bosses.json');
}

/** Parse a date-only string ("Friday", "4/30", "tomorrow") and merge with existing time components */
function parseDateOnly(dateStr, existingTimeMs, tz) {
  // Rebuild the time string by combining the date part with the existing hour:minute
  const existing = new Date(existingTimeMs);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour: 'numeric', minute: 'numeric', hour12: true,
  }).formatToParts(existing);
  const pObj = Object.fromEntries(parts.map(p => [p.type, p.value]));
  const timeComponent = `${pObj.hour}:${pObj.minute} ${pObj.dayperiod}`;
  return parseUserTime(`${dateStr} ${timeComponent}`);
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
  } catch (err) { console.warn('adjustdate: could not update control panel:', err?.message); }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('adjustdate')
    .setDescription('Move the date of a planned raid event. Run inside the announce thread.')
    .addStringOption(opt => opt.setName('date').setDescription('New date, e.g. "Friday", "tomorrow", "4/30"').setRequired(true)),

  async execute(interaction) {
    if (!hasAllowedRole(interaction.member))
      return interaction.reply({ flags: MessageFlags.Ephemeral, content: `❌ You need one of these roles: ${allowedRolesList()}` });

    const announce = getAnnounceByThreadId(interaction.channel.id);
    if (!announce)
      return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ This command must be used inside a raid announce thread.' });

    const dateStr  = interaction.options.getString('date');
    const tz       = getDefaultTz();
    const newStart = parseDateOnly(dateStr, announce.plannedTimeMs, tz);
    if (!newStart || isNaN(newStart.getTime()))
      return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Could not parse that date. Try "Friday", "tomorrow", "4/30".' });

    const newEnd     = new Date(newStart.getTime() + 2 * 3600000);
    const newTimeStr = formatInDefaultTz(newStart);
    updateAnnounceTime(announce.messageId, newStart.getTime(), newTimeStr);

    // Update Discord event
    if (announce.eventId) {
      try {
        const event = await interaction.guild.scheduledEvents.fetch(announce.eventId);
        await event.edit({ scheduledStartTime: newStart, scheduledEndTime: newEnd });
      } catch (err) { console.warn('adjustdate: could not update Discord event:', err?.message); }
    }

    const bosses       = getBosses();
    const freshAnnounce = { ...getAnnounce(announce.messageId), messageId: announce.messageId };
    await updateControlPanel(interaction.channel, freshAnnounce, bosses);

    await interaction.reply({ flags: MessageFlags.Ephemeral, content: `✅ Event date updated — new time: **${newTimeStr}**.` });
  },
};
