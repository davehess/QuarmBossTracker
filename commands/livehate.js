// commands/livehate.js — List current Plane of Hate mini-boss spawn status (live server).

const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { hasAllowedRole, allowedRolesList } = require('../utils/roles');
const { getAllLiveKills } = require('../utils/state');
const { discordAbsoluteTime, discordRelativeTime } = require('../utils/timer');
const { HATE_SPOTS, HATE_AREA_GROUPS } = require('../data/hate-spots');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('livehate')
    .setDescription('Show Plane of Hate mini-boss spawn status (live server). (Pack Member+)'),

  async execute(interaction) {
    if (!hasAllowedRole(interaction.member))
      return interaction.reply({ flags: MessageFlags.Ephemeral, content: `❌ You need one of these roles: ${allowedRolesList()}` });

    const kills = getAllLiveKills();
    const now   = Date.now();

    const embed = new EmbedBuilder()
      .setColor(0x9b59b6)
      .setTitle('☠️ Plane of Hate — Live Server Mini-Boss Status')
      .setDescription('72h respawn timer · Use `/livehatekill <position>` to record a kill')
      .setTimestamp();

    for (const group of HATE_AREA_GROUPS) {
      const lines = group.spots.map(n => {
        const key   = `hate_${n}`;
        const spot  = HATE_SPOTS[n];
        const entry = kills[key];

        let status;
        if (!entry) {
          status = '🟢 **Available**';
        } else if (entry.timerUnknown) {
          status = '❓ **Timer Unknown** — check manually';
        } else if (entry.nextSpawn <= now) {
          status = '🟢 **Available** (timer expired)';
        } else {
          status = `⏰ ${discordAbsoluteTime(entry.nextSpawn)} (${discordRelativeTime(entry.nextSpawn)})`;
        }

        return `**#${n} — ${spot.label.replace(/^Spot \d+ — /, '')}**\n↳ ${spot.desc}\n↳ ${status}`;
      });

      embed.addFields({ name: group.name, value: lines.join('\n\n'), inline: false });
    }

    await interaction.reply({ embeds: [embed] });
  },
};
