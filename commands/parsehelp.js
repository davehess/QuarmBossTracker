// commands/parsehelp.js — How to set up parsing for the Wolf Pack bot.
//
// Mimic-first: the recommended path is the Wolf Pack Mimic desktop app, which
// now does Discord sign-in on first run (mints the member's per-user upload
// token automatically — no /token paste needed). Parser.bat remains as a
// minimal/advanced fallback.
//
// The embed builder is shared with /postparsehelp (officer command that posts
// the same content as a non-ephemeral message for broadcasting).
'use strict';

const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { PARSER_DOWNLOAD_URL } = require('../utils/onboarding');

const PARSER_DOWNLOAD = PARSER_DOWNLOAD_URL;
const MIMIC_URL       = 'https://wolfpack.quest/mimic';

// Shared embed — used ephemerally by /parsehelp and publicly by /postparsehelp.
function buildParseHelpEmbed() {
  return new EmbedBuilder()
    .setColor(0x1f6feb)
    .setTitle('🐺 Set up the Wolf Pack Mimic Parser')
    .setDescription(
      'Mimic uploads your combat data so the guild boards, parses, and stats stay current — ' +
      'and gives you a DPS overlay, trigger TTS, charm tracker, and more on top. One installer, ' +
      'bundles its own Node runtime, **installs just for you with no admin prompt**.'
    )
    .addFields(
      {
        name: '1️⃣  Download + install',
        value: [
          `Download: [**${MIMIC_URL}**](${MIMIC_URL}) — grabs the latest installer directly.`,
          '• Windows SmartScreen will warn (not code-signed yet) → **More info → Run anyway**.',
          '• It installs **only for you** (no UAC / admin) — just click **Install**. (Advanced: change the folder if you like.)',
        ].join('\n'),
        inline: false,
      },
      {
        name: '2️⃣  First run — three quick steps',
        value: [
          '**Step 1 · Sign in with Discord.** Opens Discord once, you click **Authorize**, and it comes right back — this links Mimic to *your* account and sets up your personal upload automatically. **No token to copy/paste.**',
          '**Step 2 · Pick your EverQuest folder.** Mimic auto-detects it — tick the folder (or **Browse** to it) and **Save folder**.',
          '**Step 3 · Preferences** (optional) — tells display, overlays. Then **Open dashboard**.',
          '',
          '⚠️ Make sure in-game logging is on: type **`/log on`** in EverQuest (or set `Logging=on` in `eqclient.ini`).',
        ].join('\n'),
        inline: false,
      },
      {
        name: '✨  What you get',
        value: [
          '• Always-on-top **DPS HUD** · **Trigger alerts (TTS)** with countdown timers · **Charm tracker**',
          '• **Buffs & Zone** card · private **/tells** on wolfpack.quest/me/tells (encrypted)',
          '• **UI Studio** — back up your EQ window layout / hotkeys / chat tabs / ini and restore on any machine',
          '• Auto-updates from here on — no re-downloading.',
        ].join('\n'),
        inline: false,
      },
      {
        name: '🧱  Advanced: Parser.bat (minimal CLI agent)',
        value: [
          `Prefer the classic CLI? [**WolfPackParser.zip**](${PARSER_DOWNLOAD}) — unzip anywhere.`,
          '1️⃣ Run **`RUN-FIRST-for-Node.js.bat`** once (installs Node 20). 2️⃣ Run **`Parser.bat`**.',
          'Bot URL → press Enter for default. Agent token → mint one with **`/token`** in Discord and paste it.',
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
    .setFooter({ text: 'Wolf Pack EQ (Quarm) • https://wolfpack.quest • Mimic auto-updates once installed.' });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('parsehelp')
    .setDescription('How to set up the Wolf Pack Mimic Parser (ephemeral)'),

  async execute(interaction) {
    return interaction.reply({ flags: MessageFlags.Ephemeral, embeds: [buildParseHelpEmbed()] });
  },

  buildParseHelpEmbed,
};
