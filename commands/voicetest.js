// commands/voicetest.js — officer-only voice playback test.
//
// Two surfaces, depending on the `surface` option:
//   - voice (default): Bot JOINS a voice channel via @discordjs/voice and
//     plays Edge TTS audio. Highest quality, plays for anyone in voice
//     whether they have Discord focused or not. Requires the voice
//     gateway to work end-to-end (Railway → discord.media UDP/WSS,
//     plus encryption + opus + ffmpeg in the container).
//   - tts (Discord native): Bot POSTS a text message with the tts:true
//     flag to a text channel. Discord's client renders the message AND
//     reads it aloud locally on each user's machine (Windows SAPI / macOS
//     / Linux espeak), but only if the user has TTS enabled in
//     Settings → Accessibility → "Allow playback and usage of /tts" AND
//     has the channel currently focused. Useful fallback when the voice
//     gateway is broken; trade-off is per-listener configuration + only
//     fires when Discord is foregrounded.

const { SlashCommandBuilder, MessageFlags, PermissionsBitField, ChannelType } = require('discord.js');
const { hasOfficerRole, officerRolesList } = require('../utils/roles');

const DEFAULT_MESSAGE = "Wolf Pack voice test. If you can hear this, the bot is wired through and ready for raid call-outs.";

module.exports = {
  data: new SlashCommandBuilder()
    .setName('voicetest')
    .setDescription('Officer: speak a test message (voice channel via Edge TTS or Discord native TTS in text)')
    .addStringOption(opt =>
      opt.setName('message')
        .setDescription('What to say (defaults to a confirmation line)')
        .setMaxLength(300)
        .setRequired(false))
    .addStringOption(opt =>
      opt.setName('surface')
        .setDescription('How to deliver — voice channel audio or Discord native TTS text message')
        .setRequired(false)
        .addChoices(
          { name: 'Voice channel (Edge TTS, default)',     value: 'voice' },
          { name: 'Discord TTS message (in text channel)', value: 'tts' },
        ))
    .addStringOption(opt =>
      opt.setName('channel')
        .setDescription('Voice: raid/offnight. TTS: posts to the channel you run the command in.')
        .setRequired(false)
        .addChoices(
          { name: 'Raid voice',        value: 'raid' },
          { name: 'Off-night voice',   value: 'offnight' },
        ))
    .addStringOption(opt =>
      opt.setName('voice')
        .setDescription('Edge TTS voice (default: en-US-AriaNeural). Ignored for native TTS surface.')
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

    const message    = interaction.options.getString('message') || DEFAULT_MESSAGE;
    const surface    = interaction.options.getString('surface') || 'voice';
    const channelKey = interaction.options.getString('channel') || 'raid';
    const voiceId    = interaction.options.getString('voice') || null;

    // ── Surface 2: Discord native TTS message ───────────────────────────
    // Sends `tts: true` to the CURRENT channel (where the command was
    // invoked). Officers can re-run this from any channel they want the
    // call-out to land in — usually a dedicated raid-chat channel. No
    // voice gateway involvement; the message renders for everyone, and
    // anyone with TTS enabled hears their local OS voice read it.
    if (surface === 'tts') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const ch = interaction.channel;
      const botMember = interaction.guild.members.me;
      const perms = ch?.permissionsFor(botMember);
      const needFlags = [
        ['SendMessages',    PermissionsBitField.Flags.SendMessages],
        ['SendTTSMessages', PermissionsBitField.Flags.SendTTSMessages],
      ];
      const missing = needFlags.filter(([, f]) => !perms?.has(f)).map(([n]) => n);
      if (missing.length > 0) {
        return interaction.editReply({
          content:
            `❌ Bot is missing **${missing.join(', ')}** on <#${ch.id}>.\n` +
            `Native TTS needs both. Grant **Send TTS Messages** on this channel (channel settings → Permissions).`,
        });
      }
      try {
        await ch.send({ content: message, tts: true, allowedMentions: { parse: [] } });
        return interaction.editReply({
          content:
            `✅ Posted TTS-flagged message in <#${ch.id}>: _"${message.slice(0, 120)}${message.length > 120 ? '…' : ''}"_\n` +
            `Listeners hear it ONLY if they have **Settings → Accessibility → Allow playback and usage of /tts command** turned on AND are currently focused on this channel. ` +
            `Voice used is each listener's local OS TTS (not Edge neural).`,
        });
      } catch (err) {
        return interaction.editReply({
          content: `❌ Could not post TTS message: \`${err.message}\`.`,
        });
      }
    }

    // ── Surface 1: Voice channel via @discordjs/voice (Edge TTS) ────────
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
        `If you don't hear it: try \`surface:Discord TTS message\` for a native fallback while the voice gateway is being fixed.`,
    });
  },
};
