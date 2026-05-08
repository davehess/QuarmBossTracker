// commands/pvphatekill.js — Record a Plane of Hate mini-boss kill on the PVP server.
// 72-hour base timer with ±20% variance. Posts to PVP_KILLS_THREAD_ID.

const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { hasAllowedRole, allowedRolesList } = require('../utils/roles');
const { recordPvpKill, getAllPvpKills, setPvpKillThreadMessageId } = require('../utils/state');
const { discordAbsoluteTime, discordRelativeTime, parseTimeString } = require('../utils/timer');
const { refreshHateBoard } = require('../utils/hateBoard');

const HATE_TIMER_HOURS = 72;
const { HATE_SPOTS, VALID_HATE_SPOTS } = require('../data/hate-spots');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('pvphatekill')
    .setDescription('Record a Plane of Hate mini-boss kill (PVP server). 72h ±20% variance. (Pack Member+)')
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

    let killedAt = null;
    if (killedAgoStr) {
      const agoMs = parseTimeString(killedAgoStr);
      if (agoMs === null)
        return interaction.reply({ flags: MessageFlags.Ephemeral, content: `❌ Could not parse \`killed_ago\` — use a format like "2h30m" or "45m".` });
      killedAt = Date.now() - agoMs;
    }
    if (!spot)
      return interaction.reply({ flags: MessageFlags.Ephemeral, content: `❌ Invalid position. Valid spots: 1, 2, 3, 5, 7, 8, 9, 10, 11, 12.` });

    const key      = `hate_pvp_${position}`;
    const spotName = `Hate Mini — ${spot.label}`;
    const existing = getAllPvpKills()[key];

    if (existing && (existing.timerUnknown || existing.nextSpawn > Date.now())) {
      const status = existing.timerUnknown
        ? 'timer unknown — check manually'
        : `earliest spawn ${discordRelativeTime(existing.nextSpawn)}`;
      return interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: `⚠️ **${spot.label}** is already recorded — ${status}.`,
      });
    }

    recordPvpKill(spotName, HATE_TIMER_HOURS, interaction.user.id, key, timerUnknown, killedAt);
    const entry = getAllPvpKills()[key];

    let embed, replyText;
    if (timerUnknown) {
      embed = new EmbedBuilder()
        .setColor(0x808080)
        .setTitle(`❓ Hate Mini PVP Kill — ${spot.label} (Timer Unknown)`)
        .addFields(
          { name: 'Location',  value: spot.desc,                   inline: true },
          { name: 'Killed by', value: `<@${interaction.user.id}>`, inline: true },
          { name: 'Timer',     value: 'Unknown',                   inline: true },
          { name: 'Status',    value: 'Respawn time unknown. Check manually and click below when the mob is available.', inline: false },
        )
        .setTimestamp();
      replyText = `✅ PVP Hate kill recorded at **${spot.label}** (timer unknown).`;
    } else {
      embed = new EmbedBuilder()
        .setColor(0xcc0000)
        .setTitle(`🗡️ Hate Mini PVP Kill — ${spot.label}`)
        .addFields(
          { name: 'Location',    value: spot.desc,                   inline: true },
          { name: 'Killed by',   value: `<@${interaction.user.id}>`, inline: true },
          { name: 'Base Timer',  value: `${HATE_TIMER_HOURS}h (±20%)`, inline: true },
          { name: '⏰ Earliest Spawn',
            value: `${discordAbsoluteTime(entry.nextSpawn)} (${discordRelativeTime(entry.nextSpawn)})`,
            inline: false },
          { name: '⏳ Latest Spawn',
            value: `${discordAbsoluteTime(entry.nextSpawnLatest)} (${discordRelativeTime(entry.nextSpawnLatest)}) — guaranteed by this time`,
            inline: false },
        )
        .setTimestamp();
      replyText = `✅ PVP Hate kill recorded at **${spot.label}**.\nEarliest spawn: ${discordRelativeTime(entry.nextSpawn)} · Latest: ${discordRelativeTime(entry.nextSpawnLatest)}`;
    }

    const killsThreadId = process.env.PVP_KILLS_THREAD_ID;
    if (killsThreadId) {
      try {
        const thread  = await interaction.client.channels.fetch(killsThreadId);
        const payload = { embeds: [embed] };
        if (timerUnknown) {
          payload.components = [new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`mark_avail:pvp:${key}`)
              .setLabel('✅ Mob is Available')
              .setStyle(ButtonStyle.Success)
          )];
        }
        const msg = await thread.send(payload);
        setPvpKillThreadMessageId(key, msg.id);
      } catch (err) { console.warn('[pvphatekill]', err?.message); }
    }

    refreshHateBoard(interaction.client, 'pvp').catch(err => console.warn('[pvphatekill] refreshHateBoard:', err?.message));
    await interaction.reply({ flags: MessageFlags.Ephemeral, content: replyText });
  },
};
