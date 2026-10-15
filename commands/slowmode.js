// commands/slowmode.js — /slowmode on | off | status (officers).
//
// Guild-instance "slow mode" (the guild lead, 2026-10-11 and 2026-10-14): while it is on, every boss we
// kill respawns in 18h, whatever its usual timer. The rule and the stored switch live in
// utils/slowMode.js; this command only flips it and reports. The switch turns itself off 8 hours after
// it goes on, and the server's own Druzzil Ro guild lines turn it on and off (reported by agents).

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { hasOfficerRole, officerRolesList } = require('../utils/roles');
const { discordAbsoluteTime } = require('../utils/timer');
const slowMode = require('../utils/slowMode');

function statusText() {
  const flag = slowMode.getSlowMode();
  const names = 'every boss we kill in our instances (18h)';
  if (!flag) return `🐢 Slow mode: **off** (never set).\nAffected: ${names}`;
  const now = Date.now();
  const on = slowMode.slowModeOnAt(now);
  const lines = [`🐢 Slow mode: **${on ? 'ON' : 'off'}**`];
  const who = /^\d{17,20}$/.test(String(flag.set_by)) ? `<@${flag.set_by}>` : (flag.set_by || 'unknown');
  lines.push(`Turned on by ${who} at ${discordAbsoluteTime(Date.parse(flag.set_at))}`);
  if (on) lines.push(`Switches itself off ${discordAbsoluteTime(Date.parse(flag.auto_off_at))}`);
  else if (flag.off_at) lines.push(`Turned off at ${discordAbsoluteTime(Date.parse(flag.off_at))}`);
  else lines.push(`Switched itself off at ${discordAbsoluteTime(Date.parse(flag.auto_off_at))}`);
  lines.push(`Affected: ${names}`);
  return lines.join('\n');
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('slowmode')
    .setDescription('Officers: guild-instance slow mode (every boss we kill respawns in 18h)')
    .addStringOption((opt) =>
      opt.setName('action').setDescription('on, off, or status').setRequired(true)
        .addChoices(
          { name: 'on', value: 'on' },
          { name: 'off', value: 'off' },
          { name: 'status', value: 'status' },
        )),

  async execute(interaction) {
    if (!interaction.member || !hasOfficerRole(interaction.member)) {
      return interaction.reply({ flags: MessageFlags.Ephemeral, content: `❌ Officers only: ${officerRolesList()}` });
    }
    const action = interaction.options.getString('action');

    if (action === 'status') {
      return interaction.reply({ flags: MessageFlags.Ephemeral, content: statusText() });
    }

    const on = action === 'on';
    const { persisted } = await slowMode.setSlowMode(on, interaction.user.id);
    const warn = persisted ? '' : '\n⚠ Could not save it to the database, so it will not survive a bot restart.';
    await interaction.reply({ flags: MessageFlags.Ephemeral, content: `${statusText()}${warn}` });
    if (on) {
      await slowMode.announce(interaction.client,
        '🐢 Slow mode is on — every boss we kill in our instances respawns in 18h. It switches itself off in 8 hours.');
    }
  },
};
