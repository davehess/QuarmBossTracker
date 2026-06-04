// commands/parsehelp.js — How to set up parsing for the Wolf Pack bot.
//
// Two recommended paths, surfaced as two top fields on the embed:
//   1. Mimic (Electron desktop, v1.0.0+) — one installer, bundles its own
//      Node runtime, DPS overlay + trigger TTS + charm tracker + tells. The
//      default recommendation for new members.
//   2. Parser (classic .bat) — original CLI agent for anyone who wants the
//      minimal install or already has Node.js set up.
'use strict';

const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { PARSER_DOWNLOAD_URL } = require('../utils/onboarding');

// Direct GitHub-release URL. parser.wolfpack.quest CNAME-to-GitHub can't
// terminate TLS, so always link the release artifact directly.
const PARSER_DOWNLOAD = PARSER_DOWNLOAD_URL;
const MIMIC_URL       = 'https://wolfpack.quest/mimic';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('parsehelp')
    .setDescription('How to set up parsing for the Wolf Pack bot (Mimic recommended)'),

  async execute(interaction) {
    const embed = new EmbedBuilder()
      .setColor(0x1f6feb)
      .setTitle('🐺 Set up parsing — pick one')
      .setDescription(
        'Both paths upload the same combat data so the guild stats stay current. ' +
        '**Mimic** is the all-in-one desktop app (recommended); **Parser.bat** is the original CLI agent if you want the minimal install.'
      )
      .addFields(
        {
          name: '⭐  Recommended: Wolf Pack Mimic v1.0.0 (Electron desktop app)',
          value: [
            `**One-click install:** [**${MIMIC_URL}**](${MIMIC_URL}) — downloads the latest installer directly.`,
            'Bundles its own Node runtime, no separate install. SmartScreen will warn → *More info → Run anyway*.',
            '',
            '**What you get on top of uploads:**',
            '• Always-on-top **DPS HUD overlay**',
            '• **Trigger alerts** (TTS) — your own + guild-tuned set, with countdown timers',
            '• **Charm tracker** — 6-second tick counter + recharm alarm',
            '• **Buffs & Zone** card — what every character is carrying + where they parked',
            '• **/tells** synced privately to wolfpack.quest/me/tells (encrypted)',
            '• **UI Studio** — back up your EQ window layout, hotkeys, chat tabs, ini, restore on any machine',
            '• Optional **Discord sign-in** (Settings → Wolf Pack account) — survives upgrades',
            '',
            '**After install:** run it once. Run `/token` in Discord and paste into Settings → Agent token.',
          ].join('\n'),
          inline: false,
        },
        {
          name: '🧱  Minimal: Parser.bat (CLI agent)',
          value: [
            `[**WolfPackParser.zip**](${PARSER_DOWNLOAD}) — unzip anywhere on your drive.`,
            '1️⃣  Double-click **`RUN-FIRST-for-Node.js.bat`** (one time per machine; UAC approves Node.js 20).',
            '2️⃣  Double-click **`Parser.bat`**. It auto-detects your EQ folder.',
            '   • Bot URL — **press Enter** for the default',
            '   • Agent token — paste from `/token` in Discord',
            '   • Startup — pick `[1]` to start with Windows',
          ].join('\n'),
          inline: false,
        },
        {
          name: '⏱️  Recover timers from lockouts  →  /sll',
          value: [
            'If the bot lost state, restore all timers from your lockout list.',
            'In EQ: type `#showlootlockouts` → copy the output → paste into `/sll`.',
            'The lockout remaining time = the boss respawn remaining time exactly.',
          ].join('\n'),
          inline: false,
        },
      )
      .setFooter({ text: 'Wolf Pack EQ (Quarm) • https://wolfpack.quest • Mimic v1.0.0 is the stable release — auto-updates from here on.' });

    return interaction.reply({ flags: MessageFlags.Ephemeral, embeds: [embed] });
  },
};
