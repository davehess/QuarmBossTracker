// commands/pvphate.js — List current Plane of Hate mini-boss spawn status (PVP server).
// Supabase-backed via utils/hateKills since 2026-06-21.

const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { hasAllowedRole, allowedRolesList } = require('../utils/roles');
const { discordAbsoluteTime, discordRelativeTime } = require('../utils/timer');
const { HATE_SPOTS, HATE_AREA_GROUPS } = require('../data/hate-spots');
const hateKills = require('../utils/hateKills');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('pvphate')
    .setDescription('Show Plane of Hate mini-boss spawn status (PVP server). (Pack Member+)'),

  async execute(interaction) {
    if (!hasAllowedRole(interaction.member))
      return interaction.reply({ flags: MessageFlags.Ephemeral, content: `❌ You need one of these roles: ${allowedRolesList()}` });

    const state = await hateKills.getSpotStateForServer('pvp');
    const now   = Date.now();

    const embed = new EmbedBuilder()
      .setColor(0xcc0000)
      .setTitle('🗡️ Plane of Hate — PVP Server Mini-Boss Status')
      .setDescription('72h base timer ±20% variance · Use `/pvphatekill <position>` to record a kill')
      .setTimestamp();

    for (const group of HATE_AREA_GROUPS) {
      const lines = group.spots.map(n => {
        const spot  = HATE_SPOTS[n];
        const entry = state[n];

        let status;
        if (!entry) {
          status = '🟢 **Available**';
        } else if (entry.timer_unknown) {
          status = '❓ **Timer Unknown** — check manually';
        } else {
          const earliestMs = Date.parse(entry.next_spawn_earliest);
          const latestMs   = Date.parse(entry.next_spawn_latest);
          if (latestMs && latestMs <= now) status = '🟢 **Available** (window fully open)';
          else if (earliestMs <= now)      status = `🟡 **Window Open** — spawns until ${discordAbsoluteTime(latestMs)} (${discordRelativeTime(latestMs)})`;
          else                             status = `⏰ Earliest: ${discordAbsoluteTime(earliestMs)} (${discordRelativeTime(earliestMs)}) · Latest: ${discordRelativeTime(latestMs)}`;
        }

        return `**#${n} — ${spot.label.replace(/^Spot \d+ — /, '')}**\n↳ ${spot.desc}\n↳ ${status}`;
      });

      embed.addFields({ name: group.name, value: lines.join('\n\n'), inline: false });
    }

    await interaction.reply({ embeds: [embed] });
  },
};
