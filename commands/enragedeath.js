// commands/enragedeath.js — Officer command to log a player death to boss
// enrage. Powers the "days since <character> died to enrage" counter on /fun.
// (Uilnayar 2026-06-26: Moash's "0 raids since enrage death" joke with the
// previous streak struck through — Shavimo posted the joke version manually
// in Discord, this makes it a real automated card on /fun.)

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { hasAllowedRole, allowedRolesList } = require('../utils/roles');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('enragedeath')
    .setDescription('Log a player death to boss enrage. Resets the /fun "days since enrage death" counter. (Officers only)')
    .addStringOption(opt =>
      opt.setName('player').setDescription('Character who died').setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('boss').setDescription('Boss whose enrage killed them (optional)').setRequired(false)
    )
    .addStringOption(opt =>
      opt.setName('when').setDescription('ISO timestamp, defaults to now').setRequired(false)
    ),

  async execute(interaction) {
    if (!hasAllowedRole(interaction.member)) {
      return interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: `❌ You need one of these roles: ${allowedRolesList()}`,
      });
    }

    const player = (interaction.options.getString('player') || '').trim();
    const boss   = (interaction.options.getString('boss')   || '').trim() || null;
    const when   = (interaction.options.getString('when')   || '').trim();
    if (!player) {
      return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ player required.' });
    }
    const event_ts = when ? new Date(when).toISOString() : new Date().toISOString();
    if (Number.isNaN(Date.parse(event_ts))) {
      return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Invalid `when` timestamp.' });
    }

    const supabase = require('../utils/supabase');
    if (!supabase.isEnabled()) {
      return interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: '❌ Supabase is not configured — cannot record enrage death.',
      });
    }

    try {
      await supabase.upsert(
        'fun_events',
        [{
          guild_id:   process.env.SUPABASE_GUILD_ID || 'wolfpack',
          event_ts,
          event_type: 'enrage_death',
          caster:     player,
          target:     boss,
          raw_text:   boss ? `enrage death vs ${boss}` : 'enrage death',
          uploaded_by_discord_id: interaction.user.id,
        }],
        'guild_id,event_type,caster,event_ts',
      );
    } catch (err) {
      return interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: `❌ Failed to record: ${err?.message || 'unknown error'}`,
      });
    }

    return interaction.reply({
      content:
        `💀 Recorded enrage death for **${player}**` +
        (boss ? ` vs ${boss}` : '') +
        ` at ${event_ts.slice(0, 19).replace('T', ' ')} UTC.` +
        `\n\nThe **\`0 days since enrage death\`** counter on /fun will reset.`,
    });
  },
};
