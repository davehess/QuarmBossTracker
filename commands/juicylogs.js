// commands/juicylogs.js — Show characters most likely to have rich agent logs
// for historical backfill, ranked by raid attendance. Officer-only.
//
// "Juicy" = the character's eqlog_<name>_pq.proj.txt is most likely to contain
// the most boss kills + chat + /who history because they raided the most.
// Useful for picking who to nag about installing wolfpack-logsync and pointing
// it at their old logs.
//
// Sourced from opendkp_attendance_recent (built from opendkp_ticks) so it
// requires the OpenDKP mirror to be populated. Cross-references the agent's
// known uploaders (encounter contributions in the last 14 days) to flag who's
// ALREADY contributing so officers don't waste a ping on them.

const { SlashCommandBuilder, MessageFlags, EmbedBuilder } = require('discord.js');
const { hasOfficerRole, officerRolesList } = require('../utils/roles');
const supabase = require('../utils/supabase');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('juicylogs')
    .setDescription('Rank characters by raid attendance — pick who to ask for log backfill (officers only)')
    .addIntegerOption(o => o.setName('top')
      .setDescription('How many characters to show (default 20, max 50)').setRequired(false))
    .addStringOption(o => o.setName('window')
      .setDescription('Attendance window — last 30d, last 90d, or all time')
      .addChoices(
        { name: 'Last 30 days', value: '30' },
        { name: 'Last 90 days', value: '90' },
        { name: 'All time',     value: 'all' },
      ).setRequired(false)),

  async execute(interaction) {
    if (!hasOfficerRole(interaction.member)) {
      return interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: `❌ Officers only. Required roles: ${officerRolesList()}`,
      });
    }
    if (!supabase.isEnabled()) {
      return interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: '❌ Supabase not configured.',
      });
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const top    = Math.min(50, Math.max(1, interaction.options.getInteger('top') ?? 20));
    const window = interaction.options.getString('window') ?? '90';
    const sortCol = window === '30' ? 'last_30d' : window === '90' ? 'last_90d' : 'raids_attended';

    const rows = await supabase.select(
      'opendkp_attendance_recent',
      `select=character_name,raids_attended,last_30d,last_90d,last_attended&order=${sortCol}.desc&limit=${top}`
    );
    if (!Array.isArray(rows) || rows.length === 0) {
      return interaction.editReply([
        '⚠️ No attendance data in Supabase yet.',
        '• If OpenDKP creds are configured, the mirror sync runs ~45s after bot startup and every 6h.',
        '• You can force one now with `/syncopendkp`.',
      ].join('\n'));
    }

    // Who's already uploading agent logs? Pull distinct contributor_character
    // from contributions in the last 14 days as a "covered" set.
    const recentSince = new Date(Date.now() - 14 * 86400 * 1000).toISOString();
    const contributors = await supabase.select(
      'contributions',
      `select=contributor_character&contributor_character=not.is.null&created_at=gte.${recentSince}`
    );
    const coveredSet = new Set(
      Array.isArray(contributors) ? contributors.map(c => (c.contributor_character || '').toLowerCase()) : []
    );

    const labelWindow = window === '30' ? 'last 30 days' : window === '90' ? 'last 90 days' : 'all time';
    const lines = rows.map((r, i) => {
      const covered = coveredSet.has((r.character_name || '').toLowerCase());
      const tag = covered ? '🟢' : '⚪';   // green dot = already contributing
      const count = window === '30' ? r.last_30d : window === '90' ? r.last_90d : r.raids_attended;
      return `${(i + 1).toString().padStart(2, ' ')}. ${tag} **${r.character_name}** — ${count} raid${count === 1 ? '' : 's'}`;
    });

    const embed = new EmbedBuilder()
      .setTitle(`🩸 Juicy logs — top ${rows.length} by attendance (${labelWindow})`)
      .setDescription(lines.join('\n'))
      .setFooter({ text: '🟢 = already uploading agent logs (last 14d) — skip · ⚪ = not yet, good candidate' })
      .setColor(0xb37bf7);

    return interaction.editReply({ embeds: [embed] });
  },
};
