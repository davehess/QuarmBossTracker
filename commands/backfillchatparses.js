// commands/backfillchatparses.js — Extract historical EQLogParser pastes from
// chat_messages and merge them as Supabase contributions with
// source='chat_extracted' (officers only).
//
// Why this exists: before the wolfpack-logsync agent, the only record of a
// kill's per-player damage was someone pasting EQLogParser output into /gu
// or /rs. Those lines now live in chat_messages (filled by the agent's
// --since / Opt-in Logs backfill). This command turns that text back into
// structured contributions.
//
// Caveats — see CLAUDE.md "Historical Parse Recovery — Limitations":
//   - DoT damage is NEVER in these parses (server-tick mechanic, no external
//     attribution) — necros/druids/shamans will look light.
//   - Damage shields attribute to the tank, not the DS caster.
//   - Reads via find_or_create_encounter (±30 min match) so a chat-extracted
//     parse merges into the same encounter as the agent-uploaded one when
//     both exist for the same kill.
//
// Idempotent via the contributions_dedup partial unique index on
// (encounter_id, source, contributor_character) — re-runs upsert in place.

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { hasOfficerRole, officerRolesList } = require('../utils/roles');
const supabase = require('../utils/supabase');
const { parseEQLog, findBossFromName } = require('../utils/parseEqLog');

const BOSSES = require('../data/bosses.json');

// EQ chat truncates around 250 chars, so a parse for 30+ players spans several
// consecutive chat lines from the same speaker. Window-merge rows from the
// same (channel, speaker) within this many ms before parsing.
const PARSE_LINE_WINDOW_MS = 15_000;

// Quick prefilter: only chat lines containing "in <N>s," and "Damage @" are
// candidates for the parser. Saves us running the full regex on every gem in
// /gu chatter.
const QUICK_PARSE_HINT = /\bin\s+\d+s,/i;

function groupParseLines(rows) {
  // rows ordered by ts ascending. Group consecutive rows from the same
  // (channel, speaker) within PARSE_LINE_WINDOW_MS. Each group becomes one
  // joined text we try to parse.
  const groups = [];
  let current  = null;
  for (const row of rows) {
    if (!QUICK_PARSE_HINT.test(row.text)) {
      // Trailing-only chat lines (just the player list, no header) still
      // belong to a recent group if one exists for this speaker/channel.
      if (current
          && current.channel === row.channel
          && current.speaker === row.speaker
          && Date.parse(row.ts) - current.lastTs <= PARSE_LINE_WINDOW_MS) {
        current.texts.push(row.text);
        current.lastTs = Date.parse(row.ts);
        continue;
      }
      // Otherwise this row isn't a parse candidate; skip it.
      continue;
    }
    if (current
        && current.channel === row.channel
        && current.speaker === row.speaker
        && Date.parse(row.ts) - current.lastTs <= PARSE_LINE_WINDOW_MS) {
      current.texts.push(row.text);
      current.lastTs = Date.parse(row.ts);
    } else {
      current = {
        channel: row.channel,
        speaker: row.speaker,
        startTs: Date.parse(row.ts),
        lastTs:  Date.parse(row.ts),
        texts:   [row.text],
      };
      groups.push(current);
    }
  }
  return groups;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('backfillchatparses')
    .setDescription('Extract historical /gu + /rs parse pastes into Supabase (officers only)')
    .addStringOption(o => o.setName('after_ts')
      .setDescription('Only process chat newer than this ISO timestamp (default: all time)').setRequired(false))
    .addIntegerOption(o => o.setName('limit')
      .setDescription('Max chat_messages rows to scan this run (default 10000)').setRequired(false))
    .addBooleanOption(o => o.setName('dryrun')
      .setDescription('Count what would be extracted without writing').setRequired(false)),

  async execute(interaction) {
    if (!hasOfficerRole(interaction.member)) {
      return interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: `❌ Only officers can run backfill. Required roles: ${officerRolesList()}`,
      });
    }
    if (!supabase.isEnabled()) {
      return interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: '❌ Supabase is not configured on this deploy.',
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const afterTs = interaction.options.getString('after_ts');
    const limit   = interaction.options.getInteger('limit') ?? 10000;
    const dryRun  = interaction.options.getBoolean('dryrun') ?? false;

    // Pull chat_messages in chronological order. We only need rows that could
    // contain a parse header — Postgres ILIKE is cheap with the chat_messages_ts
    // index helping the order-by.
    let query = `select=ts,channel,speaker,text&order=ts.asc&limit=${limit}` +
                `&text=ilike.*Damage @*`;
    if (afterTs) query += `&ts=gte.${encodeURIComponent(afterTs)}`;
    const rows = await supabase.select('chat_messages', query);
    if (!Array.isArray(rows)) {
      return interaction.editReply('❌ Failed to fetch chat_messages.');
    }
    if (rows.length === 0) {
      return interaction.editReply('No candidate chat lines found.' +
        (afterTs ? ` (after ${afterTs})` : ''));
    }

    const groups   = groupParseLines(rows);
    const parsed   = [];
    let unparsed = 0, noBoss = 0;
    const noBossNames = new Set();

    for (const g of groups) {
      const joined = g.texts.join(' | ');
      const result = parseEQLog(joined);
      if (!result) { unparsed++; continue; }
      const boss = findBossFromName(result.bossName, BOSSES);
      if (!boss) { noBoss++; noBossNames.add(result.bossName); continue; }
      parsed.push({ group: g, result, boss });
    }

    if (dryRun) {
      const sample = parsed.slice(0, 5).map(p =>
        `• ${p.boss.name} @ ${new Date(p.group.startTs).toISOString().slice(0, 16)} — ${p.result.players.length} players, ${p.group.speaker} (${p.group.channel})`
      ).join('\n');
      const lines = [
        `🧪 Dry run — scanned ${rows.length} chat lines → ${groups.length} parse candidates.`,
        `• ${parsed.length} would extract`,
        unparsed > 0 ? `• ${unparsed} failed parser (likely partial/garbled)` : null,
        noBoss > 0 ? `• ${noBoss} no boss match: ${[...noBossNames].slice(0, 5).join(', ')}${noBossNames.size > 5 ? '…' : ''}` : null,
        parsed.length > 0 ? `\nSample:\n${sample}` : null,
      ].filter(Boolean);
      return interaction.editReply(lines.join('\n'));
    }

    let pushed = 0, skipped = 0, errors = 0;
    let lastUpdate = Date.now();
    for (let i = 0; i < parsed.length; i++) {
      const { group, result, boss } = parsed[i];
      try {
        const res = await supabase.recordParse({
          bossInternalId:       boss.id,
          parsed: {
            bossName:    result.bossName,
            duration:    result.duration,
            totalDamage: result.totalDamage,
            totalDps:    result.totalDps,
            players:     result.players,
            eventCount:  0,
          },
          timestampMs:           group.startTs,
          contributorDiscordId:  null,
          contributorCharacter:  group.speaker,
          source:                'chat_extracted',
        });
        if (res?.encounterId) pushed++;
        else skipped++;
      } catch (err) {
        errors++;
        console.warn(`[chat-backfill] ${boss.id}@${new Date(group.startTs).toISOString()}: ${err?.message}`);
      }
      if (Date.now() - lastUpdate > 8000) {
        lastUpdate = Date.now();
        try { await interaction.editReply(`⏳ Extracting… ${i + 1}/${parsed.length} (${pushed} pushed, ${skipped} skipped, ${errors} errors).`); } catch {}
      }
    }

    const lines = [
      `✅ Extracted ${pushed}/${parsed.length} chat parses to Supabase.`,
      `• Scanned ${rows.length} candidate chat lines → ${groups.length} groups`,
      skipped > 0 ? `• ${skipped} skipped (boss not in bosses_local — opt-in required)` : null,
      unparsed > 0 ? `• ${unparsed} failed parser` : null,
      noBoss > 0 ? `• ${noBoss} no boss match in bosses.json: ${[...noBossNames].slice(0, 5).join(', ')}${noBossNames.size > 5 ? '…' : ''}` : null,
      errors > 0 ? `• ${errors} errors (see logs)` : null,
      rows.length === limit ? `\n• Hit row limit — re-run with \`after_ts: ${rows[rows.length - 1].ts}\` to continue.` : null,
    ].filter(Boolean);
    return interaction.editReply(lines.join('\n'));
  },
};
