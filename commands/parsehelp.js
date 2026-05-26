// commands/parsehelp.js — How to set up automatic parsing (Wolf Pack Parser) and
// manual parsing (EQLogParser), and how to submit with /parse.
'use strict';

const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');

const PARSER_DOWNLOAD = 'https://tinyurl.com/WolfPackParse';
const EQLOGPARSER_URL = 'https://github.com/kauffman12/EQLogParser/releases';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('parsehelp')
    .setDescription('How to set up parsing and submit DPS data'),

  async execute(interaction) {
    const embed = new EmbedBuilder()
      .setColor(0xe74c3c)
      .setTitle('📊 How to Submit a Parse')
      .addFields(
        // ── Automatic ──────────────────────────────────────────────────────────
        {
          name: '🤖  Option 1 — Wolf Pack Parser (Automatic, Recommended)',
          value: [
            `Download: **${PARSER_DOWNLOAD}**`,
            'Unzip anywhere and run **Parser.bat** — no install needed.',
            'It auto-detects your EQ folder and watches all active log files.',
            '',
            'On first run you\'ll be asked for a **Token Password** — run `/token` in Discord to get it.',
            '',
            'After that: kills upload automatically in the background. No copy/paste needed.',
          ].join('\n'),
          inline: false,
        },
        // ── Manual ─────────────────────────────────────────────────────────────
        {
          name: '📋  Option 2 — Manual Parsing (EQLogParser)',
          value: [
            `Download: **${EQLOGPARSER_URL}**`,
            'Unzip anywhere — no installer needed.',
            'Point it at your EQ log file:',
            '`Options → Log File → Browse` → pick your character\'s log',
            '`C:\\EverQuest\\Logs\\eqlog_<CharName>_pq.proj.txt`',
            '',
            'After a boss kill, find the fight in the left panel.',
            'Right-click it → **"Send to EQ"** (or press **F2**). Example output:',
            '```',
            'Aten Ha Ra in 247s, 1.54M Damage @6.23K, 1. Hitya +Pets = 231.20K@5.78K in 40s | ...',
            '```',
            'Then submit: `/parse data:<paste here>`',
          ].join('\n'),
          inline: false,
        },
        // ── Instance vs open world ──────────────────────────────────────────────
        {
          name: '⚙️  Parse type (optional — defaults to `instance`)',
          value: [
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
        // ── Multiple parsers ────────────────────────────────────────────────────
        {
          name: '👥  Multiple people can /parse the same kill',
          value: [
            'Each submission is merged automatically.',
            'Higher damage numbers always win — your log is never overwritten by a worse one.',
            'The more people submit, the more complete the raid picture.',
          ].join('\n'),
          inline: false,
        },
        // ── /sll ───────────────────────────────────────────────────────────────
        {
          name: '⏱️  Recover timers from lockouts  →  /sll',
          value: [
            'If the bot lost state, restore all timers from your lockout list.',
            'In EQ: type `#showlootlockouts` → copy the output → paste into `/sll`.',
            'The lockout remaining time = the boss respawn remaining time exactly.',
          ].join('\n'),
          inline: false,
        },
        // ── Other commands ──────────────────────────────────────────────────────
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
      .setFooter({ text: 'Wolf Pack Parser auto-uploads. EQLogParser is free, open-source, and reads your log locally — nothing else is uploaded.' });

    return interaction.reply({ flags: MessageFlags.Ephemeral, embeds: [embed] });
  },
};
