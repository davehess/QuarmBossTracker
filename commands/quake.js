// commands/quake.js — Schedule or trigger an EQ quake that resets all PVP mob timers.
// Creates a Discord event, pings @PVP, and posts a 1-hour warning before the quake.

const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { hasAllowedRole, allowedRolesList } = require('../utils/roles');
const {
  getAllPvpKills, applyQuakeToAllPvpKills, saveQuake, clearQuake, getQuake,
} = require('../utils/state');
const { parseUserTime, formatInDefaultTz } = require('../utils/timezone');
const { discordAbsoluteTime, discordRelativeTime } = require('../utils/timer');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('quake')
    .setDescription('Schedule a quake event that resets all PVP mob respawn timers.')
    .addStringOption(opt => opt.setName('time').setDescription('"now" or a time string e.g. "Friday 9pm"').setRequired(true)),

  async execute(interaction) {
    if (!hasAllowedRole(interaction.member))
      return interaction.reply({ flags: MessageFlags.Ephemeral, content: `❌ You need one of these roles: ${allowedRolesList()}` });

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const timeStr = interaction.options.getString('time').trim();
    const isNow   = /^now$/i.test(timeStr);

    let quakeTime;
    if (isNow) {
      quakeTime = new Date();
    } else {
      quakeTime = parseUserTime(timeStr);
      if (!quakeTime || isNaN(quakeTime.getTime()))
        return interaction.editReply('❌ Could not parse that time. Try "now", "Friday 9pm", "8:30 PM EST", etc.');
    }

    const quakeTimeMs = quakeTime.getTime();
    const timeStr_    = formatInDefaultTz(quakeTime);
    const kills       = getAllPvpKills();
    const mobCount    = Object.keys(kills).length;

    // ── Apply quake to all existing PVP kills ─────────────────────────────
    if (mobCount > 0) {
      applyQuakeToAllPvpKills(quakeTimeMs);
    }

    // ── Create Discord event ──────────────────────────────────────────────
    let eventId = null, eventUrl = null;
    if (!isNow) {
      try {
        const eventEnd = new Date(quakeTimeMs + 30 * 60000); // 30min window
        const pvpChannelId = process.env.PVP_CHANNEL_ID;
        const event = await interaction.guild.scheduledEvents.create({
          name: '🌍 EQ Quake — PVP Reset',
          scheduledStartTime: quakeTime,
          scheduledEndTime:   eventEnd,
          privacyLevel: 2,
          entityType:   3,
          entityMetadata: { location: pvpChannelId ? `<#${pvpChannelId}>` : 'PVP Zone' },
          description: `An EverQuest quake will reset all PVP mob respawn timers.\nScheduled by ${interaction.user.username}`,
        });
        eventId  = event.id;
        eventUrl = `https://discord.com/events/${interaction.guildId}/${event.id}`;
      } catch (err) { console.warn('quake: could not create event:', err?.message); }
    }

    // ── Persist quake state (for 1-hour alert) ────────────────────────────
    if (!isNow) {
      saveQuake({ scheduledTime: quakeTimeMs, eventId, alertPosted: false, alertMessageId: null });
    } else {
      clearQuake();
    }

    // ── Build announcement embed ──────────────────────────────────────────
    const embed = new EmbedBuilder()
      .setColor(0xff4500)
      .setTitle(isNow ? '🌍 Quake! — PVP Mobs Resetting NOW' : '🌍 Quake Scheduled — PVP Reset')
      .setDescription(
        isNow
          ? `A quake is in progress! All PVP mob timers have been reset.`
          : `A quake has been scheduled for **${timeStr_}**.\nAll PVP mob respawn timers will reset at that time.`
      )
      .addFields(
        { name: 'Mobs Affected', value: mobCount > 0 ? `${mobCount} tracked mob(s) reset` : 'No mobs currently tracked', inline: true },
        { name: 'Scheduled By', value: `<@${interaction.user.id}>`, inline: true },
      );
    if (!isNow) embed.addFields({ name: 'Quake Time', value: `${discordAbsoluteTime(quakeTimeMs)} (${discordRelativeTime(quakeTimeMs)})`, inline: false });
    if (eventUrl) embed.addFields({ name: '📅 Event', value: `[Click Interested!](${eventUrl})`, inline: false });
    embed.setTimestamp();

    // ── Ping PVP role + post in PVP channel ──────────────────────────────
    const pvpRole     = process.env.PVP_ROLE || 'PVP';
    const roleObj     = interaction.guild.roles.cache.find(r => r.name === pvpRole);
    const roleMention = roleObj ? `<@&${roleObj.id}>` : null;

    const pvpTargetId = process.env.PVP_THREAD_ID || process.env.PVP_CHANNEL_ID;
    if (pvpTargetId) {
      try {
        const ch = await interaction.client.channels.fetch(pvpTargetId);
        await ch.send({
          content: roleMention ? `${roleMention} — Quake incoming!` : undefined,
          embeds: [embed],
        });
      } catch { /* non-critical */ }
    } else {
      // Fall back to the channel where the command was used
      await interaction.channel.send({
        content: roleMention ? `${roleMention} — Quake incoming!` : undefined,
        embeds: [embed],
      });
    }

    await interaction.editReply(`✅ Quake ${isNow ? 'applied' : 'scheduled for **' + timeStr_ + '**'} — ${mobCount} mob(s) updated.${eventUrl ? `\n📅 ${eventUrl}` : ''}`);
  },
};
