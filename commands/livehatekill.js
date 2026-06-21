// commands/livehatekill.js — Record a Plane of Hate mini-boss kill on the live server.
// 72-hour exact timer, no variance. Posts to LIVE_CHANNEL_ID.
//
// Supabase-backed via utils/hateKills since 2026-06-21.

const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { hasAllowedRole, allowedRolesList } = require('../utils/roles');
const { discordAbsoluteTime, discordRelativeTime, parseTimeString } = require('../utils/timer');
const { refreshHateBoard, invalidateSpotStateCache } = require('../utils/hateBoard');
const hateKills = require('../utils/hateKills');
const { HATE_SPOTS } = require('../data/hate-spots');

const HATE_TIMER_HOURS = hateKills.HATE_TIMER_HOURS;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('livehatekill')
    .setDescription('Record a Plane of Hate mini-boss kill (live server). 72h exact timer. (Pack Member+)')
    .addIntegerOption(opt =>
      opt.setName('position')
        .setDescription('Spawn point number (1, 2, 3, 5, 7, 8, 9, 10, 11, 12)')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(12)
    )
    .addBooleanOption(opt =>
      opt.setName('timer_unknown')
        .setDescription('Timer unknown — mark as killed but check manually for respawn')
        .setRequired(false)
    )
    .addStringOption(opt =>
      opt.setName('killed_ago')
        .setDescription('How long ago it was killed, e.g. "2h30m" or "45m" (back-dates the kill time)')
        .setRequired(false)
    ),

  async execute(interaction) {
    if (!hasAllowedRole(interaction.member))
      return interaction.reply({ flags: MessageFlags.Ephemeral, content: `❌ You need one of these roles: ${allowedRolesList()}` });

    const position     = interaction.options.getInteger('position');
    const timerUnknown = interaction.options.getBoolean('timer_unknown') ?? false;
    const killedAgoStr = interaction.options.getString('killed_ago') ?? null;
    const spot         = HATE_SPOTS[position];
    if (!spot)
      return interaction.reply({ flags: MessageFlags.Ephemeral, content: `❌ Invalid position. Valid spots: 1, 2, 3, 5, 7, 8, 9, 10, 11, 12.` });

    let killedAtMs = Date.now();
    if (killedAgoStr) {
      const agoMs = parseTimeString(killedAgoStr);
      if (agoMs === null)
        return interaction.reply({ flags: MessageFlags.Ephemeral, content: `❌ Could not parse \`killed_ago\` — use a format like "2h30m" or "45m".` });
      killedAtMs = Date.now() - agoMs;
    }

    const existing = (await hateKills.getSpotStateForServer('live'))[position];
    if (existing && (existing.timer_unknown ||
        (existing.next_spawn_latest && Date.parse(existing.next_spawn_latest) > Date.now()))) {
      const status = existing.timer_unknown
        ? 'timer unknown — check manually'
        : `spawns ${discordRelativeTime(Date.parse(existing.next_spawn_earliest))}`;
      return interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: `⚠️ **${spot.label}** is already recorded — ${status}. Use the board's Confirm Available flow if it really respawned.`,
      });
    }

    const row = await hateKills.recordHateKill({
      server:              'live',
      spotNum:             position,
      killedAtMs,
      timerUnknown,
      source:              'manual_slash',
      recordedByDiscordId: interaction.user.id,
    });
    if (!row) {
      return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Could not record kill (Supabase unreachable or misconfigured).' });
    }
    invalidateSpotStateCache('live');

    let embed, replyText;
    if (timerUnknown) {
      embed = new EmbedBuilder()
        .setColor(0x808080)
        .setTitle(`❓ Hate Mini Kill — ${spot.label} (Timer Unknown)`)
        .addFields(
          { name: 'Location',  value: spot.desc,                   inline: true },
          { name: 'Killed by', value: `<@${interaction.user.id}>`, inline: true },
          { name: 'Timer',     value: 'Unknown',                   inline: true },
          { name: 'Status',    value: 'Respawn time unknown. Check manually and click below when the mob is available.', inline: false },
        )
        .setTimestamp();
      replyText = `✅ Hate mini kill recorded at **${spot.label}** (timer unknown).`;
    } else {
      const earliestMs = Date.parse(row.next_spawn_earliest);
      embed = new EmbedBuilder()
        .setColor(0x9b59b6)
        .setTitle(`☠️ Hate Mini Kill — ${spot.label}`)
        .addFields(
          { name: 'Location',   value: spot.desc,                   inline: true },
          { name: 'Killed by',  value: `<@${interaction.user.id}>`, inline: true },
          { name: 'Timer',      value: `${HATE_TIMER_HOURS}h`,       inline: true },
          { name: 'Next Spawn', value: `${discordAbsoluteTime(earliestMs)} (${discordRelativeTime(earliestMs)})`, inline: false },
        )
        .setTimestamp();
      replyText = `✅ Hate mini kill recorded at **${spot.label}** — spawns ${discordRelativeTime(earliestMs)}.`;
    }

    const channelId = process.env.LIVE_CHANNEL_ID;
    if (channelId) {
      try {
        const ch      = await interaction.client.channels.fetch(channelId);
        const payload = { embeds: [embed] };
        if (timerUnknown) {
          payload.components = [new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`mark_avail:live:${position}`)
              .setLabel('✅ Mob is Available')
              .setStyle(ButtonStyle.Success)
          )];
        }
        const msg = await ch.send(payload);
        await hateKills.setThreadMessageId(row.id, msg.id);
      } catch (err) { console.warn('[livehatekill]', err?.message); }
    }

    refreshHateBoard(interaction.client, 'live').catch(err => console.warn('[livehatekill] refreshHateBoard:', err?.message));
    await interaction.reply({ flags: MessageFlags.Ephemeral, content: replyText });
  },
};
