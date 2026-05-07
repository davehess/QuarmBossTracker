// commands/pvphatekill.js — Record a Plane of Hate mini-boss kill on the PVP server.
// 72-hour base timer with ±20% variance. Posts to PVP_KILLS_THREAD_ID.

const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { hasAllowedRole, allowedRolesList } = require('../utils/roles');
const { recordPvpKill, getAllPvpKills, setPvpKillThreadMessageId } = require('../utils/state');
const { discordAbsoluteTime, discordRelativeTime } = require('../utils/timer');

const HATE_TIMER_HOURS = 72;

const HATE_SPOTS = {
  1:  { label: 'Spot 1 — Organ Hall Upper',        desc: 'First floor, Organ Hall (upstairs)' },
  2:  { label: 'Spot 2 — Organ Hall West',         desc: 'First floor, Organ Hall (west)' },
  3:  { label: 'Spot 3 — East Building Upper',     desc: 'First floor, East Building (upstairs)' },
  4:  { label: 'Spot 4 — East Building Lower',     desc: 'First floor, East Building (lower)' },
  5:  { label: 'Spot 5 — Church Middle Upper',     desc: 'First floor, Church (upstairs middle, 2nd floor)' },
  6:  { label: 'Spot 6 — Church Pathing',          desc: 'First floor, Church (pathing)' },
  7:  { label: 'Spot 7 — Church South Lower',      desc: 'First floor, Church (downstairs south)' },
  8:  { label: 'Spot 8 — Church South Upper',      desc: 'First floor, Church (upstairs south, 2nd floor)' },
  9:  { label: 'Spot 9 — Church West Upper',       desc: 'First floor, Church (upstairs west)' },
  10: { label: 'Spot 10 — 2F North Spawn',         desc: 'Second floor, North spawn' },
  11: { label: 'Spot 11 — 2F East Spawn',          desc: 'Second floor, East spawn' },
  12: { label: 'Spot 12 — 2F South Spawn',         desc: 'Second floor, South spawn' },
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('pvphatekill')
    .setDescription('Record a Plane of Hate mini-boss kill (PVP server). 72h ±20% variance. (Pack Member+)')
    .addIntegerOption(opt =>
      opt.setName('position')
        .setDescription('Spawn point number (1–12)')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(12)
    ),

  async execute(interaction) {
    if (!hasAllowedRole(interaction.member))
      return interaction.reply({ flags: MessageFlags.Ephemeral, content: `❌ You need one of these roles: ${allowedRolesList()}` });

    const position = interaction.options.getInteger('position');
    const spot     = HATE_SPOTS[position];
    if (!spot)
      return interaction.reply({ flags: MessageFlags.Ephemeral, content: `❌ Invalid position. Use 1–12.` });

    const key      = `hate_pvp_${position}`;
    const spotName = `Hate Mini — ${spot.label}`;
    const existing = getAllPvpKills()[key];

    if (existing && existing.nextSpawn > Date.now()) {
      return interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: `⚠️ **${spot.label}** is already on timer — earliest spawn ${discordRelativeTime(existing.nextSpawn)}.`,
      });
    }

    // recordPvpKill applies ±20% variance and stores nextSpawn (earliest) + nextSpawnLatest
    recordPvpKill(spotName, HATE_TIMER_HOURS, interaction.user.id, key);
    const entry = getAllPvpKills()[key];

    const embed = new EmbedBuilder()
      .setColor(0xcc0000)
      .setTitle(`🗡️ Hate Mini PVP Kill — ${spot.label}`)
      .addFields(
        { name: 'Location',          value: spot.desc,                   inline: true },
        { name: 'Killed by',         value: `<@${interaction.user.id}>`, inline: true },
        { name: 'Base Timer',        value: `${HATE_TIMER_HOURS}h (±20%)`, inline: true },
        { name: '⏰ Earliest Spawn',
          value: `${discordAbsoluteTime(entry.nextSpawn)} (${discordRelativeTime(entry.nextSpawn)})`,
          inline: false },
        { name: '⏳ Latest Spawn',
          value: `${discordAbsoluteTime(entry.nextSpawnLatest)} (${discordRelativeTime(entry.nextSpawnLatest)}) — guaranteed by this time`,
          inline: false },
      )
      .setTimestamp();

    const killsThreadId = process.env.PVP_KILLS_THREAD_ID;
    if (killsThreadId) {
      try {
        const thread = await interaction.client.channels.fetch(killsThreadId);
        const msg    = await thread.send({ embeds: [embed] });
        setPvpKillThreadMessageId(key, msg.id);
      } catch (err) { console.warn('[pvphatekill]', err?.message); }
    }

    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      content: `✅ PVP Hate kill recorded at **${spot.label}**.\nEarliest spawn: ${discordRelativeTime(entry.nextSpawn)} · Latest: ${discordRelativeTime(entry.nextSpawnLatest)}`,
    });
  },
};
