// commands/encounter.js — "What did I miss?" post-raid catch-up view.
//
// Designed for the busy player who was clutch-healing and couldn't alt-tab:
// they run /encounter after raid (from their phone if they want) and see
// every fight tonight, who contributed, what dropped, what they bid, and
// what they missed (with reasons).
//
// Subcommands:
//   /encounter tonight                — list all tonight's encounters
//   /encounter view id:<uuid prefix>  — details on one encounter
//   /encounter mine [character:<...>] — your character's involvement tonight
//
// Always ephemeral. Always read-only. Safe from any phone.

const { SlashCommandBuilder, MessageFlags, EmbedBuilder } = require('discord.js');
const supabase = require('../utils/supabase');
const { getCharacter, getAllNames } = require('../utils/roster');

function _fmt(n) { return (n || 0).toLocaleString(); }

function _fmtBar(score) {
  const pct = Math.max(0, Math.min(1, score || 0));
  const filled = Math.round(pct * 10);
  return '█'.repeat(filled) + '░'.repeat(10 - filled);
}

function _fmtDuration(sec) {
  if (!sec) return '?';
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m${s > 0 ? ` ${s}s` : ''}`;
}

function _fmtTimestamp(iso) {
  if (!iso) return '?';
  const d = new Date(iso);
  return `<t:${Math.floor(d.getTime() / 1000)}:t>`;
}

// ── tonight: list all encounters today (00:00–24:00 local) ──────────────────
async function _tonight(interaction) {
  const encounters = await supabase.getTonightEncounters(new Date());
  if (!Array.isArray(encounters) || encounters.length === 0) {
    return interaction.editReply({
      content:
        '📭 No encounters recorded today.\n' +
        'Either the raid hasn\'t happened yet, or no one\'s run /parse/parsecontrib/agent yet.',
    });
  }

  const lines = encounters.map(e => {
    const pct = Math.round((e.completeness_score || 0) * 100);
    return (
      `${_fmtTimestamp(e.started_at)} **${e.boss_name || `NPC ${e.npc_id}`}** ` +
      `· \`${e.id.slice(0, 8)}\` ` +
      `· ${_fmtDuration(e.duration_sec)} ` +
      `· ${e.contributor_count || 0}👥 ` +
      `· ${pct}% complete \`${_fmtBar(e.completeness_score)}\``
    );
  });

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`📅 Tonight's encounters (${encounters.length})`)
    .setDescription(lines.join('\n').slice(0, 4000))
    .setFooter({ text: 'Use /encounter view id:<first 8 chars> for details · 👥 = contributor count' });

  return interaction.editReply({ embeds: [embed] });
}

// ── view: details on one encounter ──────────────────────────────────────────
async function _view(interaction) {
  const idPrefix = interaction.options.getString('id');

  // Find the encounter by uuid prefix
  const found = await supabase.select(
    'encounter_completeness',
    `encounter_id=ilike.${encodeURIComponent(idPrefix.toLowerCase())}*&select=*&limit=2`
  );

  if (!Array.isArray(found) || found.length === 0) {
    return interaction.editReply({ content: `❌ No encounter matches \`${idPrefix}\`.` });
  }
  if (found.length > 1) {
    return interaction.editReply({
      content: `🔎 Multiple encounters match — extend your ID prefix.\n` +
               found.map(e => `\`${e.encounter_id.slice(0, 8)}\` ${e.boss_name} ${_fmtTimestamp(e.started_at)}`).join('\n'),
    });
  }

  const e = found[0];
  const [players, contributions, drops] = await Promise.all([
    supabase.getEncounterPlayers(e.encounter_id),
    supabase.getEncounterContributions(e.encounter_id),
    supabase.select('loot_drops', `encounter_id=eq.${e.encounter_id}&select=*`),
  ]);

  const pct = Math.round((e.completeness_score || 0) * 100);

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`☠️ ${e.boss_name || `NPC ${e.npc_id}`}`)
    .setDescription(
      `${_fmtTimestamp(e.started_at)} · ${_fmtDuration(e.duration_sec)}` +
      (e.zone_short ? ` · ${e.zone_short}` : '')
    )
    .addFields({
      name: '🎯 Completeness',
      value: `\`${_fmtBar(e.completeness_score)}\` **${pct}%** — ` +
             `${e.unique_attackers_seen} / ${e.raid_size_expected} unique attackers, ` +
             `${e.contributor_count || 0} contributors`,
      inline: false,
    });

  if (players?.length) {
    const top = players.slice(0, 12).map(p =>
      `\`#${String(p.rank).padStart(2)}\` **${p.character_name}** — ${_fmt(p.total_damage)} @ ${_fmt(p.dps)} DPS` +
      (p.has_pets ? ' +Pets' : '')
    );
    embed.addFields({
      name: `🗡️ Top ${Math.min(12, players.length)}`,
      value: top.join('\n').slice(0, 1024),
      inline: false,
    });
  }

  if (contributions?.length) {
    const list = contributions.map(c =>
      `• ${c.contributor_character || 'unknown'} · ${c.source} · ${_fmt(c.total_damage)} dmg seen, ${c.player_count} players`
    );
    embed.addFields({
      name: `👥 Contributions (${contributions.length})`,
      value: list.join('\n').slice(0, 1024),
      inline: false,
    });
  }

  if (Array.isArray(drops) && drops.length) {
    const lootLines = drops.map(d =>
      `• Item \`${d.item_id}\` × ${d.quantity || 1} → ` +
      (d.winner_character ? `**${d.winner_character}** for ${d.dkp_spent || 0} DKP` : '*unawarded*') +
      (d.lore_flagged ? ' 🔒' : '')
    );
    embed.addFields({
      name: `🎁 Loot (${drops.length})`,
      value: lootLines.join('\n').slice(0, 1024),
      inline: false,
    });
  }

  embed.setFooter({ text: `Encounter ${e.encounter_id}` });
  return interaction.editReply({ embeds: [embed] });
}

// ── mine: my character's involvement tonight ────────────────────────────────
async function _mine(interaction) {
  let name = interaction.options.getString('character');
  if (!name) {
    const guess = interaction.member?.displayName || interaction.user.username;
    const c = getCharacter(guess);
    if (c) name = c.name;
  }
  if (!name) {
    return interaction.editReply({
      content: '❓ Provide a character or set your Discord display name to match a roster name.',
    });
  }

  const rosterChar = getCharacter(name);
  if (!rosterChar) {
    return interaction.editReply({ content: `❌ **${name}** isn't in the roster.` });
  }

  // Day window
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const dayEnd   = new Date(dayStart); dayEnd.setDate(dayEnd.getDate() + 1);

  // Find encounters where this character appears in encounter_players
  const myRows = await supabase.select(
    'encounter_players',
    `character_name=eq.${encodeURIComponent(rosterChar.name)}&select=encounter_id,total_damage,dps,rank&order=rank.asc`
  );
  const myEncounterIds = (myRows || []).map(r => r.encounter_id);

  // Get all of tonight's encounters
  const tonight = await supabase.getTonightEncounters(new Date());
  const tonightIds = (tonight || []).map(e => e.encounter_id);

  const inIds  = tonightIds.filter(id => myEncounterIds.includes(id));
  const outIds = tonightIds.filter(id => !myEncounterIds.includes(id));

  // Loot won by this character tonight
  const lootWon = await supabase.select(
    'loot_drops',
    `winner_character=eq.${encodeURIComponent(rosterChar.name)}` +
    `&awarded_at=gte.${dayStart.toISOString()}` +
    `&awarded_at=lt.${dayEnd.toISOString()}` +
    `&select=*`
  );

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`📊 ${rosterChar.name} — tonight's recap`);

  // Encounters I was in
  if (inIds.length) {
    const lines = inIds.map(id => {
      const e = tonight.find(t => t.encounter_id === id);
      const me = myRows.find(r => r.encounter_id === id);
      return `${_fmtTimestamp(e.started_at)} **${e.boss_name || `NPC ${e.npc_id}`}** ` +
             `· #${me.rank} — ${_fmt(me.total_damage)} @ ${_fmt(me.dps)} DPS`;
    });
    embed.addFields({
      name: `✅ Fights I was in (${inIds.length})`,
      value: lines.join('\n').slice(0, 1024),
      inline: false,
    });
  } else {
    embed.addFields({
      name: `✅ Fights I was in`,
      value: 'None recorded. Either you missed tonight or no parser captured you.',
      inline: false,
    });
  }

  // Fights tonight I wasn't in (you missed)
  if (outIds.length) {
    const lines = outIds.slice(0, 8).map(id => {
      const e = tonight.find(t => t.encounter_id === id);
      return `${_fmtTimestamp(e.started_at)} **${e.boss_name || `NPC ${e.npc_id}`}** · \`${e.encounter_id.slice(0, 8)}\``;
    });
    if (outIds.length > 8) lines.push(`*…and ${outIds.length - 8} more*`);
    embed.addFields({
      name: `❌ Fights tonight I wasn't in (${outIds.length})`,
      value: lines.join('\n').slice(0, 1024) +
             '\n*Reasons could be: dead, out of range, on alt, or no contributor saw you.*',
      inline: false,
    });
  }

  // Loot won tonight
  if (Array.isArray(lootWon) && lootWon.length) {
    const lines = lootWon.map(l => `• Item \`${l.item_id}\` × ${l.quantity || 1} for ${l.dkp_spent || 0} DKP`);
    embed.addFields({
      name: `🎁 Won tonight (${lootWon.length})`,
      value: lines.join('\n').slice(0, 1024),
      inline: false,
    });
  }

  embed.setFooter({
    text: 'Run /dkp for your balance · /wishlist show to review your auto-bid list',
  });

  return interaction.editReply({ embeds: [embed] });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('encounter')
    .setDescription('Post-raid recap: what happened, what dropped, what you missed')
    .addSubcommand(s =>
      s.setName('tonight').setDescription('List all of tonight\'s recorded encounters')
    )
    .addSubcommand(s =>
      s.setName('view')
        .setDescription('Details on one encounter')
        .addStringOption(o => o.setName('id').setDescription('Encounter ID (first 8 chars from /encounter tonight)').setRequired(true))
    )
    .addSubcommand(s =>
      s.setName('mine')
        .setDescription('Your involvement tonight — fights, damage, loot won')
        .addStringOption(o => o.setName('character').setDescription('Default: your Discord display name').setAutocomplete(true))
    ),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused().toLowerCase();
    const names = getAllNames()
      .filter(n => !focused || n.includes(focused))
      .sort()
      .slice(0, 25);
    await interaction.respond(names.map(n => {
      const c = getCharacter(n);
      const label = c ? `${c.name} (${c.race} ${c.class})` : n;
      return { name: label.slice(0, 100), value: c?.name || n };
    }));
  },

  async execute(interaction) {
    if (!supabase.isEnabled()) {
      return interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: '❌ /encounter needs Supabase configured. SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required.',
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const sub = interaction.options.getSubcommand();
    try {
      if (sub === 'tonight') return await _tonight(interaction);
      if (sub === 'view')    return await _view(interaction);
      if (sub === 'mine')    return await _mine(interaction);
      return interaction.editReply({ content: `❌ Unknown subcommand: ${sub}` });
    } catch (err) {
      console.error('[encounter]', err);
      return interaction.editReply({ content: `⚠️ Error: ${err.message}` });
    }
  },
};
