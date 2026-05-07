// commands/livehatekill.js — Record a Plane of Hate mini-boss kill on the live server.
// 72-hour exact timer, no variance. Posts to LIVE_CHANNEL_ID.

const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { hasAllowedRole, allowedRolesList } = require('../utils/roles');
const { recordLiveKill, getAllLiveKills, setLiveKillMessageId } = require('../utils/state');
const { discordAbsoluteTime, discordRelativeTime } = require('../utils/timer');
const { refreshHateBoard } = require('../utils/hateBoard');

const HATE_TIMER_HOURS = 72;
const { HATE_SPOTS } = require('../data/hate-spots');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('livehatekill')
    .setDescription('Record a Plane of Hate mini-boss kill (live server). 72h exact timer. (Pack Member+)')
    .addIntegerOption(opt =>
      opt.setName('position')
        .setDescription('Spawn point number (1–12)')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(12)
    )
    .addBooleanOption(opt =>
      opt.setName('timer_unknown')
        .setDescription('Timer unknown — mark as killed but check manually for respawn')
        .setRequired(false)
    ),

  async execute(interaction) {
    if (!hasAllowedRole(interaction.member))
      return interaction.reply({ flags: MessageFlags.Ephemeral, content: `❌ You need one of these roles: ${allowedRolesList()}` });

    const position     = interaction.options.getInteger('position');
    const timerUnknown = interaction.options.getBoolean('timer_unknown') ?? false;
    const spot         = HATE_SPOTS[position];
    if (!spot)
      return interaction.reply({ flags: MessageFlags.Ephemeral, content: `❌ Invalid position. Use 1–12.` });

    const key      = `hate_${position}`;
    const spotName = `Hate Mini — ${spot.label}`;
    const existing = getAllLiveKills()[key];

    if (existing && (existing.timerUnknown || existing.nextSpawn > Date.now())) {
      const status = existing.timerUnknown
        ? 'timer unknown — check manually'
        : `spawns ${discordRelativeTime(existing.nextSpawn)}`;
      return interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: `⚠️ **${spot.label}** is already recorded — ${status}.`,
      });
    }

    recordLiveKill(key, spotName, HATE_TIMER_HOURS, interaction.user.id, timerUnknown);
    const entry = getAllLiveKills()[key];

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
      embed = new EmbedBuilder()
        .setColor(0x9b59b6)
        .setTitle(`☠️ Hate Mini Kill — ${spot.label}`)
        .addFields(
          { name: 'Location',   value: spot.desc,                   inline: true },
          { name: 'Killed by',  value: `<@${interaction.user.id}>`, inline: true },
          { name: 'Timer',      value: `${HATE_TIMER_HOURS}h`,       inline: true },
          { name: 'Next Spawn', value: `${discordAbsoluteTime(entry.nextSpawn)} (${discordRelativeTime(entry.nextSpawn)})`, inline: false },
        )
        .setTimestamp();
      replyText = `✅ Hate mini kill recorded at **${spot.label}** — spawns ${discordRelativeTime(entry.nextSpawn)}.`;
    }

    const channelId = process.env.LIVE_CHANNEL_ID;
    if (channelId) {
      try {
        const ch      = await interaction.client.channels.fetch(channelId);
        const payload = { embeds: [embed] };
        if (timerUnknown) {
          payload.components = [new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`mark_avail:live:${key}`)
              .setLabel('✅ Mob is Available')
              .setStyle(ButtonStyle.Success)
          )];
        }
        const msg = await ch.send(payload);
        setLiveKillMessageId(key, msg.id);
      } catch (err) { console.warn('[livehatekill]', err?.message); }
    }

    refreshHateBoard(interaction.client, 'live').catch(err => console.warn('[livehatekill] refreshHateBoard:', err?.message));
    await interaction.reply({ flags: MessageFlags.Ephemeral, content: replyText });
  },
};
