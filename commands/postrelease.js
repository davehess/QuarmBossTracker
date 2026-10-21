// commands/postrelease.js — Officer command: post a release's raid-chat announcements publicly in this channel.
// The guild lead, 2026-10-21, at the Mimic 3.0 release: "have the bot post them for me". The posts are written ahead
// of time (data/release-posts/<release>/posts.json + their pictures beside it) and this only sends them, one Discord
// message per post, in order, so nobody has to copy text and attach pictures by hand.
//
//   /postrelease                 all four posts, in order
//   /postrelease part:3          just one post
//   /postrelease part:3 picture: attach a picture to that post (post 3 ships without one: the guild lead adds it)
//
// Public repo: the post texts and pictures name no member; the pictures use invented names.
'use strict';

const fs = require('fs');
const path = require('path');
const { SlashCommandBuilder, MessageFlags, AttachmentBuilder } = require('discord.js');
const { hasOfficerRole, officerRolesList } = require('../utils/roles');

const RELEASE = '3.0';
const DIR = path.join(__dirname, '..', 'data', 'release-posts', RELEASE);

function loadPosts(dir = DIR) {
  const data = JSON.parse(fs.readFileSync(path.join(dir, 'posts.json'), 'utf8'));
  return data.posts.map(p => ({ ...p, imagePath: p.image ? path.join(dir, p.image) : null }));
}

module.exports = {
  loadPosts,
  data: new SlashCommandBuilder()
    .setName('postrelease')
    .setDescription(`Officer: post the Raid Mimic ${RELEASE} release announcements publicly in this channel`)
    .addIntegerOption(o => o.setName('part').setDescription('Post only this one (1 to 4); leave empty for all of them').setMinValue(1).setMaxValue(4))
    .addAttachmentOption(o => o.setName('picture').setDescription('A picture for that post (only with part)')),

  async execute(interaction) {
    if (!hasOfficerRole(interaction.member)) {
      return interaction.reply({ flags: MessageFlags.Ephemeral, content: `❌ Officers only. Required roles: ${officerRolesList()}` });
    }
    const part = interaction.options.getInteger('part');
    const picture = interaction.options.getAttachment('picture');
    if (picture && !part) {
      return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Pick which post the picture goes with: add `part`.' });
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const posts = loadPosts().filter(p => !part || p.part === part);
    const sent = [];
    for (const p of posts) {
      const files = [];
      if (part && picture) files.push({ attachment: picture.url, name: picture.name || `release-${p.part}.png` });
      else if (p.imagePath && fs.existsSync(p.imagePath)) files.push(new AttachmentBuilder(p.imagePath, { name: path.basename(p.imagePath) }));
      await interaction.channel.send({ content: p.text, files });
      sent.push(`${p.part} · ${p.title}${files.length ? '' : ' (no picture)'}`);
    }
    return interaction.editReply({ content: `✅ Posted:\n${sent.join('\n')}` });
  },
};
