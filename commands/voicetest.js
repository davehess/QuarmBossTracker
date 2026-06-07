// commands/voicetest.js — officer-only voice playback test.
//
// Speaks a test message into a voice channel using utils/voice. Defaults to
// RAID_VOICE_CHANNEL_ID; officers can target the off-night channel by name
// (the `channel` option's autocomplete shows what's wired in env). Useful
// for verifying TTS + Discord voice perms before a real raid:
//   1. CONNECT + SPEAK permissions in the role
//   2. ffmpeg installed in the bot's container (Docker `apk add ffmpeg`)
//   3. @discordjs/voice + opusscript + libsodium-wrappers in package.json
//
// Returns ephemerally — the joke voice line is the public confirmation.

const { SlashCommandBuilder, MessageFlags, PermissionsBitField, ChannelType } = require('discord.js');
const { hasOfficerRole, officerRolesList } = require('../utils/roles');

const DEFAULT_MESSAGE = "Wolf Pack voice test. If you can hear this, the bot is wired through and ready for raid call-outs.";

module.exports = {
  data: new SlashCommandBuilder()
    .setName('voicetest')
    .setDescription('Officer: speak a test message in a voice channel (verifies TTS + connection)')
    .addStringOption(opt =>
      opt.setName('message')
        .setDescription('What to say (defaults to a confirmation line)')
        .setMaxLength(300)
        .setRequired(false))
    .addStringOption(opt =>
      opt.setName('channel')
        .setDescription('Where to speak — defaults to RAID_VOICE_CHANNEL_ID')
        .setRequired(false)
        .addChoices(
          { name: 'Raid voice',        value: 'raid' },
          { name: 'Off-night voice',   value: 'offnight' },
        ))
    .addStringOption(opt =>
      opt.setName('voice')
        .setDescription('Edge TTS voice (default: en-US-AriaNeural)')
        .setRequired(false)
        .addChoices(
          { name: 'Aria (US female, default)', value: 'en-US-AriaNeural' },
          { name: 'Guy (US male)',             value: 'en-US-GuyNeural' },
          { name: 'Jenny (US female, warm)',   value: 'en-US-JennyNeural' },
          { name: 'Christopher (US male)',     value: 'en-US-ChristopherNeural' },
          { name: 'Ryan (UK male)',            value: 'en-GB-RyanNeural' },
          { name: 'Sonia (UK female)',         value: 'en-GB-SoniaNeural' },
        )),

  async execute(interaction) {
    if (!hasOfficerRole(interaction.member)) {
      return interaction.reply({
        content: `This is officer-only. You need one of: ${officerRolesList().join(', ')}.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    const message = interaction.options.getString('message') || DEFAULT_MESSAGE;
    const channelKey = interaction.options.getString('channel') || 'raid';
    const voiceId = interaction.options.getString('voice') || null;

    const channelId = channelKey === 'offnight'
      ? process.env.OFFNIGHT_VOICE_CHANNEL_ID
      : process.env.RAID_VOICE_CHANNEL_ID;

    if (!channelId) {
      const envName = channelKey === 'offnight' ? 'OFFNIGHT_VOICE_CHANNEL_ID' : 'RAID_VOICE_CHANNEL_ID';
      return interaction.reply({
        content: `❌ ${envName} is not set. Add it to the bot's environment and redeploy.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // Preflight perm probe — the previous failure mode was a silent
    // "signalling → destroyed" hang because Discord rejected the OP 4
    // VoiceStateUpdate. The most common cause is a channel-level perm
    // overwrite hiding CONNECT/SPEAK from the bot even when the role
    // appears to grant them. Resolve and print effective perms BEFORE
    // attempting the join so we can confirm or rule out perms in one
    // round trip.
    const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
    if (!channel) {
      return interaction.editReply({
        content: `❌ Could not fetch channel \`${channelId}\`. It may not exist in this guild, or the bot doesn't have View Channel on it.`,
      });
    }
    const channelTypeName = ChannelType[channel.type] || `unknown(${channel.type})`;
    if (channel.type !== ChannelType.GuildVoice && channel.type !== ChannelType.GuildStageVoice) {
      return interaction.editReply({
        content: `❌ Channel <#${channelId}> is **${channelTypeName}**, not a voice channel. Update RAID_VOICE_CHANNEL_ID / OFFNIGHT_VOICE_CHANNEL_ID to a real voice channel.`,
      });
    }
    const botMember = interaction.guild.members.me;
    const perms = channel.permissionsFor(botMember);
    const has = (flag) => perms?.has(flag) ?? false;
    const need = [
      ['ViewChannel', PermissionsBitField.Flags.ViewChannel],
      ['Connect',     PermissionsBitField.Flags.Connect],
      ['Speak',       PermissionsBitField.Flags.Speak],
    ];
    const missing = need.filter(([, f]) => !has(f)).map(([n]) => n);
    if (missing.length > 0) {
      const present = need.filter(([, f]) => has(f)).map(([n]) => n);
      return interaction.editReply({
        content:
          `❌ Bot is missing **${missing.join(', ')}** on <#${channelId}> (${channelTypeName}).\n` +
          `Currently has: ${present.join(', ') || 'nothing'}.\n` +
          `Fix: open the voice channel's permissions tab and grant CONNECT + SPEAK + VIEW CHANNEL to the bot's role OR to the bot user directly. Role-level perms are overridden by channel-level perms.`,
      });
    }
    console.log(`[voicetest] perms ok on ${channelId}: ${need.map(([n]) => n).join(', ')}`);

    let voice;
    try { voice = require('../utils/voice'); }
    catch (err) {
      return interaction.editReply({
        content: `❌ Voice module not loadable: \`${err.message}\`. Check that @discordjs/voice and friends installed cleanly.`,
      });
    }

    const ok = await voice.playInVoice({
      guildClient: interaction.guild,
      channelId,
      text: message,
      voiceId,
    });

    if (!ok) {
      return interaction.editReply({
        content: '❌ playInVoice returned false. Likely causes: missing voice deps in the image, ffmpeg not on PATH, or the bot lacks **Connect** + **Speak** perms on that channel.',
      });
    }

    const status = voice.getStatus(interaction.guild.id);
    return interaction.editReply({
      content:
        `✅ Queued for <#${channelId}>: _"${message.slice(0, 120)}${message.length > 120 ? '…' : ''}"_\n` +
        `Voice: \`${voiceId || voice.TTS_VOICE_DEFAULT}\` · Status: ${status.connected ? `connected (${status.queueLen} queued)` : 'connecting'}.\n` +
        `If you don't hear it: check the bot has Connect+Speak in the channel, ffmpeg is in the container, and the Railway logs for \`[voice]\` warnings.`,
    });
  },
};
