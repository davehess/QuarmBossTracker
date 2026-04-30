// commands/raidbosshelp.js — Full command reference for the raid boss tracker bot.
const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { getAllowedRoles } = require('../utils/roles');
const pkg = require('../package.json');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('raidbosshelp')
    .setDescription('Show all commands and usage for the Quarm Raid Tracker (ephemeral).'),

  async execute(interaction) {
    const roles = getAllowedRoles().map(r => `**${r}**`).join(', ');

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('📖 Quarm Raid Tracker — Command Reference')
      .setDescription(
        `This bot tracks instanced raid boss spawn timers for Project Quarm.\n` +
        `**Permitted roles:** ${roles}\n\n` +
        `Run \`/onboarding\` to see the welcome message or toggle your opt-out preference.`
      )
      .addFields(
        {
          name: '⚔️ Kill Tracking',
          value: [
            '`/kill <boss>` — Record a boss kill and start the respawn timer',
            '`/unkill <boss>` — Remove a kill record (e.g. false report)',
            '`/updatetimer <boss> <time>` — Override the next-spawn timer (e.g. `"3d4h30m"`)',
            '`/timers [zone] [filter]` — View all spawn timers; filter by zone or status',
          ].join('\n'),
          inline: false,
        },
        {
          name: '📊 Parse Tracking',
          value: [
            '`/parse <data>` — Submit an EQLogParser DPS parse (boss auto-detected from header)',
            '`/parseboss <boss> <data>` — Submit a parse with explicit boss selection',
            '`/parsestats <boss>` — DPS scoreboard and raidwide metrics for a boss across all kills',
            '`/parseaoe <data>` — Submit an AoE parse (merges damage within a 5-minute window)',
            '`/parsenight [public]` — Full-night DPS summary across every kill tonight',
            '`/raidnight` — Open tonight\'s raid parse thread with a live rolling scoreboard',
          ].join('\n'),
          inline: false,
        },
        {
          name: '📣 Raid Announcements',
          value: [
            '`/announce time:<when> [boss:<name>] [zone:<zone>]` — Create a raid announcement, thread, and Discord event',
            '`/addtarget <boss>` — Add a boss to the active announce thread\'s target list',
            '`/removetarget <boss>` — Remove a boss from the target list',
            '`/adjusttime <time>` — Update the raid time in the thread and Discord event',
            '`/adjustdate <date>` — Update the raid date (e.g. `"Friday"`, `"4/30"`)',
            '',
            'Time formats: `"8:30 PM"`, `"Thursday 9pm"`, `"tomorrow 8pm"`, `"8:30 PM EST"`, `"in 2 hours"`',
          ].join('\n'),
          inline: false,
        },
        {
          name: '🗡️ PVP Tracking',
          value: [
            '`/pvpkill <mob> [timer_hours]` — Record a PVP mob kill with optional respawn timer',
            '`/pvpunkill <mob>` — Remove a PVP mob kill record',
            '`/quake [time]` — Set a quake time to reset all PVP mob timers; posts 1-hour notice',
            '`/pvprole [silent]` — Toggle your @PVP role; omit `silent` to announce in PVP channel',
            '`/pvpalert <zone>` — Ping @PVP with a zone howl; others click 🐺 Howl! to join',
          ].join('\n'),
          inline: false,
        },
        {
          name: '🛠️ Admin / Setup',
          value: [
            '`/board` — Post or refresh all summary cards and expansion thread boards',
            '`/cleanup` — Remove duplicate or stale messages from all channels/threads',
            '`/restore <links...>` — Rebuild kill state from Active Cooldowns or Daily Summary message links',
            '`/addboss <pqdi_url>` — Add a new boss scraped from PQDI.cc',
            '`/removeboss <boss>` — Remove a boss and clear its kill state',
          ].join('\n'),
          inline: false,
        },
        {
          name: '📋 Help & Onboarding',
          value: [
            '`/raidbosshelp` — This message (ephemeral)',
            '`/onboarding` — Show the Wolf Pack welcome message again, or toggle opt-out',
          ].join('\n'),
          inline: false,
        },
        {
          name: '📋 Channel Layout',
          value: [
            '`#raid-mobs` — Active Cooldowns · Spawning Tomorrow · Daily Summary · Thread links',
            'Expansion threads — Kill buttons, per-zone cooldown cards, parse scoreboard',
            'Historic Kills thread — Archived daily summaries and cancelled announcements',
            'Parse Logs thread — Every parse logged as JSON (source of truth on redeploy)',
          ].join('\n'),
          inline: false,
        },
      )
      .setFooter({ text: `v${pkg.version} • Timer data sourced from PQDI.cc • Wolf Pack EQ (Quarm)` });

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
