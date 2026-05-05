// commands/feedback.js — Submit feedback, bug reports, or feature requests (open to all).
// Posts a formatted embed to FEEDBACK_THREAD_ID for the guild leader to review.

const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');

const CATEGORY_COLORS = {
  kill:        0xe74c3c,
  unkill:      0xe67e22,
  announce:    0x9b59b6,
  board:       0x3498db,
  tick:        0x1abc9c,
  timers:      0x2ecc71,
  addboss:     0xf39c12,
  removeboss:  0xe67e22,
  pvpkill:     0xe74c3c,
  pvpspawn:    0xe74c3c,
  updatetimer: 0x95a5a6,
  restore:     0x16a085,
  cleanup:     0x7f8c8d,
  general:     0x5865f2,
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('feedback')
    .setDescription('Submit feedback, a bug report, or a feature request. (Officers only)')
    .addStringOption(opt =>
      opt.setName('message')
        .setDescription('Describe the issue or request')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('command')
        .setDescription('Which command this is about (optional)')
        .setRequired(false)
        .addChoices(
          { name: '/kill',        value: 'kill' },
          { name: '/unkill',      value: 'unkill' },
          { name: '/announce',    value: 'announce' },
          { name: '/board',       value: 'board' },
          { name: '/tick',        value: 'tick' },
          { name: '/timers',      value: 'timers' },
          { name: '/addboss',     value: 'addboss' },
          { name: '/removeboss',  value: 'removeboss' },
          { name: '/pvpkill',     value: 'pvpkill' },
          { name: '/pvpspawn',    value: 'pvpspawn' },
          { name: '/updatetimer', value: 'updatetimer' },
          { name: '/restore',     value: 'restore' },
          { name: '/cleanup',     value: 'cleanup' },
          { name: 'General',      value: 'general' },
        )
    )
    .addAttachmentOption(opt =>
      opt.setName('screenshot')
        .setDescription('Optional screenshot or file')
        .setRequired(false)
    ),

  async execute(interaction) {
    const message    = interaction.options.getString('message');
    const command    = interaction.options.getString('command');
    const screenshot = interaction.options.getAttachment('screenshot');
    const threadId   = process.env.FEEDBACK_THREAD_ID;

    if (!threadId) {
      return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ `FEEDBACK_THREAD_ID` is not configured.' });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const submitter = interaction.member?.displayName || interaction.user.username;
    const label     = command ? `/${command}` : 'General';
    const color     = CATEGORY_COLORS[command] ?? CATEGORY_COLORS.general;

    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle(`📬 Feedback — ${label}`)
      .setDescription(message)
      .addFields({ name: 'Submitted by', value: submitter, inline: true })
      .setTimestamp();

    if (screenshot) {
      const isImage = screenshot.contentType?.startsWith('image/');
      if (isImage) {
        embed.setImage(screenshot.url);
      } else {
        embed.addFields({ name: '📎 Attachment', value: `[${screenshot.name}](${screenshot.url})`, inline: false });
      }
    }

    try {
      const thread = await interaction.client.channels.fetch(threadId);
      await thread.send({ embeds: [embed] });
      return interaction.editReply(`✅ Feedback submitted to <#${threadId}>. Thank you!`);
    } catch (err) {
      console.error('[feedback] Failed to post:', err);
      return interaction.editReply(`❌ Could not post to feedback thread: ${err?.message}`);
    }
  },
};
