// commands/feedback.js — Submit feedback, bug reports, or feature requests (open to all).
// Posts a formatted embed to FEEDBACK_THREAD_ID for the guild leader to review.

const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');

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
      .setFooter({ text: `uid:${interaction.user.id}` })
      .setTimestamp();

    // An image is copied, not linked (2026-09-26): the interaction's CDN link is signed and
    // expires, and the officer page on wolfpack.quest needs its own copy. So the bytes ride along
    // as this post's attachment and go to the private feedback-screenshots bucket.
    const shotsMod = require('../utils/feedbackShots');
    let shot = null;
    if (screenshot) {
      if (screenshot.contentType?.startsWith('image/') && (screenshot.size || 0) <= shotsMod.MAX_BYTES) {
        try {
          const res = await fetch(screenshot.url, { signal: AbortSignal.timeout(15_000) });
          const buf = res.ok ? Buffer.from(await res.arrayBuffer()) : null;
          const mime = shotsMod.sniffImage(buf);
          if (mime) shot = { buf, mime };
        } catch (err) { console.warn('[feedback] screenshot fetch failed:', err?.message); }
      }
      if (!shot) embed.addFields({ name: '📎 Attachment', value: `[${screenshot.name}](${screenshot.url})`, inline: false });
    }
    const files = shot ? shotsMod.discordFiles([shot]) : [];
    if (files.length) embed.setImage(`attachment://${files[0].name}`);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('fb_recv').setLabel('📬 Acknowledge').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('fb_nope').setLabel('❌ Not Implementing').setStyle(ButtonStyle.Danger),
    );

    try {
      const thread = await interaction.client.channels.fetch(threadId);
      const sent   = await thread.send({ embeds: [embed], components: [row], files });
      const shotPaths = shot ? await shotsMod.uploadShots([shot], 'discord') : [];

      // Mirror to Supabase feedback table for the /admin/feedback search UI.
      // Discord thread remains the primary surface; this is just for search /
      // status tracking. Fire-and-forget.
      try {
        const supabase = require('../utils/supabase');
        if (supabase.isEnabled()) {
          const guildId = sent?.guildId || interaction.guildId;
          const msgLink = guildId
            ? `https://discord.com/channels/${guildId}/${threadId}/${sent.id}`
            : null;
          supabase.insert('feedback', [{
            submitter_discord_id: interaction.user.id,
            submitter_name:       submitter,
            category:             command || 'general',
            message,
            discord_msg_id:       sent.id,
            discord_msg_link:     msgLink,
            ...(shotPaths.length ? { screenshot_paths: shotPaths } : {}),
          }]).then((rows) => {
            // The card was posted before the row existed; give it its FB-<ref> now (feedbackRefs).
            const fbTag = require('../utils/feedbackRefs').tag(Array.isArray(rows) && rows[0] ? rows[0].ref : null);
            if (!fbTag || !sent.embeds?.[0]) return;
            return sent.edit({ embeds: [EmbedBuilder.from(sent.embeds[0]).setTitle(`📬 ${fbTag} — ${label}`)] });
          }).catch(err => console.warn('[feedback] supabase mirror failed:', err?.message));
        }
      } catch (err) {
        console.warn('[feedback] supabase wrap failed:', err?.message);
      }

      return interaction.editReply(`✅ Feedback submitted to <#${threadId}>. Thank you!`);
    } catch (err) {
      console.error('[feedback] Failed to post:', err);
      return interaction.editReply(`❌ Could not post to feedback thread: ${err?.message}`);
    }
  },
};
