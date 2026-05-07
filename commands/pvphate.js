// commands/pvphate.js — List current Plane of Hate mini-boss spawn status (PVP server).

const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { hasAllowedRole, allowedRolesList } = require('../utils/roles');
const { getAllPvpKills } = require('../utils/state');
const { discordAbsoluteTime, discordRelativeTime } = require('../utils/timer');
const { HATE_SPOTS, HATE_AREA_GROUPS } = require('../data/hate-spots');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('pvphate')
    .setDescription('Show Plane of Hate mini-boss spawn status (PVP server). (Pack Member+)'),

  async execute(interaction) {
    if (!hasAllowedRole(interaction.member))
      return interaction.reply({ flags: MessageFlags.Ephemeral, content: `❌ You need one of these roles: ${allowedRolesList()}` });

    const kills = getAllPvpKills();
    const now   = Date.now();

    const embed = new EmbedBuilder()
      .setColor(0xcc0000)
      .setTitle('🗡️ Plane of Hate — PVP Server Mini-Boss Status')
      .setDescription('72h base timer ±20% variance · Use `/pvphatekill <position>` to record a kill')
      .setTimestamp();

    for (const group of HATE_AREA_GROUPS) {
      const lines = group.spots.map(n => {
        const key   = `hate_pvp_${n}`;
        const spot  = HATE_SPOTS[n];
        const entry = kills[key];

        let status;
        if (!entry) {
          status = '🟢 **Available**';
        } else if (entry.timerUnknown) {
          status = '❓ **Timer Unknown** — check manually';
        } else if (entry.nextSpawnLatest && entry.nextSpawnLatest <= now) {
          status = '🟢 **Available** (window fully open)';
        } else if (entry.nextSpawn <= now) {
          status = `🟡 **Window Open** — spawns until ${discordAbsoluteTime(entry.nextSpawnLatest)} (${discordRelativeTime(entry.nextSpawnLatest)})`;
        } else {
          status = `⏰ Earliest: ${discordAbsoluteTime(entry.nextSpawn)} (${discordRelativeTime(entry.nextSpawn)}) · Latest: ${discordRelativeTime(entry.nextSpawnLatest)}`;
        }

        return `**#${n} — ${spot.label.replace(/^Spot \d+ — /, '')}**\n↳ ${spot.desc}\n↳ ${status}`;
      });

      embed.addFields({ name: group.name, value: lines.join('\n\n'), inline: false });
    }

    await interaction.reply({ embeds: [embed] });
  },
};
