// commands/raidbosshelp.js — Send usage instructions for the raid boss tracker bot.

const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { getAllowedRoles } = require('../utils/roles');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('raidbosshelp')
    .setDescription('Show how to use the Quarm Raid Timer bot.'),

  async execute(interaction) {
    const roles = getAllowedRoles().map(r => `**${r}**`).join(', ');

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('📖 Quarm Raid Timer Bot — Help')
      .setDescription(
        `This bot tracks instanced raid boss spawn timers for Project Quarm.\n` +
        `**Permitted roles:** ${roles}`
      )
      .addFields(
        {
          name: '⚔️ Kill Tracking',
          value: [
            '`/kill <boss>` — Record a boss kill and start the respawn timer',
            '`/unkill <boss>` — Remove a kill record (e.g. false report)',
            '`/updatetimer <boss> <time>` — Override the next-spawn timer (e.g. "3d4h30m")',
            '`/timers [zone] [filter]` — View all spawn timers; filter by zone or status',
          ].join('\n'),
          inline: false,
        },
        {
          name: '📣 Raid Announcements',
          value: [
            '`/announce boss:<name> time:<when>` — Announce a specific boss kill attempt',
            '`/announce zone:<zone> time:<when>` — Zone-wide announcement with target selection',
            '  Time formats: `"8:30 PM"`, `"Thursday 9pm"`, `"tomorrow 8pm"`, `"8:30 PM EST"`',
            '',
            'Inside the announce thread:',
            '`/addtarget <boss>` — Add a boss to the event\'s target list',
            '`/removetarget <boss>` — Remove a boss from the target list',
            '`/adjusttime <time>` — Change the event time',
            '`/adjustdate <date>` — Change the event date (e.g. "Friday", "4/30")',
            'Use the **Cancel Event** button to remove the event and archive the thread.',
          ].join('\n'),
          inline: false,
        },
        {
          name: '🗡️ PVP Tracking',
          value: [
            '`/pvpkill <mob> [timer_hours]` — Record a PVP mob kill with optional respawn timer',
            '`/pvpunkill <mob>` — Remove a PVP mob kill record',
            '`/quake [time]` — Set a quake time ("now" or a time string) to reset all PVP mob timers',
            '  Quake posts a 1-hour notice to the PVP channel and creates a Discord event.',
            '`/pvprole [silent]` — Toggle your @PVP role on or off; omit `silent` to announce in PVP channel',
            '`/pvpalert <zone>` — Ping @PVP and howl for the pack in a zone; others click 🐺 Howl! to join',
          ].join('\n'),
          inline: false,
        },
        {
          name: '🛠️ Admin / Setup',
          value: [
            '`/board` — Post or refresh all summary cards and expansion thread boards',
            '`/cleanup` — Remove duplicate or stale messages from all channels/threads',
            '`/restore <links...>` — Rebuild kill state from Active Cooldowns or Daily Summary messages',
            '`/addboss <pqdi_url>` — Add a new boss from PQDI.cc',
            '`/removeboss <boss>` — Remove a boss from the tracker',
          ].join('\n'),
          inline: false,
        },
        {
          name: '📋 Channel Layout',
          value: [
            '`#raid-mobs` — Main channel with Active Cooldowns, Spawning Tomorrow, Daily Summary',
            'Expansion threads — Kill buttons and per-zone cooldown cards',
            'Historic Kills thread — Archived daily summaries and cancelled announcements',
          ].join('\n'),
          inline: false,
        },
      )
      .setFooter({ text: 'Timer data sourced from PQDI.cc • Wolf Pack EQ (Quarm)' });

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
