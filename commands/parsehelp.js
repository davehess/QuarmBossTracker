// commands/parsehelp.js — How to get EQLogParser set up and use /parse.
'use strict';

const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('parsehelp')
    .setDescription('How to install EQLogParser and submit a DPS parse'),

  async execute(interaction) {
    const embed = new EmbedBuilder()
      .setColor(0xe74c3c)
      .setTitle('📊 How to Submit a Parse')
      .addFields(
        {
          name: '1️⃣  Install EQLogParser',
          value: [
            'Download from: **https://github.com/rumstil/eqlogparser/releases**',
            'Unzip anywhere — no installer needed.',
            'Point it at your EQ log file:',
            '`Options → Log File → Browse` → pick your character\'s log',
            '`C:\\EverQuest\\Logs\\eqlog_<CharName>_pq.proj.ini`',
          ].join('\n'),
          inline: false,
        },
        {
          name: '2️⃣  After a boss kill — copy the parse',
          value: [
            'In EQLogParser, find the boss fight in the left panel.',
            'Right-click it → **"Send to EQ"** (or press **F2**).',
            'This copies one line to your clipboard, like:',
            '```',
            'Aten Ha Ra in 247s, 1.54M Damage @6.23K, 1. Hitya +Pets = 231.20K@5.78K in 40s | ...',
            '```',
          ].join('\n'),
          inline: false,
        },
        {
          name: '3️⃣  Submit with /parse',
          value: [
            '`/parse data:<paste here>`',
            '',
            '**type** option (optional — defaults to `instance`):',
            '🏰 **instance** — guild instance kill; starts the respawn timer *(use this)*',
            '🌍 **open_world** — stats recorded, no timer started',
            '🗡️ **pvp** — stats recorded, no timer started',
            '',
            '✅ **How to confirm you\'re in a guild instance:**',
            'Your chat shows this message right after the kill:',
            '> *"You have incurred a lockout on the instance of …"*',
            'Not sure? Type `#showlootlockouts` in-game to list all your active lockouts.',
          ].join('\n'),
          inline: false,
        },
        {
          name: '4️⃣  Multiple people can /parse the same kill',
          value: [
            'Each person\'s submission is merged automatically.',
            'Higher damage numbers always win — your log is never overwritten by a worse one.',
            'The more people submit, the more complete the raid picture.',
          ].join('\n'),
          inline: false,
        },
        {
          name: '⏱️  Recover timers from lockouts  →  /sll',
          value: [
            'If the bot lost state, you can restore all timers from your lockout list.',
            'In EQ: type `#showlootlockouts` → copy the output → paste into `/sll`.',
            'The lockout remaining time = the boss respawn remaining time exactly.',
          ].join('\n'),
          inline: false,
        },
        {
          name: '📈  Other parse commands',
          value: [
            '`/parseboss <boss> <data>` — submit with explicit boss (if auto-detect fails)',
            '`/parsestats <boss>` — DPS leaderboard across all recorded kills',
            '`/parseaoe <data>` — AoE/consolidated parse (merges a 5-minute window)',
            '`/parsenight` — full-night summary for tonight\'s session',
            '`/raidnight` — open a live rolling scoreboard thread for tonight',
          ].join('\n'),
          inline: false,
        },
      )
      .setFooter({ text: 'EQLogParser is free, open-source, and reads your log file locally — nothing is uploaded.' });

    return interaction.reply({ flags: MessageFlags.Ephemeral, embeds: [embed] });
  },
};
