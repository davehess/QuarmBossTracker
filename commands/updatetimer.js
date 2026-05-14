// commands/updatetimer.js
// /updatetimer <boss> <timeleft>
// timeleft formats:
//   Short: "3d4h", "2h30m", "1d4h30m20s"
//   Long:  "3 days, 4 hours, 30 minutes, and 20 seconds"
//   Also handles PQDI lockout output: "Expires in 1 Day, 4 Hours, 55 Minutes, and 38 Seconds"

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { getBossState, overrideTimer, getAllState, getZoneCard, setZoneCard } = require('../utils/state');
const { postKillUpdate } = require('../utils/killops');
const { hasAllowedRole, allowedRolesList } = require('../utils/roles');
const { getThreadId, getBossExpansion, isPopLocked } = require('../utils/config');
const { buildZoneKillCard } = require('../utils/embeds');
const { discordAbsoluteTime, discordRelativeTime, parseTimeString } = require('../utils/timer');

function getBosses() {
  delete require.cache[require.resolve('../data/bosses.json')];
  return require('../data/bosses.json');
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('updatetimer')
    .setDescription('Manually set the remaining spawn timer for a boss')
    .addStringOption((opt) =>
      opt.setName('boss').setDescription('Boss name').setRequired(true).setAutocomplete(true)
    )
    .addStringOption((opt) =>
      opt.setName('timeleft')
        .setDescription('Time remaining, e.g. "3d4h30m" or "3 days, 4 hours, 30 minutes"')
        .setRequired(true)
    ),

  async autocomplete(interaction) {
    const bosses  = getBosses();
    const focused = interaction.options.getFocused().toLowerCase().trim();
    const choices = bosses.filter((b) => !isPopLocked(b)).map((b) => ({
      name: `${b.name} (${b.zone})`, value: b.id,
      terms: [b.name.toLowerCase(), ...(b.nicknames || []).map((n) => n.toLowerCase())],
    }));
    await interaction.respond(
      choices.filter((c) => !focused || c.terms.some((t) => t.includes(focused)) || c.name.toLowerCase().includes(focused))
        .slice(0, 25).map(({ name, value }) => ({ name, value }))
    );
  },

  async execute(interaction) {
    if (!hasAllowedRole(interaction.member)) {
      return interaction.reply({ flags: MessageFlags.Ephemeral, content: `❌ You need one of these roles: ${allowedRolesList()}` });
    }

    const bosses   = getBosses();
    const bossId   = interaction.options.getString('boss');
    const timeStr  = interaction.options.getString('timeleft');
    const boss     = bosses.find((b) => b.id === bossId);
    if (!boss) return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Unknown boss.' });
    if (isPopLocked(boss)) return interaction.reply({ flags: MessageFlags.Ephemeral, content: '🔒 PoP bosses are not available until October 1, 2026.' });

    const existing = getBossState(bossId);
    if (!existing) {
      return interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: `⬜ **${boss.name}** has no kill recorded. Use /kill first, then /updatetimer to correct the timer.`,
      });
    }

    const remainingMs = parseTimeString(timeStr);
    if (!remainingMs || remainingMs <= 0) {
      return interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: `❌ Could not parse time: \`${timeStr}\`\nExamples: \`3d4h30m\`, \`1 day, 4 hours, 55 minutes\`, \`Expires in 2 Hours, 30 Minutes\``,
      });
    }

    const newNextSpawn = Date.now() + remainingMs;
    overrideTimer(bossId, newNextSpawn);

    // Update zone card with corrected timer
    await postKillUpdate(interaction.client, process.env.TIMER_CHANNEL_ID, bossId);

    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      content: `⏱️ Timer updated for **${boss.name}**\n**New spawn:** ${discordAbsoluteTime(newNextSpawn)} (${discordRelativeTime(newNextSpawn)})`,
    });

    const { postAuditEntry } = require('../utils/audit');
    postAuditEntry(interaction.client, {
      action: 'updatetimer', userId: interaction.user.id, userName: interaction.user.username,
      bossId, bossName: boss.name, prevState: existing, newNextSpawn, msgLink: null,
    }).catch(() => {});
  },
};
