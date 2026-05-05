// commands/feedbacklist.js — Fetch recent feedback entries and format them as a
// pasteable text block for Claude sessions. Officer-only.

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { hasOfficerRole, officerRolesList } = require('../utils/roles');

const MAX_FETCH = 50; // Discord API max per request

module.exports = {
  data: new SlashCommandBuilder()
    .setName('feedbacklist')
    .setDescription('List recent feedback submissions as a pasteable summary. (Officers only)')
    .addIntegerOption(opt =>
      opt.setName('limit')
        .setDescription('How many entries to show (default 20, max 50)')
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(50)
    ),

  async execute(interaction) {
    if (!hasOfficerRole(interaction.member))
      return interaction.reply({ flags: MessageFlags.Ephemeral, content: `❌ You need one of these roles: ${officerRolesList()}` });

    const threadId = process.env.FEEDBACK_THREAD_ID;
    if (!threadId)
      return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ `FEEDBACK_THREAD_ID` is not configured.' });

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const limit = interaction.options.getInteger('limit') ?? 20;

    let messages;
    try {
      const thread = await interaction.client.channels.fetch(threadId);
      messages = await thread.messages.fetch({ limit: MAX_FETCH });
    } catch (err) {
      return interaction.editReply(`❌ Could not read feedback thread: ${err?.message}`);
    }

    // Filter to open feedback embeds — exclude anything marked Implemented or Not Implementing
    function isClosed(m) {
      const statusField = m.embeds[0]?.fields?.find(f => f.name === 'Status');
      if (!statusField) return false;
      return statusField.value.startsWith('✅') || statusField.value.startsWith('❌');
    }

    const entries = [...messages.values()]
      .filter(m => m.author.bot && m.embeds.length > 0 && m.embeds[0].title?.startsWith('📬 Feedback') && !isClosed(m))
      .sort((a, b) => b.createdTimestamp - a.createdTimestamp)
      .slice(0, limit);

    if (!entries.length)
      return interaction.editReply('No open feedback entries. (Implemented/Not Implementing items are hidden — check the thread directly if needed.)');

    const lines = entries.map(m => {
      const embed      = m.embeds[0];
      const ts         = new Date(m.createdTimestamp).toLocaleString('en-US', {
        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: process.env.DEFAULT_TIMEZONE || 'America/New_York',
      });
      const category   = embed.title?.replace('📬 Feedback — ', '') || 'General';
      const submitter  = embed.fields?.find(f => f.name === 'Submitted by')?.value || '?';
      const body       = embed.description || '';
      const attachment = embed.image?.url
        ? `\n  📎 ${embed.image.url}`
        : (embed.fields?.find(f => f.name === '📎 Attachment')?.value
            ? `\n  📎 ${embed.fields.find(f => f.name === '📎 Attachment').value}`
            : '');
      return `[${ts}] ${submitter} → ${category}\n  ${body}${attachment}`;
    });

    const header = `=== FEEDBACK (${entries.length} most recent) ===\n`;
    const body   = lines.join('\n\n');
    const full   = header + body;

    // Discord code blocks have a 2000-char content limit; split if needed
    const chunks = [];
    let current  = '```\n' + header;
    for (const line of lines) {
      const addition = '\n' + line;
      if ((current + addition + '\n```').length > 1990) {
        chunks.push(current + '\n```');
        current = '```\n' + line;
      } else {
        current += addition;
      }
    }
    chunks.push(current + '\n```');

    await interaction.editReply({ content: chunks[0] });
    for (const chunk of chunks.slice(1)) {
      await interaction.followUp({ flags: MessageFlags.Ephemeral, content: chunk });
    }
  },
};
