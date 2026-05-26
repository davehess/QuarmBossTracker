// commands/parseagents.js — Show which characters are actively uploading parses.
//
// Anyone can run this. Shows the last 20 minutes of agent uploads — useful for
// verifying that multiple parsers are simultaneously feeding the dedup system,
// and for spotting characters whose agent stopped uploading mid-raid.

const { SlashCommandBuilder, MessageFlags, EmbedBuilder } = require('discord.js');
const { getAgentActivity } = require('../utils/state');
const { discordRelativeTime } = require('../utils/timer');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('parseagents')
    .setDescription('Show characters currently uploading parses via the wolfpack-logsync agent'),

  async execute(interaction) {
    const activity = getAgentActivity();
    const entries  = Object.values(activity);

    if (entries.length === 0) {
      return interaction.reply({
        flags: MessageFlags.Ephemeral,
        content:
          '📡 No agent uploads recorded yet.\n' +
          'Tracking starts the moment the bot receives its first upload — ' +
          'wait for the next encounter to finish, then re-run `/parseagents`. ' +
          'If nobody is running the WolfPackParser agent, ask an officer for the zip.',
      });
    }

    const now    = Date.now();
    const WINDOW = 20 * 60 * 1000;  // active in the last 20 min
    const active = entries
      .filter(e => e.lastUpload && (now - e.lastUpload) < WINDOW)
      .sort((a, b) => b.lastUpload - a.lastUpload);
    const stale  = entries
      .filter(e => !active.includes(e))
      .sort((a, b) => (b.lastUpload || 0) - (a.lastUpload || 0))
      .slice(0, 10);  // cap the stale list so the embed doesn't blow up

    const lines = [];
    if (active.length > 0) {
      lines.push(`🟢 **Active (last 20 min) — ${active.length}**`);
      for (const e of active) {
        const lastBoss = e.lastBoss || '?';
        lines.push(
          `  • **${e.name}** — last ${discordRelativeTime(e.lastUpload)} ` +
          `· ${e.totalUploads} upload${e.totalUploads === 1 ? '' : 's'} · last mob: ${lastBoss}`
        );
      }
    } else {
      lines.push('🟢 **Active (last 20 min)** — none');
    }

    if (stale.length > 0) {
      lines.push('');
      lines.push(`⏸️ **Stale (older than 20 min) — top ${stale.length}**`);
      for (const e of stale) {
        const when = e.lastUpload ? discordRelativeTime(e.lastUpload) : 'never';
        lines.push(`  • ${e.name} — last ${when} · ${e.totalUploads} total`);
      }
    }

    const stagingTag = process.env.STAGING_MODE === 'true' ? ' *(staging)*' : '';
    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle(`📡 Agent Upload Activity${stagingTag}`)
      .setDescription(lines.join('\n'))
      .setFooter({ text: `Cleared at midnight · use /parsereset for an immediate wipe` })
      .setTimestamp();

    return interaction.reply({ flags: MessageFlags.Ephemeral, embeds: [embed] });
  },
};
