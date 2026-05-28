// commands/parsehelp.js — How to set up the Wolf Pack Parser.
'use strict';

const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');

const PARSER_DOWNLOAD = 'https://parser.wolfpack.quest';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('parsehelp')
    .setDescription('How to set up the Wolf Pack Parser'),

  async execute(interaction) {
    const embed = new EmbedBuilder()
      .setColor(0xe74c3c)
      .setTitle('🐺 Wolf Pack Parser — Setup')
      .addFields(
        {
          name: '📥  Download',
          value: `**${PARSER_DOWNLOAD}** — unzip anywhere on your drive.`,
          inline: false,
        },
        {
          name: '1️⃣  Install Node.js (one time per machine)',
          value: [
            'Double-click **`RUN-FIRST-for-Node.js.bat`** in the unzipped folder.',
            'Approve the UAC prompt. The script auto-installs Node.js 20 if missing,',
            'or confirms you already have it and closes.',
          ].join('\n'),
          inline: false,
        },
        {
          name: '2️⃣  Run the parser',
          value: [
            'Double-click **`Parser.bat`** in the same folder.',
            'It auto-detects your EQ folder and starts watching your log files.',
            '',
            '**First-run prompts (press Enter to accept defaults):**',
            '• EQ path — accepts the auto-detected folder',
            '• Bot URL — **press Enter** to use the default endpoint',
            '• Agent token — paste the value from `/token` in Discord',
            '• Startup preference — pick `[1]` to start automatically with Windows',
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
      .setFooter({ text: 'Wolf Pack EQ (Quarm) • https://wolfpack.quest' });

    return interaction.reply({ flags: MessageFlags.Ephemeral, embeds: [embed] });
  },
};
