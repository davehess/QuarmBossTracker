// commands/scanraidhelper.js — One-shot ingestion of historical RaidHelper
// events from a Discord channel. Reads the last N messages, finds the ones
// the RH bot posted, extracts signups from the embed fields, and writes
// rh_events + rh_signups rows so /admin/signups lights up with real data
// without needing the RH REST API set up.
//
// Designed to be safely re-runnable — upserts by message id, so subsequent
// scans pick up any new RH posts plus any signup edits to existing events.

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { hasOfficerRole, officerRolesList } = require('../utils/roles');
const { scanChannel } = require('../utils/raidhelper');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('scanraidhelper')
    .setDescription('(Officer) Pull RaidHelper sign-ups from a channel into Supabase for /admin/signups')
    .addChannelOption(opt =>
      opt.setName('channel')
        .setDescription('Channel to scan (defaults to the configured raid sign-up channel)')
        .setRequired(false))
    .addIntegerOption(opt =>
      opt.setName('limit')
        .setDescription('How many recent messages to scan (default 100, max 500)')
        .setMinValue(1).setMaxValue(500)
        .setRequired(false)),

  async execute(interaction) {
    if (!hasOfficerRole(interaction.member)) {
      return interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: `❌ Only officers can scan RaidHelper history. Required roles: ${officerRolesList()}`,
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const supabase = require('../utils/supabase');
    if (!supabase.isEnabled()) {
      return interaction.editReply('❌ Supabase isn\'t configured — set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.');
    }

    const channel = interaction.options.getChannel('channel')
      || await interaction.client.channels.fetch(process.env.RAIDHELPER_CHANNEL_ID || '').catch(() => null);
    if (!channel) {
      return interaction.editReply('❌ No channel — pass one or set RAIDHELPER_CHANNEL_ID.');
    }
    const limit = interaction.options.getInteger('limit') || 100;

    const scanned = await scanChannel(channel, { limit }).catch(err => {
      console.warn('[scanraidhelper] scan failed:', err?.message);
      return null;
    });
    if (!scanned) {
      return interaction.editReply('❌ Channel scan failed — check bot permissions on that channel.');
    }
    if (scanned.length === 0) {
      return interaction.editReply(`Scanned ${limit} messages in <#${channel.id}> — found no RaidHelper events.`);
    }

    const guildId = process.env.SUPABASE_GUILD_ID || 'wolfpack';
    let evCount = 0, sgCount = 0, sgSkipped = 0;
    for (const { event, signups } of scanned) {
      const eventRow = { ...event, guild_id: guildId, synced_at: new Date().toISOString() };
      const r = await supabase.upsert('rh_events', [eventRow], 'id');
      if (r) evCount++;

      if (signups.length > 0) {
        const rows = signups.map(s => ({
          event_id:    event.id,
          signup_id:   `${s.discord_id}:${s.signup_index}`,
          discord_id:  s.discord_id,
          user_name:   null,   // not in embed mentions — could resolve via guild member fetch later
          status:      s.status,
          role:        null,
          class_name:  s.class_name,
          spec_name:   null,
          signed_at:   event.start_time,
          signup_index: s.signup_index,
          raw:         s,
          synced_at:   new Date().toISOString(),
        }));
        await supabase.upsert('rh_signups', rows, 'event_id,signup_id');
        sgCount += rows.length;
      } else {
        sgSkipped++;
      }
    }

    const lines = [
      `✅ Scanned ${scanned.length} RaidHelper event${scanned.length === 1 ? '' : 's'} in <#${channel.id}>.`,
      `📋 Events upserted: **${evCount}**`,
      `👥 Sign-ups upserted: **${sgCount}**`,
    ];
    if (sgSkipped > 0) lines.push(`⚠️ ${sgSkipped} event${sgSkipped === 1 ? '' : 's'} had no parseable sign-up fields (older / custom templates).`);
    lines.push('', 'View reconciliation at https://wolfpack.quest/admin/signups');
    return interaction.editReply(lines.join('\n'));
  },
};
