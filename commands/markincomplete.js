// commands/markincomplete.js — Officer toggle for encounters.data_incomplete.
//
// Setting this flag does two things:
//   1. The /api/agent/incomplete-encounters endpoint starts returning the
//      encounter to any agent polling for one of its players. The agent's
//      localhost:7777 dashboard then shows a "we need your logs" banner and
//      highlights matching files on the Opt-in Logs page.
//   2. The /parses/[id] page can render a "data incomplete" notice with the
//      stated reason so guildies know what's being asked for.

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { hasOfficerRole, officerRolesList } = require('../utils/roles');
const supabase = require('../utils/supabase');

const UUID_RX = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/;

function parseEncounterArg(raw) {
  const m = String(raw || '').match(UUID_RX);
  return m ? m[0] : null;
}

async function recentEncounterChoices(query) {
  if (!supabase.isEnabled()) return [];
  const rows = await supabase.select(
    'encounters',
    'select=id,started_at,total_damage,data_incomplete,eqemu_npc_types(name)&total_damage=gt.0&order=started_at.desc&limit=25'
  );
  if (!Array.isArray(rows)) return [];
  const q = (query || '').toLowerCase().trim();
  return rows
    .map(r => {
      const boss = r.eqemu_npc_types?.name || '(unknown)';
      const when = new Date(r.started_at).toLocaleString('en-US', {
        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
      });
      const flag = r.data_incomplete ? ' [INCOMPLETE]' : '';
      return { name: `${when} — ${boss}${flag}`.slice(0, 100), value: r.id };
    })
    .filter(c => !q || c.name.toLowerCase().includes(q))
    .slice(0, 25);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('markincomplete')
    .setDescription('Flag an encounter as missing data; agents nudge players to opt-in (officers only)')
    .addStringOption(o => o.setName('encounter')
      .setDescription('Encounter — pick from recent kills or paste a UUID / URL')
      .setRequired(true)
      .setAutocomplete(true))
    .addStringOption(o => o.setName('reason')
      .setDescription('What\'s missing? e.g. "no necro / DoT data", "no tank perspective", "missing healers"')
      .setRequired(false))
    .addBooleanOption(o => o.setName('clear')
      .setDescription('Set true to unflag (mark as complete again)')
      .setRequired(false)),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused();
    const choices = await recentEncounterChoices(focused);
    await interaction.respond(choices).catch(() => {});
  },

  async execute(interaction) {
    if (!hasOfficerRole(interaction.member)) {
      return interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: `❌ Officers only. Required roles: ${officerRolesList()}`,
      });
    }
    if (!supabase.isEnabled()) {
      return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Supabase not configured.' });
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const id = parseEncounterArg(interaction.options.getString('encounter', true));
    if (!id) return interaction.editReply('❌ Couldn\'t extract a UUID from your input.');

    const clearing = interaction.options.getBoolean('clear') ?? false;
    const reason   = interaction.options.getString('reason') || null;

    const updated = await supabase.update(
      'encounters',
      `id=eq.${id}`,
      clearing
        ? { data_incomplete: false, data_incomplete_reason: null, data_incomplete_at: null, data_incomplete_by: null }
        : {
            data_incomplete: true,
            data_incomplete_reason: reason,
            data_incomplete_at: new Date().toISOString(),
            data_incomplete_by: interaction.user.id,
          },
    );

    if (!Array.isArray(updated) || updated.length === 0) {
      return interaction.editReply(`❌ Encounter ${id} not found or update failed.`);
    }

    // Pull the player list so we can tell the officer which characters will
    // see the "we need your help" banner once their agent next polls.
    const players = await supabase.select(
      'encounter_players',
      `encounter_id=eq.${id}&select=character_name&order=total_damage.desc`,
    );
    const names = Array.isArray(players)
      ? players.map(p => p.character_name).slice(0, 20).join(', ')
      : '(unable to fetch)';

    if (clearing) {
      return interaction.editReply(`✅ Encounter ${id} marked complete. Agent banners will stop nagging the ${players?.length || 0} players who were in it.`);
    }
    return interaction.editReply([
      `✅ Encounter ${id} flagged as data-incomplete${reason ? `: "${reason}"` : ''}.`,
      `Agents running on these ${players?.length || 0} players will see the nudge banner on their next dashboard poll:`,
      `${names}${players?.length > 20 ? '…' : ''}`,
    ].join('\n'));
  },
};
