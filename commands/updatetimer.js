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
const { getThreadId, getBossExpansion } = require('../utils/config');
const { buildZoneKillCard } = require('../utils/embeds');
const { discordAbsoluteTime, discordRelativeTime } = require('../utils/timer');

function getBosses() {
  delete require.cache[require.resolve('../data/bosses.json')];
  return require('../data/bosses.json');
}

/**
 * Parse a time string into milliseconds.
 * Supports:
 *   "3d4h30m20s"
 *   "3 days, 4 hours, 30 minutes, and 20 seconds"
 *   "Expires in 3 Days, 4 Hours, 30 Minutes, and 20 Seconds"
 *   "3d" "4h" "30m" "20s"
 */
function parseTimeString(input) {
  const s = input.replace(/expires\s+in\s*/i, '').replace(/,?\s*and\s*/gi, ' ').trim();

  const patterns = [
    { re: /(\d+)\s*(?:d(?:ay)?s?)/i,    mult: 86400000 },
    { re: /(\d+)\s*(?:h(?:our)?s?)/i,   mult: 3600000  },
    { re: /(\d+)\s*(?:m(?:in(?:ute)?)?s?)/i, mult: 60000 },
    { re: /(\d+)\s*(?:s(?:ec(?:ond)?)?s?)/i, mult: 1000  },
  ];

  let totalMs = 0;
  let matched = false;

  for (const { re, mult } of patterns) {
    const m = s.match(re);
    if (m) { totalMs += parseInt(m[1]) * mult; matched = true; }
  }

  return matched ? totalMs : null;
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
    const choices = bosses.map((b) => ({
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
  },
};
