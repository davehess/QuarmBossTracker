// commands/backfillparses.js — Backfill historic parses.json into Supabase
// (officers only). Idempotent: findOrCreateEncounter dedups within ±30 min,
// so running multiple times only adds missing rows.

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const fs   = require('fs');
const path = require('path');
const { hasOfficerRole, officerRolesList } = require('../utils/roles');
const supabase = require('../utils/supabase');

const PARSES_FILE = path.join(__dirname, '../data/parses.json');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('backfillparses')
    .setDescription('Push existing parses.json history into Supabase (officers only)')
    .addIntegerOption(o => o.setName('limit')
      .setDescription('Max entries to push this run (default 500)').setRequired(false))
    .addBooleanOption(o => o.setName('dryrun')
      .setDescription('Count what would be pushed without writing').setRequired(false)),

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
        content: '❌ Supabase is not configured on this deploy. Set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY first.',
      });
    }
    if (!fs.existsSync(PARSES_FILE)) {
      return interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: '❌ No parses.json found on this deploy.',
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const limit  = interaction.options.getInteger('limit') ?? 500;
    const dryRun = interaction.options.getBoolean('dryrun') ?? false;

    let parses;
    try { parses = JSON.parse(fs.readFileSync(PARSES_FILE, 'utf8')); }
    catch (err) { return interaction.editReply(`❌ Failed to read parses.json: ${err.message}`); }

    // Flatten { bossId: [entry, ...] } into a single array sorted oldest-first
    // so chronological progress is preserved across runs.
    const flat = [];
    for (const [bossId, entries] of Object.entries(parses)) {
      if (!Array.isArray(entries)) continue;
      for (const e of entries) {
        if (!e?.timestamp || !Array.isArray(e?.players)) continue;
        flat.push({ bossId, entry: e });
      }
    }
    flat.sort((a, b) => (a.entry.timestamp || 0) - (b.entry.timestamp || 0));

    const totalAvailable = flat.length;
    if (totalAvailable === 0) {
      return interaction.editReply('No parse entries found in parses.json.');
    }

    const target = flat.slice(0, limit);
    let pushed = 0, missingBoss = 0, errors = 0, skipped = 0;
    const missingBossIds = new Set();

    if (dryRun) {
      // Just count how many would map to known bosses_local rows
      for (const { bossId } of target) {
        const npcId = await supabase.getNpcIdForInternalId(bossId).catch(() => null);
        if (npcId) pushed++;
        else { missingBoss++; missingBossIds.add(bossId); }
      }
      const lines = [
        `🧪 Dry run — would push ${pushed} of ${target.length} entries (of ${totalAvailable} total in file).`,
        missingBoss > 0
          ? `• ${missingBoss} skipped (boss not in bosses_local): ${[...missingBossIds].slice(0, 10).join(', ')}${missingBossIds.size > 10 ? '…' : ''}`
          : '• All targeted bosses are mapped in bosses_local.',
      ];
      return interaction.editReply(lines.join('\n'));
    }

    // Update the user every ~25 rows so they don't think it hung
    let lastUpdate = Date.now();
    for (let i = 0; i < target.length; i++) {
      const { bossId, entry } = target[i];
      try {
        const result = await supabase.recordParse({
          bossInternalId:       bossId,
          parsed: {
            bossName:    entry.bossName || bossId,
            duration:    entry.duration,
            totalDamage: entry.totalDamage,
            totalDps:    entry.totalDps,
            players:     entry.players,
            eventCount:  entry.eventCount || 0,
          },
          timestampMs:           entry.timestamp,
          contributorDiscordId:  null,
          contributorCharacter:  entry.submittedByName || null,
          source:                entry.source || 'parses_json_backfill',
        });
        if (result?.encounterId) pushed++;
        else { missingBoss++; missingBossIds.add(bossId); }
      } catch (err) {
        errors++;
        console.warn(`[backfill] ${bossId}@${entry.timestamp} failed:`, err?.message);
      }

      if (Date.now() - lastUpdate > 8000) {
        lastUpdate = Date.now();
        try { await interaction.editReply(`⏳ Backfilling… ${i + 1}/${target.length} processed (${pushed} pushed, ${missingBoss} skipped, ${errors} errors).`); } catch {}
      }
    }

    const lines = [
      `✅ Backfill complete — ${pushed}/${target.length} pushed to Supabase (${totalAvailable} total in file).`,
      missingBoss > 0
        ? `• ${missingBoss} skipped (boss not in bosses_local): ${[...missingBossIds].slice(0, 10).join(', ')}${missingBossIds.size > 10 ? '…' : ''}`
        : null,
      errors > 0 ? `• ${errors} errors (see logs)` : null,
      target.length < totalAvailable
        ? `• Run again with \`limit: ${totalAvailable - target.length}\` to push the rest.`
        : null,
    ].filter(Boolean);
    return interaction.editReply(lines.join('\n'));
  },
};
