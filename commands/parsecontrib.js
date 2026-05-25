// commands/parsecontrib.js — Multi-perspective parse contribution.
//
// Lets any guild member submit *their* EQLogParser perspective on a fight that
// someone else already officially recorded via /parse. Increases completeness
// when different raiders see different parts of the encounter (proximity gaps).
//
// Flow:
//   1. User pastes EQLogParser "Send to EQ" data (same format as /parse)
//   2. Bot parses it, detects boss
//   3. Looks up the matching encounter in Supabase (same boss, ±30 min window)
//   4. Records this submission as a contribution
//   5. Supabase merge_encounter_players() recomputes max-damage-per-character
//   6. Returns updated completeness score
//
// Requires Supabase. Falls back to a clear message if not configured.

const { SlashCommandBuilder, MessageFlags, EmbedBuilder } = require('discord.js');
const { parseEQLog, findBossFromName } = require('./parse');
const supabase = require('../utils/supabase');

function getBosses() {
  delete require.cache[require.resolve('../data/bosses.json')];
  return require('../data/bosses.json');
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('parsecontrib')
    .setDescription('Add your perspective on a fight someone else already parsed (multi-contributor)')
    .addStringOption(opt =>
      opt.setName('data')
        .setDescription('EQLogParser "Send to EQ" paste from your character\'s log')
        .setRequired(true)
        .setMaxLength(5000)
    )
    .addIntegerOption(opt =>
      opt.setName('window_minutes')
        .setDescription('How far back to search for the matching encounter (default: 30)')
        .setRequired(false)
        .setMinValue(5)
        .setMaxValue(180)
    ),

  async execute(interaction) {
    if (!supabase.isEnabled()) {
      return interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: '❌ Supabase is not configured. `/parsecontrib` requires `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to be set.',
      });
    }

    const rawData      = interaction.options.getString('data');
    const windowMin    = interaction.options.getInteger('window_minutes') ?? 30;

    const parsed = parseEQLog(rawData);
    if (!parsed) {
      return interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: '❌ Could not parse that data. Expected EQLogParser "Send to EQ" format.',
      });
    }

    const bosses = getBosses();
    const boss   = findBossFromName(parsed.bossName, bosses);
    if (!boss) {
      return interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: `❌ Couldn't match the boss name "**${parsed.bossName}**" to bosses.json. Officer can run \`/parseboss\` to associate it first.`,
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // Look for an existing encounter for this boss within the window.
    // find_or_create_encounter will create one if none exists — which is fine,
    // it means this person is the first to contribute for this kill.
    const result = await supabase.recordParse({
      bossInternalId:       boss.id,
      parsed,
      timestampMs:          Date.now(),
      contributorDiscordId: interaction.user.id,
      contributorCharacter: interaction.member?.displayName || interaction.user.username,
      source:               'eqlogparser_send_to_eq',
    });

    if (!result?.encounterId) {
      return interaction.editReply({
        content:
          '⚠️ Could not record contribution. Either Supabase is not configured, ' +
          'the boss is not yet mapped in `bosses_local`, or the upstream NPC table ' +
          'is not synced yet. Check the bot logs for details.',
      });
    }

    // Fetch updated completeness + merged player list
    const [completeness, players, contributions] = await Promise.all([
      supabase.getEncounterCompleteness(result.encounterId),
      supabase.getEncounterPlayers(result.encounterId),
      supabase.getEncounterContributions(result.encounterId),
    ]);

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(`📊 Contribution recorded — ${boss.name}`)
      .setDescription(
        `Added your perspective from **${parsed.players.length}** players ` +
        `(**${parsed.totalDamage.toLocaleString()}** total damage seen).`
      );

    if (completeness) {
      const score = Math.round((completeness.completeness_score || 0) * 100);
      const bar   = '█'.repeat(Math.floor(score / 10)) + '░'.repeat(10 - Math.floor(score / 10));
      embed.addFields({
        name:  '🎯 Encounter Completeness',
        value: `\`${bar}\` **${score}%**\n` +
               `${completeness.unique_attackers_seen} / ${completeness.raid_size_expected} unique attackers · ` +
               `${completeness.contributor_count} contributor${completeness.contributor_count === 1 ? '' : 's'}`,
        inline: false,
      });
    }

    if (contributions?.length) {
      const list = contributions
        .map(c => `• ${c.contributor_character || 'unknown'} — ${(c.total_damage || 0).toLocaleString()} dmg seen (${c.source})`)
        .join('\n');
      embed.addFields({ name: `👥 Contributions (${contributions.length})`, value: list.slice(0, 1024), inline: false });
    }

    if (players?.length) {
      const top = players.slice(0, 10)
        .map(p => `${p.rank}. **${p.character_name}** — ${(p.total_damage || 0).toLocaleString()} @ ${(p.dps || 0).toLocaleString()} DPS`)
        .join('\n');
      embed.addFields({ name: `🏆 Merged Top 10`, value: top.slice(0, 1024), inline: false });
    }

    embed.setFooter({ text: `Encounter ${result.encounterId.slice(0, 8)} · ±${windowMin}min match window` });

    return interaction.editReply({ embeds: [embed] });
  },
};
